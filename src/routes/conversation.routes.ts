import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware, getCurrentUser } from "../middleware/auth";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, or, desc, asc, count, sql, inArray, lt } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

const createConversationSchema = z.object({
  participantIds: z.array(z.string().uuid()).min(1).max(50),
  groupName: z.string().max(100).optional(),
  groupAvatar: z.string().url().optional(),
});

const sendMessageSchema = z.object({
  contentType: z.enum(["TEXT", "IMAGE", "VIDEO", "AUDIO", "POST", "STORY", "REEL", "LIKE"]),
  textContent: z.string().max(5000).optional(),
  mediaUrl: z.string().url().optional(),
  mediaThumbnail: z.string().url().optional(),
  mediaDuration: z.number().optional(),
  referenceId: z.string().uuid().optional(),
  replyToId: z.string().uuid().optional(),
});

function getPagination(c: any) {
  const page = Number(c.req.query("page")) || 1;
  const perPage = Math.min(Number(c.req.query("perPage")) || 20, 50);
  return { page, perPage, offset: (page - 1) * perPage };
}

// Cursor-based pagination helper
function getCursorPagination(c: any) {
  const cursor = c.req.query("cursor");
  const perPage = Math.min(Number(c.req.query("perPage")) || 20, 50);
  return { cursor, perPage };
}

const conversationRouter = new Hono();
conversationRouter.use("*", authMiddleware);

// GET /v1/conversations - List conversations with last message
conversationRouter.get("/", async (c) => {
  const user = getCurrentUser(c);
  const { page, perPage, offset } = getPagination(c);

  // Get user's conversations with last message
  const conversations = await db
    .select({
      id: schema.conversations.id,
      isGroup: schema.conversations.isGroup,
      groupName: schema.conversations.groupName,
      groupAvatar: schema.conversations.groupAvatar,
      createdAt: schema.conversations.createdAt,
      updatedAt: schema.conversations.updatedAt,
      members: sql`(SELECT json_agg(json_build_object('id', u.id, 'username', u.username, 'fullName', u.full_name, 'avatarUrl', u.avatar_url, 'isVerified', u.is_verified) ORDER BY u.username) FROM conversation_members cm INNER JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = conversations.id)`,
      lastMessage: sql`(SELECT json_build_object('id', m.id, 'conversationId', m.conversation_id, 'senderId', m.sender_id, 'contentType', m.content_type, 'textContent', m.text_content, 'mediaUrl', m.media_url, 'mediaThumbnail', m.media_thumbnail, 'mediaDuration', m.media_duration, 'referenceId', m.reference_id, 'replyToId', m.reply_to_id, 'status', m.status, 'createdAt', m.created_at, 'sender', json_build_object('id', s.id, 'username', s.username, 'fullName', s.full_name, 'avatarUrl', s.avatar_url)) FROM messages m INNER JOIN users s ON s.id = m.sender_id WHERE m.conversation_id = conversations.id ORDER BY m.created_at DESC LIMIT 1)`,
      lastReadAt: sql`(SELECT cm.last_read_at FROM conversation_members cm WHERE cm.conversation_id = conversations.id AND cm.user_id = ${user.id})`,
      isMuted: sql`(SELECT cm.is_muted FROM conversation_members cm WHERE cm.conversation_id = conversations.id AND cm.user_id = ${user.id})`,
    })
    .from(schema.conversationMembers)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.conversationMembers.conversationId))
    .where(eq(schema.conversationMembers.userId, user.id))
    .limit(perPage)
    .offset(offset)
    .orderBy(desc(schema.conversations.updatedAt));

  const total = await db
    .select({ count: count() })
    .from(schema.conversationMembers)
    .where(eq(schema.conversationMembers.userId, user.id));

  return c.json({
    success: true,
    data: {
      items: conversations.map((conv) => ({
        ...conv,
        members: conv.members || [],
        lastMessage: conv.lastMessage || null,
        lastReadAt: conv.lastReadAt || null,
        isMuted: conv.isMuted || false,
        unreadCount: 0, // Could be computed from lastReadAt vs lastMessage
      })),
      page,
      perPage,
      total: total[0]?.count || 0,
      hasMore: page * perPage < (total[0]?.count || 0),
    },
  });
});

