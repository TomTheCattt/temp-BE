/**
 * Protocol Heartbeat - Kernel-managed WebSocket Ping/Pong
 *
 * This implements the protocol-level heartbeat using WebSocket ping/pong frames.
 * These are handled by the OS/kernel network stack (NWConnection on iOS, OkHttp on Android),
 * making them extremely battery-efficient with near-zero application overhead.
 *
 * SPEC (from DESIGN_DOCUMENT.md §7.5):
 * - Interval: 25 seconds (keeps NAT/firewall mappings alive)
 * - Timeout: 15 seconds (if no pong, connection is dead)
 * - Must be < Load Balancer idle timeout (typically 60s)
 * - Used ALWAYS (idle, background, active call) as base keep-alive
 */

import { WebSocket } from "ws";

/**
 * Protocol heartbeat configuration
 */
export interface ProtocolHeartbeatConfig {
  /** Ping interval in milliseconds (default: 25000 = 25s) */
  pingInterval: number;
  /** Pong timeout in milliseconds (default: 15000 = 15s) */
  pongTimeout: number;
  /** Load balancer idle timeout (default: 55000 = 55s) - must be < LB timeout */
  lbIdleTimeout: number;
}

/**
 * Default protocol heartbeat configuration (battery-optimized)
 */
export const DEFAULT_PROTOCOL_HEARTBEAT_CONFIG: ProtocolHeartbeatConfig = {
  pingInterval: 25_000,   // 25s - keeps NAT/firewall mappings alive
  pongTimeout: 15_000,    // 15s - if no pong, connection is dead
  lbIdleTimeout: 55_000,  // 55s - must be < LB timeout (typically 60s)
};

/**
 * Protocol heartbeat state
 */
export interface ProtocolHeartbeatState {
  isRunning: boolean;
  lastPingSent: number;
  lastPongReceived: number;
  consecutiveFailures: number;
  timer?: ReturnType<typeof setInterval>;
  pongTimeoutTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Callbacks for protocol heartbeat events
 */
export interface ProtocolHeartbeatCallbacks {
  /** Called when pong timeout occurs (connection likely dead) */
  onPongTimeout: (consecutiveFailures: number) => void;
  /** Called when pong is received */
  onPongReceived: (rtt: number) => void;
  /** Called when ping is sent */
  onPingSent?: () => void;
}

/**
 * ProtocolHeartbeat - Manages kernel-level WebSocket ping/pong
 *
 * Uses WebSocket's native ping/pong frames which are handled by the OS network stack.
 * On iOS/macOS: NWConnection handles this in kernel
 * On Android: OkHttp/WebSocket handles this in native layer
 * On Node.js: ws library handles this in C++ addon
 */
export class ProtocolHeartbeat {
  private config: ProtocolHeartbeatConfig;
  private state: ProtocolHeartbeatState;
  private callbacks: ProtocolHeartbeatCallbacks;
  private socket: WebSocket | null = null;

  constructor(
    config: Partial<ProtocolHeartbeatConfig> = {},
    callbacks: ProtocolHeartbeatCallbacks
  ) {
    this.config = { ...DEFAULT_PROTOCOL_HEARTBEAT_CONFIG, ...config };
    this.callbacks = callbacks;
    this.state = {
      isRunning: false,
      lastPingSent: 0,
      lastPongReceived: 0,
      consecutiveFailures: 0,
    };
  }

  /**
   * Attach to a WebSocket socket
   */
  attach(socket: WebSocket): void {
    this.socket = socket;

    // Listen for pong responses (WebSocket protocol level)
    socket.on("pong", (data: Buffer) => {
      this.handlePong(data);
    });

    // Listen for close to clean up
    socket.on("close", () => {
      this.stop();
    });

    socket.on("error", () => {
      this.stop();
    });
  }

