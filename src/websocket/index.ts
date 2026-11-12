/**
 * WebSocket Function for Neon Functions - Handles Chat, Call Signaling & Presence
 *
 * This is the main entry point for the WebSocket server deployed on Neon Functions.
 * It integrates:
 * - ConnectionManager for connection lifecycle, subscriptions, presence
 * - Battery-optimized heartbeat system (protocol + application level)
 * - Channel authorization (canSubscribe)
 * - Message handlers for ping, subscribe, unsubscribe, messaging, typing, presence, sync
 * - Auto-subscription to user channels on connect
 * - Context-aware reconnect with exponential backoff + jitter
 *
 * Deployed as a separate function for independent scaling.
 * Endpoint: wss://<branch>-<slug>.compute.<region>.aws.neon.tech/ws/v1
 */

import { upgradeWebSocket } from "@neon/functions";
import {
  ConnectionManager,
  AuthenticatedSocket,
  ConnectionState,
  MessageEnvelope,
} from "./connection-manager";
import {
  BatteryHeartbeatManager,
  CallConnectionState,
  AppPingMessage,
  AppPongMessage,
  NetworkType,
} from "./battery-heartbeat";
import { ReconnectManager, ReconnectContext, WSError, WSErrorCode } from "./reconnect-manager";
import { routeMessage, parseClientMessage, validateMessageSize } from "./message-handlers";
import { verifyBetterAuthToken } from "./auth-helpers";
import { autoSubscribeConversations } from "./conversation-subscription";
import { initRecoveryState, cleanupRecoveryState } from "./event-recovery";

// Global ConnectionManager instance (per isolate)
const connectionManager = new ConnectionManager();

// Environment variables (injected by Neon at runtime)
const DATABASE_URL = process.env.DATABASE_URL!;

/**
 * Extract token from WebSocket upgrade request
 * Supports: Authorization: Bearer <token>, Sec-WebSocket-Protocol: bearer.<token>, or ?token= query param
 */
function extractToken(request: Request): string | null {
  // 1. Check Authorization header (Bearer token)
  const authHeader = request.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // 2. Check Sec-WebSocket-Protocol header (standard for WebSocket auth)
  const protocolHeader = request.headers.get("Sec-WebSocket-Protocol");
  if (protocolHeader && protocolHeader.startsWith("bearer.")) {
    return protocolHeader.slice(7); // Remove "bearer." prefix
  }

  // 3. Fallback to query parameter (legacy, less secure)
  const url = new URL(request.url);
  return url.searchParams.get("token");
}

/**
 * Get client IP address from request headers
 */
function getClientIp(request: Request): string | undefined {
  return (
    request.headers.get("CF-Connecting-IP") || // Cloudflare
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || // Standard proxy
    request.headers.get("X-Real-IP") || // Nginx
    undefined
  );
}

/**
 * Get user agent from request
 */
function getUserAgent(request: Request): string | undefined {
  return request.headers.get("User-Agent") || undefined;
}

