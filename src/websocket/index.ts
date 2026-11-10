// WebSocket Function for Neon Functions - Handles Chat & Call Signaling
// Deployed as a separate function for independent scaling

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, and } from "drizzle-orm";
import * as schema from "../db/schema";
import { upgradeWebSocket } from "@neon/functions";

// Types for authenticated WebSocket
interface AuthenticatedSocket extends WebSocket {
  userId: string;
  isAlive: boolean;
  ping?: () => void;
}

// Message types
interface WSMessage {
  type: string;
  to_user_id?: string;
  conversationId?: string;
  content?: string;
  contentType?: string;
  callId?: string;
  sdp?: string;
  candidate?: string;
  callType?: string;
}

// Allowed message types for validation
const allowedMessageTypes = new Set([
  "send_message",
  "typing_start",
  "typing_stop",
  "mark_read",
  "delete_message",
  "call_initiate",
  "call_offer",
  "call_answer",
  "call_ice_candidate",
  "call_hangup",
  "call_reject",
  "call_busy",
  "call_ringing",
]);

// In-memory client store (per-function instance)
// Note: For production with multiple instances, consider Redis or Neon Realtime for presence
const clients = new Map<string, Set<AuthenticatedSocket>>();

// Environment variables (injected by Neon at runtime)
const DATABASE_URL = process.env.DATABASE_URL!;

// Create database pool
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
});

export const db = drizzle(pool, { schema });

// Session token verification uses database lookup (Better Auth uses opaque tokens by default)

function validateMessage(msg: unknown): WSMessage | null {
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (typeof m.type !== "string" || !allowedMessageTypes.has(m.type)) return null;
  return m as unknown as WSMessage;
}

// Extract token from WebSocket upgrade request
// Supports: Authorization: Bearer <token>, Sec-WebSocket-Protocol: bearer.<token>, or ?token= query param (legacy)
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

