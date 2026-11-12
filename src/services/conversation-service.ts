import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, or, desc, asc, count, sql, inArray, lt, gt, isNull, isNotNull, not } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

// Type helpers for enum values
type MessageContentType = typeof schema.messages.$inferInsert["contentType"];
type MessageStatus = typeof schema.messages.$inferInsert["status"];

export interface CreateConversationInput {
  participantIds: string[];
  groupName?: string;
  groupAvatar?: string;
  creatorId: string;
}

export interface ConversationListOptions {
  userId: string;
  page: number;
  perPage: number;
}

export interface ConversationDetails {
  id: string;
  isGroup: boolean;
  groupName: string | null;
  groupAvatarUrl: string | null;
  groupOwnerId: string | null;
  encryptionType: string;
  createdAt: Date;
  updatedAt: Date;
  members: ConversationMember[];
  lastMessage: MessagePreview | null;
  lastReadAt: Date | null;
  isMuted: boolean;
  unreadCount: number;
}

export interface ConversationMember {
  id: string;
  userId: string;
  role: string;
  isMuted: boolean;
  lastReadAt: Date | null;
  lastDeliveredAt: Date | null;
  joinedAt: Date;
  leftAt: Date | null;
  user: {
    id: string;
    username: string;
    fullName: string | null;
    avatarUrl: string | null;
    isVerified: boolean;
  };
}

export interface MessagePreview {
  id: string;
  conversationId: string;
  senderId: string;
  contentType: MessageContentType;
  textContent: string | null;
  mediaUrl: string | null;
  mediaThumbnail: string | null;
  mediaDuration: string | null;
  referenceId: string | null;
  replyToId: string | null;
  status: MessageStatus;
  createdAt: Date;
  sender: {
    id: string;
    username: string;
    fullName: string | null;
    avatarUrl: string | null;
    isVerified: boolean;
  };
}

export interface SendMessageInput {
  conversationId: string;
  senderId: string;
  contentType: MessageContentType;
  textContent?: string;
  mediaUrl?: string;
  mediaThumbnail?: string;
  mediaDuration?: number;
  replyToId?: string;
}

export interface MessageListOptions {
  conversationId: string;
  userId: string;
  cursor?: string;
  perPage: number;
}

export interface EditMessageInput {
  messageId: string;
  userId: string;
  textContent: string;
}

export interface UnsendMessageInput {
  messageId: string;
  userId: string;
  forEveryone: boolean;
}

export interface MessageSearchOptions {
  conversationId: string;
  userId: string;
  query: string;
  page: number;
  perPage: number;
}

/**
 * Conversation Service - handles all conversation-related business logic
 */
export class ConversationService {

