import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware, getCurrentUser } from "../middleware/auth";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, desc, asc, count, sql, inArray, isNull, lt, not } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { createReelService } from "../services/reel-service";

const createReelSchema = z.object({
  videoUrl: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  caption: z.string().max(2200).optional(),
  duration: z.number().positive(),
  audioId: z.string().uuid().optional(),
  audioName: z.string().max(200).optional(),
  audioArtist: z.string().max(200).optional(),
  audioCoverUrl: z.string().url().optional(),
  isOriginalAudio: z.boolean().default(true),
  audience: z.enum(["public", "followers", "close_friends"]).default("public"),
  allowRemix: z.boolean().default(true),
  allowDownload: z.boolean().default(false),
});

const updateReelSchema = z.object({
  caption: z.string().max(2200).optional(),
  audioName: z.string().max(200).optional(),
  audioArtist: z.string().max(200).optional(),
});

const reportReelSchema = z.object({
  reason: z.enum(["SPAM", "HATE_SPEECH", "HARASSMENT", "VIOLENCE", "NUDITY", "SELF_HARM", "MISINFORMATION", "SCAM", "IMPERSONATION", "COPYRIGHT", "OTHER"]),
  description: z.string().max(1000).optional(),
});

const remixReelSchema = z.object({
  videoUrl: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  caption: z.string().max(2200).optional(),
  duration: z.number().positive(),
  remixType: z.enum(["REMIX", "DUET"]),
});

// Cursor-based pagination helper
function getCursorPagination(c: any) {
  const cursor = c.req.query("cursor");
  const perPage = Math.min(Number(c.req.query("perPage")) || 20, 50);
  return { cursor, perPage };
}

const reelRouter = new Hono();
reelRouter.use("*", authMiddleware);

// ============================================================
// FEED ENDPOINTS (BE-091, BE-094)
// ============================================================

// GET /v1/reels/feed - Personalized reels feed (infinite scroll)
reelRouter.get("/feed", async (c) => {
  const user = getCurrentUser(c);
  const { cursor, perPage } = getCursorPagination(c);

  const reelService = createReelService(user.id);
  const result = await reelService.getFeed(cursor, perPage);

  return c.json({
    success: true,
    data: result,
  });
});

// GET /v1/reels/explore - Trending/explore reels
reelRouter.get("/explore", async (c) => {
  const user = getCurrentUser(c);
  const { cursor, perPage } = getCursorPagination(c);

  const reelService = createReelService(user.id);
  const result = await reelService.getExplore(cursor, perPage);

  return c.json({
    success: true,
    data: result,
  });
});

// ============================================================
// USER REELS GRID (BE-092)
// ============================================================

// GET /v1/reels/user/:userId - User's reels grid
reelRouter.get("/user/:userId", async (c) => {
  const user = getCurrentUser(c);
  const targetId = c.req.param("userId");
  const { cursor, perPage } = getCursorPagination(c);

  const reelService = createReelService(user.id);
  const result = await reelService.getUserReels(targetId, cursor, perPage, user.id);

  return c.json({
    success: true,
    data: result,
  });
});

// ============================================================
// SINGLE REEL (BE-095)
// ============================================================

// GET /v1/reels/:id - Single reel with audio info
reelRouter.get("/:id", async (c) => {
  const user = getCurrentUser(c);
  const reelId = c.req.param("id");

  const reelService = createReelService(user.id);
  const reel = await reelService.getReelById(reelId, user.id);

  if (!reel) {
    throw new HTTPException(404, { message: "Reel not found" });
  }

  return c.json({
    success: true,
    data: { reel },
  });
});

// ============================================================
// CREATE/UPDATE/DELETE REEL (BE-093, BE-097)
// ============================================================

// POST /v1/reels - Create reel
reelRouter.post("/", zValidator("json", createReelSchema), async (c) => {
  const user = getCurrentUser(c);
  const input = c.req.valid("json");

  const reelService = createReelService(user.id);
  const reel = await reelService.createReel({
    authorId: user.id,
    ...input,
  });

  return c.json(
    {
      success: true,
      data: { reel },
    },
    201
  );
});

