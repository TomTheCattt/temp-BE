/**
 * ConnectionManager - WebSocket Connection Management
 *
 * Handles connections, subscriptions, presence, and broadcasting
 * Designed for Neon Functions with multi-isolate fan-out support
 * Now integrates battery-optimized heartbeat system
 */

import { WebSocket } from "ws";
import { db } from "../db/client";
import { eq, and } from "drizzle-orm";
import * as schema from "../db/schema";
import { canSubscribe as channelCanSubscribe } from "./channel-auth";
import {
  BatteryHeartbeatManager,
  CallConnectionState,
  NetworkType,
  AppHeartbeatCallbacks,
  AppPingMessage,
  AppPongMessage,
} from "./battery-heartbeat";
import { ReconnectManager, ReconnectContext, WSError, WSErrorCode } from "./reconnect-manager";
import { NetworkDetector, NetworkInfo } from "./network-detector";

/**
 * Convert ConnectionState to CallConnectionState
 */
function toCallConnectionState(state: ConnectionState): CallConnectionState {
  return state as unknown as CallConnectionState;
}

/**
 * Convert CallConnectionState to ConnectionState
 */
function toConnectionState(state: CallConnectionState): ConnectionState {
  return state as unknown as ConnectionState;
}

/**
 * WebSocket connection state
 */
export enum ConnectionState {
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
 * Authenticated socket with user metadata
 */
export interface AuthenticatedSocket extends WebSocket {
  userId: string;
  isAlive: boolean;
  state: ConnectionState;
  subscriptions: Set<string>;
  lastSequence: number;
  lastEventId: string;
  generation: number;
  closeReason?: { code: number; reason: string; recoverable: boolean };
  // Battery heartbeat integration
  batteryHeartbeat?: BatteryHeartbeatManager;
  networkInfo?: NetworkInfo;
}

/**
 * Presence status
 */
export interface PresenceStatus {
  userId: string;
  status: "online" | "away" | "busy" | "offline";
  lastSeen: Date;
  deviceId?: string;
}

/**
 * Connection metadata for tracking
 */
interface ConnectionMetadata {
  userId: string;
  socket: AuthenticatedSocket;
  connectedAt: Date;
  lastActivity: Date;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Message envelope for ordered delivery
 */
export interface MessageEnvelope<T = any> {
  eventId: string;
  sequence: number;
  timestamp: string;
  type: string;
  payload: T;
  ackRequired?: boolean;
  correlationId?: string;
}

/**
 * ConnectionManager - Centralized WebSocket connection management
 *
 * Features:
 * - Per-user connection tracking (multi-device support)
 * - Channel-based subscriptions
 * - Presence management (online/away/busy/offline)
 * - Battery-optimized heartbeat (protocol + application level)
 * - Event recovery with sequence numbers
 * - Context-aware reconnect with exponential backoff + jitter
 * - Cross-isolate fan-out via polling (Scale to Zero compatible)
 */
export class ConnectionManager {
  // In-memory stores (per-isolate)
  private connections = new Map<string, Map<string, ConnectionMetadata>>(); // userId -> socketId -> metadata
  private userSubscriptions = new Map<string, Set<string>>(); // userId -> channels
  private socketSubscriptions = new Map<string, Set<string>>(); // socketId -> channels
  private presence = new Map<string, PresenceStatus>(); // userId -> presence
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  // Battery heartbeat integration
  private batteryHeartbeatManager: BatteryHeartbeatManager | null = null;
  private reconnectManager: ReconnectManager | null = null;
  private networkDetector: NetworkDetector;

  // Callbacks for cross-isolate events
  private onBroadcastCallback?: (channel: string, message: string) => void;
  private onPresenceChangeCallback?: (userId: string, status: PresenceStatus) => void;

  // Sequence counter for message ordering
  private sequenceCounter = 0;

  // Configuration
  private readonly POLL_INTERVAL_MS = 1_000; // 1s polling for cross-isolate fan-out
  private readonly PRESENCE_GRACE_PERIOD_MS = 30_000; // 30s before marking offline
  private readonly MAX_MESSAGE_SIZE = 16_384; // 16KB

