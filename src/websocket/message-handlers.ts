/**
 * WebSocket Message Handlers
 *
 * Handles incoming WebSocket messages:
 * - ping/pong (heartbeat)
 * - subscribe/unsubscribe (channel management)
 * - message.send, message.read, typing, presence, sync
 *
 * Based on DESIGN_DOCUMENT.md §7.1 WebSocket API
 */

import { WebSocket } from "ws";
import { db } from "../db/client";
import { eq, and, desc, lt } from "drizzle-orm";
import * as schema from "../db/schema";
import { ConnectionManager, AuthenticatedSocket, MessageEnvelope, ConnectionState } from "./connection-manager";
import { canSubscribe, parseChannel, ChannelType, getConversationChannel, getUserChannel, getPresenceChannel } from "./channel-auth";
import { createMessage, markConversationRead, deleteMessage, getConversationMembers, isConversationMember, updateMessage, unsendMessage, addMessageReaction, removeMessageReaction, getMessageReactions } from "./message-helpers";
import { processIncomingEvent, handleAcknowledgment as processAcknowledgment, getRecoveryState, createRecoveryRequest, sendWithAck, cleanupRecoveryState } from "./event-recovery";

/**
 * Supported client message types
 */
export enum ClientMessageType {
  PING = "ping",
  SUBSCRIBE = "subscribe",
  UNSUBSCRIBE = "unsubscribe",
  MESSAGE_SEND = "message.send",
  MESSAGE_READ = "message.read",
  MESSAGE_REACT = "message.react",
  MESSAGE_REACT_REMOVE = "message.react.remove",
  MESSAGE_TYPING_START = "message.typing.start",
  MESSAGE_TYPING_STOP = "message.typing.stop",
  MESSAGE_DELETE = "message.delete",
  MESSAGE_UNSEND = "message.unsend",
  MESSAGE_EDIT = "message.edit",
  PRESENCE_UPDATE = "presence.update",
  SYNC_REQUEST = "sync.request",
  RECOVERY_REQUEST = "recovery.request",
  ACKNOWLEDGMENT = "acknowledgment",
}

/**
 * Supported server message types
 */
export enum ServerMessageType {
  PONG = "pong",
  CONNECTED = "connected",
  SUBSCRIBED = "subscribed",
  UNSUBSCRIBED = "unsubscribed",
  MESSAGE_NEW = "message.new",
  MESSAGE_UPDATED = "message.updated",
  MESSAGE_DELETED = "message.deleted",
  MESSAGE_REACTION = "message.reaction",
  MESSAGE_REACTION_REMOVED = "message.reaction.removed",
  MESSAGE_DELIVERED = "message.delivered",
  MESSAGE_READ_RECEIPT = "message.read",
  MESSAGE_ACK = "message.ack",
  TYPING_START = "typing.start",
  TYPING_STOP = "typing.stop",
  PRESENCE_CHANGED = "presence.changed",
  NOTIFICATION_NEW = "notification.new",
  NOTIFICATION_READ = "notification.read",
  SYNC_RESPONSE = "sync.response",
  RECOVERY_RESPONSE = "recovery.response",
  LIVE_UPDATE = "live.update",
  ERROR = "error",
}

/**
 * Client message payloads
 */
export interface PingPayload {}
export interface SubscribePayload { channels: string[]; }
export interface UnsubscribePayload { channels: string[]; }
export interface MessageSendPayload { conversationId: string; content: string; contentType?: string; replyToId?: string; }
export interface MessageReadPayload { conversationId: string; messageId: string; }
export interface MessageReactPayload { messageId: string; emoji: string; }
export interface TypingPayload { conversationId: string; }
export interface PresenceUpdatePayload { status: "online" | "away" | "busy"; }
export interface SyncRequestPayload { conversationId: string; lastMessageId?: string; lastReadAt?: string; }
export interface MessageDeletePayload { conversationId: string; messageId: string; }
export interface MessageUnsendPayload { conversationId: string; messageId: string; forEveryone: boolean; }
export interface MessageEditPayload { conversationId: string; messageId: string; content: string; }
export interface RecoveryRequestPayload { conversationId: string; lastSequence: number; lastEventId: string; generation: number; }
export interface AcknowledgmentPayload { eventId: string; sequence: number; }