// PATCH /v1/reels/:id - Update reel (caption, audio info)
reelRouter.patch("/:id", zValidator("json", updateReelSchema), async (c) => {
  const user = getCurrentUser(c);
  const reelId = c.req.param("id");
  const input = c.req.valid("json");

  const reelService = createReelService(user.id);
  const reel = await reelService.updateReel(reelId, user.id, input);

  return c.json({
    success: true,
    data: { reel },
  });
});

// DELETE /v1/reels/:id - Delete reel (author only)
reelRouter.delete("/:id", async (c) => {
  const user = getCurrentUser(c);
  const reelId = c.req.param("id");

  const reelService = createReelService(user.id);
  await reelService.deleteReel(reelId, user.id);

  return c.status(204);
});

// ============================================================
// ENGAGEMENT ENDPOINTS (BE-095)
// ============================================================

// POST /v1/reels/:id/like - Like reel
reelRouter.post("/:id/like", async (c) => {
  const user = getCurrentUser(c);
  const reelId = c.req.param("id");

  const reelService = createReelService(user.id);
  await reelService.likeReel(reelId, user.id);

  return c.status(204);
});

// DELETE /v1/reels/:id/like - Unlike reel
reelRouter.delete("/:id/like", async (c) => {
  const user = getCurrentUser(c);
  const reelId = c.req.param("id");

  const reelService = createReelService(user.id);
  await reelService.unlikeReel(reelId, user.id);

  return c.status(204);
});

// POST /v1/reels/:id/save - Save reel
reelRouter.post("/:id/save", async (c) => {
  const user = getCurrentUser(c);
  const reelId = c.req.param("id");
  const collectionId = c.req.query("collectionId");

  const reelService = createReelService(user.id);
  await reelService.saveReel(reelId, user.id, collectionId);

  return c.status(204);
});

// DELETE /v1/reels/:id/save - Unsave reel
reelRouter.delete("/:id/save", async (c) => {
  const user = getCurrentUser(c);
  const reelId = c.req.param("id");

  const reelService = createReelService(user.id);
  await reelService.unsaveReel(reelId, user.id);

  return c.status(204);
});

// POST /v1/reels/:id/share - Share reel to DM
reelRouter.post("/:id/share", zValidator("json", z.object({ conversationId: z.string().uuid() })), async (c) => {
  const user = getCurrentUser(c);
  const reelId = c.req.param("id");
  const { conversationId } = c.req.valid("json");

  const reelService = createReelService(user.id);
  await reelService.shareReel(reelId, user.id, conversationId);

  return c.status(204);
});

// POST /v1/reels/:id/view - Increment view count
reelRouter.post("/:id/view", async (c) => {
  const reelId = c.req.param("id");

  const reelService = createReelService(""); // No user needed for view increment
  await reelService.incrementViews(reelId);

  return c.status(204);
});

// POST /v1/reels/:id/play - Increment play count
reelRouter.post("/:id/play", async (c) => {
  const reelId = c.req.param("id");

  const reelService = createReelService("");
  await reelService.incrementPlays(reelId);

  return c.status(204);
});

// GET /v1/reels/:id/likes - Get users who liked a reel
reelRouter.get("/:id/likes", async (c) => {
  const user = getCurrentUser(c);
  const reelId = c.req.param("id");
  const { cursor, perPage } = getCursorPagination(c);

  const reelService = createReelService(user.id);
  const result = await reelService.getReelLikes(reelId, user.id, cursor, perPage);

  return c.json({
    success: true,
    data: result,
  });
});

// ============================================================
// REEL COMMENTS (BE-096 - reuse comment system)
// ============================================================