  constructor() {
    this.networkDetector = new NetworkDetector();
    this.initializeBatteryHeartbeat();
    this.initializeReconnectManager();
    this.startPolling();
  }

  /**
   * Initialize battery-optimized heartbeat system
   */
  private initializeBatteryHeartbeat(): void {
    const callbacks: AppHeartbeatCallbacks = {
      sendAppPing: async (ping: AppPingMessage) => {
        // Broadcast ping to all user's connections
        this.broadcastToUser(ping.callId, ping);
      },
      onAppHeartbeatFailed: (reason: string) => {
        console.warn(`[ConnectionManager] App heartbeat failed: ${reason}`);
        // Trigger reconnect
        this.handleHeartbeatFailure(reason);
      },
      onAppPongReceived: (rtt: number, serverTime: string) => {
        // Update metrics, clock sync
        console.debug(`[ConnectionManager] App pong RTT: ${rtt}ms`);
      },
      onStateChange: (state) => {
        console.debug(`[ConnectionManager] Battery heartbeat state:`, {
          callState: state.callState,
          interval: state.currentInterval,
          background: state.isBackground,
          network: state.networkType,
        });
      },
    };

    this.batteryHeartbeatManager = new BatteryHeartbeatManager(callbacks);
  }

  /**
   * Initialize reconnect manager
   */
  private initializeReconnectManager(): void {
    this.reconnectManager = new ReconnectManager(
      {
        baseDelayMs: 1_000,
        maxDelayMs: 30_000,
        maxRetriesActiveCall: 30,
        maxRetriesIdle: 10,
      },
      {
        connectFn: async () => {
          // This would be implemented to trigger a new connection
          console.log("[ConnectionManager] Reconnect function called");
        },
        onReconnectAttempt: (attempt, delay, context) => {
          console.log(`[ConnectionManager] Reconnect attempt ${attempt} in ${delay}ms`);
        },
        onReconnectSuccess: (context) => {
          console.log("[ConnectionManager] Reconnect successful");
        },
        onReconnectFailed: (error, context) => {
          console.error("[ConnectionManager] Reconnect failed:", error);
        },
        onMaxRetriesExceeded: (context) => {
          console.error("[ConnectionManager] Max retries exceeded");
        },
      }
    );
  }

  /**
   * Add a new WebSocket connection
   */
  async addConnection(
    userId: string,
    socket: AuthenticatedSocket,
    metadata: { ipAddress?: string; userAgent?: string } = {}
  ): Promise<void> {
    const socketId = this.generateSocketId();

    // Initialize socket metadata
    socket.userId = userId;
    socket.isAlive = true;
    socket.state = ConnectionState.AUTHENTICATED;
    socket.subscriptions = new Set();
    socket.lastSequence = 0;
    socket.lastEventId = "";
    socket.generation = 0;

    // Store connection
    const userConnections = this.connections.get(userId) || new Map();
    userConnections.set(socketId, {
      userId,
      socket,
      connectedAt: new Date(),
      lastActivity: new Date(),
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    });
    this.connections.set(userId, userConnections);

    // Initialize user subscriptions
    if (!this.userSubscriptions.has(userId)) {
      this.userSubscriptions.set(userId, new Set());
    }
    this.socketSubscriptions.set(socketId, new Set());

    // Update presence to online
    this.updatePresence(userId, "online");

    // Initialize battery heartbeat for this socket
    this.initializeSocketHeartbeat(socket, userId);

    // Auto-subscribe to user channels
    await this.autoSubscribeUserChannels(socket, userId);

    console.log(`[ConnectionManager] User ${userId} connected (socket: ${socketId})`);
  }