// POST /v1/conversations - Create conversation
conversationRouter.post("/", zValidator("json", createConversationSchema), async (c) => {
  const user = getCurrentUser(c);
  const { participantIds, groupName, groupAvatar } = c.req.valid("json");

  // Validate participants exist
  const participants = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(inArray(schema.users.id, participantIds));

  if (participants.length !== participantIds.length) {
    throw new HTTPException(400, { message: "One or more participants not found" });
  }

  // Prevent adding self as participant (already added as creator)
  if (participantIds.includes(user.id)) {
    throw new HTTPException(400, { message: "Cannot add yourself as participant" });
  }

  // Authorization: For group conversations, require mutual follow with all participants
  // For 1-on-1, allow if users have any connection (follow/followed) or are creating first contact
  if (groupName && participantIds.length > 0) {
    // Check mutual follow for each participant
    for (const participantId of participantIds) {
      const mutualFollow = await db
        .select({ id: schema.follows.id })
        .from(schema.follows)
        .where(
          or(
            and(eq(schema.follows.followerId, user.id), eq(schema.follows.followingId, participantId)),
            and(eq(schema.follows.followerId, participantId), eq(schema.follows.followingId, user.id))
          )
        )
        .limit(1);

      if (mutualFollow.length === 0) {
        throw new HTTPException(403, {
          message: `Cannot create group with user ${participantId}: mutual follow required`,
          res: c.json({ success: false, error: "MUTUAL_FOLLOW_REQUIRED", message: "Mutual follow required to create group conversation" }),
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
          inArray(schema.conversationMembers.userId, [user.id, participantIds[0]])
        )
      )
      .groupBy(schema.conversations.id)
      .having(sql`count(*) = 2`);

    if (existing.length > 0) {
      return c.json({ success: true, data: { conversation: { id: existing[0].id } } });
    }
  }

  // Create conversation
  const [conversation] = await db
    .insert(schema.conversations)
    .values({
      isGroup: !!groupName,
      groupName,
      groupAvatar,
    })
    .returning();

  // Add members
  const allMemberIds = [...new Set([user.id, ...participantIds])];
  await db.insert(schema.conversationMembers).values(
    allMemberIds.map((memberId) => ({
      conversationId: conversation.id,
      userId: memberId,
    }))
  );

  const createdConversation = await db.query.conversations.findFirst({
    where: eq(schema.conversations.id, conversation.id),
    with: { members: { with: { user: true } } },
  });

  return c.json(
    {
      success: true,
      data: { conversation: createdConversation },
    },
    201
  );
});

// GET /v1/conversations/:id/messages - Get messages (cursor pagination)
conversationRouter.get("/:id/messages", async (c) => {
  const user = getCurrentUser(c);
  const conversationId = c.req.param("id");
  const { cursor, perPage } = getCursorPagination(c);

  // Verify membership
  const membership = await db.query.conversationMembers.findFirst({
    where: and(eq(schema.conversationMembers.conversationId, conversationId), eq(schema.conversationMembers.userId, user.id)),
  });

  if (!membership) {
    throw new HTTPException(403, { message: "Not a member of this conversation" });
  }

  const whereConditions = [eq(schema.messages.conversationId, conversationId)];

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
      referenceId: schema.messages.referenceId,
      replyToId: schema.messages.replyToId,
      status: schema.messages.status,
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

  return c.json({
    success: true,
    data: {
      items: items.reverse(), // Return in chronological order
      nextCursor,
      hasMore,
    },
  });
});

// POST /v1/conversations/:id/messages - Send message
conversationRouter.post("/:id/messages", zValidator("json", sendMessageSchema), async (c) => {
  const user = getCurrentUser(c);
  const conversationId = c.req.param("id");
  const { contentType, textContent, mediaUrl, mediaThumbnail, mediaDuration, referenceId, replyToId } = c.req.valid("json");

  // Verify membership
  const membership = await db.query.conversationMembers.findFirst({
    where: and(eq(schema.conversationMembers.conversationId, conversationId), eq(schema.conversationMembers.userId, user.id)),
  });

  if (!membership) {
    throw new HTTPException(403, { message: "Not a member of this conversation" });
  }

  // Validate reply
  if (replyToId) {
    const replyMsg = await db.query.messages.findFirst({ where: eq(schema.messages.id, replyToId) });
    if (!replyMsg || replyMsg.conversationId !== conversationId) {
      throw new HTTPException(400, { message: "Invalid reply message" });
    }
  }

  const [message] = await db
    .insert(schema.messages)
    .values({
      conversationId,
      senderId: user.id,
      contentType,
      textContent,
      mediaUrl,
      mediaThumbnail,
      mediaDuration: mediaDuration ? mediaDuration.toString() : null,
      referenceId,
      replyToId,
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
    .where(and(eq(schema.conversationMembers.conversationId, conversationId), sql`${schema.conversationMembers.userId} != ${user.id}`));

  const createdMessage = await db.query.messages.findFirst({
    where: eq(schema.messages.id, message.id),
    with: { sender: true },
  });

  return c.json(
    {
      success: true,
      data: { message: createdMessage },
    },
    201
  );
});

// POST /v1/conversations/:id/read - Mark as read
conversationRouter.post("/:id/read", async (c) => {
  const user = getCurrentUser(c);
  const conversationId = c.req.param("id");

  const membership = await db.query.conversationMembers.findFirst({
    where: and(eq(schema.conversationMembers.conversationId, conversationId), eq(schema.conversationMembers.userId, user.id)),
  });

  if (!membership) {
    throw new HTTPException(403, { message: "Not a member of this conversation" });
  }

  await db
    .update(schema.conversationMembers)
    .set({ lastReadAt: new Date() })
    .where(and(eq(schema.conversationMembers.conversationId, conversationId), eq(schema.conversationMembers.userId, user.id)));

  return c.status(204);
});

// PUT /v1/conversations/:id/mute - Mute/unmute conversation
conversationRouter.put("/:id/mute", zValidator("json", z.object({ mute: z.boolean() })), async (c) => {
  const user = getCurrentUser(c);
  const conversationId = c.req.param("id");
  const { mute } = c.req.valid("json");

  const membership = await db.query.conversationMembers.findFirst({
    where: and(eq(schema.conversationMembers.conversationId, conversationId), eq(schema.conversationMembers.userId, user.id)),
  });

  if (!membership) {
    throw new HTTPException(403, { message: "Not a member of this conversation" });
  }

  await db
    .update(schema.conversationMembers)
    .set({ isMuted: mute })
    .where(and(eq(schema.conversationMembers.conversationId, conversationId), eq(schema.conversationMembers.userId, user.id)));

  return c.status(204);
});

// DELETE /v1/conversations/messages/:messageId - Delete message (sender only)
conversationRouter.delete("/messages/:messageId", async (c) => {
  const user = getCurrentUser(c);
  const messageId = c.req.param("messageId");

  const message = await db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
  if (!message) {
    throw new HTTPException(404, { message: "Message not found" });
  }

  if (message.senderId !== user.id) {
    throw new HTTPException(403, { message: "Not authorized to delete this message" });
  }

  await db.delete(schema.messages).where(eq(schema.messages.id, messageId));

  return c.status(204);
});

export { conversationRouter };