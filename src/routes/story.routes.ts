import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware, getCurrentUser } from "../middleware/auth";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, desc, asc, count, sql, inArray, lt, not, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

const createStorySchema = z.object({
  mediaUrl: z.string().url(),
  type: z.enum(["IMAGE", "VIDEO"]),
  duration: z.number().positive().max(60).default(5),
  stickerType: z.string().max(50).optional(),
  stickerData: z.string().optional(),
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

  const following = await db.select({ followingId: schema.follows.followingId }).from(schema.follows).where(eq(schema.follows.followerId, user.id));
  const followingIds = following.map((f) => f.followingId);
  followingIds.push(user.id);

  const blocked = await db.select({ blockedId: schema.blocks.blockedId }).from(schema.blocks).where(eq(schema.blocks.blockerId, user.id));
  const blockedIds = blocked.map((b) => b.blockedId);

  const now = new Date();

  const whereConditions = [
    inArray(schema.stories.authorId, followingIds),
    sql`${schema.stories.expiresAt} > ${now}`,
  ];

  // Exclude blocked users
  if (blockedIds.length > 0) {
    whereConditions.push(not(inArray(schema.stories.authorId, blockedIds)));
  }

  // Get active stories from following
  const activeStories = await db
    .select({
      id: schema.stories.id,
      authorId: schema.stories.authorId,
      createdAt: schema.stories.createdAt,
      expiresAt: schema.stories.expiresAt,
      author: {
        id: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
      },
      items: sql`(SELECT json_agg(json_build_object('id', si.id, 'mediaUrl', si.media_url, 'type', si.type, 'duration', si.duration, 'sortOrder', si.sort_order, 'stickerType', si.sticker_type, 'stickerData', si.sticker_data) ORDER BY si.sort_order) FROM story_items si WHERE si.story_id = stories.id)`,
    })
    .from(schema.stories)
    .innerJoin(schema.users, eq(schema.users.id, schema.stories.authorId))
    .where(and(...whereConditions))
    .orderBy(desc(schema.stories.createdAt));

  // Group by author
  const storiesByAuthor = new Map<string, any[]>();
  for (const story of activeStories) {
    const authorId = story.authorId;
    if (!storiesByAuthor.has(authorId)) {
      storiesByAuthor.set(authorId, []);
    }
    storiesByAuthor.get(authorId)!.push(story);
  }

  const items = Array.from(storiesByAuthor.entries()).map(([authorId, stories]) => ({
    userId: authorId,
    author: stories[0].author,
    stories: stories.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      items: s.items || [],
    })),
  }));

  return c.json({ success: true, data: { items } });
});

// GET /v1/stories/:userId/items - User's story items (with view status)
storyRouter.get("/:userId/items", async (c) => {
  const user = getCurrentUser(c);
  const targetId = c.req.param("userId");

  const targetUser = await db.query.users.findFirst({
    where: eq(schema.users.id, targetId),
    columns: { id: true, isPrivate: true },
  });

  if (!targetUser) {
    throw new HTTPException(404, { message: "User not found" });
  }

  if (targetUser.isPrivate && targetId !== user.id) {
    const following = await db.query.follows.findFirst({
      where: and(eq(schema.follows.followerId, user.id), eq(schema.follows.followingId, targetId)),
    });
    if (!following) {
      throw new HTTPException(403, { message: "This account is private" });
    }
  }

  const now = new Date();

  const stories = await db
    .select({
      id: schema.stories.id,
      authorId: schema.stories.authorId,
      createdAt: schema.stories.createdAt,
      expiresAt: schema.stories.expiresAt,
      author: {
        id: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
      },
      items: sql`(SELECT json_agg(json_build_object('id', si.id, 'mediaUrl', si.media_url, 'type', si.type, 'duration', si.duration, 'sortOrder', si.sort_order, 'stickerType', si.sticker_type, 'stickerData', si.sticker_data) ORDER BY si.sort_order) FROM story_items si WHERE si.story_id = stories.id)`,
    })
    .from(schema.stories)
    .innerJoin(schema.users, eq(schema.users.id, schema.stories.authorId))
    .where(and(eq(schema.stories.authorId, targetId), sql`${schema.stories.expiresAt} > ${now}`))
    .orderBy(desc(schema.stories.createdAt));

  // Get view status for current user
  const storyIds = stories.map((s) => s.id);
  let viewedSet = new Set<string>();
  if (storyIds.length > 0) {
    const views = await db
      .select({ storyId: schema.storyViews.storyId })
      .from(schema.storyViews)
      .where(and(eq(schema.storyViews.viewerId, user.id), inArray(schema.storyViews.storyId, storyIds)));
    viewedSet = new Set(views.map((v) => v.storyId));
  }

  return c.json({
    success: true,
    data: {
      stories: stories.map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        items: s.items || [],
        viewed: viewedSet.has(s.id),
      })),
    },
  });
});

