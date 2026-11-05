import { WebSocket } from "ws";
import { createServer } from "http";
import { Neon } from "@neon/functions";

interface AuthenticatedSocket extends WebSocket {
  userId: string;
  isAlive: boolean;
}

const clients = new Map<string, Set<AuthenticatedSocket>>();

const MAX_MESSAGE_SIZE = 16 * 1024;

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

function validateMessage(msg: unknown): WSMessage | null {
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (typeof m.type !== "string" || !allowedMessageTypes.has(m.type)) return null;
  return m as WSMessage;
}

export default async function websocketHandler(request: Request, env: { DATABASE_URL: string }): Promise<Response> {
  const upgradeHeader = request.headers.get("Upgrade");
  if (upgradeHeader !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }

  const { 0: client, 1: server } = Object.values(new WebSocketPair());

  server.accept();

  // Parse token from query param
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    server.close(4001, "Missing token");
    return new Response(null, { status: 101, webSocket: client });
  }

  // Verify token and get user (you'll need to implement Firebase verification here)
  // For now, we'll store the token and validate on first message
  const socket = server as unknown as AuthenticatedSocket;
  socket.userId = ""; // Will be set after auth
  socket.isAlive = true;
  socket.pendingAuthToken = token;

  // Heartbeat
  const heartbeat = setInterval(() => {
    if (!socket.isAlive) {
      clearInterval(heartbeat);
      return socket.close(1000, "Heartbeat timeout");
    }
    socket.isAlive = false;
    socket.ping();
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
        // TODO: Verify Firebase token here
        // For now, we'll extract userId from a custom claim or assume it's passed
        // In production, verify with Firebase Admin SDK
        socket.userId = "user_from_token"; // Replace with actual verification
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

  return new Response(null, { status: 101, webSocket: client });
}

async function routeMessage(ws: AuthenticatedSocket, message: WSMessage) {
  switch (message.type) {
    case "send_message":
      if (!message.conversationId || !message.content) {
        ws.send(JSON.stringify({ type: "error", message: "Missing conversationId or content" }));
        return;
      }
      // TODO: Validate user is member of conversation
      // For now, broadcast to all members (implement with database check)
      broadcastToConversation(message.conversationId, {
        type: "new_message",
        message: {
          id: crypto.randomUUID(),
          conversationId: message.conversationId,
          senderId: ws.userId,
          content: message.content,
          contentType: message.contentType || "TEXT",
          status: "SENT",
          createdAt: new Date().toISOString(),
        },
      });
      break;

    case "typing_start":
    case "typing_stop":
      if (!message.conversationId) return;
      broadcastToConversation(message.conversationId, {
        type: message.type,
        conversationId: message.conversationId,
        userId: ws.userId,
      }, ws.userId);
      break;

    case "mark_read":
      if (!message.conversationId) return;
      broadcastToConversation(message.conversationId, {
        type: "message_read",
        conversationId: message.conversationId,
        userId: ws.userId,
      });
      break;

    case "delete_message":
      if (!message.conversationId || !message.to_user_id) return;
      broadcastToConversation(message.conversationId, {
        type: "message_deleted",
        conversationId: message.conversationId,
        messageId: message.to_user_id,
      });
      break;

    // Call signaling
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

function broadcastToConversation(conversationId: string, payload: object, excludeUserId?: string) {
  // TODO: Get conversation members from database and broadcast
  // For now, broadcast to all (implement with database query)
  clients.forEach((sockets, userId) => {
    if (userId !== excludeUserId) {
      sockets.forEach((socket) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(payload));
        }
      });
    }
  });
}

function broadcastPresence(userId: string, type: "user_online" | "user_offline") {
  // TODO: Get followers from database and notify
  // For now, broadcast to all connected users
  clients.forEach((sockets) => {
    sockets.forEach((socket) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type, user_id: userId }));
      }
    });
  });
}

// WebSocketPair polyfill for environments that don't have it
interface WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

const WebSocketPair = globalThis.WebSocketPair ?? class {
  constructor() {
    const server = new WebSocket("ws://localhost");
    const client = new WebSocket("ws://localhost");
    // This is a simplified polyfill - in Neon Functions, WebSocketPair is available natively
    return [client, server] as unknown as WebSocketPair;
  }
} as unknown as { new(): WebSocketPair };