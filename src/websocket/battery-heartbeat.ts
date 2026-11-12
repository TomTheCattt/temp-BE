/**
 * Battery-Optimized Application Heartbeat Manager
 *
 * Implements state-aware application heartbeat that ONLY runs during active calls.
 * Key principle from DESIGN_DOCUMENT.md §7.5:
 * - Active call: 30s interval (RTT monitoring for quality)
 * - Connecting (ICE negotiation): 10s interval (fast failure detection)
 * - Idle: DISABLED (rely on protocol ping only)
 * - Background: DISABLED (rely on VoIP push for incoming calls)
 * - Network-aware: Cellular gets slightly more aggressive intervals
 */

import { WebSocket } from "ws";
import { ProtocolHeartbeat, ProtocolHeartbeatConfig, ProtocolHeartbeatCallbacks, DEFAULT_PROTOCOL_HEARTBEAT_CONFIG } from "./protocol-heartbeat";

/**
 * Call connection states (matching ConnectionState from connection-manager)
 */
export enum CallConnectionState {
  IDLE = "idle",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  AUTHENTICATED = "authenticated",
  JOINED = "joined",
  RECOVERING = "recovering",
  RECONNECTING = "reconnecting",
  CLOSING = "closing",
  CLOSED = "closed",
}

/**
 * Network type for adaptive intervals
 */
export type NetworkType = "wifi" | "cellular" | "unknown";

/**
 * Application heartbeat configuration
 */
export interface AppHeartbeatConfig {
  /** Interval during active call (default: 30000 = 30s) */
  activeCall: number;
  /** Interval during ICE negotiation/connecting (default: 10000 = 10s) */
  connecting: number;
  /** Interval when idle (default: 0 = DISABLED) */
  idle: number;
  /** Interval when backgrounded (default: 0 = DISABLED) */
  background: number;
  /** Pong timeout in milliseconds (default: 10000 = 10s) */
  pongTimeout: number;
}

/**
 * Default application heartbeat configuration
 */
export const DEFAULT_APP_HEARTBEAT_CONFIG: AppHeartbeatConfig = {
  activeCall: 30_000,    // 30s during active call (media quality monitoring)
  connecting: 10_000,    // 10s during ICE negotiation (detect failures fast)
  idle: 0,               // DISABLED - no app heartbeat when not in call
  background: 0,         // DISABLED - VoIP push handles incoming calls
  pongTimeout: 10_000,   // 10s timeout for app pong
};

/**
 * Application heartbeat state
 */
export interface AppHeartbeatState {
  isRunning: boolean;
  currentInterval: number;
  callState: CallConnectionState;
  networkType: NetworkType;
  isBackground: boolean;
  lastPingSent: number;
  lastPongReceived: number;
  pendingPings: Map<number, number>; // sequence -> sent timestamp
  nextSequence: number;
  timer?: ReturnType<typeof setInterval>;
}

/**
 * Callbacks for application heartbeat events
 */
export interface AppHeartbeatCallbacks {
  /** Send application ping message */
  sendAppPing: (ping: AppPingMessage) => Promise<void>;
  /** Called when app pong timeout occurs */
  onAppHeartbeatFailed: (reason: string) => void;
  /** Called when app pong received with RTT */
  onAppPongReceived: (rtt: number, serverTime: string) => void;
  /** Called when state changes */
  onStateChange?: (state: AppHeartbeatState) => void;
}

/**
 * Application ping message payload
 */
export interface AppPingMessage {
  type: "call.ping";
  timestamp: string;           // ISO 8601 client timestamp
  callId: string;              // Current call ID
  sequence: number;            // Monotonic sequence for RTT measurement
  clientNetworkType: NetworkType; // Network type hint for server adaptation
}

/**
 * Application pong message payload
 */
export interface AppPongMessage {
  type: "call.pong";
  timestamp: string;           // ISO 8601 server timestamp
  sequence: number;            // Matching sequence from ping
  serverTime: string;          // Server time for clock sync
}

/**
 * BatteryHeartbeatManager - State-aware adaptive heartbeat
 *
 * Manages both protocol-level (kernel) and application-level heartbeats.
 * Application heartbeat ONLY runs during active calls to minimize battery impact.
 */
export class BatteryHeartbeatManager {
  private config: AppHeartbeatConfig;
  private protocolConfig: ProtocolHeartbeatConfig;
  private state: AppHeartbeatState;
  private callbacks: AppHeartbeatCallbacks;
  private protocolHeartbeat: ProtocolHeartbeat | null = null;
  private currentCallId?: string;

