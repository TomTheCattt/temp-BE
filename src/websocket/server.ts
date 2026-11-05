import { Server } from 'http';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import { URL } from 'url';
import { z } from 'zod';
import { auth } from '../config/firebase';
import { prisma } from '../config/database';
import { isFirebaseConfigured } from '../config/env';

interface AuthenticatedSocket extends WebSocket { userId: string; isAlive: boolean; }
const clients = new Map<string, Set<AuthenticatedSocket>>();

const MAX_MESSAGE_SIZE = 16 * 1024; // 16KB
const wsMessageSchema = z.object({
  type: z.enum(['typing_start', 'typing_stop', 'call_initiate', 'call_offer', 'call_answer', 'call_ice_candidate', 'call_hangup', 'call_reject', 'call_busy', 'call_ringing']),
  to_user_id: z.string().uuid(),
});

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE_SIZE });
  const heartbeat = setInterval(() => wss.clients.forEach((socket) => {
    const ws = socket as AuthenticatedSocket;
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false; ws.ping();
  }), 30_000);

  wss.on('connection', async (ws: AuthenticatedSocket, request) => {
    // Accept token from Authorization header OR query parameter
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '') || url.searchParams.get('token');

    if (!token || !isFirebaseConfigured) return ws.close(4001, 'Unauthorized');
    try {
      const decoded = await auth().verifyIdToken(token, true);
      const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid }, select: { id: true } });
      if (!user) return ws.close(4001, 'User not found');
      ws.userId = user.id; ws.isAlive = true;
      const sockets = clients.get(user.id) ?? new Set<AuthenticatedSocket>();
      const firstConnection = sockets.size === 0; sockets.add(ws); clients.set(user.id, sockets);
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('message', (raw) => { void relay(ws, raw); });
      ws.on('close', () => {
        sockets.delete(ws);
        if (sockets.size) return;
        setTimeout(() => { if ((clients.get(user.id)?.size ?? 0) === 0) { clients.delete(user.id); void broadcastPresence(user.id, 'user_offline'); } }, 30_000);
      });
      if (firstConnection) void broadcastPresence(user.id, 'user_online');
    } catch { ws.close(4001, 'Invalid token'); }
  });
  wss.on('close', () => clearInterval(heartbeat));

  // Handle WebSocket errors
  wss.on('error', (err) => {
    console.error('WebSocket server error:', err);
  });
}

function rawToText(raw: RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString();
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString();
  return Buffer.from(raw).toString();
}

async function relay(ws: AuthenticatedSocket, raw: RawData) {
  let message: { type?: string; to_user_id?: string };
  try {
    const text = rawToText(raw);
    const parsed = JSON.parse(text);
    const validated = wsMessageSchema.parse(parsed);
    message = validated;
  } catch {
    return send(ws, { type: 'error', message: 'Invalid message format' });
  }

  const sharedConversation = await prisma.conversation.count({ where: { AND: [{ members: { some: { userId: ws.userId } } }, { members: { some: { userId: message.to_user_id } } }] } });
  if (!sharedConversation) return send(ws, { type: 'error', message: 'Recipient is not in a shared conversation' });
  if (!message.to_user_id) return send(ws, { type: 'error', message: 'Missing recipient' });
  sendToUser(message.to_user_id, { ...message, from_user_id: ws.userId });
}

function send(ws: WebSocket, payload: object) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); }
export function sendToUser(userId: string, payload: object) { clients.get(userId)?.forEach((socket) => send(socket, payload)); }
async function broadcastPresence(userId: string, type: 'user_online' | 'user_offline') {
  const followers = await prisma.follow.findMany({ where: { followingId: userId }, select: { followerId: true } });
  for (const { followerId } of followers) sendToUser(followerId, { type, user_id: userId });
}