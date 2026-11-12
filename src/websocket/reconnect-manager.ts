/**
 * Reconnect Manager - Exponential Backoff + Jitter
 *
 * Implements context-aware reconnect policy with exponential backoff and jitter.
 * Key features from DESIGN_DOCUMENT.md §7.5:
 * - Equal jitter: [cap / 2, cap] - prevents thundering herd
 * - Context-aware: aggressive during active call, conservative when idle
 * - Non-retryable error detection (TOKEN_EXPIRED, KICKED, PERMISSION_DENIED, etc.)
 * - Background: only reconnect if active call (VoIP handles incoming)
 * - Max 30s delay cap, max 10-30 attempts depending on context
 */

import { CallConnectionState, NetworkType } from "./battery-heartbeat";

/**
 * WebSocket error codes for reconnect policy
 */
export enum WSErrorCode {
  // Non-retryable
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  TOKEN_REVOKED = "TOKEN_REVOKED",
  KICKED_FROM_ROOM = "KICKED_FROM_ROOM",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  USER_LEFT_ROOM = "USER_LEFT_ROOM",
  CALL_ENDED = "CALL_ENDED",

  // Retryable
  NETWORK_ERROR = "NETWORK_ERROR",
  SERVER_UNAVAILABLE = "SERVER_UNAVAILABLE",
  CONNECTION_CLOSED = "CONNECTION_CLOSED",
  PROTOCOL_ERROR = "PROTOCOL_ERROR",
  APP_HEARTBEAT_TIMEOUT = "APP_PONG_TIMEOUT",
  PROTOCOL_PONG_TIMEOUT = "PROTOCOL_PONG_TIMEOUT",
  UNKNOWN = "UNKNOWN",
}

/**
 * WebSocket error with code and metadata
 */
export interface WSError {
  code: WSErrorCode | string;
  message: string;
  recoverable: boolean;
  retryAfter?: number; // Server-suggested retry delay (ms)
  statusCode?: number; // HTTP/WebSocket status code
}

/**
 * Reconnect context for policy decisions
 */
export interface ReconnectContext {
  /** Current call connection state */
  callState: CallConnectionState;
  /** Whether app is in background */
  isBackground: boolean;
  /** Current network type */
  networkType: NetworkType;
  /** Whether there's an active call */
  hasActiveCall: boolean;
  /** Current call ID if applicable */
  callId?: string;
  /** Current retry attempt number */
  attempt: number;
  /** Last error that triggered reconnect */
  lastError?: WSError;
}

/**
 * Reconnect delay calculation result
 */
export interface ReconnectDelay {
  /** Delay in milliseconds */
  delayMs: number;
  /** Whether this is the final attempt */
  isFinalAttempt: boolean;
  /** Maximum attempts allowed for this context */
  maxRetries: number;
}

/**
 * Reconnect policy configuration
 */
export interface ReconnectPolicyConfig {
  /** Base delay for exponential backoff (ms) */
  baseDelayMs: number;
  /** Maximum delay cap (ms) */
  maxDelayMs: number;
  /** Jitter factor (0-1) for equal jitter [cap/2, cap] */
  jitterFactor: number;
  /** Maximum retries during active call */
  maxRetriesActiveCall: number;
  /** Maximum retries when idle */
  maxRetriesIdle: number;
  /** Maximum retries for server unavailable */
  maxRetriesServerUnavailable: number;
  /** Maximum retries for network errors */
  maxRetriesNetworkError: number;
  /** Faster retry cap during active call (ms) */
  activeCallRetryCapMs: number;
  /** Slower retry cap when idle (ms) */
  idleRetryCapMs: number;
}

/**
 * Default reconnect policy configuration
 */
