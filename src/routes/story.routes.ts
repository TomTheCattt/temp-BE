import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware, getCurrentUser } from "../middleware/auth";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, desc, asc, count, sql, inArray, lt, not, isNull, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { getStoryService } from "../services/story-service";

const createStorySchema = z.object({
  audience: z.enum(["followers", "close_friends"]).default("followers"),
  items: z.array(z.object({
    mediaUrl: z.string().url(),
    type: z.enum(["IMAGE", "VIDEO"]),
    duration: z.number().positive().max(60).default(5),
    sortOrder: z.number().int().nonnegative(),
    stickerType: z.string().max(50).optional(),
    stickerData: z.record(z.any()).optional(),
    thumbnailUrl: z.string().url().optional(),
  })).min(1).max(10),
});

const replySchema = z.object({
  text: z.string().min(1).max(1000),
  mediaUrl: z.string().url().optional(),
});

const commentSchema = z.object({
  text: z.string().min(1).max(1000),
  parentId: z.string().uuid().optional(),
});

const reportSchema = z.object({
  reason: z.string(),
  description: z.string().optional(),
});

function getPagination(c: any) {
  const page = Number(c.req.query("page")) || 1;
  const perPage = Math.min(Number(c.req.query("perPage")) || 20, 50);
  return { page, perPage, offset: (page - 1) * perPage };
}

const storyRouter = new Hono();
storyRouter.use("*", authMiddleware);

// GET /v1/stories/feed - Stories feed (active stories from self + following)
storyRouter.get("/feed", async (c) => {
  const user = getCurrentUser(c);
  const storyService = getStoryService();

  const feed = await storyService.getFeed(user.id);

  return c.json({ success: true, data: { items: feed } });
});

// GET /v1/stories/:userId/items - User's story items (with view status)
storyRouter.get("/:userId/items", async (c) => {
  const user = getCurrentUser(c);
  const targetId = c.req.param("userId");
  const storyService = getStoryService();

  const stories = await storyService.getUserStories(targetId, user.id);

  return c.json({
    success: true,
    data: { stories },
  });
});

// POST /v1/stories - Create story
storyRouter.post("/", zValidator("json", createStorySchema), async (c) => {
  const user = getCurrentUser(c);
  const { audience, items } = c.req.valid("json");
  const storyService = getStoryService();

  const story = await storyService.createStory({
    authorId: user.id,
    audience,
    items,
  });

  return c.json(
    {
      success: true,
      data: { story },
    },
    201
  );
});

// POST /v1/stories/:storyId/view - Mark story as viewed
storyRouter.post("/:storyId/view", async (c) => {
  const user = getCurrentUser(c);
  const storyId = c.req.param("storyId");
  const storyService = getStoryService();

  await storyService.markAsViewed(storyId, user.id);

  return c.status(204);
});

// GET /v1/stories/:storyId/views - Get story viewers (author only)
storyRouter.get("/:storyId/views", async (c) => {
  const user = getCurrentUser(c);
  const storyId = c.req.param("storyId");
  const { page, perPage, offset } = getPagination(c);
  const storyService = getStoryService();

  const result = await storyService.getStoryViewers(storyId, user.id, c.req.query("cursor"), perPage);

  return c.json({
    success: true,
    data: {
      items: result.items,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    },
  });
});

// POST /v1/stories/:storyId/reply - Reply to story (creates DM)
storyRouter.post("/:storyId/reply", zValidator("json", replySchema), async (c) => {
  const user = getCurrentUser(c);
  const storyId = c.req.param("storyId");
  const { text, mediaUrl } = c.req.valid("json");
  const storyService = getStoryService();

  const { conversationId, messageId } = await storyService.replyToStory(storyId, user.id, text, mediaUrl);

  return c.json({
    success: true,
    data: { conversationId, messageId },
  }, 201);
});

// DELETE /v1/stories/:storyId - Delete story (author only)
storyRouter.delete("/:storyId", async (c) => {
  const user = getCurrentUser(c);
  const storyId = c.req.param("storyId");
  const storyService = getStoryService();

  await storyService.deleteStory(storyId, user.id);

  return c.status(204);
});

// GET /v1/stories/:id/comments - Get story comments
storyRouter.get("/:id/comments", async (c) => {
  const user = getCurrentUser(c);
  const storyId = c.req.param("id");
  const { page, perPage, offset } = getPagination(c);

  const story = await db.query.stories.findFirst({ where: eq(schema.stories.id, storyId), columns: { id: true, authorId: true } });
  if (!story) throw new HTTPException(404, { message: "Story not found" });

  // Check if user can view story (private account check)
  if (story.authorId !== user.id) {
    const storyAuthor = await db.query.users.findFirst({ where: eq(schema.users.id, story.authorId), columns: { isPrivate: true } });
    if (storyAuthor?.isPrivate) {
      const following = await db.query.follows.findFirst({ where: and(eq(schema.follows.followerId, user.id), eq(schema.follows.followingId, story.authorId)) });
      if (!following) throw new HTTPException(403, { message: "This account is private" });
    }
  }

  const [commentsList, total] = await Promise.all([
    db
      .select({
        id: schema.comments.id,
        commentableType: schema.comments.commentableType,
        commentableId: schema.comments.commentableId,
        authorId: schema.comments.authorId,
        text: schema.comments.text,
        parentId: schema.comments.parentId,
        likesCount: schema.comments.likesCount,
        createdAt: schema.comments.createdAt,
        author: {
          id: schema.users.id,
          username: schema.users.username,
          fullName: schema.users.fullName,
          avatarUrl: schema.users.avatarUrl,
          isVerified: schema.users.isVerified,
        },
      })
      .from(schema.comments)
      .innerJoin(schema.users, eq(schema.users.id, schema.comments.authorId))
      .where(and(
        eq(schema.comments.commentableType, "STORY"),
        eq(schema.comments.commentableId, storyId),
        isNull(schema.comments.parentId)
      ))
      .orderBy(desc(schema.comments.createdAt))
      .limit(perPage)
      .offset(offset),
    db.select({ count: count() }).from(schema.comments).where(and(
      eq(schema.comments.commentableType, "STORY"),
      eq(schema.comments.commentableId, storyId),
      isNull(schema.comments.parentId)
    )),
  ]);

  return c.json({
    success: true,
    data: {
      items: commentsList,
      page,
      perPage,
      total: total[0]?.count || 0,
      hasMore: page * perPage < (total[0]?.count || 0),
    },
  });
});

