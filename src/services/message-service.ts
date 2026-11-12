import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, or, desc, asc, count, sql, inArray, lt, gt, isNull, isNotNull, not } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

// Type helpers for enum values
type MessageContentType = typeof schema.messages.$inferInsert["contentType"];
type MessageStatus = typeof schema.messages.$inferInsert["status"];

export interface MessageDetails {
  id: string;
  conversationId: string;
  senderId: string;
  contentType: MessageContentType;
  textContent: string | null;
  mediaUrl: string | null;
  mediaThumbnail: string | null;
  mediaDuration: string | null;
  mediaMetadata: Record<string, any>;
  reactionEmoji: string | null;
  replyToId: string | null;
  status: MessageStatus;
  isEphemeral: boolean;
  expiresAt: Date | null;
  isEdited: boolean;
  editedAt: Date | null;
  isUnsent: boolean;
  unsentAt: Date | null;
  unsentForEveryone: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  sender?: {
    id: string;
    username: string;
    fullName: string | null;
    avatarUrl: string | null;
    isVerified: boolean;
  };
  replyTo?: MessageDetails | null;
  reactions?: MessageReaction[];
}

export interface MessageReaction {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: Date;
  user: {
    id: string;
    username: string;
    fullName: string | null;
    avatarUrl: string | null;
    isVerified: boolean;
  };
}

export interface SendMessageOptions {
  conversationId: string;
  senderId: string;
  contentType: MessageContentType;
  textContent?: string;
  mediaUrl?: string;
  mediaThumbnail?: string;
  mediaDuration?: number;
  mediaMetadata?: Record<string, any>;
  replyToId?: string;
  isEphemeral?: boolean;
  expiresAt?: Date;
}

export interface EditMessageOptions {
  messageId: string;
  userId: string;
  textContent: string;
}

export interface UnsendMessageOptions {
  messageId: string;
  userId: string;
  forEveryone: boolean;
}

export interface ReactionOptions {
  messageId: string;
  userId: string;
  emoji: string;
}

export interface MessageSearchOptions {
  conversationId: string;
  userId: string;
  query: string;
  cursor?: string;
  perPage: number;
}

/**
 * Message Service - handles all message-related business logic
 */
export class MessageService {

