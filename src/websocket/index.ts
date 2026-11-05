// WebSocket Function for Neon Functions - Handles Chat & Call Signaling
// Deployed as a separate function for independent scaling

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, and } from "drizzle-orm";
import * as schema from "../db/schema";
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";

// Types for authenticated WebSocket
interface AuthenticatedSocket extends WebSocket {
  userId: string;
  isAlive: boolean;
  pendingAuthToken?: string;
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
const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL!;

// Create database pool
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
});

export const db = drizzle(pool, { schema });

// JWKS for Better Auth token verification
const jwksUrl = `${BETTER_AUTH_URL}/.well-known/jwks.json`;
const jwks = createRemoteJWKSet(new URL(jwksUrl));

interface AuthJWTPayload extends JWTPayload {
  sub: string;
  sessionId: string;
  email: string;
  username?: string;
}

function validateMessage(msg: unknown): WSMessage | null {
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (typeof m.type !== "string" || !allowedMessageTypes.has(m.type)) return null;
  return m as unknown as WSMessage;
}

// Main handler for Neon Functions
// Neon Functions export a default fetch handler
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
  // Neon Functions provides WebSocketPair via the runtime
  // For local development with `neon dev`, this works
  // @ts-expect-error - WebSocketPair is provided by Neon Functions runtime
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];

  server.accept();

  // Parse token from query param
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    server.close(4001, "Missing token");
    // @ts-expect-error - webSocket is supported by Neon Functions Response
    return new Response(null, { status: 101, webSocket: client });
  }

  const socket = server as unknown as AuthenticatedSocket;
  socket.userId = "";
  socket.isAlive = true;
  socket.pendingAuthToken = token;

  // Heartbeat - 30 second interval
  const heartbeat = setInterval(() => {
    if (!socket.isAlive) {
      clearInterval(heartbeat);
      return socket.close(1000, "Heartbeat timeout");
    }
    socket.isAlive = false;
    try {
      // @ts-expect-error - ping is available on WebSocket in Neon Functions
      socket.ping();
    } catch {
      // Socket might be closed
    }
  }, 30_000);

  socket.addEventListener("message", async (event) => {
    try {
      let message: WSMessage;
      try {
        const parsed = JSON.parse(event.data as string);
        const validated = validateMessage(parsed);
        if (!validated) {
          socket.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
          return;
        }
        message = validated;
      } catch {
        socket.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      // Handle auth on first message
      if (!socket.userId && socket.pendingAuthToken) {
        const userId = await verifyBetterAuthToken(socket.pendingAuthToken);
        if (!userId) {
          socket.close(4001, "Invalid token");
          return;
        }

        socket.userId = userId;
        delete socket.pendingAuthToken;

        const sockets = clients.get(socket.userId) ?? new Set();
        const firstConnection = sockets.size === 0;
        sockets.add(socket);
        clients.set(socket.userId, sockets);

        if (firstConnection) {
          broadcastPresence(socket.userId, "user_online");
        }
      }

      // Route message
      await routeMessage(socket, message);
    } catch (error) {
      console.error("WebSocket message error:", error);
      socket.send(JSON.stringify({ type: "error", message: "Internal error" }));
    }
  });

  socket.addEventListener("close", () => {
    clearInterval(heartbeat);
    if (socket.userId) {
      const sockets = clients.get(socket.userId);
      if (sockets) {
        sockets.delete(socket);
        if (sockets.size === 0) {
          clients.delete(socket.userId);
          // Debounce offline broadcast (30s grace period for multi-device)
          setTimeout(() => {
            if ((clients.get(socket.userId)?.size ?? 0) === 0) {
              broadcastPresence(socket.userId, "user_offline");
            }
          }, 30_000);
        }
      }
    }
  });

  socket.addEventListener("error", (error) => {
    console.error("WebSocket error:", error);
  });

  // @ts-expect-error - webSocket is supported by Neon Functions Response
  return new Response(null, { status: 101, webSocket: client });
}

async function verifyBetterAuthToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify<AuthJWTPayload>(token, jwks, {
      issuer: BETTER_AUTH_URL,
      audience: "instagram-clone",
    });
    return payload.sub;
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