// POST /v1/stories/:id/comments - Add story comment
storyRouter.post("/:id/comments", zValidator("json", commentSchema), async (c) => {
  const user = getCurrentUser(c);
  const storyId = c.req.param("id");
  const { text, parentId } = c.req.valid("json");

  const story = await db.query.stories.findFirst({ where: eq(schema.stories.id, storyId), columns: { id: true, authorId: true } });
  if (!story) throw new HTTPException(404, { message: "Story not found" });

  // Check if user can comment (private account check)
  if (story.authorId !== user.id) {
    const storyAuthor = await db.query.users.findFirst({ where: eq(schema.users.id, story.authorId), columns: { isPrivate: true } });
    if (storyAuthor?.isPrivate) {
      const following = await db.query.follows.findFirst({ where: and(eq(schema.follows.followerId, user.id), eq(schema.follows.followingId, story.authorId)) });
      if (!following) throw new HTTPException(403, { message: "This account is private" });
    }
  }

  if (parentId) {
    const parentComment = await db.query.comments.findFirst({ where: eq(schema.comments.id, parentId) });
    if (!parentComment || parentComment.commentableType !== "STORY" || parentComment.commentableId !== storyId) {
      throw new HTTPException(400, { message: "Invalid parent comment" });
    }
  }

  const [comment] = await db
    .insert(schema.comments)
    .values({
      commentableType: "STORY",
      commentableId: storyId,
      authorId: user.id,
      text,
      parentId,
    })
    .returning();

  // Notify story author (if not self)
  if (story.authorId !== user.id) {
    await db.insert(schema.notifications).values({
      recipientId: story.authorId,
      actorId: user.id,
      type: "COMMENT",
      referenceType: "story",
      referenceId: storyId,
      previewText: text.substring(0, 100),
      deepLink: `/stories/${storyId}`,
      groupKey: `comment:story:${storyId}`,
    });
  }

  // If replying to a comment, notify parent comment author
  if (parentId) {
    const parentComment = await db.query.comments.findFirst({ where: eq(schema.comments.id, parentId) });
    if (parentComment && parentComment.authorId !== user.id && parentComment.authorId !== story.authorId) {
      await db.insert(schema.notifications).values({
        recipientId: parentComment.authorId,
        actorId: user.id,
        type: "COMMENT",
        referenceType: "story",
        referenceId: storyId,
        previewText: text.substring(0, 100),
        deepLink: `/stories/${storyId}`,
        groupKey: `comment:story:${storyId}`,
      });
    }
  }

  const createdComment = await db.query.comments.findFirst({
    where: eq(schema.comments.id, comment.id),
    with: { author: true },
  });

  return c.json({ success: true, data: { comment: createdComment } }, 201);
});

// DELETE /v1/stories/:id/comments/:commentId - Delete story comment
storyRouter.delete("/:id/comments/:commentId", async (c) => {
  const user = getCurrentUser(c);
  const storyId = c.req.param("id");
  const commentId = c.req.param("commentId");

  const comment = await db.query.comments.findFirst({
    where: and(
      eq(schema.comments.id, commentId),
      eq(schema.comments.commentableType, "STORY"),
      eq(schema.comments.commentableId, storyId)
    ),
  });
  if (!comment) throw new HTTPException(404, { message: "Comment not found" });

  // Only comment author or story author can delete
  if (comment.authorId !== user.id) {
    const story = await db.query.stories.findFirst({ where: eq(schema.stories.id, storyId), columns: { authorId: true } });
    if (!story || story.authorId !== user.id) {
      throw new HTTPException(403, { message: "Not authorized to delete this comment" });
    }
  }

  await db.delete(schema.comments).where(eq(schema.comments.id, commentId));

  return c.status(204);
});

// POST /v1/stories/:storyId/report - Report a story
storyRouter.post("/:storyId/report", zValidator("json", reportSchema), async (c) => {
  const user = getCurrentUser(c);
  const storyId = c.req.param("storyId");
  const { reason, description } = c.req.valid("json");
  const storyService = getStoryService();

  await storyService.reportStory(storyId, user.id, reason, description);

  return c.json({ success: true, data: { message: "Story reported successfully" } }, 201);
});

export { storyRouter };