export const DEFAULT_RECONNECT_POLICY_CONFIG: ReconnectPolicyConfig = {
  baseDelayMs: 1_000,        // 1s base
  maxDelayMs: 30_000,        // 30s max cap
  jitterFactor: 0.5,         // Equal jitter: [cap/2, cap]
  maxRetriesActiveCall: 30,  // More retries during active call
  maxRetriesIdle: 10,        // Fewer retries when idle (battery saving)
  maxRetriesServerUnavailable: 15,
  maxRetriesNetworkError: 20,
  activeCallRetryCapMs: 10_000,  // Faster retry during call
  idleRetryCapMs: 30_000,        // Slower retry when idle
};

/**
 * ReconnectManager - Handles reconnect logic with exponential backoff + jitter
 */
export class ReconnectManager {
  private config: ReconnectPolicyConfig;
  private attempt = 0;
  private isReconnecting = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private abortController?: AbortController;

  // Callbacks
  private onReconnectAttempt?: (attempt: number, delay: number, context: ReconnectContext) => void;
  private onReconnectSuccess?: (context: ReconnectContext) => void;
  private onReconnectFailed?: (error: Error, context: ReconnectContext) => void;
  private onMaxRetriesExceeded?: (context: ReconnectContext) => void;
  private connectFn?: () => Promise<void>;

  constructor(
    config: Partial<ReconnectPolicyConfig> = {},
    callbacks: {
      onReconnectAttempt?: (attempt: number, delay: number, context: ReconnectContext) => void;
      onReconnectSuccess?: (context: ReconnectContext) => void;
      onReconnectFailed?: (error: Error, context: ReconnectContext) => void;
      onMaxRetriesExceeded?: (context: ReconnectContext) => void;
      connectFn?: () => Promise<void>;
    } = {}
  ) {
    this.config = { ...DEFAULT_RECONNECT_POLICY_CONFIG, ...config };
    this.onReconnectAttempt = callbacks.onReconnectAttempt;
    this.onReconnectSuccess = callbacks.onReconnectSuccess;
    this.onReconnectFailed = callbacks.onReconnectFailed;
    this.onMaxRetriesExceeded = callbacks.onMaxRetriesExceeded;
    this.connectFn = callbacks.connectFn;
  }

  /**
   * Schedule a reconnect attempt
   */
  scheduleReconnect(
    error: WSError | string,
    context: ReconnectContext
  ): void {
    if (this.isReconnecting) {
      console.log("[ReconnectManager] Already reconnecting, skipping");
      return;
    }

    // Normalize error
    const wsError = typeof error === "string"
      ? { code: error as WSErrorCode, message: error, recoverable: true }
      : error;

    // Check if we should reconnect
    if (!this.shouldReconnect(wsError, context)) {
      console.log(`[ReconnectManager] Non-retryable error: ${wsError.code}, not reconnecting`);
      return;
    }

    // Check max retries
    const maxRetries = this.getMaxRetries(wsError, context);
    if (context.attempt >= maxRetries) {
      console.log(`[ReconnectManager] Max retries (${maxRetries}) exceeded for ${wsError.code}`);
      this.onMaxRetriesExceeded?.(context);
      return;
    }

    // Calculate delay
    const delay = this.getDelay(context.attempt, wsError, context);

    console.log(
      `[ReconnectManager] Scheduling reconnect attempt ${context.attempt + 1}/${maxRetries} ` +
      `in ${delay.delayMs}ms (error: ${wsError.code})`
    );

    this.isReconnecting = true;
    this.attempt = context.attempt;

    // Create abort controller for this attempt
    this.abortController = new AbortController();

    // Notify attempt
    this.onReconnectAttempt?.(this.attempt + 1, delay.delayMs, context);

    // Schedule reconnect
    this.reconnectTimer = setTimeout(() => {
      this.executeReconnect(wsError, context);
    }, delay.delayMs);

    this.reconnectTimer.unref?.();
  }