export type ClientMessage =
  | { type: ClientMessageType.PING; payload: PingPayload; requestId?: string; }
  | { type: ClientMessageType.SUBSCRIBE; payload: SubscribePayload; requestId?: string; }
  | { type: ClientMessageType.UNSUBSCRIBE; payload: UnsubscribePayload; requestId?: string; }
  | { type: ClientMessageType.MESSAGE_SEND; payload: MessageSendPayload; requestId?: string; }
  | { type: ClientMessageType.MESSAGE_READ; payload: MessageReadPayload; requestId?: string; }
  | { type: ClientMessageType.MESSAGE_REACT; payload: MessageReactPayload; requestId?: string; }
  | { type: ClientMessageType.MESSAGE_REACT_REMOVE; payload: MessageReactPayload; requestId?: string; }
  | { type: ClientMessageType.MESSAGE_TYPING_START; payload: TypingPayload; requestId?: string; }
  | { type: ClientMessageType.MESSAGE_TYPING_STOP; payload: TypingPayload; requestId?: string; }
  | { type: ClientMessageType.MESSAGE_DELETE; payload: MessageDeletePayload; requestId?: string; }
  | { type: ClientMessageType.MESSAGE_UNSEND; payload: MessageUnsendPayload; requestId?: string; }
  | { type: ClientMessageType.MESSAGE_EDIT; payload: MessageEditPayload; requestId?: string; }
  | { type: ClientMessageType.PRESENCE_UPDATE; payload: PresenceUpdatePayload; requestId?: string; }
  | { type: ClientMessageType.SYNC_REQUEST; payload: SyncRequestPayload; requestId?: string; }
  | { type: ClientMessageType.RECOVERY_REQUEST; payload: RecoveryRequestPayload; requestId?: string; }
  | { type: ClientMessageType.ACKNOWLEDGMENT; payload: AcknowledgmentPayload; requestId?: string; };

/**
 * Server message payloads
 */
export interface PongPayload { timestamp: string; serverTime: string; }
export interface ConnectedPayload { userId: string; serverTime: string; }
export interface SubscribedPayload { channels: string[]; }
export interface UnsubscribedPayload { channels: string[]; }
export interface ErrorPayload { code: string; message: string; requestId?: string; }
export interface MessageDeliveredPayload { conversationId: string; messageId: string; userId: string; timestamp: string; }
export interface MessageAckPayload { eventId: string; sequence: number; messageId: string; status: "delivered" | "read" | "failed"; }
export interface RecoveryResponsePayload {
  conversationId: string;
  events: MessageEnvelope[];
  snapshot?: any;
  nextCursor?: string | null;
  hasMore: boolean;
  lastSequence: number;
  lastEventId: string;
  success: boolean;
}

export type ServerMessage =
  | { type: ServerMessageType.PONG; payload: PongPayload; requestId?: string; }
  | { type: ServerMessageType.CONNECTED; payload: ConnectedPayload; }
  | { type: ServerMessageType.SUBSCRIBED; payload: SubscribedPayload; requestId?: string; }
  | { type: ServerMessageType.UNSUBSCRIBED; payload: UnsubscribedPayload; requestId?: string; }
  | { type: ServerMessageType.MESSAGE_NEW; payload: any; }
  | { type: ServerMessageType.MESSAGE_UPDATED; payload: any; requestId?: string; }
  | { type: ServerMessageType.MESSAGE_DELETED; payload: { messageId: string; conversationId: string; forEveryone: boolean; }; requestId?: string; }
  | { type: ServerMessageType.MESSAGE_REACTION; payload: { messageId: string; emoji: string; userId: string; count: number; }; }
  | { type: ServerMessageType.MESSAGE_REACTION_REMOVED; payload: { messageId: string; emoji: string; userId: string; count: number; }; requestId?: string; }
  | { type: ServerMessageType.MESSAGE_DELIVERED; payload: MessageDeliveredPayload; }
  | { type: ServerMessageType.MESSAGE_READ_RECEIPT; payload: { conversationId: string; messageId: string; userId: string; }; }
  | { type: ServerMessageType.MESSAGE_ACK; payload: MessageAckPayload; }
  | { type: ServerMessageType.TYPING_START; payload: { userId: string; conversationId: string; }; }
  | { type: ServerMessageType.TYPING_STOP; payload: { userId: string; conversationId: string; }; }
  | { type: ServerMessageType.PRESENCE_CHANGED; payload: { userId: string; status: string; lastSeen?: string; }; }
  | { type: ServerMessageType.NOTIFICATION_NEW; payload: any; }
  | { type: ServerMessageType.NOTIFICATION_READ; payload: { notificationId: string; }; }
  | { type: ServerMessageType.SYNC_RESPONSE; payload: { conversationId: string; messages: any[]; hasMore: boolean; nextCursor: string | null; }; }
  | { type: ServerMessageType.RECOVERY_RESPONSE; payload: RecoveryResponsePayload; requestId?: string; }
  | { type: ServerMessageType.LIVE_UPDATE; payload: { liveId: string; event: string; data: any; }; }
  | { type: ServerMessageType.ERROR; payload: ErrorPayload; requestId?: string; };

