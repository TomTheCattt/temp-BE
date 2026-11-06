// Local WebSocket Server for Development
// Integrates with Hono's built-in WebSocket support and verifies Better Auth tokens

import { WebSocketServer, WebSocket, RawData } from 'ws';
import { URL } from 'url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq, and } from 'drizzle-orm';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import * as schema from '../db/schema';
import { env } from '../config/env';

interface AuthenticatedSocket extends WebSocket {
  userId: string;
  isAlive: boolean;
  pendingAuthToken?: string;
}

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

// In-memory client store (per-server instance)
const clients = new Map<string, Set<AuthenticatedSocket>>();

// Database pool
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 5,
});

export const db = drizzle(pool, { schema });

// JWKS for Better Auth token verification
const jwksUrl = `${env.BETTER_AUTH_URL}/.well-known/jwks.json`;
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

export function setupWebSocket(wss: WebSocketServer) {
  const heartbeat = setInterval(() => {
    wss.clients.forEach((socket) => {
      const ws = socket as AuthenticatedSocket;
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    });
  }, 30_000);

  wss.on('connection', async (ws: AuthenticatedSocket, request) => {
    // Accept token from Authorization header OR query parameter
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '') || url.searchParams.get('token');

    if (!token) {
      console.log('[WS] Connection rejected: missing token');
      return ws.close(4001, 'Unauthorized');
    }

    ws.userId = "";
    ws.isAlive = true;
    ws.pendingAuthToken = token;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', async (raw: RawData) => {
      try {
        let message: WSMessage;
        try {
          const text = rawToText(raw);
          const parsed = JSON.parse(text);
          const validated = validateMessage(parsed);
          if (!validated) {
            ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
            return;
          }
          message = validated;
        } catch {
          ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
          return;
        }

        // Handle auth on first message (or if not yet authenticated)
        if (!ws.userId && ws.pendingAuthToken) {
          const userId = await verifyBetterAuthToken(ws.pendingAuthToken);
          if (!userId) {
            console.log('[WS] Token verification failed');
            ws.close(4001, "Invalid token");
            return;
          }

          ws.userId = userId;
          delete ws.pendingAuthToken;

          const sockets = clients.get(ws.userId) ?? new Set<AuthenticatedSocket>();
          const firstConnection = sockets.size === 0;
          sockets.add(ws);
          clients.set(ws.userId, sockets);

          if (firstConnection) {
            broadcastPresence(ws.userId, "user_online");
          }
        }

        // Route message
        await routeMessage(ws, message);
      } catch (error) {
        console.error('[WS] Message error:', error);
        ws.send(JSON.stringify({ type: "error", message: "Internal error" }));
      }
    });

    ws.on('close', () => {
      if (ws.userId) {
        const sockets = clients.get(ws.userId);
        if (sockets) {
          sockets.delete(ws);
          if (sockets.size === 0) {
            clients.delete(ws.userId);
            // Debounce offline broadcast (30s grace period for multi-device)
            setTimeout(() => {
              if ((clients.get(ws.userId)?.size ?? 0) === 0) {
                broadcastPresence(ws.userId, "user_offline");
              }
            }, 30_000);
          }
        }
      }
    });

    ws.on('error', (error) => {
      console.error('[WS] Socket error:', error);
    });
  });

  wss.on('close', () => clearInterval(heartbeat));
  wss.on('error', (err) => console.error('[WS] Server error:', err));

  console.log('[WS] WebSocket server initialized on path /ws');
}

function rawToText(raw: RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString();
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString();
  return Buffer.from(raw).toString();
}

async function verifyBetterAuthToken(token: string): Promise<string | null> {
  try {
    // First try to verify as JWT via JWKS
    const { payload } = await jwtVerify<AuthJWTPayload>(token, jwks, {
      issuer: env.BETTER_AUTH_URL,
      audience: "instagram-clone",
    });
    return payload.sub;
  } catch (error) {
    // If JWT verification fails, try to look up session in database
    // (Better Auth stores session tokens in the sessions table)
    console.log('[WS] JWT verification failed, trying session lookup:', error);
    try {
      const sessionRecord = await db
        .select({ userId: schema.sessions.userId })
        .from(schema.sessions)
        .where(and(
          eq(schema.sessions.token, token),
          eq(schema.sessions.expiresAt, new Date()) // Not expired
        ))
        .limit(1);
      if (sessionRecord.length > 0) {
        return sessionRecord[0].userId;
      }
    } catch (dbError) {
      console.error('[WS] Session lookup failed:', dbError);
    }
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
      const isMember = await isConversationMember(message.conversationId, ws.userId);
      if (!isMember) {
        ws.send(JSON.stringify({ type: "error", message: "Not a member of this conversation" }));
        return;
      }

      const newMessage = await createMessage({
        conversationId: message.conversationId,
        senderId: ws.userId,
        content: message.content,
        contentType: (message.contentType as any) || "TEXT",
      });

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
      await markConversationRead(message.conversationId, ws.userId);
      broadcastToConversation(message.conversationId, {
        type: "message_read",
        conversationId: message.conversationId,
        userId: ws.userId,
      });
      break;

    case "delete_message":
      if (!message.conversationId || !message.to_user_id) return;
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
  const members = await getConversationMembers(conversationId);
  for (const memberId of members) {
    if (memberId !== excludeUserId) {
      sendToUser(memberId, payload);
    }
  }
}

async function broadcastPresence(userId: string, type: "user_online" | "user_offline") {
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