/**
 * Conversation Subscription Manager - Auto-subscribe to conversation channels on connect
 *
 * Handles automatic subscription to all conversations a user is a member of
 * when they establish a WebSocket connection. This ensures real-time message
 * delivery without requiring manual subscription per conversation.
 *
 * Based on DESIGN_DOCUMENT.md §7.1 WebSocket API
 */

import { db } from "../db/client";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { ConnectionManager, AuthenticatedSocket } from "./connection-manager";
import { getConversationChannel } from "./channel-auth";

/**
 * Result of auto-subscription operation
 */
export interface AutoSubscribeResult {
  subscribedChannels: string[];
  failedChannels: string[];
  conversationCount: number;
}

/**
 * Conversation subscription options
 */
export interface ConversationSubscriptionOptions {
  /** Maximum number of conversations to auto-subscribe (default: 100) */
  maxConversations?: number;
  /** Whether to include muted conversations (default: true) */
  includeMuted?: boolean;
  /** Whether to only subscribe to conversations with recent activity (default: false) */
  recentOnly?: boolean;
  /** Days to look back for recent activity (default: 30) */
  recentDays?: number;
}

/**
 * Subscribe a user to all their conversation channels
 * Called automatically when a user connects via WebSocket
 */
export async function autoSubscribeConversations(
  socket: AuthenticatedSocket,
  manager: ConnectionManager,
  options: ConversationSubscriptionOptions = {}
): Promise<AutoSubscribeResult> {
  const {
    maxConversations = 100,
    includeMuted = true,
    recentOnly = false,
    recentDays = 30,
  } = options;

  const userId = socket.userId;
  const subscribedChannels: string[] = [];
  const failedChannels: string[] = [];

  try {
    // Build query to get user's conversations
    let query = db
      .select({
        conversationId: schema.conversationMembers.conversationId,
        isMuted: schema.conversationMembers.isMuted,
        lastMessageAt: schema.conversations.updatedAt,
      })
      .from(schema.conversationMembers)
      .innerJoin(
        schema.conversations,
        eq(schema.conversationMembers.conversationId, schema.conversations.id)
      )
      .where(eq(schema.conversationMembers.userId, userId))
      .limit(maxConversations);

    // Add filters based on options
    const conditions = [eq(schema.conversationMembers.userId, userId)];

    if (!includeMuted) {
      conditions.push(eq(schema.conversationMembers.isMuted, false));
    }

    if (recentOnly) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - recentDays);
      conditions.push(eq(schema.conversations.updatedAt, cutoffDate)); // Note: This is simplified
    }

    // Execute query
    const userConversations = await db
      .select({
        conversationId: schema.conversationMembers.conversationId,
        isMuted: schema.conversationMembers.isMuted,
        lastMessageAt: schema.conversations.updatedAt,
      })
      .from(schema.conversationMembers)
      .innerJoin(
        schema.conversations,
        eq(schema.conversationMembers.conversationId, schema.conversations.id)
      )
      .where(eq(schema.conversationMembers.userId, userId))
      .limit(maxConversations);

    // Subscribe to each conversation channel
    for (const conv of userConversations) {
      const channel = getConversationChannel(conv.conversationId);

      try {
        const allowedChannels = await manager.subscribe(socket, [channel]);

        if (allowedChannels.length > 0) {
          subscribedChannels.push(...allowedChannels);
        } else {
          failedChannels.push(channel);
        }
      } catch (error) {
        console.error(
          `[ConversationSubscription] Failed to subscribe to ${channel}:`,
          error
        );
        failedChannels.push(channel);
      }
    }

    console.log(
      `[ConversationSubscription] User ${userId} auto-subscribed to ${subscribedChannels.length} conversations (${failedChannels.length} failed)`
    );

    return {
      subscribedChannels,
      failedChannels,
      conversationCount: userConversations.length,
    };
  } catch (error) {
    console.error(
      `[ConversationSubscription] Auto-subscribe failed for user ${userId}:`,
      error
    );
    return {
      subscribedChannels,
      failedChannels,
      conversationCount: 0,
    };
  }
}

/**
 * Subscribe to a specific conversation
 * Used when user joins a new conversation or creates one
 */
export async function subscribeToConversation(
  socket: AuthenticatedSocket,
  manager: ConnectionManager,
  conversationId: string
): Promise<boolean> {
  const channel = getConversationChannel(conversationId);

  try {
    const allowedChannels = await manager.subscribe(socket, [channel]);
    return allowedChannels.length > 0;
  } catch (error) {
    console.error(
      `[ConversationSubscription] Failed to subscribe to conversation ${conversationId}:`,
      error
    );
    return false;
  }
}

/**
 * Unsubscribe from a specific conversation
 * Used when user leaves a conversation
 */
export async function unsubscribeFromConversation(
  socket: AuthenticatedSocket,
  manager: ConnectionManager,
  conversationId: string
): Promise<void> {
  const channel = getConversationChannel(conversationId);
  manager.unsubscribe(socket, [channel]);
}

/**
 * Get all conversation channels a user is currently subscribed to
 */
export function getSubscribedConversations(socket: AuthenticatedSocket): string[] {
  const conversationPrefix = "conversation:";
  return Array.from(socket.subscriptions)
    .filter((ch) => ch.startsWith(conversationPrefix))
    .map((ch) => ch.slice(conversationPrefix.length));
}

/**
 * Check if user is subscribed to a specific conversation
 */
export function isSubscribedToConversation(
  socket: AuthenticatedSocket,
  conversationId: string
): boolean {
  const channel = getConversationChannel(conversationId);
  return socket.subscriptions.has(channel);
}

/**
 * Batch subscribe to multiple conversations
 * More efficient than calling subscribeToConversation multiple times
 */
export async function batchSubscribeConversations(
  socket: AuthenticatedSocket,
  manager: ConnectionManager,
  conversationIds: string[]
): Promise<{ success: string[]; failed: string[] }> {
  const channels = conversationIds.map((id) => getConversationChannel(id));

  try {
    const allowedChannels = await manager.subscribe(socket, channels);
    const failed = channels.filter((ch) => !allowedChannels.includes(ch));

    return {
      success: allowedChannels.map((ch) => ch.slice("conversation:".length)),
      failed: failed.map((ch) => ch.slice("conversation:".length)),
    };
  } catch (error) {
    console.error(
      `[ConversationSubscription] Batch subscribe failed:`,
      error
    );
    return {
      success: [],
      failed: conversationIds,
    };
  }
}

/**
 * Re-subscribe to all conversations (useful after reconnection)
 */
export async function resubscribeAllConversations(
  socket: AuthenticatedSocket,
  manager: ConnectionManager
): Promise<AutoSubscribeResult> {
  // First unsubscribe from all conversation channels
  const currentConversations = getSubscribedConversations(socket);
  for (const convId of currentConversations) {
    await unsubscribeFromConversation(socket, manager, convId);
  }

  // Then re-subscribe
  return autoSubscribeConversations(socket, manager);
}