  /**
   * Start the protocol heartbeat
   */
  start(): void {
    if (this.state.isRunning) return;

    this.state.isRunning = true;
    this.state.consecutiveFailures = 0;

    // Send initial ping
    this.sendPing();

    // Set up interval
    this.state.timer = setInterval(() => {
      if (!this.state.isRunning) return;
      this.sendPing();
    }, this.config.pingInterval);

    // Don't prevent process exit
    this.state.timer.unref?.();

    console.log(`[ProtocolHeartbeat] Started (interval: ${this.config.pingInterval}ms, timeout: ${this.config.pongTimeout}ms)`);
  }

  /**
   * Stop the protocol heartbeat
   */
  stop(): void {
    if (!this.state.isRunning) return;

    this.state.isRunning = false;

    if (this.state.timer) {
      clearInterval(this.state.timer);
      this.state.timer = undefined;
    }

    if (this.state.pongTimeoutTimer) {
      clearTimeout(this.state.pongTimeoutTimer);
      this.state.pongTimeoutTimer = undefined;
    }

    console.log("[ProtocolHeartbeat] Stopped");
  }

  /**
   * Send a WebSocket ping frame
   */
  private sendPing(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn("[ProtocolHeartbeat] Cannot send ping - socket not open");
      return;
    }

    try {
      // Send ping frame with current timestamp as payload
      const payload = Buffer.from(Date.now().toString());
      this.socket.ping(payload);
      this.state.lastPingSent = Date.now();

      // Set timeout for pong response
      this.state.pongTimeoutTimer = setTimeout(() => {
        this.handlePongTimeout();
      }, this.config.pongTimeout);

      this.callbacks.onPingSent?.();
    } catch (error) {
      console.error("[ProtocolHeartbeat] Failed to send ping:", error);
      this.handlePongTimeout();
    }
  }

  /**
   * Handle incoming pong
   */
  private handlePong(data: Buffer): void {
    const now = Date.now();
    this.state.lastPongReceived = now;

    // Clear pong timeout
    if (this.state.pongTimeoutTimer) {
      clearTimeout(this.state.pongTimeoutTimer);
      this.state.pongTimeoutTimer = undefined;
    }

    // Calculate RTT if we can parse the timestamp
    let rtt = 0;
    try {
      const sentTime = parseInt(data.toString(), 10);
      if (!isNaN(sentTime)) {
        rtt = now - sentTime;
      }
    } catch {
      // Payload might not be our timestamp
    }

    this.state.consecutiveFailures = 0;
    this.callbacks.onPongReceived(rtt);
  }

  /**
   * Handle pong timeout (no response within timeout period)
   */
  private handlePongTimeout(): void {
    this.state.consecutiveFailures++;
    console.warn(`[ProtocolHeartbeat] Pong timeout (failure #${this.state.consecutiveFailures})`);

    this.callbacks.onPongTimeout(this.state.consecutiveFailures);
  }

  /**
   * Get current state
   */
  getState(): Readonly<ProtocolHeartbeatState> {
    return { ...this.state };
  }

  /**
   * Get configuration
   */
  getConfig(): Readonly<ProtocolHeartbeatConfig> {
    return { ...this.config };
  }

  /**
   * Update configuration dynamically
   */
  updateConfig(config: Partial<ProtocolHeartbeatConfig>): void {
    this.config = { ...this.config, ...config };

    // Restart if running to apply new interval
    if (this.state.isRunning) {
      this.stop();
      this.start();
    }
  }

  /**
   * Check if connection is healthy based on protocol heartbeat
   */
  isHealthy(): boolean {
    return this.state.consecutiveFailures === 0;
  }

  /**
   * Get time since last successful pong
   */
  getTimeSinceLastPong(): number {
    if (this.state.lastPongReceived === 0) return Infinity;
    return Date.now() - this.state.lastPongReceived;
  }
}

/**
 * Create a protocol heartbeat instance with default config
 */
export function createProtocolHeartbeat(
  callbacks: ProtocolHeartbeatCallbacks,
  config?: Partial<ProtocolHeartbeatConfig>
): ProtocolHeartbeat {
  return new ProtocolHeartbeat(config, callbacks);
}