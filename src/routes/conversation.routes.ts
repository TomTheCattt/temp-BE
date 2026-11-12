import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware, getCurrentUser } from "../middleware/auth";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, or, desc, asc, count, sql, inArray, lt, isNull, not } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { conversationService } from "../services/conversation-service";
import { messageService } from "../services/message-service";

const createConversationSchema = z.object({
  participantIds: z.array(z.string().uuid()).min(1).max(50),
  groupName: z.string().max(100).optional(),
  groupAvatar: z.string().url().optional(),
});

const sendMessageSchema = z.object({
  contentType: z.enum([
    "TEXT", "IMAGE", "VIDEO", "AUDIO", "FILE",
    "POST_SHARE", "REEL_SHARE", "STORY_SHARE", "PROFILE_SHARE",
    "LOCATION", "CONTACT", "VOICE", "REPLY", "SYSTEM"
  ]),
  textContent: z.string().max(5000).optional(),
  mediaUrl: z.string().url().optional(),
  mediaThumbnail: z.string().url().optional(),
  mediaDuration: z.number().optional(),
  mediaMetadata: z.record(z.any()).optional(),
  referenceId: z.string().uuid().optional(),
  replyToId: z.string().uuid().optional(),
  isEphemeral: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
});

const editMessageSchema = z.object({
  textContent: z.string().max(5000),
});

const unsendMessageSchema = z.object({
  forEveryone: z.boolean().default(true),
});

const reactionSchema = z.object({
  emoji: z.string().max(10),
});

const muteSchema = z.object({
  mute: z.boolean(),
});

const addMembersSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(50),
});

const updateGroupSchema = z.object({
  groupName: z.string().max(100).optional(),
  groupAvatar: z.string().url().optional(),
});

const blockUserSchema = z.object({
  targetUserId: z.string().uuid(),
});