  /**
   * Initialize battery heartbeat for a specific socket
   */
  private initializeSocketHeartbeat(socket: AuthenticatedSocket, userId: string): void {
    if (!this.batteryHeartbeatManager) return;

    // Create socket-specific callbacks
    const socketCallbacks: AppHeartbeatCallbacks = {
      sendAppPing: async (ping: AppPingMessage) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(ping));
        }
      },
      onAppHeartbeatFailed: (reason: string) => {
        console.warn(`[ConnectionManager] Socket ${userId} app heartbeat failed: ${reason}`);
        this.handleSocketHeartbeatFailure(socket, reason);
      },
      onAppPongReceived: (rtt: number, serverTime: string) => {
        console.debug(`[ConnectionManager] Socket ${userId} app pong RTT: ${rtt}ms`);
      },
    };

    // Create a per-socket heartbeat manager
    const socketHeartbeat = new BatteryHeartbeatManager(socketCallbacks);

    // Initialize protocol heartbeat (kernel-managed ping/pong)
    socketHeartbeat.initializeProtocolHeartbeat(socket);

    // Attach to socket for cleanup
    socket.batteryHeartbeat = socketHeartbeat;

    // Set initial state
    socketHeartbeat.setCallState(CallConnectionState.AUTHENTICATED);
  }

  /**
   * Handle socket heartbeat failure
   */
  private handleSocketHeartbeatFailure(socket: AuthenticatedSocket, reason: string): void {
    const userId = socket.userId;

    // Create error for reconnect policy
    const error: WSError = {
      code: reason.includes("PROTOCOL") ? WSErrorCode.PROTOCOL_PONG_TIMEOUT : WSErrorCode.APP_HEARTBEAT_TIMEOUT,
      message: reason,
      recoverable: true,
    };

    // Prepare reconnect context
    const context: ReconnectContext = {
      callState: toCallConnectionState(socket.state),
      isBackground: socket.batteryHeartbeat?.getState().isBackground ?? false,
      networkType: socket.batteryHeartbeat?.getState().networkType ?? "unknown",
      hasActiveCall: socket.state === ConnectionState.JOINED,
      callId: socket.batteryHeartbeat?.getState().callState === CallConnectionState.JOINED ? "active" : undefined,
      attempt: 0,
      lastError: error,
    };

    // Schedule reconnect
    this.reconnectManager?.scheduleReconnect(error, context);
  }

  /**
   * Handle general heartbeat failure
   */
  private handleHeartbeatFailure(reason: string): void {
    console.warn(`[ConnectionManager] Heartbeat failure: ${reason}`);
  }

  /**
   * Remove a WebSocket connection
   */
  removeConnection(userId: string, socket: AuthenticatedSocket): void {
    const socketId = this.getSocketId(socket);

    if (!socketId) {
      console.warn(`[ConnectionManager] Attempted to remove unknown socket for user ${userId}`);
      return;
    }

    // Stop battery heartbeat for this socket
    if (socket.batteryHeartbeat) {
      socket.batteryHeartbeat.stop();
      socket.batteryHeartbeat = undefined;
    }

    // Clean up socket subscriptions
    this.socketSubscriptions.delete(socketId);

    // Remove from user connections
    const userConnections = this.connections.get(userId);
    if (userConnections) {
      userConnections.delete(socketId);

      // If no more connections for this user, clean up
      if (userConnections.size === 0) {
        this.connections.delete(userId);

        // Debounce offline presence (grace period for multi-device)
        setTimeout(() => {
          const remaining = this.connections.get(userId);
          if (!remaining || remaining.size === 0) {
            this.updatePresence(userId, "offline", new Date());
          }
        }, this.PRESENCE_GRACE_PERIOD_MS);
      }
    }

    console.log(`[ConnectionManager] User ${userId} disconnected (socket: ${socketId})`);
  }

  /**
   * Subscribe a socket to channels
   */
  async subscribe(socket: AuthenticatedSocket, channels: string[]): Promise<string[]> {
    const socketId = this.getSocketId(socket);
    if (!socketId) return [];

    const userId = socket.userId;
    const socketSubs = this.socketSubscriptions.get(socketId);
    const userSubs = this.userSubscriptions.get(userId);

    if (!socketSubs || !userSubs) return [];

    const allowedChannels: string[] = [];

    for (const channel of channels) {
      // Validate channel access
      if (await this.canSubscribe(userId, channel)) {
        socketSubs.add(channel);
        userSubs.add(channel);
        socket.subscriptions.add(channel);
        allowedChannels.push(channel);
      }
    }

    return allowedChannels;
  }

  /**
   * Unsubscribe a socket from channels
   */
  unsubscribe(socket: AuthenticatedSocket, channels: string[]): void {
    const socketId = this.getSocketId(socket);
    if (!socketId) return;

    const socketSubs = this.socketSubscriptions.get(socketId);
    const userSubs = this.userSubscriptions.get(socket.userId);

    if (!socketSubs || !userSubs) return;

    for (const channel of channels) {
      socketSubs.delete(channel);
      socket.subscriptions.delete(channel);

      // Only remove from user subscriptions if no other socket is subscribed
      let stillSubscribed = false;
      for (const subs of Array.from(this.socketSubscriptions.values())) {
        if (subs.has(channel)) {
          stillSubscribed = true;
          break;
        }
      }
      if (!stillSubscribed) {
        userSubs.delete(channel);
      }
    }
  }

  /**
   * Check if user can subscribe to a channel
   * Delegates to channel-auth module for authorization logic
   */
  async canSubscribe(userId: string, channel: string): Promise<boolean> {
    const result = await channelCanSubscribe(userId, channel);
    return result.allowed;
  }

  /**
   * Broadcast a message to all subscribers of a channel
   */
  async broadcast(channel: string, message: MessageEnvelope | object, excludeSocketId?: string): Promise<void> {
    const payload = typeof message === "string" ? message : JSON.stringify(message);

    // Local broadcast (this isolate)
    this.broadcastLocal(channel, payload, excludeSocketId);

    // Cross-isolate broadcast via callback (to be implemented with polling/LISTEN/Redis)
    if (this.onBroadcastCallback) {
      this.onBroadcastCallback(channel, payload);
    }
  }

  /**
   * Broadcast to a specific user (all their connections)
   */
  broadcastToUser(userId: string, message: MessageEnvelope | object): void {
    const payload = typeof message === "string" ? message : JSON.stringify(message);
    const userConnections = this.connections.get(userId);

    if (userConnections) {
      for (const [, metadata] of Array.from(userConnections.entries())) {
        if (metadata.socket.readyState === WebSocket.OPEN) {
          metadata.socket.send(payload);
        }
      }
    }
  }

  /**
   * Update user presence status
   */
  async updatePresence(
    userId: string,
    status: "online" | "away" | "busy" | "offline",
    lastSeen?: Date
  ): Promise<void> {
    const presence: PresenceStatus = {
      userId,
      status,
      lastSeen: lastSeen || new Date(),
    };

    this.presence.set(userId, presence);

    // Persist to database periodically
    await this.persistPresence(userId, presence);

    // Broadcast to friends/followers
    await this.broadcastPresenceToFollowers(userId, presence);

    // Trigger callback for cross-isolate sync
    if (this.onPresenceChangeCallback) {
      this.onPresenceChangeCallback(userId, presence);
    }
  }

  /**
   * Get user's current presence status
   */
  getPresence(userId: string): PresenceStatus | undefined {
    return this.presence.get(userId);
  }

  /**
   * Get all online users
   */
  getOnlineUsers(): PresenceStatus[] {
    return Array.from(this.presence.values()).filter(p => p.status !== "offline");
  }

  /**
   * Get connection count for a user
   */
  getConnectionCount(userId: string): number {
    return this.connections.get(userId)?.size || 0;
  }

  /**
   * Get total connection count
   */
  getTotalConnections(): number {
    let count = 0;
    for (const userConnections of Array.from(this.connections.values())) {
      count += userConnections.size;
    }
    return count;
  }

  /**
   * Get user's subscriptions
   */
  getUserSubscriptions(userId: string): string[] {
    return Array.from(this.userSubscriptions.get(userId) || []);
  }

  /**
   * Get socket's subscriptions
   */
  getSocketSubscriptions(socket: AuthenticatedSocket): string[] {
    return Array.from(socket.subscriptions);
  }

  /**
   * Update socket activity timestamp
   */
  updateActivity(socket: AuthenticatedSocket): void {
    const socketId = this.getSocketId(socket);
    if (socketId) {
      const userConnections = this.connections.get(socket.userId);
      const metadata = userConnections?.get(socketId);
      if (metadata) {
        metadata.lastActivity = new Date();
      }
    }
    socket.isAlive = true;
  }

  /**
   * Handle incoming pong (heartbeat response) - legacy support
   */
  handlePong(socket: AuthenticatedSocket): void {
    socket.isAlive = true;
    this.updateActivity(socket);
  }

  /**
   * Handle application-level pong for battery heartbeat
   */
  handleAppPong(socket: AuthenticatedSocket, pong: AppPongMessage): void {
    socket.batteryHeartbeat?.handlePong(pong);
  }

  /**
   * Set cross-isolate broadcast callback
   */
  setBroadcastCallback(callback: (channel: string, message: string) => void): void {
    this.onBroadcastCallback = callback;
  }

  /**
   * Set presence change callback
   */
  setPresenceChangeCallback(callback: (userId: string, status: PresenceStatus) => void): void {
    this.onPresenceChangeCallback = callback;
  }

  /**
   * Update socket call state (for battery heartbeat)
   */
  setSocketCallState(socket: AuthenticatedSocket, state: CallConnectionState): void {
    socket.state = toConnectionState(state);
    socket.batteryHeartbeat?.setCallState(state);
  }

  /**
   * Set socket background state (for battery heartbeat)
   */
  setSocketBackground(socket: AuthenticatedSocket, background: boolean): void {
    socket.batteryHeartbeat?.setBackground(background);
  }

  /**
   * Set socket network type (for battery heartbeat)
   */
  setSocketNetworkType(socket: AuthenticatedSocket, type: NetworkType): void {
    socket.batteryHeartbeat?.setNetworkType(type);
    socket.networkInfo = this.networkDetector.getCurrentInfo();
  }

  /**
   * Set socket call ID (for battery heartbeat)
   */
  setSocketCallId(socket: AuthenticatedSocket, callId: string | undefined): void {
    socket.batteryHeartbeat?.setCallId(callId);
  }

  /**
   * Generate next sequence number for message ordering
   */
  nextSequence(): number {
    return ++this.sequenceCounter;
  }

  /**
   * Create a message envelope with sequence and event ID
   */
  createEnvelope<T>(type: string, payload: T, options: { ackRequired?: boolean; correlationId?: string } = {}): MessageEnvelope<T> {
    return {
      eventId: crypto.randomUUID(),
      sequence: this.nextSequence(),
      timestamp: new Date().toISOString(),
      type,
      payload,
      ackRequired: options.ackRequired,
      correlationId: options.correlationId,
    };
  }

  /**
   * Get battery heartbeat manager (for testing/monitoring)
   */
  getBatteryHeartbeatManager(): BatteryHeartbeatManager | null {
    return this.batteryHeartbeatManager;
  }

  /**
   * Get reconnect manager (for testing/monitoring)
   */
  getReconnectManager(): ReconnectManager | null {
    return this.reconnectManager;
  }

  /**
   * Get network detector (for testing/monitoring)
   */
  getNetworkDetector(): NetworkDetector {
    return this.networkDetector;
  }

  /**
   * Start polling for cross-isolate events
   * This enables Scale to Zero compatibility
   */
  private startPolling(): void {
    // Polling is handled externally via the database
    // This is a placeholder for the polling mechanism
    // The actual implementation would query the database for new events
  }

  /**
   * Stop all intervals and cleanup
   */
  stop(): void {
    // Stop battery heartbeat
    if (this.batteryHeartbeatManager) {
      this.batteryHeartbeatManager.stop();
    }

    // Stop reconnect manager
    this.reconnectManager?.cancel();

    // Stop polling
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  // ===== Private Helper Methods =====

  /**
   * Broadcast locally to subscribed sockets
   */
  private broadcastLocal(channel: string, payload: string, excludeSocketId?: string): void {
    for (const [, userConnections] of Array.from(this.connections.entries())) {
      for (const [socketId, metadata] of Array.from(userConnections.entries())) {
        // Skip excluded socket
        if (excludeSocketId && socketId === excludeSocketId) continue;

        const socketSubs = this.socketSubscriptions.get(socketId);
        if (socketSubs?.has(channel) && metadata.socket.readyState === WebSocket.OPEN) {
          metadata.socket.send(payload);
        }
      }
    }
  }

  /**
   * Auto-subscribe user to their personal channels
   */
  private async autoSubscribeUserChannels(socket: AuthenticatedSocket, userId: string): Promise<void> {
    const channels = [
      `user:${userId}`,           // Personal notifications, direct messages
      `presence:${userId}`,       // Own presence updates
    ];

    await this.subscribe(socket, channels);
  }

  /**
   * Persist presence to database
   */
  private async persistPresence(userId: string, presence: PresenceStatus): Promise<void> {
    try {
      // Update user's last_seen in database
      // This would typically update a presence table or user settings
      // For now, we'll just log it
      console.log(`[ConnectionManager] Presence update: ${userId} -> ${presence.status}`);
    } catch (error) {
      console.error(`[ConnectionManager] Failed to persist presence:`, error);
    }
  }

  /**
   * Broadcast presence change to followers
   */
  private async broadcastPresenceToFollowers(userId: string, presence: PresenceStatus): Promise<void> {
    try {
      // Get followers from database
      const followers = await db
        .select({ followerId: schema.follows.followerId })
        .from(schema.follows)
        .where(eq(schema.follows.followingId, userId));

      const payload = this.createEnvelope("presence.changed", {
        userId,
        status: presence.status,
        lastSeen: presence.lastSeen.toISOString(),
      });

      for (const { followerId } of followers) {
        this.broadcastToUser(followerId, payload);
      }
    } catch (error) {
      console.error(`[ConnectionManager] Failed to broadcast presence:`, error);
    }
  }

  /**
   * Check if user is member of conversation
   */
  private async isConversationMember(userId: string, conversationId: string): Promise<boolean> {
    try {
      const result = await db
        .select({ id: schema.conversationMembers.id })
        .from(schema.conversationMembers)
        .where(and(
          eq(schema.conversationMembers.conversationId, conversationId),
          eq(schema.conversationMembers.userId, userId)
        ))
        .limit(1);
      return result.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Check if user is participant in call
   */
  private async isCallParticipant(userId: string, callId: string): Promise<boolean> {
    // TODO: Implement when calls table is available
    return false;
  }

  /**
   * Check if two users are friends (follow each other)
   */
  private async areFriends(userId: string, targetUserId: string): Promise<boolean> {
    try {
      const [follow1, follow2] = await Promise.all([
        db.select({ id: schema.follows.id })
          .from(schema.follows)
          .where(and(
            eq(schema.follows.followerId, userId),
            eq(schema.follows.followingId, targetUserId)
          ))
          .limit(1),
        db.select({ id: schema.follows.id })
          .from(schema.follows)
          .where(and(
            eq(schema.follows.followerId, targetUserId),
            eq(schema.follows.followingId, userId)
          ))
          .limit(1),
      ]);

      return follow1.length > 0 && follow2.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get socket ID from socket (public method for external use)
   */
  getSocketId(socket: AuthenticatedSocket): string | null {
    const userConnections = this.connections.get(socket.userId);
    if (!userConnections) return null;

    for (const [socketId, metadata] of Array.from(userConnections.entries())) {
      if (metadata.socket === socket) {
        return socketId;
      }
    }
    return null;
  }

  /**
   * Generate unique socket ID
   */
  private generateSocketId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Singleton instance
export const connectionManager = new ConnectionManager();