/**
 * Mediasoup SFU Function Entry Point for Neon Functions
 *
 * Handles WebRTC media routing via mediasoup:
 * - WebSocket signaling for WebRTC transport negotiation
 * - Producer/Consumer management for audio/video/screen
 * - Simulcast/SVC for adaptive bitrate
 * - Data channels for signaling fallback
 * - Server-side recording via mediasoup recorder
 * - Multi-party mesh SFU topology
 *
 * Deployed as a separate function with UDP port support for media transport.
 * Endpoint: wss://<branch>-<slug>.compute.<region>.aws.neon.tech/mediasoup/v1
 */

import { upgradeWebSocket } from "@neon/functions";
import {
  AuthenticatedSocket,
  ConnectionManager,
  ConnectionState,
} from "./connection-manager";
import { routeMediasoupMessage, setupMediasoupEventListeners } from "./mediasoup-handlers";
import { verifyBetterAuthToken } from "./auth-helpers";
import { mediasoupService } from "../services/mediasoup-service";

// Global ConnectionManager instance (per isolate)
const connectionManager = new ConnectionManager();

// Initialize mediasoup event listeners for broadcasting
setupMediasoupEventListeners(connectionManager);

// Initialize mediasoup service
let mediasoupInitialized = false;

async function initializeMediasoup(): Promise<void> {
  if (mediasoupInitialized) return;

  try {
    await mediasoupService.initialize();
    mediasoupInitialized = true;
    console.log("[Mediasoup] Service initialized");
  } catch (error) {
    console.error("[Mediasoup] Failed to initialize:", error);
    throw error;
  }
}

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
    return protocolHeader.slice(7);
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
    // Initialize mediasoup on first request
    await initializeMediasoup();

    const upgradeHeader = request.headers.get("Upgrade");

    // Handle WebSocket upgrade
    if (upgradeHeader?.toLowerCase() === "websocket") {
      return handleWebSocketUpgrade(request);
    }

    // Health check endpoint
    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      return new Response(JSON.stringify({
        status: "ok",
        service: "mediasoup",
        timestamp: new Date().toISOString(),
        connections: connectionManager.getTotalConnections(),
        rooms: mediasoupService.getActiveRoomCount(),
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Metrics endpoint
    if (request.method === "GET" && new URL(request.url).pathname === "/metrics") {
      return new Response(JSON.stringify({
        totalConnections: connectionManager.getTotalConnections(),
        onlineUsers: connectionManager.getOnlineUsers().length,
        activeRooms: mediasoupService.getActiveRoomCount(),
        timestamp: new Date().toISOString(),
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Room info endpoint
    if (request.method === "GET" && new URL(request.url).pathname.startsWith("/room/")) {
      const roomId = new URL(request.url).pathname.split("/room/")[1];
      const room = mediasoupService.getRoom(roomId);
      if (!room) {
        return new Response(JSON.stringify({ error: "Room not found" }), { status: 404 });
      }
      const stats = await mediasoupService.getRoomStats(roomId);
      return new Response(JSON.stringify(stats), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

/**
 * Handle WebSocket upgrade request for mediasoup signaling
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

  // Send connected message with mediasoup capabilities
  authSocket.send(JSON.stringify({
    type: "mediasoup.connected",
    userId,
    serverTime: new Date().toISOString(),
    capabilities: {
      // Indicate supported features
      simulcast: true,
      svc: true,
      dataChannels: true,
      recording: true,
      maxParticipants: 50,
    },
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

      // Route to mediasoup handler
      await routeMediasoupMessage(authSocket, message, connectionManager);
    } catch (error) {
      console.error("[Mediasoup] Message error:", error);
      authSocket.send(JSON.stringify({
        type: "error",
        code: "INTERNAL_ERROR",
        message: "Internal error"
      }));
    }
  });

  // Handle connection close
  authSocket.addEventListener("close", (event) => {
    // Clean up connection
    connectionManager.removeConnection(userId, authSocket);

    // If user was in a call, notify others
    // This would be handled by the participant cleanup in mediasoup service

    console.log(`[Mediasoup] Connection closed for user ${userId}: ${event.code} ${event.reason}`);
  });

  // Handle errors
  authSocket.addEventListener("error", (error) => {
    console.error("[Mediasoup] Socket error:", error);
  });

  return response;
}

/**
 * Parse client message - simple JSON parser for mediasoup signaling
 */
function parseClientMessage(data: string): any {
  try {
    const parsed = JSON.parse(data);
    // Validate required fields
    if (!parsed.type || typeof parsed.type !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// Graceful shutdown handling
if (typeof process !== "undefined") {
  process.on("SIGINT", async () => {
    console.log("[Mediasoup] Received SIGINT, shutting down...");
    await mediasoupService.shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("[Mediasoup] Received SIGTERM, shutting down...");
    await mediasoupService.shutdown();
    process.exit(0);
  });
}