  constructor(
    callbacks: AppHeartbeatCallbacks,
    appConfig: Partial<AppHeartbeatConfig> = {},
    protocolConfig: Partial<ProtocolHeartbeatConfig> = {}
  ) {
    this.config = { ...DEFAULT_APP_HEARTBEAT_CONFIG, ...appConfig };
    this.protocolConfig = { ...DEFAULT_PROTOCOL_HEARTBEAT_CONFIG, ...protocolConfig };
    this.callbacks = callbacks;
    this.state = {
      isRunning: false,
      currentInterval: 0,
      callState: CallConnectionState.IDLE,
      networkType: "unknown",
      isBackground: false,
      lastPingSent: 0,
      lastPongReceived: 0,
      pendingPings: new Map(),
      nextSequence: 0,
    };
  }

  /**
   * Initialize with protocol heartbeat (should be called once on connection)
   */
  initializeProtocolHeartbeat(socket: WebSocket): void {
    const protocolCallbacks: ProtocolHeartbeatCallbacks = {
      onPongTimeout: (failures) => {
        // Protocol heartbeat failure - connection likely dead
        this.callbacks.onAppHeartbeatFailed(`PROTOCOL_PONG_TIMEOUT_x${failures}`);
      },
      onPongReceived: (rtt) => {
        // Protocol pong received - connection alive at kernel level
        console.debug(`[BatteryHeartbeat] Protocol pong RTT: ${rtt}ms`);
      },
    };

    this.protocolHeartbeat = new ProtocolHeartbeat(this.protocolConfig, protocolCallbacks);
    this.protocolHeartbeat.attach(socket);
    this.protocolHeartbeat.start();
  }

  /**
   * Set current call ID (when joining a call)
   */
  setCallId(callId: string | undefined): void {
    this.currentCallId = callId;
  }

  /**
   * Call when call state changes (idle, connecting, joined, etc.)
   */
  setCallState(state: CallConnectionState): void {
    const oldState = this.state.callState;
    this.state.callState = state;
    this.updateAppHeartbeat();

    // Log state transitions for debugging
    if (oldState !== state) {
      console.log(`[BatteryHeartbeat] Call state: ${oldState} → ${state}`);
      this.callbacks.onStateChange?.(this.state);
    }
  }

  /**
   * Call when app enters background/foreground
   */
  setBackground(background: boolean): void {
    const oldBackground = this.state.isBackground;
    this.state.isBackground = background;
    this.updateAppHeartbeat();

    if (oldBackground !== background) {
      console.log(`[BatteryHeartbeat] Background: ${oldBackground} → ${background}`);
      this.callbacks.onStateChange?.(this.state);
    }
  }

  /**
   * Call when network changes (via NWPathMonitor or equivalent)
   */
  setNetworkType(type: NetworkType): void {
    const oldType = this.state.networkType;
    this.state.networkType = type;

    // On cellular, slightly more aggressive to detect handover failures
    if (type === "cellular" && this.state.callState === CallConnectionState.JOINED) {
      this.config.activeCall = 25_000;
    } else if (type === "wifi" && this.state.callState === CallConnectionState.JOINED) {
      this.config.activeCall = 30_000;
    }

    if (oldType !== type) {
      console.log(`[BatteryHeartbeat] Network: ${oldType} → ${type}`);
      this.updateAppHeartbeat();
      this.callbacks.onStateChange?.(this.state);
    }
  }

  /**
   * Update application heartbeat based on current state
   */
  private updateAppHeartbeat(): void {
    // Clear existing timer
    if (this.state.timer) {
      clearInterval(this.state.timer);
      this.state.timer = undefined;
    }

    // Determine interval based on state
    let interval = 0;

    if (this.state.isBackground) {
      interval = this.config.background; // 0 = disabled
    } else {
      switch (this.state.callState) {
        case CallConnectionState.JOINED:
          interval = this.config.activeCall;
          break;
        case CallConnectionState.CONNECTING:
        case CallConnectionState.AUTHENTICATED:
          interval = this.config.connecting;
          break;
        case CallConnectionState.CONNECTED:
        case CallConnectionState.IDLE:
        default:
          interval = this.config.idle; // 0 = disabled
          break;
      }
    }

    this.state.currentInterval = interval;

    // Start timer if interval > 0
    if (interval > 0 && this.currentCallId) {
      this.state.timer = setInterval(() => this.sendAppPing(), interval);
      // Send immediately on state change to active
      this.sendAppPing();
      this.state.isRunning = true;
      console.log(`[BatteryHeartbeat] App heartbeat started (interval: ${interval}ms)`);
    } else {
      this.state.isRunning = false;
      console.log(`[BatteryHeartbeat] App heartbeat stopped (interval: ${interval}ms)`);
    }

    this.callbacks.onStateChange?.(this.state);
  }