// POST /v1/stories - Create story
storyRouter.post("/", zValidator("json", createStorySchema), async (c) => {
  const user = getCurrentUser(c);
  const { mediaUrl, type, duration, stickerType, stickerData } = c.req.valid("json");

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  const [story] = await db
    .insert(schema.stories)
    .values({
      authorId: user.id,
      expiresAt,
    })
    .returning();

  await db.insert(schema.storyItems).values({
    storyId: story.id,
    mediaUrl,
    type,
    duration: duration.toString(),
    sortOrder: 0,
    stickerType,
    stickerData,
  });

  const createdStory = await db.query.stories.findFirst({
    where: eq(schema.stories.id, story.id),
    with: { author: true, items: { orderBy: asc(schema.storyItems.sortOrder) } },
  });

  return c.json(
    {
      success: true,
      data: { story: createdStory },
    },
    201
  );
});

// POST /v1/stories/:storyId/view - Mark story as viewed
storyRouter.post("/:storyId/view", async (c) => {
  const user = getCurrentUser(c);
  const storyId = c.req.param("storyId");

  const story = await db.query.stories.findFirst({ where: eq(schema.stories.id, storyId) });
  if (!story) {
    throw new HTTPException(404, { message: "Story not found" });
  }

  if (story.expiresAt < new Date()) {
    throw new HTTPException(410, { message: "Story has expired" });
  }

  await db.insert(schema.storyViews).values({ storyId, viewerId: user.id }).onConflictDoNothing();

  return c.status(204);
});

// DELETE /v1/stories/:storyId - Delete story (author only)
storyRouter.delete("/:storyId", async (c) => {
  const user = getCurrentUser(c);
  const storyId = c.req.param("storyId");

  const story = await db.query.stories.findFirst({ where: eq(schema.stories.id, storyId) });
  if (!story) {
    throw new HTTPException(404, { message: "Story not found" });
  }
  if (story.authorId !== user.id) {
    throw new HTTPException(403, { message: "Not authorized to delete this story" });
  }

  await db.delete(schema.stories).where(eq(schema.stories.id, storyId));

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
        storyId: schema.comments.storyId,
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
      .where(and(eq(schema.comments.storyId, storyId), isNull(schema.comments.parentId)))
      .orderBy(desc(schema.comments.createdAt))
      .limit(perPage)
      .offset(offset),
    db.select({ count: count() }).from(schema.comments).where(and(eq(schema.comments.storyId, storyId), isNull(schema.comments.parentId))),
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
storyRouter.post("/:id/comments", zValidator("json", z.object({ text: z.string().min(1).max(1000), parentId: z.string().uuid().optional() })), async (c) => {
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
    if (!parentComment || parentComment.storyId !== storyId) {
      throw new HTTPException(400, { message: "Invalid parent comment" });
    }
  }

  const [comment] = await db
    .insert(schema.comments)
    .values({
      storyId,
      authorId: user.id,
      text,
      parentId,
    })
    .returning();

  // Notify story author (if not self)
  if (story.authorId !== user.id) {
    await db.insert(schema.notifications).values({ recipientId: story.authorId, actorId: user.id, type: "COMMENT", storyId, commentText: text });
  }

  // If replying to a comment, notify parent comment author
  if (parentId) {
    const parentComment = await db.query.comments.findFirst({ where: eq(schema.comments.id, parentId) });
    if (parentComment && parentComment.authorId !== user.id && parentComment.authorId !== story.authorId) {
      await db.insert(schema.notifications).values({ recipientId: parentComment.authorId, actorId: user.id, type: "COMMENT", storyId, commentText: text });
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
    where: and(eq(schema.comments.id, commentId), eq(schema.comments.storyId, storyId)),
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

  // Story comments don't have a commentsCount field on stories table
  // (stories expire after 24h, so comment count isn't tracked the same way)

  return c.status(204);
});

export { storyRouter };