// Main handler for Neon Functions
export default {
  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");

    // Handle WebSocket upgrade
    if (upgradeHeader?.toLowerCase() === "websocket") {
      return handleWebSocketUpgrade(request);
    }

    // Health check endpoint for the function
    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      return new Response(JSON.stringify({
        status: "ok",
        service: "websocket",
        timestamp: new Date().toISOString(),
        connections: connectionManager.getTotalConnections(),
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Metrics endpoint
    if (request.method === "GET" && new URL(request.url).pathname === "/metrics") {
      return new Response(JSON.stringify({
        totalConnections: connectionManager.getTotalConnections(),
        onlineUsers: connectionManager.getOnlineUsers().length,
        timestamp: new Date().toISOString(),
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

/**
 * Handle WebSocket upgrade request
 * Verifies authentication token BEFORE upgrading
 */
async function handleWebSocketUpgrade(request: Request): Promise<Response> {
  // Extract and verify token BEFORE upgrading
  const token = extractToken(request);

  if (!token) {
    return new Response("Missing token", { status: 401 });
  }

  // Verify token during handshake
  const userId = await verifyBetterAuthToken(token);
  if (!userId) {
    return new Response("Invalid token", { status: 401 });
  }

  // Token valid - upgrade to WebSocket
  const { socket, response } = upgradeWebSocket(request);

  const authSocket = socket as unknown as AuthenticatedSocket;

  // Initialize socket with user ID and metadata
  authSocket.userId = userId;
  authSocket.isAlive = true;
  authSocket.state = ConnectionState.CONNECTED;
  authSocket.subscriptions = new Set();
  authSocket.lastSequence = 0;
  authSocket.lastEventId = "";
  authSocket.generation = 0;

  // Get client metadata
  const clientIp = getClientIp(request);
  const userAgent = getUserAgent(request);

  // Register connection with ConnectionManager
  await connectionManager.addConnection(userId, authSocket, {
    ipAddress: clientIp,
    userAgent,
  });

  // Initialize event recovery state for this socket
  initRecoveryState(authSocket);

  // Auto-subscribe to user's conversation channels
  await autoSubscribeConversations(authSocket, connectionManager);

  // Send connected message
  authSocket.send(JSON.stringify({
    type: "connected",
    userId,
    serverTime: new Date().toISOString(),
  }));

  // Handle incoming messages
  authSocket.addEventListener("message", async (event) => {
    try {
      // Convert event.data to string
      let data: string;
      if (typeof event.data === "string") {
        data = event.data;
      } else if (event.data instanceof ArrayBuffer) {
        data = new TextDecoder().decode(event.data);
      } else if (event.data instanceof Blob) {
        data = await event.data.text();
      } else if (Buffer.isBuffer(event.data)) {
        data = event.data.toString();
      } else {
        data = String(event.data);
      }

      // Enforce message size limit (16KB)
      if (data.length > 16_384) {
        authSocket.send(JSON.stringify({
          type: "error",
          code: "MESSAGE_TOO_LARGE",
          message: "Message too large (max 16KB)"
        }));
        return;
      }

      // Parse message
      const message = parseClientMessage(data);

      if (!message) {
        authSocket.send(JSON.stringify({
          type: "error",
          code: "INVALID_MESSAGE",
          message: "Invalid message format"
        }));
        return;
      }

      // Handle battery heartbeat messages
      if (await handleBatteryHeartbeatMessage(authSocket, message)) {
        return;
      }

      // Route to appropriate handler
      await routeMessage(authSocket, message, connectionManager);
    } catch (error) {
      console.error("[WebSocket] Message error:", error);
      authSocket.send(JSON.stringify({
        type: "error",
        code: "INTERNAL_ERROR",
        message: "Internal error"
      }));
    }
  });

  // Handle connection close
  authSocket.addEventListener("close", (event) => {
    // Parse close code for reconnect policy
    const error = parseCloseCodeForReconnect(event.code, event.reason);

    // Clean up connection
    connectionManager.removeConnection(userId, authSocket);

    // Clean up event recovery state
    cleanupRecoveryState(authSocket);

    // If recoverable, schedule reconnect (handled by client, but we log it)
    if (error.recoverable) {
      console.log(`[WebSocket] Connection closed with recoverable error: ${error.code}, client should reconnect`);
    }
  });

  // Handle errors
  authSocket.addEventListener("error", (error) => {
    console.error("[WebSocket] Socket error:", error);
  });

  return response;
}

/**
 * Handle battery heartbeat specific messages
 * Returns true if message was handled, false otherwise
 */
async function handleBatteryHeartbeatMessage(
  socket: AuthenticatedSocket,
  message: any
): Promise<boolean> {
  // Handle application pong response
  if (message.type === "call.pong") {
    const pong = message as AppPongMessage;
    connectionManager.handleAppPong(socket, pong);
    return true;
  }

  // Handle application ping request (client -> server)
  if (message.type === "call.ping") {
    const ping = message as AppPingMessage;
    // Respond with pong
    const pong: AppPongMessage = {
      type: "call.pong",
      timestamp: new Date().toISOString(),
      sequence: ping.sequence,
      serverTime: new Date().toISOString(),
    };
    socket.send(JSON.stringify(pong));
    return true;
  }

  // Handle call state changes (from client)
  if (message.type === "call.state") {
    const { state, callId } = message.payload;
    if (state && Object.values(CallConnectionState).includes(state)) {
      connectionManager.setSocketCallState(socket, state as CallConnectionState);
      if (callId) {
        connectionManager.setSocketCallId(socket, callId);
      }
    }
    return true;
  }

  // Handle background/foreground changes (from client)
  if (message.type === "call.background") {
    const { background } = message.payload;
    if (typeof background === "boolean") {
      connectionManager.setSocketBackground(socket, background);
    }
    return true;
  }

  // Handle network type changes (from client)
  if (message.type === "call.network") {
    const { networkType } = message.payload;
    if (networkType && ["wifi", "cellular", "unknown"].includes(networkType)) {
      connectionManager.setSocketNetworkType(socket, networkType as NetworkType);
    }
    return true;
  }

  // Handle reconnect request with recovery
  if (message.type === "call.reconnect") {
    const { callId, lastSequence, cursor } = message.payload;
    // This would trigger event recovery
    // For now, we acknowledge
    socket.send(JSON.stringify({
      type: "call.recovery",
      callId,
      events: [], // Would fetch from database
      snapshot: null,
      success: true,
    }));
    return true;
  }

  return false;
}

/**
 * Parse WebSocket close code to WSError for reconnect policy
 */
function parseCloseCodeForReconnect(code: number, reason: string): WSError {
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