  /**
   * Execute the reconnect attempt
   */
  private async executeReconnect(
    error: WSError,
    context: ReconnectContext
  ): Promise<void> {
    this.isReconnecting = false;

    if (this.abortController?.signal.aborted) {
      console.log("[ReconnectManager] Reconnect aborted");
      return;
    }

    if (!this.connectFn) {
      console.error("[ReconnectManager] No connect function provided");
      this.onReconnectFailed?.(new Error("No connect function"), context);
      return;
    }

    try {
      console.log(`[ReconnectManager] Attempting reconnect (attempt ${this.attempt + 1})...`);
      await this.connectFn();
      console.log("[ReconnectManager] Reconnect successful!");
      this.onReconnectSuccess?.(context);
      this.reset();
    } catch (reconnectError) {
      console.error("[ReconnectManager] Reconnect failed:", reconnectError);

      // Increment attempt for next retry
      const nextAttempt = this.attempt + 1;

      // Schedule next attempt with updated context
      this.scheduleReconnect(error, {
        ...context,
        attempt: nextAttempt,
        lastError: error,
      });
    }
  }

  /**
   * Determine if we should reconnect based on error and context
   */
  shouldReconnect(error: WSError, context: ReconnectContext): boolean {
    // NON-RETRYABLE: Never reconnect
    const nonRetryableCodes: WSErrorCode[] = [
      WSErrorCode.TOKEN_EXPIRED,
      WSErrorCode.TOKEN_REVOKED,
      WSErrorCode.KICKED_FROM_ROOM,
      WSErrorCode.PERMISSION_DENIED,
      WSErrorCode.USER_LEFT_ROOM,
      WSErrorCode.CALL_ENDED,
    ];

    if (nonRetryableCodes.includes(error.code as WSErrorCode)) {
      return false;
    }

    // If error explicitly marked as non-recoverable
    if (error.recoverable === false) {
      return false;
    }

    // BACKGROUND: Only reconnect if we have an active call
    // (VoIP push will handle incoming calls)
    if (context.isBackground && !context.hasActiveCall) {
      return false;
    }

    // RETRYABLE: Network issues, server restart, temporary errors
    return true;
  }

  /**
   * Get maximum retries for error and context
   */
  getMaxRetries(error: WSError, context: ReconnectContext): number {
    // More retries during active call
    if (context.hasActiveCall) {
      if (error.code === WSErrorCode.SERVER_UNAVAILABLE) {
        return this.config.maxRetriesServerUnavailable;
      }
      if (error.code === WSErrorCode.NETWORK_ERROR) {
        return this.config.maxRetriesNetworkError;
      }
      return this.config.maxRetriesActiveCall;
    }

    // Fewer retries when idle (battery saving)
    if (error.code === WSErrorCode.SERVER_UNAVAILABLE) {
      return Math.min(this.config.maxRetriesServerUnavailable, this.config.maxRetriesIdle);
    }
    if (error.code === WSErrorCode.NETWORK_ERROR) {
      return Math.min(this.config.maxRetriesNetworkError, 5);
    }
    return Math.min(this.config.maxRetriesIdle, 3);
  }

  /**
   * Calculate reconnect delay with exponential backoff + equal jitter
   */
  getDelay(attempt: number, error: WSError, context: ReconnectContext): ReconnectDelay {
    // Check for server-suggested retry-after
    if (error.retryAfter && error.retryAfter > 0) {
      return {
        delayMs: error.retryAfter,
        isFinalAttempt: false,
        maxRetries: this.getMaxRetries(error, context),
      };
    }

    // Exponential backoff: 2^attempt * baseDelay
    const exponent = Math.min(Math.max(attempt, 0), 10); // Cap exponent at 10
    const rawDelay = Math.min(
      Math.pow(2, exponent) * this.config.baseDelayMs,
      this.config.maxDelayMs
    );

    // Equal jitter: [cap/2, cap] - prevents thundering herd
    const jitter = rawDelay * this.config.jitterFactor;
    const delay = Math.floor(rawDelay / 2 + Math.random() * jitter);

    // Apply context-specific caps
    let finalDelay = delay;
    if (context.hasActiveCall) {
      finalDelay = Math.min(delay, this.config.activeCallRetryCapMs);
      if (error.code === WSErrorCode.NETWORK_ERROR) {
        finalDelay = Math.min(delay, 3_000); // Very fast for network errors during call
      }
    } else {
      finalDelay = Math.min(delay, this.config.idleRetryCapMs);
      if (error.code === WSErrorCode.NETWORK_ERROR) {
        finalDelay = Math.min(delay, 10_000);
      }
    }

    const maxRetries = this.getMaxRetries(error, context);
    const isFinalAttempt = attempt + 1 >= maxRetries;

    return {
      delayMs: finalDelay,
      isFinalAttempt,
      maxRetries,
    };
  }

