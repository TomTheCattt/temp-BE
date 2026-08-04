import { Server } from 'http';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import { auth } from '../config/firebase';
import { prisma } from '../config/database';
import { isFirebaseConfigured } from '../config/env';

interface AuthenticatedSocket extends WebSocket { userId: string; isAlive: boolean; }
const clients = new Map<string, Set<AuthenticatedSocket>>();

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const heartbeat = setInterval(() => wss.clients.forEach((socket) => {
    const ws = socket as AuthenticatedSocket;
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false; ws.ping();
  }), 30_000);

  wss.on('connection', async (ws: AuthenticatedSocket, request) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
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
}

function rawToText(raw: RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString();
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString();
  return Buffer.from(raw).toString();
}

async function relay(ws: AuthenticatedSocket, raw: RawData) {
  let message: { type?: string; to_user_id?: string };
  try { message = JSON.parse(rawToText(raw)); } catch { return send(ws, { type: 'error', message: 'Invalid JSON' }); }
  const allowed = new Set(['typing_start', 'typing_stop', 'call_initiate', 'call_offer', 'call_answer', 'call_ice_candidate', 'call_hangup', 'call_reject', 'call_busy', 'call_ringing']);
  if (!message.type || !allowed.has(message.type) || !message.to_user_id) return send(ws, { type: 'error', message: 'Unsupported message' });
  const sharedConversation = await prisma.conversation.count({ where: { AND: [{ members: { some: { userId: ws.userId } } }, { members: { some: { userId: message.to_user_id } } }] } });
  if (!sharedConversation) return send(ws, { type: 'error', message: 'Recipient is not in a shared conversation' });
  sendToUser(message.to_user_id, { ...message, from_user_id: ws.userId });
}

function send(ws: WebSocket, payload: object) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); }
export function sendToUser(userId: string, payload: object) { clients.get(userId)?.forEach((socket) => send(socket, payload)); }
async function broadcastPresence(userId: string, type: 'user_online' | 'user_offline') {
  const followers = await prisma.follow.findMany({ where: { followingId: userId }, select: { followerId: true } });
  for (const { followerId } of followers) sendToUser(followerId, { type, user_id: userId });
}