  /**
   * Get conversation list for a user with last message and unread count
   */
  async getConversations(options: ConversationListOptions) {
    const { userId, page, perPage } = options;
    const offset = (page - 1) * perPage;

    // Get user's conversations with last message, members, unread count
    const conversations = await db
      .select({
        id: schema.conversations.id,
        isGroup: schema.conversations.isGroup,
        groupName: schema.conversations.groupName,
        groupAvatarUrl: schema.conversations.groupAvatarUrl,
        groupOwnerId: schema.conversations.groupOwnerId,
        encryptionType: schema.conversations.encryptionType,
        createdAt: schema.conversations.createdAt,
        updatedAt: schema.conversations.updatedAt,
        members: sql`(
          SELECT json_agg(json_build_object(
            'id', cm.id,
            'userId', u.id,
            'role', cm.role,
            'isMuted', cm.is_muted,
            'lastReadAt', cm.last_read_at,
            'lastDeliveredAt', cm.last_delivered_at,
            'joinedAt', cm.joined_at,
            'leftAt', cm.left_at,
            'user', json_build_object(
              'id', u.id,
              'username', u.username,
              'fullName', u.full_name,
              'avatarUrl', u.avatar_url,
              'isVerified', u.is_verified
            )
          ) ORDER BY u.username)
          FROM conversation_members cm
          INNER JOIN users u ON u.id = cm.user_id
          WHERE cm.conversation_id = conversations.id
        )`.as("members"),
        lastMessage: sql`(
          SELECT json_build_object(
            'id', m.id,
            'conversationId', m.conversation_id,
            'senderId', m.sender_id,
            'contentType', m.content_type,
            'textContent', m.text_content,
            'mediaUrl', m.media_url,
            'mediaThumbnail', m.media_thumbnail,
            'mediaDuration', m.media_duration,
            'referenceId', m.reference_id,
            'replyToId', m.reply_to_id,
            'status', m.status,
            'createdAt', m.created_at,
            'sender', json_build_object(
              'id', s.id,
              'username', s.username,
              'fullName', s.full_name,
              'avatarUrl', s.avatar_url,
              'isVerified', s.is_verified
            )
          )
          FROM messages m
          INNER JOIN users s ON s.id = m.sender_id
          WHERE m.conversation_id = conversations.id
            AND m.deleted_at IS NULL
          ORDER BY m.created_at DESC
          LIMIT 1
        )`.as("lastMessage"),
        lastReadAt: sql`(
          SELECT cm.last_read_at
          FROM conversation_members cm
          WHERE cm.conversation_id = conversations.id
            AND cm.user_id = ${userId}
        )`.as("lastReadAt"),
        isMuted: sql`(
          SELECT cm.is_muted
          FROM conversation_members cm
          WHERE cm.conversation_id = conversations.id
            AND cm.user_id = ${userId}
        )`.as("isMuted"),
      })
      .from(schema.conversationMembers)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.conversationMembers.conversationId))
      .where(and(
        eq(schema.conversationMembers.userId, userId),
        isNull(schema.conversationMembers.leftAt)
      ))
      .limit(perPage)
      .offset(offset)
      .orderBy(desc(schema.conversations.updatedAt));

    // Get total count
    const totalResult = await db
      .select({ count: count() })
      .from(schema.conversationMembers)
      .where(and(
        eq(schema.conversationMembers.userId, userId),
        isNull(schema.conversationMembers.leftAt)
      ));

    const total = totalResult[0]?.count || 0;

    // Calculate unread count for each conversation
    const conversationsWithUnread = await Promise.all(
      conversations.map(async (conv) => {
        const lastReadAt = conv.lastReadAt as Date | null;
        const lastMessage = conv.lastMessage as MessagePreview | null;

        let unreadCount = 0;
        if (lastMessage && (!lastReadAt || new Date(lastMessage.createdAt) > new Date(lastReadAt))) {
          // Count messages after lastReadAt
          const unreadResult = await db
            .select({ count: count() })
            .from(schema.messages)
            .where(and(
              eq(schema.messages.conversationId, conv.id),
              isNull(schema.messages.deletedAt),
              lastReadAt ? gt(schema.messages.createdAt, lastReadAt) : sql`true`
            ));
          unreadCount = unreadResult[0]?.count || 0;
        }

        return {
          ...conv,
          members: conv.members || [],
          lastMessage: conv.lastMessage || null,
          lastReadAt: conv.lastReadAt || null,
          isMuted: conv.isMuted || false,
          unreadCount,
        };
      })
    );

    return {
      items: conversationsWithUnread,
      page,
      perPage,
      total,
      hasMore: page * perPage < total,
    };
  }

  /**
   * Create a new conversation (1:1 or group)
   */
  async createConversation(input: CreateConversationInput) {
    const { participantIds, groupName, groupAvatar, creatorId } = input;

    // Validate participants exist
    const participants = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.id, participantIds));

    if (participants.length !== participantIds.length) {
      throw new HTTPException(400, { message: "One or more participants not found" });
    }

    // Prevent adding self as participant
    if (participantIds.includes(creatorId)) {
      throw new HTTPException(400, { message: "Cannot add yourself as participant" });
    }

    // For group conversations, require mutual follow with all participants
    if (groupName && participantIds.length > 0) {
      for (const participantId of participantIds) {
        const mutualFollow = await db
          .select({ id: schema.follows.id })
          .from(schema.follows)
          .where(
            or(
              and(eq(schema.follows.followerId, creatorId), eq(schema.follows.followingId, participantId)),
              and(eq(schema.follows.followerId, participantId), eq(schema.follows.followingId, creatorId))
            )
          )
          .limit(1);

        if (mutualFollow.length === 0) {
          throw new HTTPException(403, {
            message: `Cannot create group with user ${participantId}: mutual follow required`,
            res: new Response(JSON.stringify({ success: false, error: "MUTUAL_FOLLOW_REQUIRED", message: "Mutual follow required to create group conversation" }), {
              status: 403,
              headers: { "Content-Type": "application/json" },
            }),
          });
        }
      }
    }

    // Check if 1-on-1 conversation already exists
    if (!groupName && participantIds.length === 1) {
      const existing = await db
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .innerJoin(schema.conversationMembers, eq(schema.conversationMembers.conversationId, schema.conversations.id))
        .where(
          and(
            eq(schema.conversations.isGroup, false),
            inArray(schema.conversationMembers.userId, [creatorId, participantIds[0]])
          )
        )
        .groupBy(schema.conversations.id)
        .having(sql`count(*) = 2`);

      if (existing.length > 0) {
        return { conversation: { id: existing[0].id }, isExisting: true };
      }
    }

    // Create conversation
    const [conversation] = await db
      .insert(schema.conversations)
      .values({
        groupName,
        isGroup: !!groupName,
        groupAvatarUrl: groupAvatar,
        groupOwnerId: groupName ? creatorId : null,
        encryptionType: "none",
      })
      .returning();

    // Add members
    const allMemberIds = [...new Set([creatorId, ...participantIds])];
    await db.insert(schema.conversationMembers).values(
      allMemberIds.map((memberId) => ({
        conversationId: conversation.id,
        userId: memberId,
        role: memberId === creatorId && groupName ? "owner" : "member",
      }))
    );

    const createdConversation = await this.getConversationById(conversation.id);

    return { conversation: createdConversation, isExisting: false };
  }

  /**
   * Get conversation by ID with all details
   */
  async getConversationById(conversationId: string): Promise<ConversationDetails | null> {
    const conversation = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, conversationId),
      with: {
        members: {
          with: { user: true },
        },
      },
    });

    if (!conversation) return null;

    // Get last message
    const lastMessage = await db.query.messages.findFirst({
      where: and(
        eq(schema.messages.conversationId, conversationId),
        isNull(schema.messages.deletedAt)
      ),
      orderBy: desc(schema.messages.createdAt),
      with: { sender: true },
    });

    // For detailed member info
    const members = await db.query.conversationMembers.findMany({
      where: and(
        eq(schema.conversationMembers.conversationId, conversationId),
        isNull(schema.conversationMembers.leftAt)
      ),
      with: { user: true },
    });

    return {
      id: conversation.id,
      isGroup: conversation.isGroup,
      groupName: conversation.groupName,
      groupAvatarUrl: conversation.groupAvatarUrl,
      groupOwnerId: conversation.groupOwnerId,
      encryptionType: conversation.encryptionType,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      members: members.map(m => ({
        id: m.id,
        userId: m.userId,
        role: m.role,
        isMuted: m.isMuted,
        lastReadAt: m.lastReadAt,
        lastDeliveredAt: m.lastDeliveredAt,
        joinedAt: m.joinedAt,
        leftAt: m.leftAt,
        user: {
          id: m.user.id,
          username: m.user.username,
          fullName: m.user.fullName,
          avatarUrl: m.user.avatarUrl,
          isVerified: m.user.isVerified,
        },
      })),
      lastMessage: lastMessage ? {
        id: lastMessage.id,
        conversationId: lastMessage.conversationId,
        senderId: lastMessage.senderId,
        contentType: lastMessage.contentType,
        textContent: lastMessage.textContent,
        mediaUrl: lastMessage.mediaUrl,
        mediaThumbnail: lastMessage.mediaThumbnail,
        mediaDuration: lastMessage.mediaDuration,
        referenceId: (lastMessage as any).referenceId,
        replyToId: lastMessage.replyToId,
        status: lastMessage.status,
        createdAt: lastMessage.createdAt,
        sender: {
          id: lastMessage.sender.id,
          username: lastMessage.sender.username,
          fullName: lastMessage.sender.fullName,
          avatarUrl: lastMessage.sender.avatarUrl,
          isVerified: lastMessage.sender.isVerified,
        },
      } : null,
      lastReadAt: null, // Would need to be fetched per user
      isMuted: false, // Would need to be fetched per user
      unreadCount: 0,
    };
  }

  /**
   * Get messages for a conversation with cursor-based pagination
   */
  async getMessages(options: MessageListOptions) {
    const { conversationId, userId, cursor, perPage } = options;

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

    const messagesList = await db
      .select({
        id: schema.messages.id,
        conversationId: schema.messages.conversationId,
        senderId: schema.messages.senderId,
        contentType: schema.messages.contentType,
        textContent: schema.messages.textContent,
        mediaUrl: schema.messages.mediaUrl,
        mediaThumbnail: schema.messages.mediaThumbnail,
        mediaDuration: schema.messages.mediaDuration,
        // @ts-ignore - TypeScript can't infer referenceId from select columns
        referenceId: schema.messages.referenceId,
        replyToId: schema.messages.replyToId,
        status: schema.messages.status,
        isEdited: schema.messages.isEdited,
        editedAt: schema.messages.editedAt,
        isUnsent: schema.messages.isUnsent,
        unsentForEveryone: schema.messages.unsentForEveryone,
        createdAt: schema.messages.createdAt,
        sender: {
          id: schema.users.id,
          username: schema.users.username,
          fullName: schema.users.fullName,
          avatarUrl: schema.users.avatarUrl,
          isVerified: schema.users.isVerified,
        },
      })
      .from(schema.messages)
      .innerJoin(schema.users, eq(schema.users.id, schema.messages.senderId))
      .where(and(...whereConditions))
      .limit(perPage + 1)
      .orderBy(desc(schema.messages.createdAt));

    const hasMore = messagesList.length > perPage;
    const items = hasMore ? messagesList.slice(0, perPage) : messagesList;
    const nextCursor = hasMore ? items[items.length - 1].createdAt : null;

    return {
      items: items.reverse(), // Return in chronological order
      nextCursor,
      hasMore,
    };
  }

  /**
   * Send a message to a conversation
   */
  async sendMessage(input: SendMessageInput) {
    const { conversationId, senderId, contentType, textContent, mediaUrl, mediaThumbnail, mediaDuration, replyToId } = input;

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
          eq(schema.messages.conversationId, conversationId)
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
        replyToId: replyToId ?? null,
        status: "SENT",
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

    const createdMessage = await db.query.messages.findFirst({
      where: eq(schema.messages.id, message.id),
      with: { sender: true },
    });

    return createdMessage;
  }

  /**
   * Mark conversation as read
   */
  async markAsRead(conversationId: string, userId: string) {
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

    await db
      .update(schema.conversationMembers)
      .set({ lastReadAt: new Date() })
      .where(and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, userId)
      ));

    // Also update lastDeliveredAt
    await db
      .update(schema.conversationMembers)
      .set({ lastDeliveredAt: new Date() })
      .where(and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, userId)
      ));

    return { success: true };
  }

  /**
   * Mute or unmute a conversation
   */
  async setMute(conversationId: string, userId: string, mute: boolean) {
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

    await db
      .update(schema.conversationMembers)
      .set({ isMuted: mute })
      .where(and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, userId)
      ));

    return { success: true };
  }

  /**
   * Leave a conversation (group only)
   */
  async leaveConversation(conversationId: string, userId: string) {
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

    // Check if it's a group conversation
    const conversation = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, conversationId),
    });

    if (!conversation) {
      throw new HTTPException(404, { message: "Conversation not found" });
    }

    if (!conversation.isGroup) {
      throw new HTTPException(400, { message: "Cannot leave a 1:1 conversation. Use archive instead." });
    }

    // If user is owner, transfer ownership or prevent
    if (conversation.groupOwnerId === userId) {
      // Find another member to transfer ownership
      const otherMembers = await db.query.conversationMembers.findMany({
        where: and(
          eq(schema.conversationMembers.conversationId, conversationId),
          not(eq(schema.conversationMembers.userId, userId)),
          isNull(schema.conversationMembers.leftAt)
        ),
        limit: 1,
      });

      if (otherMembers.length > 0) {
        await db
          .update(schema.conversations)
          .set({ groupOwnerId: otherMembers[0].userId })
          .where(eq(schema.conversations.id, conversationId));
      } else {
        // No other members, mark conversation as deleted
        await db
          .update(schema.conversations)
          .set({ deletedAt: new Date() })
          .where(eq(schema.conversations.id, conversationId));
      }
    }

    // Mark member as left
    await db
      .update(schema.conversationMembers)
      .set({ leftAt: new Date() })
      .where(and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, userId)
      ));

    return { success: true };
  }

  /**
   * Block a user in a conversation
   */
  async blockUserInConversation(conversationId: string, userId: string, targetUserId: string) {
    // Verify user is member
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

    // Create block record
    await db.insert(schema.blocks).values({
      blockerId: userId,
      blockedId: targetUserId,
      blockDm: true,
      blockProfile: false,
      blockContent: false,
      blockComments: false,
      blockMentions: false,
    }).onConflictDoNothing();

    // Remove target user from conversation if they're a member
    await db
      .update(schema.conversationMembers)
      .set({ leftAt: new Date() })
      .where(and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, targetUserId),
        isNull(schema.conversationMembers.leftAt)
      ));

    return { success: true };
  }

  /**
   * Report a conversation
   */
  async reportConversation(conversationId: string, reporterId: string, reason: string, description?: string) {
    const membership = await db.query.conversationMembers.findFirst({
      where: and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, reporterId),
        isNull(schema.conversationMembers.leftAt)
      ),
    });

    if (!membership) {
      throw new HTTPException(403, { message: "Not a member of this conversation" });
    }

    await db.insert(schema.reports).values({
      reporterId,
      reportedType: "MESSAGE",
      reportedId: conversationId,
      reason: reason as any,
      description,
      status: "PENDING",
    });

    return { success: true };
  }

  /**
   * Add members to a group conversation
   */
  async addMembers(conversationId: string, userId: string, participantIds: string[]) {
    // Verify user is member and has permission (owner or admin)
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

    const conversation = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, conversationId),
    });

    if (!conversation || !conversation.isGroup) {
      throw new HTTPException(400, { message: "Can only add members to group conversations" });
    }

    // Check if user is owner or admin
    if (conversation.groupOwnerId !== userId && membership.role !== "admin") {
      throw new HTTPException(403, { message: "Only owner or admin can add members" });
    }

    // Validate participants exist
    const participants = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.id, participantIds));

    if (participants.length !== participantIds.length) {
      throw new HTTPException(400, { message: "One or more participants not found" });
    }

    // Check if already members
    const existingMembers = await db.query.conversationMembers.findMany({
      where: and(
        eq(schema.conversationMembers.conversationId, conversationId),
        inArray(schema.conversationMembers.userId, participantIds),
        isNull(schema.conversationMembers.leftAt)
      ),
    });

    const existingIds = new Set(existingMembers.map(m => m.userId));
    const newParticipants = participantIds.filter(id => !existingIds.has(id));

    if (newParticipants.length === 0) {
      throw new HTTPException(400, { message: "All users are already members" });
    }

    // Add new members
    await db.insert(schema.conversationMembers).values(
      newParticipants.map(userId => ({
        conversationId,
        userId,
        role: "member",
      }))
    );

    return { success: true, addedCount: newParticipants.length };
  }

  /**
   * Remove member from group conversation
   */
  async removeMember(conversationId: string, userId: string, targetUserId: string) {
    // Verify user is member and has permission
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

    const conversation = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, conversationId),
    });

    if (!conversation || !conversation.isGroup) {
      throw new HTTPException(400, { message: "Can only remove members from group conversations" });
    }

    // Check permission: owner, admin, or self
    if (conversation.groupOwnerId !== userId && membership.role !== "admin" && userId !== targetUserId) {
      throw new HTTPException(403, { message: "Not authorized to remove this member" });
    }

    // Cannot remove owner unless transferring ownership
    if (targetUserId === conversation.groupOwnerId) {
      throw new HTTPException(400, { message: "Cannot remove owner. Transfer ownership first." });
    }

    // Mark member as left
    await db
      .update(schema.conversationMembers)
      .set({ leftAt: new Date() })
      .where(and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, targetUserId),
        isNull(schema.conversationMembers.leftAt)
      ));

    return { success: true };
  }

  /**
   * Transfer group ownership
   */
  async transferOwnership(conversationId: string, userId: string, newOwnerId: string) {
    const conversation = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, conversationId),
    });

    if (!conversation || !conversation.isGroup) {
      throw new HTTPException(400, { message: "Can only transfer ownership in group conversations" });
    }

    if (conversation.groupOwnerId !== userId) {
      throw new HTTPException(403, { message: "Only owner can transfer ownership" });
    }

    // Verify new owner is a member
    const newOwnerMembership = await db.query.conversationMembers.findFirst({
      where: and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, newOwnerId),
        isNull(schema.conversationMembers.leftAt)
      ),
    });

    if (!newOwnerMembership) {
      throw new HTTPException(400, { message: "New owner must be a member of the conversation" });
    }

    await db
      .update(schema.conversations)
      .set({ groupOwnerId: newOwnerId })
      .where(eq(schema.conversations.id, conversationId));

    // Update roles
    await db
      .update(schema.conversationMembers)
      .set({ role: "owner" })
      .where(and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, newOwnerId)
      ));

    await db
      .update(schema.conversationMembers)
      .set({ role: "member" })
      .where(and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, userId)
      ));

    return { success: true };
  }

  /**
   * Update group name
   */
  async updateGroupName(conversationId: string, userId: string, groupName: string) {
    const conversation = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, conversationId),
    });

    if (!conversation || !conversation.isGroup) {
      throw new HTTPException(400, { message: "Can only update group name for group conversations" });
    }

    // Check if user is owner or admin
    const membership = await db.query.conversationMembers.findFirst({
      where: and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, userId),
        isNull(schema.conversationMembers.leftAt)
      ),
    });

    if (!membership || (conversation.groupOwnerId !== userId && membership.role !== "admin")) {
      throw new HTTPException(403, { message: "Not authorized to update group name" });
    }

    await db
      .update(schema.conversations)
      .set({ groupName, updatedAt: new Date() })
      .where(eq(schema.conversations.id, conversationId));

    return { success: true };
  }

  /**
   * Update group avatar
   */
  async updateGroupAvatar(conversationId: string, userId: string, groupAvatarUrl: string) {
    const conversation = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, conversationId),
    });

    if (!conversation || !conversation.isGroup) {
      throw new HTTPException(400, { message: "Can only update group avatar for group conversations" });
    }

    const membership = await db.query.conversationMembers.findFirst({
      where: and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, userId),
        isNull(schema.conversationMembers.leftAt)
      ),
    });

    if (!membership || (conversation.groupOwnerId !== userId && membership.role !== "admin")) {
      throw new HTTPException(403, { message: "Not authorized to update group avatar" });
    }

    await db
      .update(schema.conversations)
      .set({ groupAvatarUrl, updatedAt: new Date() })
      .where(eq(schema.conversations.id, conversationId));

    return { success: true };
  }

  /**
   * Edit a message (within time window)
   */
  async editMessage(input: EditMessageInput) {
    const { messageId, userId, textContent } = input;

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

    await db
      .update(schema.messages)
      .set({
        textContent,
        isEdited: true,
        editedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.messages.id, messageId));

    const updatedMessage = await db.query.messages.findFirst({
      where: eq(schema.messages.id, messageId),
      with: { sender: true },
    });

    return updatedMessage;
  }

  /**
   * Unsend a message (delete for everyone or just me)
   */
  async unsendMessage(input: UnsendMessageInput) {
    const { messageId, userId, forEveryone } = input;

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
        })
        .where(eq(schema.messages.id, messageId));
    } else {
      // Soft delete for sender only (mark as deleted for this user)
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
  async addReaction(messageId: string, userId: string, emoji: string) {
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

    // Add reaction
    await db.insert(schema.messageReactions).values({
      messageId,
      userId,
      emoji,
    }).onConflictDoNothing();

    // Get reaction count
    const reactions = await db.query.messageReactions.findMany({
      where: eq(schema.messageReactions.messageId, messageId),
    });

    return { success: true, reactionCount: reactions.length };
  }

  /**
   * Remove reaction from message
   */
  async removeReaction(messageId: string, userId: string, emoji: string) {
    await db.delete(schema.messageReactions).where(and(
      eq(schema.messageReactions.messageId, messageId),
      eq(schema.messageReactions.userId, userId),
      eq(schema.messageReactions.emoji, emoji)
    ));

    const reactions = await db.query.messageReactions.findMany({
      where: eq(schema.messageReactions.messageId, messageId),
    });

    return { success: true, reactionCount: reactions.length };
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
   * Search messages within a conversation
   */
  async searchMessages(options: MessageSearchOptions) {
    const { conversationId, userId, query, page, perPage } = options;
    const offset = (page - 1) * perPage;

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

    // Search in text content using ILIKE
    const searchQuery = `%${query}%`;

    const messagesList = await db
      .select({
        id: schema.messages.id,
        conversationId: schema.messages.conversationId,
        senderId: schema.messages.senderId,
        contentType: schema.messages.contentType,
        textContent: schema.messages.textContent,
        mediaUrl: schema.messages.mediaUrl,
        mediaThumbnail: schema.messages.mediaThumbnail,
        mediaDuration: schema.messages.mediaDuration,
        // @ts-ignore - TypeScript can't infer referenceId from select columns
        referenceId: schema.messages.referenceId,
        replyToId: schema.messages.replyToId,
        status: schema.messages.status,
        isEdited: schema.messages.isEdited,
        editedAt: schema.messages.editedAt,
        createdAt: schema.messages.createdAt,
        sender: {
          id: schema.users.id,
          username: schema.users.username,
          fullName: schema.users.fullName,
          avatarUrl: schema.users.avatarUrl,
          isVerified: schema.users.isVerified,
        },
      })
      .from(schema.messages)
      .innerJoin(schema.users, eq(schema.users.id, schema.messages.senderId))
      .where(and(
        eq(schema.messages.conversationId, conversationId),
        isNull(schema.messages.deletedAt),
        sql`${schema.messages.textContent} ILIKE ${searchQuery}`
      ))
      .limit(perPage)
      .offset(offset)
      .orderBy(desc(schema.messages.createdAt));

    const totalResult = await db
      .select({ count: count() })
      .from(schema.messages)
      .where(and(
        eq(schema.messages.conversationId, conversationId),
        isNull(schema.messages.deletedAt),
        sql`${schema.messages.textContent} ILIKE ${searchQuery}`
      ));

    const total = totalResult[0]?.count || 0;

    return {
      items: messagesList,
      page,
      perPage,
      total,
      hasMore: page * perPage < total,
    };
  }

  /**
   * Update message status (delivered, read)
   */
  async updateMessageStatus(messageId: string, status: "DELIVERED" | "READ") {
    await db
      .update(schema.messages)
      .set({ status })
      .where(eq(schema.messages.id, messageId));

    return { success: true };
  }

  /**
   * Mark messages as delivered for a user
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

    return { success: true };
  }

  /**
   * Get unread count for all conversations of a user
   */
  async getUnreadCounts(userId: string): Promise<Record<string, number>> {
    const conversations = await db
      .select({ id: schema.conversations.id })
      .from(schema.conversationMembers)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.conversationMembers.conversationId))
      .where(and(
        eq(schema.conversationMembers.userId, userId),
        isNull(schema.conversationMembers.leftAt),
        isNull(schema.conversations.deletedAt)
      ));

    const counts: Record<string, number> = {};

    for (const conv of conversations) {
      const membership = await db.query.conversationMembers.findFirst({
        where: and(
          eq(schema.conversationMembers.conversationId, conv.id),
          eq(schema.conversationMembers.userId, userId)
        ),
      });

      if (membership?.lastReadAt) {
        const unreadResult = await db
          .select({ count: count() })
          .from(schema.messages)
          .where(and(
            eq(schema.messages.conversationId, conv.id),
            isNull(schema.messages.deletedAt),
            gt(schema.messages.createdAt, membership.lastReadAt)
          ));
        counts[conv.id] = unreadResult[0]?.count || 0;
      } else {
        // Never read - count all messages
        const unreadResult = await db
          .select({ count: count() })
          .from(schema.messages)
          .where(and(
            eq(schema.messages.conversationId, conv.id),
            isNull(schema.messages.deletedAt)
          ));
        counts[conv.id] = unreadResult[0]?.count || 0;
      }
    }

    return counts;
  }
}

export const conversationService = new ConversationService();