// GET /v1/reels/:reelId/comments - Reel comments
reelRouter.get("/:reelId/comments", async (c) => {
  const user = getCurrentUser(c);
  const reelId = c.req.param("reelId");
  const { cursor, perPage } = getCursorPagination(c);

  const whereConditions = [
    eq(schema.comments.commentableType, "REEL"),
    eq(schema.comments.commentableId, reelId),
    isNull(schema.comments.parentId),
  ];

  if (cursor) {
    whereConditions.push(lt(schema.comments.createdAt, new Date(cursor)));
  }

  const [commentsList, total] = await Promise.all([
    db.select({
      id: schema.comments.id,
      commentableType: schema.comments.commentableType,
      commentableId: schema.comments.commentableId,
      authorId: schema.comments.authorId,
      text: schema.comments.text,
      parentId: schema.comments.parentId,
      likesCount: schema.comments.likesCount,
      repliesCount: schema.comments.repliesCount,
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
      .where(and(...whereConditions))
      .limit(perPage + 1)
      .orderBy(desc(schema.comments.createdAt)),
    db.select({ count: count() })
      .from(schema.comments)
      .where(and(
        eq(schema.comments.commentableType, "REEL"),
        eq(schema.comments.commentableId, reelId),
        isNull(schema.comments.parentId)
      )),
  ]);

  const hasMore = commentsList.length > perPage;
  const items = hasMore ? commentsList.slice(0, perPage) : commentsList;
  const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null;

  // Check if current user liked each comment
  const commentIds = items.map((cm) => cm.id);
  let likedSet = new Set<string>();
  if (commentIds.length > 0) {
    const likes = await db.select({ commentId: schema.likes.likeableId })
      .from(schema.likes)
      .where(and(
        eq(schema.likes.userId, user.id),
        eq(schema.likes.likeableType, "COMMENT"),
        inArray(schema.likes.likeableId, commentIds)
      ));
    likedSet = new Set(likes.map((l) => l.commentId));
  }

  return c.json({
    success: true,
    data: {
      items: items.map(cm => ({
        ...cm,
        isLiked: likedSet.has(cm.id),
      })),
      nextCursor,
      hasMore,
      total: total[0]?.count || 0,
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
    if (!parentComment || parentComment.commentableId !== reelId || parentComment.commentableType !== "REEL") {
      throw new HTTPException(400, { message: "Invalid parent comment" });
    }
  }

  const [comment] = await db
    .insert(schema.comments)
    .values({
      commentableType: "REEL",
      commentableId: reelId,
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
      type: "REEL_COMMENT",
      referenceType: "reel",
      referenceId: reelId,
      previewText: text.substring(0, 100),
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

// DELETE /v1/reels/:reelId/comments/:commentId - Delete reel comment
reelRouter.delete("/:reelId/comments/:commentId", async (c) => {
  const user = getCurrentUser(c);
  const reelId = c.req.param("reelId");
  const commentId = c.req.param("commentId");

  const comment = await db.query.comments.findFirst({
    where: and(eq(schema.comments.id, commentId), eq(schema.comments.commentableId, reelId), eq(schema.comments.commentableType, "REEL")),
  });
  if (!comment) throw new HTTPException(404, { message: "Comment not found" });

  // Only comment author or reel author can delete
  if (comment.authorId !== user.id) {
    const reel = await db.query.reels.findFirst({ where: eq(schema.reels.id, reelId), columns: { authorId: true } });
    if (!reel || reel.authorId !== user.id) {
      throw new HTTPException(403, { message: "Not authorized to delete this comment" });
    }
  }

  await db.delete(schema.comments).where(eq(schema.comments.id, commentId));

  // Decrement comments count on reel
  await db.update(schema.reels).set({ commentsCount: sql`${schema.reels.commentsCount} - 1` }).where(eq(schema.reels.id, reelId));

  return c.status(204);
});

// ============================================================
// REEL REPORTING (BE-097)
// ============================================================

// POST /v1/reels/:id/report - Report reel
reelRouter.post("/:id/report", zValidator("json", reportReelSchema), async (c) => {
  const user = getCurrentUser(c);
  const reelId = c.req.param("id");
  const { reason, description } = c.req.valid("json");

  const reelService = createReelService(user.id);
  await reelService.reportReel(reelId, user.id, reason, description);

  return c.status(204);
});

// ============================================================
// REEL REMIX/DUET (BE-098 - Future)
// ============================================================

// POST /v1/reels/:id/remix - Create remix/duet
reelRouter.post("/:id/remix", zValidator("json", remixReelSchema), async (c) => {
  const user = getCurrentUser(c);
  const originalReelId = c.req.param("id");
  const input = c.req.valid("json");

  const reelService = createReelService(user.id);
  const reel = await reelService.createRemix({
    authorId: user.id,
    originalReelId,
    ...input,
  });

  return c.json(
    {
      success: true,
      data: { reel },
    },
    201
  );
});

// ============================================================
// AUDIO MANAGEMENT ENDPOINTS (BE-094)
// ============================================================

// GET /v1/reels/audio/:audioId - Get audio track
reelRouter.get("/audio/:audioId", async (c) => {
  const user = getCurrentUser(c);
  const audioId = c.req.param("audioId");

  const reelService = createReelService(user.id);
  const audio = await reelService.getAudioTrack(audioId);

  if (!audio) {
    throw new HTTPException(404, { message: "Audio track not found" });
  }

  return c.json({
    success: true,
    data: { audio },
  });
});

// GET /v1/reels/audio/search - Search audio tracks
reelRouter.get("/audio/search", async (c) => {
  const user = getCurrentUser(c);
  const query = c.req.query("q");
  const { cursor, perPage } = getCursorPagination(c);

  if (!query || query.length < 2) {
    throw new HTTPException(400, { message: "Query must be at least 2 characters" });
  }

  const reelService = createReelService(user.id);
  const result = await reelService.searchAudioTracks(query, cursor, perPage);

  return c.json({
    success: true,
    data: result,
  });
});

// GET /v1/reels/audio/trending - Get trending audio tracks
reelRouter.get("/audio/trending", async (c) => {
  const user = getCurrentUser(c);
  const { cursor, perPage } = getCursorPagination(c);

  const reelService = createReelService(user.id);
  const result = await reelService.getTrendingAudio(cursor, perPage);

  return c.json({
    success: true,
    data: result,
  });
});

// POST /v1/reels/audio/:audioId/save - Save audio track
reelRouter.post("/audio/:audioId/save", async (c) => {
  const user = getCurrentUser(c);
  const audioId = c.req.param("audioId");

  const reelService = createReelService(user.id);
  await reelService.saveAudio(audioId, user.id);

  return c.status(204);
});

// DELETE /v1/reels/audio/:audioId/save - Unsave audio track
reelRouter.delete("/audio/:audioId/save", async (c) => {
  const user = getCurrentUser(c);
  const audioId = c.req.param("audioId");

  const reelService = createReelService(user.id);
  await reelService.unsaveAudio(audioId, user.id);

  return c.status(204);
});

// GET /v1/reels/audio/saved - Get user's saved audio tracks
reelRouter.get("/audio/saved", async (c) => {
  const user = getCurrentUser(c);
  const { cursor, perPage } = getCursorPagination(c);

  const reelService = createReelService(user.id);
  const result = await reelService.getSavedAudio(user.id, cursor, perPage);

  return c.json({
    success: true,
    data: result,
  });
});

// GET /v1/reels/audio/:audioId/reels - Get reels using this audio
reelRouter.get("/audio/:audioId/reels", async (c) => {
  const user = getCurrentUser(c);
  const audioId = c.req.param("audioId");
  const { cursor, perPage } = getCursorPagination(c);

  const reelService = createReelService(user.id);
  const result = await reelService.getReelsByAudio(audioId, cursor, perPage);

  return c.json({
    success: true,
    data: result,
  });
});

export { reelRouter };