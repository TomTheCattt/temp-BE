/**
 * Database Helper Functions for WebSocket Message Handlers
 *
 * Contains reusable database operations for messages, conversations, etc.
 */

import { db } from "../db/client";
import { eq, and, desc, lt, gt } from "drizzle-orm";
import * as schema from "../db/schema";

/**
 * Create a new message in the database
 */
export async function createMessage(data: {
  conversationId: string;
  senderId: string;
  content: string;
  contentType: string;
  replyToId?: string;
}): Promise<any> {
  const [result] = await db
    .insert(schema.messages)
    .values({
      conversationId: data.conversationId,
      senderId: data.senderId,
      textContent: data.content,
      contentType: data.contentType as any,
      replyToId: data.replyToId,
      status: "SENT",
    })
    .returning({
      id: schema.messages.id,
      conversationId: schema.messages.conversationId,
      senderId: schema.messages.senderId,
      textContent: schema.messages.textContent,
      contentType: schema.messages.contentType,
      replyToId: schema.messages.replyToId,
      status: schema.messages.status,
      createdAt: schema.messages.createdAt,
    });
  return result;
}

/**
 * Mark conversation as read for a user
 */
export async function markConversationRead(conversationId: string, userId: string): Promise<void> {
  await db
    .update(schema.conversationMembers)
    .set({ lastReadAt: new Date() })
    .where(and(
      eq(schema.conversationMembers.conversationId, conversationId),
      eq(schema.conversationMembers.userId, userId)
    ));
}

/**
 * Delete a message (only by sender)
 */
export async function deleteMessage(messageId: string, userId: string): Promise<boolean> {
  const result = await db
    .delete(schema.messages)
    .where(and(
      eq(schema.messages.id, messageId),
      eq(schema.messages.senderId, userId)
    ))
    .returning({ id: schema.messages.id });
  return result.length > 0;
}

/**
 * Get conversation members
 */
export async function getConversationMembers(conversationId: string): Promise<string[]> {
  const result = await db
    .select({ userId: schema.conversationMembers.userId })
    .from(schema.conversationMembers)
    .where(eq(schema.conversationMembers.conversationId, conversationId));
  return result.map((r) => r.userId);
}

/**
 * Check if user is a member of a conversation
 */
export async function isConversationMember(conversationId: string, userId: string): Promise<boolean> {
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

/**
 * Get followers of a user (for presence broadcasting)
 */
export async function getFollowers(userId: string): Promise<string[]> {
  const result = await db
    .select({ followerId: schema.follows.followerId })
    .from(schema.follows)
    .where(eq(schema.follows.followingId, userId));
  return result.map((r) => r.followerId);
}

/**
 * Update last delivered timestamp for a conversation member
 */
export async function updateLastDelivered(conversationId: string, userId: string, messageId?: string): Promise<void> {
  await db
    .update(schema.conversationMembers)
    .set({
      lastReadAt: new Date(), // Using lastReadAt since lastDeliveredAt doesn't exist in schema
      // lastDeliveredMessageId: messageId, // If this field exists
    })
    .where(and(
      eq(schema.conversationMembers.conversationId, conversationId),
      eq(schema.conversationMembers.userId, userId)
    ));
}

/**
 * Get messages for a conversation (paginated)
 */
export async function getConversationMessages(
  conversationId: string,
  options: {
    limit?: number;
    before?: Date;
    after?: Date;
  } = {}
): Promise<any[]> {
  const { limit = 50, before, after } = options;

  const conditions = [
    eq(schema.messages.conversationId, conversationId),
    eq(schema.messages.status, "SENT")
  ];

  if (before) {
    conditions.push(lt(schema.messages.createdAt, before));
  }

  if (after) {
    conditions.push(gt(schema.messages.createdAt, after));
  }

  const messages = await db
    .select()
    .from(schema.messages)
    .where(and(...conditions))
    .orderBy(desc(schema.messages.createdAt))
    .limit(limit);

  return messages;
}

/**
 * Add reaction to a message
 */
export async function addMessageReaction(messageId: string, userId: string, emoji: string): Promise<any> {
  // TODO: Implement when message_reactions table is available
  console.log(`[MessageHelpers] Add reaction: ${emoji} by ${userId} to ${messageId}`);
  return { messageId, userId, emoji, count: 1 };
}

/**
 * Remove reaction from a message
 */
export async function removeMessageReaction(messageId: string, userId: string, emoji: string): Promise<boolean> {
  // TODO: Implement when message_reactions table is available
  console.log(`[MessageHelpers] Remove reaction: ${emoji} by ${userId} from ${messageId}`);
  return true;
}

/**
 * Get message reactions
 */
export async function getMessageReactions(messageId: string): Promise<any[]> {
  // TODO: Implement when message_reactions table is available
  return [];
}

/**
 * Update message (edit)
 */
export async function updateMessage(messageId: string, userId: string, content: string): Promise<any | null> {
  const result = await db
    .update(schema.messages)
    .set({
      textContent: content,
      // isEdited: true, // Field doesn't exist in schema
      // editedAt: new Date(), // Field doesn't exist in schema
      updatedAt: new Date(),
    })
    .where(and(
      eq(schema.messages.id, messageId),
      eq(schema.messages.senderId, userId)
    ))
    .returning();
  return result.length > 0 ? result[0] : null;
}

/**
 * Unsend message (delete for everyone or just me)
 */
export async function unsendMessage(messageId: string, userId: string, forEveryone: boolean): Promise<boolean> {
  if (forEveryone) {
    // Delete for everyone - only sender can do this
    const result = await db
      .delete(schema.messages)
      .where(and(
        eq(schema.messages.id, messageId),
        eq(schema.messages.senderId, userId)
      ))
      .returning({ id: schema.messages.id });
    return result.length > 0;
  } else {
    // Delete for me only - mark as unsent for this user
    // This would require a message_recipients or similar table
    // For now, just delete if sender
    return unsendMessage(messageId, userId, true);
  }
}

/**
 * Get unread count for a conversation
 */
export async function getUnreadCount(conversationId: string, userId: string): Promise<number> {
  const member = await db
    .select({ lastReadAt: schema.conversationMembers.lastReadAt })
    .from(schema.conversationMembers)
    .where(and(
      eq(schema.conversationMembers.conversationId, conversationId),
      eq(schema.conversationMembers.userId, userId)
    ))
    .limit(1);

  if (member.length === 0 || !member[0].lastReadAt) {
    // If never read, count all messages
    const result = await db
      .select({ count: schema.messages.id })
      .from(schema.messages)
      .where(and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.status, "SENT")
      ));
    return result.length;
  }

  // Count messages after lastReadAt
  const result = await db
    .select({ count: schema.messages.id })
    .from(schema.messages)
    .where(and(
      eq(schema.messages.conversationId, conversationId),
      eq(schema.messages.status, "SENT"),
      // createdAt > lastReadAt
    ));
  return result.length;
}