// Main handler for Neon Functions
export default {
  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");

    // Handle WebSocket upgrade
    if (upgradeHeader === "websocket") {
      return handleWebSocketUpgrade(request);
    }

    // Health check endpoint for the function
    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      return new Response(JSON.stringify({
        status: "ok",
        service: "websocket",
        timestamp: new Date().toISOString(),
        connections: clients.size,
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

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
  authSocket.userId = userId;
  authSocket.isAlive = true;

  // Register authenticated socket immediately
  const sockets = clients.get(authSocket.userId) ?? new Set();
  const firstConnection = sockets.size === 0;
  sockets.add(authSocket);
  clients.set(authSocket.userId, sockets);

  if (firstConnection) {
    broadcastPresence(authSocket.userId, "user_online");
  }

  // Heartbeat - 30 second interval with jitter
  const heartbeatInterval = 30_000 + Math.floor(Math.random() * 10_000) - 5_000; // 25-35s
  const heartbeat = setInterval(() => {
    if (!authSocket.isAlive) {
      clearInterval(heartbeat);
      return authSocket.close(1000, "Heartbeat timeout");
    }
    authSocket.isAlive = false;
    try {
      authSocket.ping?.();
    } catch {
      // Socket might be closed
    }
  }, heartbeatInterval);

  authSocket.addEventListener("message", async (event) => {
    try {
      // Enforce message size limit (16KB)
      const data = event.data;
      if (data && typeof data === "string" && data.length > 16_384) {
        authSocket.send(JSON.stringify({ type: "error", message: "Message too large (max 16KB)" }));
        return;
      }
      if (data && data instanceof ArrayBuffer && data.byteLength > 16_384) {
        authSocket.send(JSON.stringify({ type: "error", message: "Message too large (max 16KB)" }));
        return;
      }
      if (data && data instanceof Blob && data.size > 16_384) {
        authSocket.send(JSON.stringify({ type: "error", message: "Message too large (max 16KB)" }));
        return;
      }

      let message: WSMessage;
      try {
        const parsed = JSON.parse(data as string);
        const validated = validateMessage(parsed);
        if (!validated) {
          authSocket.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
          return;
        }
        message = validated;
      } catch {
        authSocket.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      // Route message (user already authenticated)
      await routeMessage(authSocket, message);
    } catch (error) {
      console.error("WebSocket message error:", error);
      authSocket.send(JSON.stringify({ type: "error", message: "Internal error" }));
    }
  });

  authSocket.addEventListener("close", () => {
    clearInterval(heartbeat);
    if (authSocket.userId) {
      const sockets = clients.get(authSocket.userId);
      if (sockets) {
        sockets.delete(authSocket);
        if (sockets.size === 0) {
          clients.delete(authSocket.userId);
          // Debounce offline broadcast (30s grace period for multi-device)
          setTimeout(() => {
            if ((clients.get(authSocket.userId)?.size ?? 0) === 0) {
              broadcastPresence(authSocket.userId, "user_offline");
            }
          }, 30_000);
        }
      }
    }
  });

  authSocket.addEventListener("error", (error) => {
    console.error("WebSocket error:", error);
  });

  authSocket.addEventListener("pong", () => {
    authSocket.isAlive = true;
  });

  return response;
}

async function verifyBetterAuthToken(token: string): Promise<string | null> {
  try {
    // Better Auth uses opaque session tokens - look up in database
    const session = await db.query.sessions.findFirst({
      where: eq(schema.sessions.token, token),
      with: { user: true },
    });

    if (!session || session.expiresAt < new Date()) {
      return null;
    }

    // Update session activity (sliding window)
    await db
      .update(schema.sessions)
      .set({ updatedAt: new Date() })
      .where(eq(schema.sessions.id, session.id));

    return session.userId;
  } catch (error) {
    console.error("Token verification failed:", error);
    return null;
  }
}

async function routeMessage(ws: AuthenticatedSocket, message: WSMessage) {
  switch (message.type) {
    case "send_message":
      if (!message.conversationId || !message.content) {
        ws.send(JSON.stringify({ type: "error", message: "Missing conversationId or content" }));
        return;
      }
      // Validate user is member of conversation
      const isMember = await isConversationMember(message.conversationId, ws.userId);
      if (!isMember) {
        ws.send(JSON.stringify({ type: "error", message: "Not a member of this conversation" }));
        return;
      }

      // Create message in database
      const newMessage = await createMessage({
        conversationId: message.conversationId,
        senderId: ws.userId,
        content: message.content,
        contentType: (message.contentType as any) || "TEXT",
      });

      // Broadcast to all conversation members
      broadcastToConversation(message.conversationId, {
        type: "new_message",
        message: newMessage,
      });
      break;

    case "typing_start":
    case "typing_stop":
      if (!message.conversationId) return;
      const isTypingMember = await isConversationMember(message.conversationId, ws.userId);
      if (!isTypingMember) return;
      broadcastToConversation(message.conversationId, {
        type: message.type,
        conversationId: message.conversationId,
        userId: ws.userId,
      }, ws.userId);
      break;

    case "mark_read":
      if (!message.conversationId) return;
      const isReadMember = await isConversationMember(message.conversationId, ws.userId);
      if (!isReadMember) return;
      // Update read receipt in database
      await markConversationRead(message.conversationId, ws.userId);
      broadcastToConversation(message.conversationId, {
        type: "message_read",
        conversationId: message.conversationId,
        userId: ws.userId,
      });
      break;

    case "delete_message":
      if (!message.conversationId || !message.to_user_id) return;
      // message.to_user_id is actually messageId here
      const deleted = await deleteMessage(message.to_user_id, ws.userId);
      if (deleted) {
        broadcastToConversation(message.conversationId, {
          type: "message_deleted",
          conversationId: message.conversationId,
          messageId: message.to_user_id,
        });
      }
      break;

    // Call signaling - relay directly to target user
    case "call_initiate":
    case "call_offer":
    case "call_answer":
    case "call_ice_candidate":
    case "call_hangup":
    case "call_reject":
    case "call_busy":
    case "call_ringing":
      if (!message.to_user_id || !message.callId) return;
      sendToUser(message.to_user_id, {
        ...message,
        from_user_id: ws.userId,
      });
      break;

    default:
      ws.send(JSON.stringify({ type: "error", message: "Unsupported message type" }));
  }
}

function sendToUser(userId: string, payload: object) {
  clients.get(userId)?.forEach((socket) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  });
}

async function broadcastToConversation(conversationId: string, payload: object, excludeUserId?: string) {
  // Get conversation members from database
  const members = await getConversationMembers(conversationId);

  for (const memberId of members) {
    if (memberId !== excludeUserId) {
      sendToUser(memberId, payload);
    }
  }
}

async function broadcastPresence(userId: string, type: "user_online" | "user_offline") {
  // Get followers from database
  const followers = await getFollowers(userId);

  for (const followerId of followers) {
    sendToUser(followerId, { type, user_id: userId });
  }
}

// Database helper functions using Drizzle
async function isConversationMember(conversationId: string, userId: string): Promise<boolean> {
  const result = await db
    .select({ id: schema.conversationMembers.id })
    .from(schema.conversationMembers)
    .where(and(
      eq(schema.conversationMembers.conversationId, conversationId),
      eq(schema.conversationMembers.userId, userId)
    ))
    .limit(1);
  return result.length > 0;
}

async function getConversationMembers(conversationId: string): Promise<string[]> {
  const result = await db
    .select({ userId: schema.conversationMembers.userId })
    .from(schema.conversationMembers)
    .where(eq(schema.conversationMembers.conversationId, conversationId));
  return result.map((r) => r.userId);
}

async function createMessage(data: {
  conversationId: string;
  senderId: string;
  content: string;
  contentType: string;
}): Promise<any> {
  const [result] = await db
    .insert(schema.messages)
    .values({
      conversationId: data.conversationId,
      senderId: data.senderId,
      textContent: data.content,
      contentType: data.contentType as any,
      status: "SENT",
    })
    .returning({
      id: schema.messages.id,
      conversationId: schema.messages.conversationId,
      senderId: schema.messages.senderId,
      textContent: schema.messages.textContent,
      contentType: schema.messages.contentType,
      status: schema.messages.status,
      createdAt: schema.messages.createdAt,
    });
  return result;
}

async function markConversationRead(conversationId: string, userId: string): Promise<void> {
  await db
    .update(schema.conversationMembers)
    .set({ lastReadAt: new Date() })
    .where(and(
      eq(schema.conversationMembers.conversationId, conversationId),
      eq(schema.conversationMembers.userId, userId)
    ));
}

async function deleteMessage(messageId: string, userId: string): Promise<boolean> {
  const result = await db
    .delete(schema.messages)
    .where(and(
      eq(schema.messages.id, messageId),
      eq(schema.messages.senderId, userId)
    ))
    .returning({ id: schema.messages.id });
  return result.length > 0;
}

async function getFollowers(userId: string): Promise<string[]> {
  const result = await db
    .select({ followerId: schema.follows.followerId })
    .from(schema.follows)
    .where(eq(schema.follows.followingId, userId));
  return result.map((r) => r.followerId);
}