const reportSchema = z.object({
  reason: z.enum(["SPAM", "HATE_SPEECH", "HARASSMENT", "VIOLENCE", "NUDITY", "SELF_HARM", "MISINFORMATION", "SCAM", "IMPERSONATION", "COPYRIGHT", "OTHER"]),
  description: z.string().max(1000).optional(),
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

// ============================================================
// CONVERSATION LIST & CREATE
// ============================================================

// GET /v1/conversations - List conversations with last message and unread count
conversationRouter.get("/", async (c) => {
  const user = getCurrentUser(c);
  const { page, perPage } = getPagination(c);

  const result = await conversationService.getConversations({
    userId: user.id,
    page,
    perPage,
  });

  return c.json({
    success: true,
    data: result,
  });
});

// POST /v1/conversations - Create conversation (1:1 or group)
conversationRouter.post("/", zValidator("json", createConversationSchema), async (c) => {
  const user = getCurrentUser(c);
  const { participantIds, groupName, groupAvatar } = c.req.valid("json");

  const result = await conversationService.createConversation({
    participantIds,
    groupName,
    groupAvatar,
    creatorId: user.id,
  });

  return c.json(
    {
      success: true,
      data: { conversation: result.conversation, isExisting: result.isExisting },
    },
    result.isExisting ? 200 : 201
  );
});

// ============================================================
// CONVERSATION DETAILS & SETTINGS
// ============================================================

// GET /v1/conversations/:id - Get conversation details
conversationRouter.get("/:id", async (c) => {
  const user = getCurrentUser(c);
  const conversationId = c.req.param("id");

  // Verify membership
  const membership = await db.query.conversationMembers.findFirst({
    where: and(
      eq(schema.conversationMembers.conversationId, conversationId),
      eq(schema.conversationMembers.userId, user.id),
      isNull(schema.conversationMembers.leftAt)
    ),
  });

  if (!membership) {
    throw new HTTPException(403, { message: "Not a member of this conversation" });
  }

  const conversation = await conversationService.getConversationById(conversationId);

  if (!conversation) {
    throw new HTTPException(404, { message: "Conversation not found" });
  }

  // Get unread count for current user
  const unreadCount = await messageService.getUnreadCount(conversationId, user.id);

  // Get current user's mute status
  const isMuted = membership.isMuted;
  const lastReadAt = membership.lastReadAt;

  return c.json({
    success: true,
    data: {
      conversation: {
        ...conversation,
        unreadCount,
        isMuted,
        lastReadAt,
      },
    },
  });
});

// PUT /v1/conversations/:id - Update conversation (group name, avatar)
conversationRouter.put("/:id", zValidator("json", updateGroupSchema), async (c) => {
  const user = getCurrentUser(c);
  const conversationId = c.req.param("id");
  const { groupName, groupAvatar } = c.req.valid("json");

  const conversation = await db.query.conversations.findFirst({
    where: eq(schema.conversations.id, conversationId),
  });

  if (!conversation || !conversation.isGroup) {
    throw new HTTPException(400, { message: "Can only update group conversations" });
  }

  const membership = await db.query.conversationMembers.findFirst({
    where: and(
      eq(schema.conversationMembers.conversationId, conversationId),
      eq(schema.conversationMembers.userId, user.id),
      isNull(schema.conversationMembers.leftAt)
    ),
  });

  if (!membership || (conversation.groupOwnerId !== user.id && membership.role !== "admin")) {
    throw new HTTPException(403, { message: "Not authorized to update this conversation" });
  }

  const updateData: any = { updatedAt: new Date() };
  if (groupName !== undefined) updateData.groupName = groupName;
  if (groupAvatar !== undefined) updateData.groupAvatarUrl = groupAvatar;

  await db
    .update(schema.conversations)
    .set(updateData)
    .where(eq(schema.conversations.id, conversationId));

  return c.status(204);
});

// POST /v1/conversations/:id/mute - Mute/unmute conversation
conversationRouter.post("/:id/mute", zValidator("json", muteSchema), async (c) => {
  const user = getCurrentUser(c);
  const conversationId = c.req.param("id");
  const { mute } = c.req.valid("json");

  await conversationService.setMute(conversationId, user.id, mute);

  return c.status(204);
});

// POST /v1/conversations/:id/leave - Leave group conversation
conversationRouter.post("/:id/leave", async (c) => {
  const user = getCurrentUser(c);
  const conversationId = c.req.param("id");

  await conversationService.leaveConversation(conversationId, user.id);

  return c.status(204);
});

// POST /v1/conversations/:id/block - Block user in conversation
conversationRouter.post("/:id/block", zValidator("json", blockUserSchema), async (c) => {
  const user = getCurrentUser(c);
  const conversationId = c.req.param("id");
  const { targetUserId } = c.req.valid("json");

  await conversationService.blockUserInConversation(conversationId, user.id, targetUserId);

  return c.status(204);
});

// POST /v1/conversations/:id/report - Report conversation
conversationRouter.post("/:id/report", zValidator("json", reportSchema), async (c) => {
  const user = getCurrentUser(c);
  const conversationId = c.req.param("id");
  const { reason, description } = c.req.valid("json");

  await conversationService.reportConversation(conversationId, user.id, reason, description);

  return c.status(204);
});

// POST /v1/conversations/:id/read - Mark as read
conversationRouter.post("/:id/read", async (c) => {
  const user = getCurrentUser(c);
  const conversationId = c.req.param("id");

  await conversationService.markAsRead(conversationId, user.id);

  return c.status(204);
});

// ============================================================
// GROUP MEMBER MANAGEMENT
// ============================================================

// POST /v1/conversations/:id/members - Add members to group
conversationRouter.post("/:id/members", zValidator("json", addMembersSchema), async (c) => {
  const user = getCurrentUser(c);
  const conversationId = c.req.param("id");
  const { userIds } = c.req.valid("json");

  const result = await conversationService.addMembers(conversationId, user.id, userIds);

  return c.json({ success: true, data: result });
});

// DELETE /v1/conversations/:id/members/:userId - Remove member from group
conversationRouter.delete("/:id/members/:userId", async (c) => {
  const user = getCurrentUser(c);
  const conversationId = c.req.param("id");
  const targetUserId = c.req.param("userId");

  await conversationService.removeMember(conversationId, user.id, targetUserId);

  return c.status(204);
});

// PUT /v1/conversations/:id/owner - Transfer group ownership
conversationRouter.put("/:id/owner", zValidator("json", z.object({ newOwnerId: z.string().uuid() })), async (c) => {
  const user = getCurrentUser(c);
  const conversationId = c.req.param("id");
  const { newOwnerId } = c.req.valid("json");

  await conversationService.transferOwnership(conversationId, user.id, newOwnerId);

  return c.status(204);
});

// ============================================================
// MESSAGES
// ============================================================

// GET /v1/conversations/:id/messages - Get messages (cursor pagination)
conversationRouter.get("/:id/messages", async (c) => {
  const user = getCurrentUser(c);
  const conversationId = c.req.param("id");
  const { cursor, perPage } = getCursorPagination(c);

  const result = await messageService.getMessages(conversationId, user.id, cursor, perPage);

  return c.json({
    success: true,
    data: result,
  });
});

// POST /v1/conversations/:id/messages - Send message
conversationRouter.post("/:id/messages", zValidator("json", sendMessageSchema), async (c) => {
  const user = getCurrentUser(c);
  const conversationId = c.req.param("id");
  const { contentType, textContent, mediaUrl, mediaThumbnail, mediaDuration, mediaMetadata, replyToId, isEphemeral, expiresAt } = c.req.valid("json");

  const message = await messageService.sendMessage({
    conversationId,
    senderId: user.id,
    contentType,
    textContent,
    mediaUrl,
    mediaThumbnail,
    mediaDuration,
    mediaMetadata,
    replyToId,
    isEphemeral,
    expiresAt: expiresAt ? new Date(expiresAt) : undefined,
  });

  return c.json(
    {
      success: true,
      data: { message },
    },
    201
  );
});

// GET /v1/conversations/:id/messages/search - Search messages in conversation
conversationRouter.get("/:id/messages/search", async (c) => {
  const user = getCurrentUser(c);
  const conversationId = c.req.param("id");
  const query = c.req.query("q");
  const { cursor, perPage } = getCursorPagination(c);

  if (!query || query.trim().length === 0) {
    throw new HTTPException(400, { message: "Query parameter 'q' is required" });
  }

  const result = await messageService.searchMessages({
    conversationId,
    userId: user.id,
    query: query.trim(),
    cursor,
    perPage,
  });

  return c.json({
    success: true,
    data: result,
  });
});

// ============================================================
// MESSAGE OPERATIONS
// ============================================================

// GET /v1/messages/:id - Get message details
conversationRouter.get("/messages/:id", async (c) => {
  const user = getCurrentUser(c);
  const messageId = c.req.param("id");

  const message = await messageService.getMessageById(messageId);

  if (!message) {
    throw new HTTPException(404, { message: "Message not found" });
  }

  // Verify user is member of the conversation
  const membership = await db.query.conversationMembers.findFirst({
    where: and(
      eq(schema.conversationMembers.conversationId, message.conversationId),
      eq(schema.conversationMembers.userId, user.id),
      isNull(schema.conversationMembers.leftAt)
    ),
  });

  if (!membership) {
    throw new HTTPException(403, { message: "Not a member of this conversation" });
  }

  return c.json({
    success: true,
    data: { message },
  });
});

// PATCH /v1/messages/:id - Edit message (within 10 min)
conversationRouter.patch("/messages/:id", zValidator("json", editMessageSchema), async (c) => {
  const user = getCurrentUser(c);
  const messageId = c.req.param("id");
  const { textContent } = c.req.valid("json");

  const message = await messageService.editMessage({
    messageId,
    userId: user.id,
    textContent,
  });

  return c.json({
    success: true,
    data: { message },
  });
});

// DELETE /v1/messages/:id - Unsend message (for everyone or just me)
conversationRouter.delete("/messages/:id", zValidator("json", unsendMessageSchema), async (c) => {
  const user = getCurrentUser(c);
  const messageId = c.req.param("id");
  const { forEveryone } = c.req.valid("json");

  await messageService.unsendMessage({
    messageId,
    userId: user.id,
    forEveryone,
  });

  return c.status(204);
});

// POST /v1/messages/:id/reaction - Add reaction
conversationRouter.post("/messages/:id/reaction", zValidator("json", reactionSchema), async (c) => {
  const user = getCurrentUser(c);
  const messageId = c.req.param("id");
  const { emoji } = c.req.valid("json");

  const result = await messageService.addReaction({
    messageId,
    userId: user.id,
    emoji,
  });

  return c.json({
    success: true,
    data: result,
  });
});

// DELETE /v1/messages/:id/reaction - Remove reaction
conversationRouter.delete("/messages/:id/reaction", zValidator("json", reactionSchema), async (c) => {
  const user = getCurrentUser(c);
  const messageId = c.req.param("id");
  const { emoji } = c.req.valid("json");

  const result = await messageService.removeReaction({
    messageId,
    userId: user.id,
    emoji,
  });

  return c.json({
    success: true,
    data: result,
  });
});

// GET /v1/messages/:id/reactions - Get message reactions
conversationRouter.get("/messages/:id/reactions", async (c) => {
  const messageId = c.req.param("id");

  const reactions = await messageService.getReactions(messageId);

  return c.json({
    success: true,
    data: { reactions },
  });
});

// POST /v1/messages/:id/read - Mark message as read
conversationRouter.post("/messages/:id/read", async (c) => {
  const user = getCurrentUser(c);
  const messageId = c.req.param("id");

  const message = await db.query.messages.findFirst({
    where: eq(schema.messages.id, messageId),
  });

  if (!message) {
    throw new HTTPException(404, { message: "Message not found" });
  }

  await messageService.markMessagesRead(message.conversationId, user.id, message.id.toString());

  return c.status(204);
});

// POST /v1/messages/:id/delivered - Mark message as delivered
conversationRouter.post("/messages/:id/delivered", async (c) => {
  const user = getCurrentUser(c);
  const messageId = c.req.param("id");

  const message = await db.query.messages.findFirst({
    where: eq(schema.messages.id, messageId),
  });

  if (!message) {
    throw new HTTPException(404, { message: "Message not found" });
  }

  await messageService.markMessagesDelivered(message.conversationId, user.id, message.id.toString());

  return c.status(204);
});

// GET /v1/messages/:id/thread - Get message thread (replies)
conversationRouter.get("/messages/:id/thread", async (c) => {
  const user = getCurrentUser(c);
  const messageId = c.req.param("id");
  const perPage = Math.min(Number(c.req.query("perPage")) || 20, 50);

  const replies = await messageService.getMessageThread(messageId, user.id, perPage);

  return c.json({
    success: true,
    data: { messages: replies },
  });
});

// POST /v1/messages/forward - Forward messages
conversationRouter.post("/messages/forward", zValidator("json", z.object({
  messageIds: z.array(z.string().uuid()).min(1).max(10),
  conversationId: z.string().uuid(),
})), async (c) => {
  const user = getCurrentUser(c);
  const { messageIds, conversationId } = c.req.valid("json");

  const result = await messageService.forwardMessages(messageIds, user.id, conversationId);

  return c.json({
    success: true,
    data: result,
  });
});

export { conversationRouter };