  /**
   * Send application ping message
   */
  private async sendAppPing(): Promise<void> {
    if (!this.currentCallId) {
      console.warn("[BatteryHeartbeat] No callId set, skipping app ping");
      return;
    }

    const sequence = this.state.nextSequence++;
    const ping: AppPingMessage = {
      type: "call.ping",
      timestamp: new Date().toISOString(),
      callId: this.currentCallId,
      sequence,
      clientNetworkType: this.state.networkType,
    };

    try {
      await this.callbacks.sendAppPing(ping);
      this.state.lastPingSent = Date.now();
      this.state.pendingPings.set(sequence, this.state.lastPingSent);

      // Set timeout for pong
      setTimeout(() => this.handlePongTimeout(sequence), this.config.pongTimeout);
    } catch (error) {
      console.error("[BatteryHeartbeat] Failed to send app ping:", error);
    }
  }

  /**
   * Handle application pong timeout
   */
  private handlePongTimeout(sequence: number): void {
    const sentAt = this.state.pendingPings.get(sequence);
    if (sentAt) {
      const rtt = Date.now() - sentAt;
      this.state.pendingPings.delete(sequence);

      // RTT >= timeout means connection issue
      if (rtt >= this.config.pongTimeout) {
        console.warn(`[BatteryHeartbeat] App heartbeat timeout (seq: ${sequence}, RTT: ${rtt}ms)`);
        this.callbacks.onAppHeartbeatFailed("APP_PONG_TIMEOUT");
      }
    }
  }

  /**
   * Handle incoming application pong
   */
  handlePong(pong: AppPongMessage): void {
    const sentAt = this.state.pendingPings.get(pong.sequence);
    if (sentAt) {
      const rtt = Date.now() - sentAt;
      this.state.pendingPings.delete(pong.sequence);
      this.state.lastPongReceived = Date.now();

      this.callbacks.onAppPongReceived(rtt, pong.serverTime);
    }
  }

  /**
   * Get current state
   */
  getState(): Readonly<AppHeartbeatState> {
    return { ...this.state, pendingPings: new Map(this.state.pendingPings) };
  }

  /**
   * Get protocol heartbeat instance
   */
  getProtocolHeartbeat(): ProtocolHeartbeat | null {
    return this.protocolHeartbeat;
  }

  /**
   * Stop all heartbeats
   */
  stop(): void {
    // Stop app heartbeat
    if (this.state.timer) {
      clearInterval(this.state.timer);
      this.state.timer = undefined;
    }

    // Clear pending pings
    this.state.pendingPings.clear();
    this.state.isRunning = false;

    // Stop protocol heartbeat
    if (this.protocolHeartbeat) {
      this.protocolHeartbeat.stop();
      this.protocolHeartbeat = null;
    }

    console.log("[BatteryHeartbeat] Stopped all heartbeats");
  }

  /**
   * Update configuration dynamically
   */
  updateConfig(appConfig?: Partial<AppHeartbeatConfig>, protocolConfig?: Partial<ProtocolHeartbeatConfig>): void {
    if (appConfig) {
      this.config = { ...this.config, ...appConfig };
    }
    if (protocolConfig) {
      this.protocolConfig = { ...this.protocolConfig, ...protocolConfig };
      if (this.protocolHeartbeat) {
        this.protocolHeartbeat.updateConfig(this.protocolConfig);
      }
    }
    this.updateAppHeartbeat();
  }
}

/**
 * Create a battery heartbeat manager with default config
 */
export function createBatteryHeartbeatManager(
  callbacks: AppHeartbeatCallbacks,
  appConfig?: Partial<AppHeartbeatConfig>,
  protocolConfig?: Partial<ProtocolHeartbeatConfig>
): BatteryHeartbeatManager {
  return new BatteryHeartbeatManager(callbacks, appConfig, protocolConfig);
}