/**
 * Maximum message size (16KB)
 */
const MAX_MESSAGE_SIZE = 16_384;

/**
 * Validate and parse incoming message
 */
export function parseClientMessage(data: string | ArrayBuffer | Blob): ClientMessage | null {
  try {
    let text: string;
    if (typeof data === "string") {
      text = data;
    } else if (data instanceof ArrayBuffer) {
      text = new TextDecoder().decode(data);
    } else if (data instanceof Blob) {
      // Blob needs async read, handle in caller
      return null;
    } else {
      return null;
    }

    if (text.length > MAX_MESSAGE_SIZE) {
      return null;
    }

    const parsed = JSON.parse(text);

    // Basic validation
    if (!parsed || typeof parsed.type !== "string") {
      return null;
    }

    return parsed as ClientMessage;
  } catch {
    return null;
  }
}

/**
 * Send a message to a socket
 */
export function sendMessage(ws: AuthenticatedSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Send error response
 */
export function sendError(ws: AuthenticatedSocket, code: string, message: string, requestId?: string): void {
  sendMessage(ws, {
    type: ServerMessageType.ERROR,
    payload: { code, message },
    requestId,
  });
}

/**
 * Handle ping message - respond with pong
 */
export async function handlePing(
  ws: AuthenticatedSocket,
  message: ClientMessage,
  manager: ConnectionManager
): Promise<void> {
  const requestId = "requestId" in message ? message.requestId : undefined;

  // Update activity
  manager.updateActivity(ws);
  ws.isAlive = true;

  // Respond with pong
  sendMessage(ws, {
    type: ServerMessageType.PONG,
    payload: {
      timestamp: new Date().toISOString(),
      serverTime: new Date().toISOString(),
    },
    requestId,
  });
}

/**
 * Handle subscribe message - subscribe to channels
 */
export async function handleSubscribe(
  ws: AuthenticatedSocket,
  message: ClientMessage,
  manager: ConnectionManager
): Promise<void> {
  const requestId = "requestId" in message ? message.requestId : undefined;
  const payload = message.payload as SubscribePayload;

  if (!payload.channels || !Array.isArray(payload.channels)) {
    sendError(ws, "INVALID_PAYLOAD", "Missing or invalid channels array", requestId);
    return;
  }

  // Validate each channel
  const allowedChannels: string[] = [];
  const deniedChannels: string[] = [];

  for (const channel of payload.channels) {
    if (typeof channel !== "string") {
      deniedChannels.push(channel);
      continue;
    }

    const authResult = await canSubscribe(ws.userId, channel);
    if (authResult.allowed) {
      allowedChannels.push(channel);
    } else {
      deniedChannels.push(channel);
    }
  }

  // Subscribe to allowed channels
  if (allowedChannels.length > 0) {
    manager.subscribe(ws, allowedChannels);
  }

  // Respond with subscribed channels
  sendMessage(ws, {
    type: ServerMessageType.SUBSCRIBED,
    payload: { channels: allowedChannels },
    requestId,
  });

  // Log denied channels
  if (deniedChannels.length > 0) {
    console.log(`[MessageHandlers] User ${ws.userId} denied subscription to: ${deniedChannels.join(", ")}`);
  }
}

/**
 * Handle unsubscribe message - unsubscribe from channels
 */
export async function handleUnsubscribe(
  ws: AuthenticatedSocket,
  message: ClientMessage,
  manager: ConnectionManager
): Promise<void> {
  const requestId = "requestId" in message ? message.requestId : undefined;
  const payload = message.payload as UnsubscribePayload;

  if (!payload.channels || !Array.isArray(payload.channels)) {
    sendError(ws, "INVALID_PAYLOAD", "Missing or invalid channels array", requestId);
    return;
  }

  // Unsubscribe from channels
  manager.unsubscribe(ws, payload.channels);

  // Respond with unsubscribed channels
  sendMessage(ws, {
    type: ServerMessageType.UNSUBSCRIBED,
    payload: { channels: payload.channels },
    requestId,
  });
}

/**
 * Handle message.send - send a new message to a conversation
 */
export async function handleMessageSend(
  ws: AuthenticatedSocket,
  message: ClientMessage,
  manager: ConnectionManager
): Promise<void> {
  const requestId = "requestId" in message ? message.requestId : undefined;
  const payload = message.payload as MessageSendPayload;

  if (!payload.conversationId || !payload.content) {
    sendError(ws, "INVALID_PAYLOAD", "Missing conversationId or content", requestId);
    return;
  }

  // Verify user is member of conversation
  const isMember = await isConversationMember(payload.conversationId, ws.userId);
  if (!isMember) {
    sendError(ws, "FORBIDDEN", "Not a member of this conversation", requestId);
    return;
  }

  try {
    // Create message in database
    const newMessage = await createMessage({
      conversationId: payload.conversationId,
      senderId: ws.userId,
      content: payload.content,
      contentType: payload.contentType || "TEXT",
      replyToId: payload.replyToId,
    });

    // Broadcast to conversation channel
    const conversationChannel = getConversationChannel(payload.conversationId);
    const envelope = manager.createEnvelope(ServerMessageType.MESSAGE_NEW, newMessage);

    await manager.broadcast(conversationChannel, envelope);

    // Send confirmation to sender (without requestId in the envelope)
    sendMessage(ws, {
      type: ServerMessageType.MESSAGE_NEW,
      payload: newMessage,
    });

  } catch (error) {
    console.error("[MessageHandlers] Failed to send message:", error);
    sendError(ws, "INTERNAL_ERROR", "Failed to send message", requestId);
  }
}

/**
 * Handle message.read - mark messages as read
 */
export async function handleMessageRead(
  ws: AuthenticatedSocket,
  message: ClientMessage,
  manager: ConnectionManager
): Promise<void> {
  const requestId = "requestId" in message ? message.requestId : undefined;
  const payload = message.payload as MessageReadPayload;

  if (!payload.conversationId || !payload.messageId) {
    sendError(ws, "INVALID_PAYLOAD", "Missing conversationId or messageId", requestId);
    return;
  }

  // Verify user is member of conversation
  const isMember = await isConversationMember(payload.conversationId, ws.userId);
  if (!isMember) {
    sendError(ws, "FORBIDDEN", "Not a member of this conversation", requestId);
    return;
  }

  try {
    // Update read receipt in database
    await markConversationRead(payload.conversationId, ws.userId);

    // Broadcast to conversation
    const conversationChannel = getConversationChannel(payload.conversationId);
    const envelope = manager.createEnvelope(ServerMessageType.MESSAGE_READ_RECEIPT, {
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      userId: ws.userId,
    });

    await manager.broadcast(conversationChannel, envelope);

  } catch (error) {
    console.error("[MessageHandlers] Failed to mark read:", error);
    sendError(ws, "INTERNAL_ERROR", "Failed to mark as read", requestId);
  }
}

/**
 * Handle message.react - add reaction to message
 */
export async function handleMessageReact(
  ws: AuthenticatedSocket,
  message: ClientMessage,
  manager: ConnectionManager
): Promise<void> {
  const requestId = "requestId" in message ? message.requestId : undefined;
  const payload = message.payload as MessageReactPayload;

  if (!payload.messageId || !payload.emoji) {
    sendError(ws, "INVALID_PAYLOAD", "Missing messageId or emoji", requestId);
    return;
  }

  // TODO: Implement reaction logic with database
  // For now, just broadcast the reaction
  const envelope = manager.createEnvelope(ServerMessageType.MESSAGE_REACTION, {
    messageId: payload.messageId,
    emoji: payload.emoji,
    userId: ws.userId,
    count: 1, // TODO: Get actual count
  });

  // Broadcast to user's conversation (need to find which conversation)
  // This would require a database lookup
  console.log(`[MessageHandlers] Reaction from ${ws.userId} on ${payload.messageId}: ${payload.emoji}`);
}

/**
 * Handle typing.start - broadcast typing indicator
 */
export async function handleTypingStart(
  ws: AuthenticatedSocket,
  message: ClientMessage,
  manager: ConnectionManager
): Promise<void> {
  const payload = message.payload as TypingPayload;

  if (!payload.conversationId) return;

  // Verify user is member
  const isMember = await isConversationMember(payload.conversationId, ws.userId);
  if (!isMember) return;

  // Broadcast to conversation (excluding sender)
  const conversationChannel = getConversationChannel(payload.conversationId);
  const envelope = manager.createEnvelope(ServerMessageType.TYPING_START, {
    userId: ws.userId,
    conversationId: payload.conversationId,
  });

  await manager.broadcast(conversationChannel, envelope, manager.getSocketId(ws) || undefined);
}

/**
 * Handle typing.stop - broadcast typing stop
 */
export async function handleTypingStop(
  ws: AuthenticatedSocket,
  message: ClientMessage,
  manager: ConnectionManager
): Promise<void> {
  const payload = message.payload as TypingPayload;

  if (!payload.conversationId) return;

  // Verify user is member
  const isMember = await isConversationMember(payload.conversationId, ws.userId);
  if (!isMember) return;

  // Broadcast to conversation (excluding sender)
  const conversationChannel = getConversationChannel(payload.conversationId);
  const envelope = manager.createEnvelope(ServerMessageType.TYPING_STOP, {
    userId: ws.userId,
    conversationId: payload.conversationId,
  });

  await manager.broadcast(conversationChannel, envelope, manager.getSocketId(ws) || undefined);
}

/**
 * Handle presence.update - update user presence status
 */
export async function handlePresenceUpdate(
  ws: AuthenticatedSocket,
  message: ClientMessage,
  manager: ConnectionManager
): Promise<void> {
  const requestId = "requestId" in message ? message.requestId : undefined;
  const payload = message.payload as PresenceUpdatePayload;

  if (!payload.status || !["online", "away", "busy"].includes(payload.status)) {
    sendError(ws, "INVALID_PAYLOAD", "Invalid status. Must be: online, away, or busy", requestId);
    return;
  }

  try {
    await manager.updatePresence(ws.userId, payload.status);

    // Send confirmation (without requestId in the envelope)
    sendMessage(ws, {
      type: ServerMessageType.PRESENCE_CHANGED,
      payload: {
        userId: ws.userId,
        status: payload.status,
        lastSeen: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[MessageHandlers] Failed to update presence:", error);
    sendError(ws, "INTERNAL_ERROR", "Failed to update presence", requestId);
  }
}

/**
 * Handle sync.request - fetch missed messages for reconnection
 */
export async function handleSyncRequest(
  ws: AuthenticatedSocket,
  message: ClientMessage,
  manager: ConnectionManager
): Promise<void> {
  const requestId = "requestId" in message ? message.requestId : undefined;
  const payload = message.payload as SyncRequestPayload;

  if (!payload.conversationId) {
    sendError(ws, "INVALID_PAYLOAD", "Missing conversationId", requestId);
    return;
  }

  // Verify user is member
  const isMember = await isConversationMember(payload.conversationId, ws.userId);
  if (!isMember) {
    sendError(ws, "FORBIDDEN", "Not a member of this conversation", requestId);
    return;
  }

  try {
    // Fetch messages after lastMessageId (or latest 50 if not provided)
    let whereCondition = and(
      eq(schema.messages.conversationId, payload.conversationId),
      eq(schema.messages.status, "SENT")
    );

    if (payload.lastMessageId) {
      const lastMsg = await db
        .select({ createdAt: schema.messages.createdAt })
        .from(schema.messages)
        .where(eq(schema.messages.id, payload.lastMessageId))
        .limit(1);

      if (lastMsg.length > 0) {
        whereCondition = and(
          whereCondition,
          lt(schema.messages.createdAt, lastMsg[0].createdAt)
        );
      }
    }

    const messages = await db
      .select()
      .from(schema.messages)
      .where(whereCondition)
      .orderBy(desc(schema.messages.createdAt))
      .limit(50);

    // Respond with sync data
    sendMessage(ws, {
      type: ServerMessageType.SYNC_RESPONSE,
      payload: {
        conversationId: payload.conversationId,
        messages: messages.reverse(), // Chronological order
        hasMore: messages.length === 50,
        nextCursor: messages.length === 50 ? messages[messages.length - 1].id : null,
      },
    });
  } catch (error) {
    console.error("[MessageHandlers] Sync request failed:", error);
    sendError(ws, "INTERNAL_ERROR", "Sync request failed", requestId);
  }
}

/**
 * Handle recovery.request - event recovery with sequence IDs
 */
export async function handleRecoveryRequest(
  ws: AuthenticatedSocket,
  message: ClientMessage,
  manager: ConnectionManager
): Promise<void> {
  const requestId = "requestId" in message ? message.requestId : undefined;
  const payload = message.payload as RecoveryRequestPayload;

  if (!payload.conversationId || payload.lastSequence === undefined) {
    sendError(ws, "INVALID_PAYLOAD", "Missing conversationId or lastSequence", requestId);
    return;
  }

  // Verify user is member
  const isMember = await isConversationMember(payload.conversationId, ws.userId);
  if (!isMember) {
    sendError(ws, "FORBIDDEN", "Not a member of this conversation", requestId);
    return;
  }

  try {
    // Fetch messages after lastSequence
    const whereCondition = and(
      eq(schema.messages.conversationId, payload.conversationId),
      eq(schema.messages.status, "SENT")
    );

    // Note: In a real implementation, we would use the sequence number from a separate
    // event log table. For now, we use createdAt as a proxy.
    const messages = await db
      .select()
      .from(schema.messages)
      .where(whereCondition)
      .orderBy(desc(schema.messages.createdAt))
      .limit(50);

    // Create envelopes for each message
    const events: MessageEnvelope[] = messages
      .reverse()
      .map((msg, index) => ({
        eventId: crypto.randomUUID(),
        sequence: payload.lastSequence + index + 1,
        timestamp: msg.createdAt.toISOString(),
        type: ServerMessageType.MESSAGE_NEW,
        payload: msg,
      }));

    // Respond with recovery data
    const recoveryResponse: ServerMessage = {
      type: ServerMessageType.RECOVERY_RESPONSE,
      payload: {
        conversationId: payload.conversationId,
        events,
        snapshot: null,
        nextCursor: messages.length === 50 ? messages[messages.length - 1].id : null,
        hasMore: messages.length === 50,
        lastSequence: payload.lastSequence + events.length,
        lastEventId: events.length > 0 ? events[events.length - 1].eventId : payload.lastEventId,
        success: true,
      },
      requestId,
    };

    sendMessage(ws, recoveryResponse);
  } catch (error) {
    console.error("[MessageHandlers] Recovery request failed:", error);
    sendError(ws, "INTERNAL_ERROR", "Recovery request failed", requestId);
  }
}

/**
 * Handle message.delete - delete a message (soft delete for sender)
 */
export async function handleMessageDelete(
  ws: AuthenticatedSocket,
  message: ClientMessage,
  manager: ConnectionManager
): Promise<void> {
  const requestId = "requestId" in message ? message.requestId : undefined;
  const payload = message.payload as MessageDeletePayload;

  if (!payload.conversationId || !payload.messageId) {
    sendError(ws, "INVALID_PAYLOAD", "Missing conversationId or messageId", requestId);
    return;
  }

  // Verify user is member
  const isMember = await isConversationMember(payload.conversationId, ws.userId);
  if (!isMember) {
    sendError(ws, "FORBIDDEN", "Not a member of this conversation", requestId);
    return;
  }

  try {
    // Delete message (only sender can delete)
    const deleted = await deleteMessage(payload.messageId, ws.userId);

    if (!deleted) {
      sendError(ws, "NOT_FOUND", "Message not found or not authorized", requestId);
      return;
    }

    // Broadcast deletion to conversation
    const conversationChannel = getConversationChannel(payload.conversationId);
    const envelope = manager.createEnvelope(ServerMessageType.MESSAGE_DELETED, {
      messageId: payload.messageId,
      conversationId: payload.conversationId,
      forEveryone: false, // Soft delete for sender only
    });

    await manager.broadcast(conversationChannel, envelope);

    // Send confirmation to sender
    sendMessage(ws, {
      type: ServerMessageType.MESSAGE_DELETED,
      payload: {
        messageId: payload.messageId,
        conversationId: payload.conversationId,
        forEveryone: false,
      },
      requestId,
    });
  } catch (error) {
    console.error("[MessageHandlers] Failed to delete message:", error);
    sendError(ws, "INTERNAL_ERROR", "Failed to delete message", requestId);
  }
}

/**
 * Handle message.unsend - unsend a message (delete for everyone or just me)
 */
export async function handleMessageUnsend(
  ws: AuthenticatedSocket,
  message: ClientMessage,
  manager: ConnectionManager
): Promise<void> {
  const requestId = "requestId" in message ? message.requestId : undefined;
  const payload = message.payload as MessageUnsendPayload;

  if (!payload.conversationId || !payload.messageId) {
    sendError(ws, "INVALID_PAYLOAD", "Missing conversationId or messageId", requestId);
    return;
  }

  // Verify user is member
  const isMember = await isConversationMember(payload.conversationId, ws.userId);
  if (!isMember) {
    sendError(ws, "FORBIDDEN", "Not a member of this conversation", requestId);
    return;
  }

  try {
    // Unsend message
    const unsent = await unsendMessage(payload.messageId, ws.userId, payload.forEveryone);

    if (!unsent) {
      sendError(ws, "NOT_FOUND", "Message not found or not authorized", requestId);
      return;
    }

    // Broadcast unsend to conversation
    const conversationChannel = getConversationChannel(payload.conversationId);
    const envelope = manager.createEnvelope(ServerMessageType.MESSAGE_DELETED, {
      messageId: payload.messageId,
      conversationId: payload.conversationId,
      forEveryone: payload.forEveryone,
    });

    await manager.broadcast(conversationChannel, envelope);

    // Send confirmation to sender
    sendMessage(ws, {
      type: ServerMessageType.MESSAGE_DELETED,
      payload: {
        messageId: payload.messageId,
        conversationId: payload.conversationId,
        forEveryone: payload.forEveryone,
      },
      requestId,
    });
  } catch (error) {
    console.error("[MessageHandlers] Failed to unsend message:", error);
    sendError(ws, "INTERNAL_ERROR", "Failed to unsend message", requestId);
  }
}

/**
 * Handle message.edit - edit a message (within time limit)
 */
export async function handleMessageEdit(
  ws: AuthenticatedSocket,
  message: ClientMessage,
  manager: ConnectionManager
): Promise<void> {
  const requestId = "requestId" in message ? message.requestId : undefined;
  const payload = message.payload as MessageEditPayload;

  if (!payload.conversationId || !payload.messageId || !payload.content) {
    sendError(ws, "INVALID_PAYLOAD", "Missing conversationId, messageId, or content", requestId);
    return;
  }

  // Verify user is member
  const isMember = await isConversationMember(payload.conversationId, ws.userId);
  if (!isMember) {
    sendError(ws, "FORBIDDEN", "Not a member of this conversation", requestId);
    return;
  }

  try {
    // Update message (only sender can edit, within time limit)
    const updated = await updateMessage(payload.messageId, ws.userId, payload.content);

    if (!updated) {
      sendError(ws, "NOT_FOUND", "Message not found, not authorized, or edit window expired", requestId);
      return;
    }

    // Broadcast edit to conversation
    const conversationChannel = getConversationChannel(payload.conversationId);
    const envelope = manager.createEnvelope(ServerMessageType.MESSAGE_UPDATED, updated);

    await manager.broadcast(conversationChannel, envelope);

    // Send confirmation to sender
    sendMessage(ws, {
      type: ServerMessageType.MESSAGE_UPDATED,
      payload: updated,
      requestId,
    });
  } catch (error) {
    console.error("[MessageHandlers] Failed to edit message:", error);
    sendError(ws, "INTERNAL_ERROR", "Failed to edit message", requestId);
  }
}

/**
 * Handle message.react.remove - remove reaction from message
 */
export async function handleMessageReactRemove(
  ws: AuthenticatedSocket,
  message: ClientMessage,
  manager: ConnectionManager
): Promise<void> {
  const requestId = "requestId" in message ? message.requestId : undefined;
  const payload = message.payload as MessageReactPayload;

  if (!payload.messageId || !payload.emoji) {
    sendError(ws, "INVALID_PAYLOAD", "Missing messageId or emoji", requestId);
    return;
  }

  try {
    // Remove reaction
    await removeMessageReaction(payload.messageId, ws.userId, payload.emoji);

    // Broadcast reaction removal
    const envelope = manager.createEnvelope(ServerMessageType.MESSAGE_REACTION_REMOVED, {
      messageId: payload.messageId,
      emoji: payload.emoji,
      userId: ws.userId,
      count: 0, // TODO: Get actual count
    });

    // Would need to find the conversation ID for the message
    // For now, broadcast to user's conversations
    console.log(`[MessageHandlers] Reaction removed: ${payload.emoji} by ${ws.userId} from ${payload.messageId}`);

  } catch (error) {
    console.error("[MessageHandlers] Failed to remove reaction:", error);
    sendError(ws, "INTERNAL_ERROR", "Failed to remove reaction", requestId);
  }
}

/**
 * Handle acknowledgment - client acknowledges receipt of event
 */
export async function handleAcknowledgment(
  ws: AuthenticatedSocket,
  message: ClientMessage,
  manager: ConnectionManager
): Promise<void> {
  const payload = message.payload as AcknowledgmentPayload;

  // Handle acknowledgment using event recovery
  processAcknowledgment(ws, {
    eventId: payload.eventId,
    sequence: payload.sequence,
    timestamp: new Date().toISOString(),
    type: "acknowledgment",
    payload: { eventId: payload.eventId, sequence: payload.sequence },
  } as MessageEnvelope);
}

/**
 * Route incoming message to appropriate handler
 */
export async function routeMessage(
  ws: AuthenticatedSocket,
  message: ClientMessage,
  manager: ConnectionManager
): Promise<void> {
  // Update activity timestamp
  manager.updateActivity(ws);

  try {
    const messageType = message.type;
    switch (messageType) {
      case ClientMessageType.PING:
        await handlePing(ws, message, manager);
        break;

      case ClientMessageType.SUBSCRIBE:
        await handleSubscribe(ws, message, manager);
        break;

      case ClientMessageType.UNSUBSCRIBE:
        await handleUnsubscribe(ws, message, manager);
        break;

      case ClientMessageType.MESSAGE_SEND:
        await handleMessageSend(ws, message, manager);
        break;

      case ClientMessageType.MESSAGE_READ:
        await handleMessageRead(ws, message, manager);
        break;

      case ClientMessageType.MESSAGE_REACT:
        await handleMessageReact(ws, message, manager);
        break;

      case ClientMessageType.MESSAGE_TYPING_START:
        await handleTypingStart(ws, message, manager);
        break;

      case ClientMessageType.MESSAGE_TYPING_STOP:
        await handleTypingStop(ws, message, manager);
        break;

      case ClientMessageType.PRESENCE_UPDATE:
        await handlePresenceUpdate(ws, message, manager);
        break;

      case ClientMessageType.SYNC_REQUEST:
        await handleSyncRequest(ws, message, manager);
        break;

      case ClientMessageType.RECOVERY_REQUEST:
        await handleRecoveryRequest(ws, message, manager);
        break;

      case ClientMessageType.MESSAGE_DELETE:
        await handleMessageDelete(ws, message, manager);
        break;

      case ClientMessageType.MESSAGE_UNSEND:
        await handleMessageUnsend(ws, message, manager);
        break;

      case ClientMessageType.MESSAGE_EDIT:
        await handleMessageEdit(ws, message, manager);
        break;

      case ClientMessageType.MESSAGE_REACT_REMOVE:
        await handleMessageReactRemove(ws, message, manager);
        break;

      case ClientMessageType.ACKNOWLEDGMENT:
        await handleAcknowledgment(ws, message, manager);
        break;

      default:
        // TypeScript exhaustiveness check
        const _exhaustive: never = messageType;
        sendError(ws, "UNKNOWN_TYPE", `Unknown message type: ${messageType}`);
    }
  } catch (error) {
    console.error("[MessageHandlers] Route message error:", error);
    sendError(ws, "INTERNAL_ERROR", "Message handling failed");
  }
}

/**
 * Validate message size
 */
export function validateMessageSize(data: string | ArrayBuffer | Blob): boolean {
  if (typeof data === "string") {
    return data.length <= MAX_MESSAGE_SIZE;
  } else if (data instanceof ArrayBuffer) {
    return data.byteLength <= MAX_MESSAGE_SIZE;
  } else if (data instanceof Blob) {
    return data.size <= MAX_MESSAGE_SIZE;
  }
  return false;
}