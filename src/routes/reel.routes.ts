import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware, getCurrentUser } from "../middleware/auth";
import { db } from "../index";
import * as schema from "../db/schema";
import { eq, and, desc, asc, count, sql, inArray, isNull, lt } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

const createReelSchema = z.object({
  videoUrl: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  caption: z.string().max(2200).optional(),
  duration: z.number().positive(),
  audioName: z.string().max(200).optional(),
  audioArtist: z.string().max(200).optional(),
  audioCoverUrl: z.string().url().optional(),
  isOriginalAudio: z.boolean().default(true),
});

const updateReelSchema = z.object({
  caption: z.string().max(2200).optional(),
  audioName: z.string().max(200).optional(),
  audioArtist: z.string().max(200).optional(),
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

const reelRouter = new Hono();
reelRouter.use("*", authMiddleware);

// GET /v1/reels/feed - Reels feed (popular reels)
reelRouter.get("/feed", async (c) => {
  const user = getCurrentUser(c);
  const { cursor, perPage } = getCursorPagination(c);

  const blocked = await db.select({ blockedId: schema.blocks.blockedId }).from(schema.blocks).where(eq(schema.blocks.blockerId, user.id));
  const blockedIds = blocked.map((b) => b.blockedId);

  const whereConditions = [
    sql`${schema.reels.authorId} NOT IN (${blockedIds.length > 0 ? blockedIds : sql`SELECT 1 WHERE FALSE`})`,
  ];

  if (cursor) {
    whereConditions.push(lt(schema.reels.createdAt, new Date(cursor)));
  }

  const reelsList = await db
    .select({
      id: schema.reels.id,
      authorId: schema.reels.authorId,
      videoUrl: schema.reels.videoUrl,
      thumbnailUrl: schema.reels.thumbnailUrl,
      caption: schema.reels.caption,
      audioName: schema.reels.audioName,
      audioArtist: schema.reels.audioArtist,
      audioCoverUrl: schema.reels.audioCoverUrl,
      isOriginalAudio: schema.reels.isOriginalAudio,
      duration: schema.reels.duration,
      likesCount: schema.reels.likesCount,
      commentsCount: schema.reels.commentsCount,
      sharesCount: schema.reels.sharesCount,
      viewsCount: schema.reels.viewsCount,
      createdAt: schema.reels.createdAt,
      author: {
        id: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
      },
    })
    .from(schema.reels)
    .innerJoin(schema.users, eq(schema.users.id, schema.reels.authorId))
    .where(and(...whereConditions))
    .limit(perPage + 1)
    .orderBy(desc(schema.reels.viewsCount), desc(schema.reels.createdAt));

  const hasMore = reelsList.length > perPage;
  const items = hasMore ? reelsList.slice(0, perPage) : reelsList;
  const nextCursor = hasMore ? items[items.length - 1].createdAt : null;

  const reelIds = items.map((r) => r.id);
  const [likes, saves] = await Promise.all([
    reelIds.length > 0
      ? db.select({ reelId: schema.likes.reelId }).from(schema.likes).where(and(eq(schema.likes.userId, user.id), inArray(schema.likes.reelId, reelIds)))
      : Promise.resolve([]),
    reelIds.length > 0
      ? db.select({ reelId: schema.savedReels.reelId }).from(schema.savedReels).where(and(eq(schema.savedReels.userId, user.id), inArray(schema.savedReels.reelId, reelIds)))
      : Promise.resolve([]),
  ]);
  const likedSet = new Set(likes.map((l) => l.reelId));
  const savedSet = new Set(saves.map((s) => s.reelId));

  return c.json({
    success: true,
    data: {
      items: items.map((r) => ({
        ...r,
        author: { ...r.author, isFollowing: false },
        isLiked: likedSet.has(r.id),
        isSaved: savedSet.has(r.id),
      })),
      nextCursor,
      hasMore,
    },
  });
});

// GET /v1/reels/user/:userId - User's reels grid
reelRouter.get("/user/:userId", async (c) => {
  const user = getCurrentUser(c);
  const targetId = c.req.param("userId");
  const { page, perPage, offset } = getPagination(c);

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

  const [reelsList, total] = await Promise.all([
    db.select({
      id: schema.reels.id,
      authorId: schema.reels.authorId,
      videoUrl: schema.reels.videoUrl,
      thumbnailUrl: schema.reels.thumbnailUrl,
      caption: schema.reels.caption,
      audioName: schema.reels.audioName,
      audioArtist: schema.reels.audioArtist,
      audioCoverUrl: schema.reels.audioCoverUrl,
      isOriginalAudio: schema.reels.isOriginalAudio,
      duration: schema.reels.duration,
      likesCount: schema.reels.likesCount,
      commentsCount: schema.reels.commentsCount,
      sharesCount: schema.reels.sharesCount,
      viewsCount: schema.reels.viewsCount,
      createdAt: schema.reels.createdAt,
      author: {
        id: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
      },
    })
      .from(schema.reels)
      .innerJoin(schema.users, eq(schema.users.id, schema.reels.authorId))
      .where(eq(schema.reels.authorId, targetId))
      .limit(perPage)
      .offset(offset)
      .orderBy(desc(schema.reels.createdAt)),
    db.select({ count: count() }).from(schema.reels).where(eq(schema.reels.authorId, targetId)),
  ]);

  return c.json({
    success: true,
    data: {
      items: reelsList.map((r) => ({
        ...r,
        author: { ...r.author, isFollowing: targetId !== user.id },
        isLiked: false,
        isSaved: false,
      })),
      page,
      perPage,
      total: total[0]?.count || 0,
      hasMore: page * perPage < (total[0]?.count || 0),
    },
  });
});

// POST /v1/reels - Create reel
reelRouter.post("/", zValidator("json", createReelSchema), async (c) => {
  const user = getCurrentUser(c);
  const { videoUrl, thumbnailUrl, caption, duration, audioName, audioArtist, audioCoverUrl, isOriginalAudio } = c.req.valid("json");

  const [reel] = await db
    .insert(schema.reels)
    .values({
      authorId: user.id,
      videoUrl,
      thumbnailUrl,
      caption,
      duration: duration.toString(),
      audioName,
      audioArtist,
      audioCoverUrl,
      isOriginalAudio,
    })
    .returning();

  await db.update(schema.users).set({ postsCount: sql`${schema.users.postsCount} + 1` }).where(eq(schema.users.id, user.id));

  const createdReel = await db.query.reels.findFirst({
    where: eq(schema.reels.id, reel.id),
    with: { author: true },
  });

  return c.json(
    {
      success: true,
      data: {
        reel: {
          ...createdReel!,
          author: { ...createdReel!.author, isFollowing: false },
          isLiked: false,
          isSaved: false,
        },
      },
    },
    201
  );
});

// POST /v1/reels/:id/like - Like reel
reelRouter.post("/:id/like", async (c) => {
  const user = getCurrentUser(c);
  const reelId = c.req.param("id");

  const reel = await db.query.reels.findFirst({
    where: eq(schema.reels.id, reelId),
  });

  if (!reel) {
    throw new HTTPException(404, { message: "Reel not found" });
  }

  const existing = await db.query.likes.findFirst({
    where: and(eq(schema.likes.userId, user.id), eq(schema.likes.reelId, reelId)),
  });

  if (existing) {
    throw new HTTPException(409, { message: "Already liked this reel" });
  }

  await db.insert(schema.likes).values({ userId: user.id, reelId });
  await db.update(schema.reels).set({ likesCount: sql`${schema.reels.likesCount} + 1` }).where(eq(schema.reels.id, reelId));

  if (reel.authorId !== user.id) {
    await db.insert(schema.notifications).values({
      recipientId: reel.authorId,
      actorId: user.id,
      type: "LIKE",
      reelId,
    });
  }

  return c.status(204);
});

// DELETE /v1/reels/:id/like - Unlike reel
reelRouter.delete("/:id/like", async (c) => {
  const user = getCurrentUser(c);
  const reelId = c.req.param("id");

  const result = await db
    .delete(schema.likes)
    .where(and(eq(schema.likes.userId, user.id), eq(schema.likes.reelId, reelId)))
    .returning({ id: schema.likes.id });

  if (result.length === 0) {
    throw new HTTPException(404, { message: "Not liked this reel" });
  }

  await db.update(schema.reels).set({ likesCount: sql`${schema.reels.likesCount} - 1` }).where(eq(schema.reels.id, reelId));

  return c.status(204);
});

// POST /v1/reels/:id/save - Save reel
reelRouter.post("/:id/save", async (c) => {
  const user = getCurrentUser(c);
  const reelId = c.req.param("id");

  const reel = await db.query.reels.findFirst({ where: eq(schema.reels.id, reelId) });
  if (!reel) {
    throw new HTTPException(404, { message: "Reel not found" });
  }

  await db.insert(schema.savedReels).values({ userId: user.id, reelId }).onConflictDoNothing();

  return c.status(204);
});

// DELETE /v1/reels/:id/save - Unsave reel
reelRouter.delete("/:id/save", async (c) => {
  const user = getCurrentUser(c);
  const reelId = c.req.param("id");

  await db.delete(schema.savedReels).where(and(eq(schema.savedReels.userId, user.id), eq(schema.savedReels.reelId, reelId)));

  return c.status(204);
});

// DELETE /v1/reels/:id - Delete reel (author only)
reelRouter.delete("/:id", async (c) => {
  const user = getCurrentUser(c);
  const reelId = c.req.param("id");

  const reel = await db.query.reels.findFirst({ where: eq(schema.reels.id, reelId) });
  if (!reel) {
    throw new HTTPException(404, { message: "Reel not found" });
  }
  if (reel.authorId !== user.id) {
    throw new HTTPException(403, { message: "Not authorized to delete this reel" });
  }

  await db.delete(schema.reels).where(eq(schema.reels.id, reelId));
  await db.update(schema.users).set({ postsCount: sql`${schema.users.postsCount} - 1` }).where(eq(schema.users.id, user.id));

  return c.status(204);
});

// POST /v1/reels/:id/view - Increment view count
reelRouter.post("/:id/view", async (c) => {
  const reelId = c.req.param("id");

  await db.update(schema.reels).set({ viewsCount: sql`${schema.reels.viewsCount} + 1` }).where(eq(schema.reels.id, reelId));

  return c.status(204);
});

// GET /v1/reels/:reelId/comments - Reel comments
reelRouter.get("/:reelId/comments", async (c) => {
  const user = getCurrentUser(c);
  const reelId = c.req.param("reelId");
  const { page, perPage, offset } = getPagination(c);

  const [commentsList, total] = await Promise.all([
    db.select({
      id: schema.comments.id,
      reelId: schema.comments.reelId,
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
      .where(and(eq(schema.comments.reelId, reelId), isNull(schema.comments.parentId)))
      .limit(perPage)
      .offset(offset)
      .orderBy(desc(schema.comments.createdAt)),
    db.select({ count: count() }).from(schema.comments).where(and(eq(schema.comments.reelId, reelId), isNull(schema.comments.parentId))),
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

// POST /v1/reels/:reelId/comments - Add reel comment
reelRouter.post("/:reelId/comments", zValidator("json", z.object({ text: z.string().min(1).max(1000), parentId: z.string().uuid().optional() })), async (c) => {
  const user = getCurrentUser(c);
  const reelId = c.req.param("reelId");
  const { text, parentId } = c.req.valid("json");

  const reel = await db.query.reels.findFirst({ where: eq(schema.reels.id, reelId) });
  if (!reel) {
    throw new HTTPException(404, { message: "Reel not found" });
  }

  if (parentId) {
    const parentComment = await db.query.comments.findFirst({ where: eq(schema.comments.id, parentId) });
    if (!parentComment || parentComment.reelId !== reelId) {
      throw new HTTPException(400, { message: "Invalid parent comment" });
    }
  }

  const [comment] = await db
    .insert(schema.comments)
    .values({
      reelId,
      authorId: user.id,
      text,
      parentId,
    })
    .returning();

  await db.update(schema.reels).set({ commentsCount: sql`${schema.reels.commentsCount} + 1` }).where(eq(schema.reels.id, reelId));

  if (reel.authorId !== user.id) {
    await db.insert(schema.notifications).values({
      recipientId: reel.authorId,
      actorId: user.id,
      type: "COMMENT",
      reelId,
      commentText: text,
    });
  }

  const createdComment = await db.query.comments.findFirst({
    where: eq(schema.comments.id, comment.id),
    with: { author: true },
  });

  return c.json(
    {
      success: true,
      data: { comment: createdComment },
    },
    201
  );
});

export { reelRouter };