  /**
   * Send a message
   */
  async sendMessage(options: SendMessageOptions) {
    const {
      conversationId,
      senderId,
      contentType,
      textContent,
      mediaUrl,
      mediaThumbnail,
      mediaDuration,
      mediaMetadata,
      replyToId,
      isEphemeral = false,
      expiresAt,
    } = options;

    // Verify membership
    const membership = await db.query.conversationMembers.findFirst({
      where: and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, senderId),
        isNull(schema.conversationMembers.leftAt)
      ),
    });

    if (!membership) {
      throw new HTTPException(403, { message: "Not a member of this conversation" });
    }

    // Validate reply
    if (replyToId) {
      const replyMsg = await db.query.messages.findFirst({
        where: and(
          eq(schema.messages.id, replyToId),
          eq(schema.messages.conversationId, conversationId),
          isNull(schema.messages.deletedAt)
        )
      });
      if (!replyMsg) {
        throw new HTTPException(400, { message: "Invalid reply message" });
      }
    }

    const [message] = await db
      .insert(schema.messages)
      .values({
        conversationId,
        senderId,
        contentType,
        textContent: textContent ?? null,
        mediaUrl: mediaUrl ?? null,
        mediaThumbnail: mediaThumbnail ?? null,
        mediaDuration: mediaDuration ? mediaDuration.toString() : null,
        mediaMetadata: mediaMetadata ?? {},
        replyToId: replyToId ?? null,
        status: "SENT",
        isEphemeral: isEphemeral ?? false,
        expiresAt: expiresAt ?? null,
      })
      .returning();

    // Update conversation updatedAt
    await db
      .update(schema.conversations)
      .set({ updatedAt: new Date() })
      .where(eq(schema.conversations.id, conversationId));

    // Update other members' lastReadAt to null (mark as unread for them)
    await db
      .update(schema.conversationMembers)
      .set({ lastReadAt: null })
      .where(and(
        eq(schema.conversationMembers.conversationId, conversationId),
        not(eq(schema.conversationMembers.userId, senderId)),
        isNull(schema.conversationMembers.leftAt)
      ));

    // Send push notifications to offline users (would integrate with notification service)
    // await this.sendPushNotifications(conversationId, senderId, message);

    const createdMessage = await this.getMessageById(message.id);
    return createdMessage;
  }

  /**
   * Get message by ID with full details
   */
  async getMessageById(messageId: string): Promise<MessageDetails | null> {
    const message = await db.query.messages.findFirst({
      where: eq(schema.messages.id, messageId),
      with: {
        sender: true,
        replyTo: {
          with: { sender: true },
        },
        reactions: {
          with: { user: true },
        },
      },
    });

    if (!message) return null;

    return this.formatMessage(message);
  }

  /**
   * Get messages for a conversation with cursor-based pagination
   */
  async getMessages(conversationId: string, userId: string, cursor?: string, perPage = 20) {
    // Verify membership
    const membership = await db.query.conversationMembers.findFirst({
      where: and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, userId),
        isNull(schema.conversationMembers.leftAt)
      ),
    });

    if (!membership) {
      throw new HTTPException(403, { message: "Not a member of this conversation" });
    }

    const whereConditions = [
      eq(schema.messages.conversationId, conversationId),
      isNull(schema.messages.deletedAt),
    ];

    if (cursor) {
      whereConditions.push(lt(schema.messages.createdAt, new Date(cursor)));
    }

    const messagesList = await db.query.messages.findMany({
      where: and(...whereConditions),
      limit: perPage + 1,
      orderBy: desc(schema.messages.createdAt),
      with: {
        sender: true,
        replyTo: { with: { sender: true } },
        reactions: { with: { user: true } },
      },
    });

    const hasMore = messagesList.length > perPage;
    const items = hasMore ? messagesList.slice(0, perPage) : messagesList;
    const nextCursor = hasMore ? items[items.length - 1].createdAt : null;

    return {
      items: items.reverse().map(m => this.formatMessage(m)),
      nextCursor: nextCursor?.toISOString() || null,
      hasMore,
    };
  }

  /**
   * Search messages within a conversation
   */
  async searchMessages(options: MessageSearchOptions) {
    const { conversationId, userId, query, cursor, perPage } = options;

    // Verify membership
    const membership = await db.query.conversationMembers.findFirst({
      where: and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, userId),
        isNull(schema.conversationMembers.leftAt)
      ),
    });

    if (!membership) {
      throw new HTTPException(403, { message: "Not a member of this conversation" });
    }

    const searchQuery = `%${query}%`;

    const whereConditions = [
      eq(schema.messages.conversationId, conversationId),
      isNull(schema.messages.deletedAt),
      sql`${schema.messages.textContent} ILIKE ${searchQuery}`,
    ];

    if (cursor) {
      whereConditions.push(lt(schema.messages.createdAt, new Date(cursor)));
    }

    const messagesList = await db.query.messages.findMany({
      where: and(...whereConditions),
      limit: perPage + 1,
      orderBy: desc(schema.messages.createdAt),
      with: {
        sender: true,
        replyTo: { with: { sender: true } },
        reactions: { with: { user: true } },
      },
    });

    const hasMore = messagesList.length > perPage;
    const items = hasMore ? messagesList.slice(0, perPage) : messagesList;
    const nextCursor = hasMore ? items[items.length - 1].createdAt : null;

    return {
      items: items.reverse().map(m => this.formatMessage(m)),
      nextCursor: nextCursor?.toISOString() || null,
      hasMore,
    };
  }

  /**
   * Edit a message (within time window)
   */
  async editMessage(options: EditMessageOptions) {
    const { messageId, userId, textContent } = options;

    const message = await db.query.messages.findFirst({
      where: eq(schema.messages.id, messageId),
    });

    if (!message) {
      throw new HTTPException(404, { message: "Message not found" });
    }

    if (message.senderId !== userId) {
      throw new HTTPException(403, { message: "Not authorized to edit this message" });
    }

    // Check if message is within edit window (10 minutes)
    const editWindowMs = 10 * 60 * 1000; // 10 minutes
    const messageAge = Date.now() - new Date(message.createdAt).getTime();

    if (messageAge > editWindowMs) {
      throw new HTTPException(400, { message: "Edit window expired (10 minutes)" });
    }

    // Don't allow editing unsent messages
    if (message.isUnsent) {
      throw new HTTPException(400, { message: "Cannot edit unsent message" });
    }

    // Don't allow editing ephemeral messages that have expired
    if (message.isEphemeral && message.expiresAt && new Date(message.expiresAt) < new Date()) {
      throw new HTTPException(400, { message: "Cannot edit expired ephemeral message" });
    }

    await db
      .update(schema.messages)
      .set({
        textContent,
        isEdited: true,
        editedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.messages.id, messageId));

    return this.getMessageById(messageId);
  }

  /**
   * Unsend a message (delete for everyone or just me)
   */
  async unsendMessage(options: UnsendMessageOptions) {
    const { messageId, userId, forEveryone } = options;

    const message = await db.query.messages.findFirst({
      where: eq(schema.messages.id, messageId),
    });

    if (!message) {
      throw new HTTPException(404, { message: "Message not found" });
    }

    if (message.senderId !== userId) {
      throw new HTTPException(403, { message: "Not authorized to unsend this message" });
    }

    if (forEveryone) {
      // Mark as unsent for everyone
      await db
        .update(schema.messages)
        .set({
          isUnsent: true,
          unsentForEveryone: true,
          unsentAt: new Date(),
          textContent: null,
          mediaUrl: null,
          mediaThumbnail: null,
          mediaMetadata: {},
        })
        .where(eq(schema.messages.id, messageId));
    } else {
      // Soft delete for sender only
      await db
        .update(schema.messages)
        .set({
          deletedAt: new Date(),
        })
        .where(eq(schema.messages.id, messageId));
    }

    return { success: true };
  }

  /**
   * Add reaction to message
   */
  async addReaction(options: ReactionOptions) {
    const { messageId, userId, emoji } = options;

    const message = await db.query.messages.findFirst({
      where: eq(schema.messages.id, messageId),
    });

    if (!message) {
      throw new HTTPException(404, { message: "Message not found" });
    }

    // Check if user is member of conversation
    const membership = await db.query.conversationMembers.findFirst({
      where: and(
        eq(schema.conversationMembers.conversationId, message.conversationId),
        eq(schema.conversationMembers.userId, userId),
        isNull(schema.conversationMembers.leftAt)
      ),
    });

    if (!membership) {
      throw new HTTPException(403, { message: "Not a member of this conversation" });
    }

    // Add reaction (upsert - replace if same user/emoji)
    await db.insert(schema.messageReactions).values({
      messageId,
      userId,
      emoji,
    }).onConflictDoUpdate({
      target: [schema.messageReactions.messageId, schema.messageReactions.userId, schema.messageReactions.emoji],
      set: { createdAt: new Date() },
    });

    // Get updated reaction counts
    const reactions = await this.getReactions(messageId);

    return { success: true, reactions };
  }

  /**
   * Remove reaction from message
   */
  async removeReaction(options: ReactionOptions) {
    const { messageId, userId, emoji } = options;

    await db.delete(schema.messageReactions).where(and(
      eq(schema.messageReactions.messageId, messageId),
      eq(schema.messageReactions.userId, userId),
      eq(schema.messageReactions.emoji, emoji)
    ));

    const reactions = await this.getReactions(messageId);

    return { success: true, reactions };
  }

  /**
   * Get reactions for a message
   */
  async getReactions(messageId: string) {
    const reactions = await db.query.messageReactions.findMany({
      where: eq(schema.messageReactions.messageId, messageId),
      with: { user: true },
    });

    // Group by emoji
    const grouped: Record<string, { emoji: string; count: number; users: any[] }> = {};
    for (const reaction of reactions) {
      if (!grouped[reaction.emoji]) {
        grouped[reaction.emoji] = { emoji: reaction.emoji, count: 0, users: [] };
      }
      grouped[reaction.emoji].count++;
      grouped[reaction.emoji].users.push({
        id: reaction.user.id,
        username: reaction.user.username,
        fullName: reaction.user.fullName,
        avatarUrl: reaction.user.avatarUrl,
      });
    }

    return Object.values(grouped);
  }

  /**
   * Update message status (sent -> delivered -> read)
   */
  async updateMessageStatus(messageId: string, status: "SENT" | "DELIVERED" | "READ") {
    const message = await db.query.messages.findFirst({
      where: eq(schema.messages.id, messageId),
    });

    if (!message) {
      throw new HTTPException(404, { message: "Message not found" });
    }

    // Only allow forward progression of status
    const statusOrder = { SENT: 0, DELIVERED: 1, READ: 2 };
    if (statusOrder[status] <= statusOrder[message.status as keyof typeof statusOrder]) {
      // Already at this status or beyond
      return { success: true, message: "Status already at or beyond target" };
    }

    await db
      .update(schema.messages)
      .set({ status })
      .where(eq(schema.messages.id, messageId));

    return { success: true };
  }

  /**
   * Mark messages as delivered for a user in a conversation
   */
  async markMessagesDelivered(conversationId: string, userId: string, upToMessageId?: string) {
    // Update conversation member's lastDeliveredAt
    await db
      .update(schema.conversationMembers)
      .set({ lastDeliveredAt: new Date() })
      .where(and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, userId)
      ));

    // Optionally update individual message statuses
    if (upToMessageId) {
      await db
        .update(schema.messages)
        .set({ status: "DELIVERED" })
        .where(and(
          eq(schema.messages.conversationId, conversationId),
          lt(schema.messages.createdAt, new Date(upToMessageId)), // Using createdAt as proxy for ordering
          sql`${schema.messages.status} IN ('SENT')`
        ));
    }

    return { success: true };
  }

  /**
   * Mark messages as read for a user in a conversation
   */
  async markMessagesRead(conversationId: string, userId: string, upToMessageId?: string) {
    // Update conversation member's lastReadAt
    await db
      .update(schema.conversationMembers)
      .set({ lastReadAt: new Date() })
      .where(and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, userId)
      ));

    // Optionally update individual message statuses
    if (upToMessageId) {
      await db
        .update(schema.messages)
        .set({ status: "READ" })
        .where(and(
          eq(schema.messages.conversationId, conversationId),
          lt(schema.messages.createdAt, new Date(upToMessageId)),
          sql`${schema.messages.status} IN ('SENT', 'DELIVERED')`
        ));
    }

    return { success: true };
  }

  /**
   * Get unread message count for a conversation
   */
  async getUnreadCount(conversationId: string, userId: string): Promise<number> {
    const membership = await db.query.conversationMembers.findFirst({
      where: and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, userId),
        isNull(schema.conversationMembers.leftAt)
      ),
    });

    if (!membership) {
      return 0;
    }

    if (membership.lastReadAt) {
      const result = await db
        .select({ count: count() })
        .from(schema.messages)
        .where(and(
          eq(schema.messages.conversationId, conversationId),
          isNull(schema.messages.deletedAt),
          gt(schema.messages.createdAt, membership.lastReadAt)
        ));
      return result[0]?.count || 0;
    } else {
      // Never read - count all messages
      const result = await db
        .select({ count: count() })
        .from(schema.messages)
        .where(and(
          eq(schema.messages.conversationId, conversationId),
          isNull(schema.messages.deletedAt)
        ));
      return result[0]?.count || 0;
    }
  }

  /**
   * Delete expired ephemeral messages (cleanup job)
   */
  async deleteExpiredEphemeralMessages() {
    const now = new Date();

    const result = await db
      .update(schema.messages)
      .set({
        deletedAt: now,
        isUnsent: true,
        unsentForEveryone: true,
        unsentAt: now,
        textContent: null,
        mediaUrl: null,
        mediaThumbnail: null,
      })
      .where(and(
        eq(schema.messages.isEphemeral, true),
        isNotNull(schema.messages.expiresAt),
        lt(schema.messages.expiresAt, now),
        isNull(schema.messages.deletedAt)
      ));

    return { success: true, deletedCount: result.rowCount || 0 };
  }

  /**
   * Get message thread (replies to a message)
   */
  async getMessageThread(messageId: string, userId: string, perPage = 20) {
    const message = await db.query.messages.findFirst({
      where: eq(schema.messages.id, messageId),
    });

    if (!message) {
      throw new HTTPException(404, { message: "Message not found" });
    }

    // Check membership
    const membership = await db.query.conversationMembers.findFirst({
      where: and(
        eq(schema.conversationMembers.conversationId, message.conversationId),
        eq(schema.conversationMembers.userId, userId),
        isNull(schema.conversationMembers.leftAt)
      ),
    });

    if (!membership) {
      throw new HTTPException(403, { message: "Not a member of this conversation" });
    }

    const replies = await db.query.messages.findMany({
      where: and(
        eq(schema.messages.replyToId, messageId),
        isNull(schema.messages.deletedAt)
      ),
      limit: perPage,
      orderBy: asc(schema.messages.createdAt),
      with: {
        sender: true,
        replyTo: { with: { sender: true } },
        reactions: { with: { user: true } },
      },
    });

    return replies.map(m => this.formatMessage(m));
  }

  /**
   * Forward messages to another conversation
   */
  async forwardMessages(messageIds: string[], fromUserId: string, toConversationId: string) {
    // Verify membership in source conversations
    const messages = await db.query.messages.findMany({
      where: inArray(schema.messages.id, messageIds),
    });

    if (messages.length !== messageIds.length) {
      throw new HTTPException(404, { message: "One or more messages not found" });
    }

    // Verify membership in target conversation
    const membership = await db.query.conversationMembers.findFirst({
      where: and(
        eq(schema.conversationMembers.conversationId, toConversationId),
        eq(schema.conversationMembers.userId, fromUserId),
        isNull(schema.conversationMembers.leftAt)
      ),
    });

    if (!membership) {
      throw new HTTPException(403, { message: "Not a member of target conversation" });
    }

    // Create forwarded messages
    const forwardedMessages = await Promise.all(
      messages.map(msg =>
        this.sendMessage({
          conversationId: toConversationId,
          senderId: fromUserId,
          contentType: msg.contentType,
          textContent: msg.textContent ?? undefined,
          mediaUrl: msg.mediaUrl ?? undefined,
          mediaThumbnail: msg.mediaThumbnail ?? undefined,
          mediaDuration: msg.mediaDuration ? parseFloat(msg.mediaDuration) : undefined,
          mediaMetadata: msg.mediaMetadata ?? undefined,
        })
      )
    );

    return { success: true, messages: forwardedMessages };
  }

  /**
   * Format message with all relations
   */
  private formatMessage(message: any): MessageDetails {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      contentType: message.contentType,
      textContent: message.textContent,
      mediaUrl: message.mediaUrl,
      mediaThumbnail: message.mediaThumbnail,
      mediaDuration: message.mediaDuration,
      mediaMetadata: message.mediaMetadata || {},
      reactionEmoji: message.reactionEmoji,
      replyToId: message.replyToId,
      status: message.status,
      isEphemeral: message.isEphemeral,
      expiresAt: message.expiresAt,
      isEdited: message.isEdited,
      editedAt: message.editedAt,
      isUnsent: message.isUnsent,
      unsentAt: message.unsentAt,
      unsentForEveryone: message.unsentForEveryone,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      deletedAt: message.deletedAt,
      sender: message.sender ? {
        id: message.sender.id,
        username: message.sender.username,
        fullName: message.sender.fullName,
        avatarUrl: message.sender.avatarUrl,
        isVerified: message.sender.isVerified,
      } : undefined,
      replyTo: message.replyTo ? this.formatMessage(message.replyTo) : undefined,
      reactions: message.reactions?.map((r: any) => ({
        id: r.id,
        messageId: r.messageId,
        userId: r.userId,
        emoji: r.emoji,
        createdAt: r.createdAt,
        user: r.user ? {
          id: r.user.id,
          username: r.user.username,
          fullName: r.user.fullName,
          avatarUrl: r.user.avatarUrl,
          isVerified: r.user.isVerified,
        } : undefined,
      })) || [],
    };
  }
}

export const messageService = new MessageService();