  /**
   * Cancel any pending reconnect
   */
  cancel(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = undefined;
    }
    this.isReconnecting = false;
    console.log("[ReconnectManager] Reconnect cancelled");
  }

  /**
   * Reset reconnect state (call on successful connection)
   */
  reset(): void {
    this.attempt = 0;
    this.isReconnecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  /**
   * Check if currently reconnecting
   */
  isCurrentlyReconnecting(): boolean {
    return this.isReconnecting;
  }

  /**
   * Get current attempt number
   */
  getCurrentAttempt(): number {
    return this.attempt;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ReconnectPolicyConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Static helper to calculate delay (for testing/external use)
   */
  static calculateDelay(
    attempt: number,
    config: Partial<ReconnectPolicyConfig> = {}
  ): number {
    const mergedConfig = { ...DEFAULT_RECONNECT_POLICY_CONFIG, ...config };
    const exponent = Math.min(Math.max(attempt, 0), 10);
    const rawDelay = Math.min(
      Math.pow(2, exponent) * mergedConfig.baseDelayMs,
      mergedConfig.maxDelayMs
    );
    // Equal jitter
    return Math.floor(rawDelay / 2 + Math.random() * (rawDelay * mergedConfig.jitterFactor));
  }
}

/**
 * Create a reconnect manager with default config
 */
export function createReconnectManager(
  callbacks: {
    onReconnectAttempt?: (attempt: number, delay: number, context: ReconnectContext) => void;
    onReconnectSuccess?: (context: ReconnectContext) => void;
    onReconnectFailed?: (error: Error, context: ReconnectContext) => void;
    onMaxRetriesExceeded?: (context: ReconnectContext) => void;
    connectFn?: () => Promise<void>;
  },
  config?: Partial<ReconnectPolicyConfig>
): ReconnectManager {
  return new ReconnectManager(config, callbacks);
}

/**
 * Parse WebSocket close code to error
 */
export function parseCloseCode(code: number, reason: string): WSError {
  switch (code) {
    case 1000: // Normal closure
      return { code: WSErrorCode.CALL_ENDED, message: reason, recoverable: false };
    case 1001: // Going away
      return { code: WSErrorCode.CONNECTION_CLOSED, message: reason, recoverable: true };
    case 1002: // Protocol error
      return { code: WSErrorCode.PROTOCOL_ERROR, message: reason, recoverable: true };
    case 1003: // Unsupported data
      return { code: WSErrorCode.PROTOCOL_ERROR, message: reason, recoverable: false };
    case 1008: // Policy violation
      return { code: WSErrorCode.PERMISSION_DENIED, message: reason, recoverable: false };
    case 1009: // Too large
      return { code: WSErrorCode.PROTOCOL_ERROR, message: reason, recoverable: false };
    case 1011: // Internal error
      return { code: WSErrorCode.SERVER_UNAVAILABLE, message: reason, recoverable: true };
    case 4001: // Custom: Token expired
      return { code: WSErrorCode.TOKEN_EXPIRED, message: reason, recoverable: false };
    case 4002: // Custom: Token revoked
      return { code: WSErrorCode.TOKEN_REVOKED, message: reason, recoverable: false };
    case 4003: // Custom: Kicked
      return { code: WSErrorCode.KICKED_FROM_ROOM, message: reason, recoverable: false };
    case 4004: // Custom: Permission denied
      return { code: WSErrorCode.PERMISSION_DENIED, message: reason, recoverable: false };
    default:
      return { code: WSErrorCode.UNKNOWN, message: `Close code ${code}: ${reason}`, recoverable: true };
  }
}