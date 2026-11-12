import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware, getCurrentUser } from "../middleware/auth";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, desc, asc, count, sql, inArray, lt, gt, not, isNull, or, gte, exists } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { createFeedService, FeedService } from "../services/feed-service";
import { createExploreService } from "../services/explore-service";
import {
  getComments,
  getReplies,
  createComment,
  updateComment,
  deleteComment,
  likeComment,
  unlikeComment,
  reportComment,
} from "../services/comment-service";

// ============================================================================
// Validation Schemas
// ============================================================================

const createPostSchema = z.object({
  caption: z.string().max(2200).optional(),
  locationName: z.string().max(200).optional(),
  locationLat: z.number().optional(),
  locationLng: z.number().optional(),
  audience: z.enum(["PUBLIC", "FOLLOWERS", "CLOSE_FRIENDS"]).default("PUBLIC"),
  closeFriendsOnly: z.boolean().default(false),
  media: z.array(
    z.object({
      url: z.string().url(),
      type: z.enum(["IMAGE", "VIDEO", "CAROUSEL", "AUDIO"]),
      width: z.number().optional(),
      height: z.number().optional(),
      duration: z.number().optional(),
      sortOrder: z.number().optional(),
      pendingUploadId: z.string().uuid().optional(),
    })
  ).min(1).max(10),
});

function toDecimalString(num?: number): string | undefined {
  return num !== undefined ? num.toString() : undefined;
}

const updatePostSchema = z.object({
  caption: z.string().max(2200).optional(),
  locationName: z.string().max(200).optional(),
  locationLat: z.number().optional(),
  locationLng: z.number().optional(),
  audience: z.enum(["PUBLIC", "FOLLOWERS", "CLOSE_FRIENDS"]).optional(),
  closeFriendsOnly: z.boolean().optional(),
});

const commentSchema = z.object({
  text: z.string().min(1).max(1000),
  parentId: z.string().uuid().optional(),
});

const reportSchema = z.object({
  reason: z.enum([
    "SPAM", "HATE_SPEECH", "HARASSMENT", "VIOLENCE", "NUDITY",
    "SELF_HARM", "MISINFORMATION", "SCAM", "IMPERSONATION", "COPYRIGHT", "OTHER"
  ]),
  description: z.string().optional(),
});

// ============================================================================
// Helpers
// ============================================================================

function getCursorPagination(c: any) {
  const cursor = c.req.query("cursor");
  const perPage = Math.min(Number(c.req.query("perPage")) || 20, 50);
  return { cursor, perPage };
}

function getPagination(c: any) {
  const page = Number(c.req.query("page")) || 1;
  const perPage = Math.min(Number(c.req.query("perPage")) || 20, 50);
  return { page, perPage, offset: (page - 1) * perPage };
}

// ============================================================================
// Router Setup
// ============================================================================

const postRouter = new Hono();
postRouter.use("*", authMiddleware);

// ============================================================
// FEED ENDPOINTS (using FeedService with ranking algorithm)
// ============================================================

postRouter.get("/feed", async (c) => {
  const user = getCurrentUser(c);
  const { cursor, perPage } = getCursorPagination(c);

  const feedService = createFeedService(user.id);
  const result = await feedService.getFeed(cursor, perPage);

  return c.json({
    success: true,
    data: {
      items: result.items.map((item) => ({
        id: item.postId,
        authorId: item.authorId,
        caption: item.caption,
        locationName: item.locationName,
        locationLat: item.locationLat,
        locationLng: item.locationLng,
        likesCount: item.likesCount,
        commentsCount: item.commentsCount,
        sharesCount: item.sharesCount,
        savesCount: item.savesCount,
        viewsCount: item.viewsCount,
        isSponsored: item.isSponsored,
        sponsorUserId: item.sponsorUserId,
        audience: item.audience,
        closeFriendsOnly: item.closeFriendsOnly,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        author: {
          id: item.authorId,
          username: item.username,
          fullName: item.fullName,
          avatarUrl: item.avatarUrl,
          isVerified: item.isVerified,
          isPrivate: item.isPrivate,
        },
        mediaItems: item.mediaUrl ? [{
          id: item.postId,
          url: item.mediaUrl,
          thumbnailUrl: item.thumbnailUrl,
          type: item.mediaType,
          width: item.width,
          height: item.height,
          duration: item.duration ? parseFloat(item.duration) : null,
          sortOrder: item.sortOrder,
        }] : [],
        isLiked: false,
        isSaved: false,
      })),
      nextCursor: result.nextCursor ? feedService.getCursorString(result.nextCursor) : null,
      hasMore: result.hasMore,
    },
  });
});

// ============================================================
// EXPLORE ENDPOINT (using ExploreService)
// ============================================================

postRouter.get("/explore", async (c) => {
  const user = getCurrentUser(c);
  const { cursor, perPage } = getCursorPagination(c);

  const exploreService = createExploreService(user.id);
  const result = await exploreService.getExploreFeed(cursor, perPage);

  return c.json({
    success: true,
    data: {
      items: result.items.map((item) => ({
        id: item.postId,
        authorId: item.authorId,
        caption: item.caption,
        locationName: item.locationName,
        locationLat: item.locationLat,
        locationLng: item.locationLng,
        likesCount: item.likesCount,
        commentsCount: item.commentsCount,
        sharesCount: item.sharesCount,
        savesCount: item.savesCount,
        viewsCount: item.viewsCount,
        isSponsored: item.isSponsored,
        sponsorUserId: item.sponsorUserId,
        audience: item.audience,
        closeFriendsOnly: item.closeFriendsOnly,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        author: {
          id: item.authorId,
          username: item.username,
          fullName: item.fullName,
          avatarUrl: item.avatarUrl,
          isVerified: item.isVerified,
          isPrivate: item.isPrivate,
        },
        mediaItems: item.mediaUrl ? [{
          id: item.postId,
          url: item.mediaUrl,
          thumbnailUrl: item.thumbnailUrl,
          type: item.mediaType,
          width: item.width,
          height: item.height,
          duration: item.duration ? parseFloat(item.duration) : null,
          sortOrder: item.sortOrder,
        }] : [],
        isLiked: false,
        isSaved: false,
        exploreSource: item.source,
        exploreReason: item.reason,
      })),
      nextCursor: result.nextCursor ? exploreService.getCursorString(result.nextCursor) : null,
      hasMore: result.hasMore,
      sections: result.sections,
    },
  });
});

// Explore sections endpoint for grid layout
postRouter.get("/explore/sections", async (c) => {
  const user = getCurrentUser(c);
  const exploreService = createExploreService(user.id);
  const sections = await exploreService.getExploreSections();

  return c.json({
    success: true,
    data: { sections },
  });
});

// ============================================================
// SAVED POSTS FEED
// ============================================================

postRouter.get("/saved", async (c) => {
  const user = getCurrentUser(c);
  const { cursor, perPage } = getCursorPagination(c);

  const whereConditions = [eq(schema.savedItems.userId, user.id)];
  if (cursor) {
    whereConditions.push(lt(schema.savedItems.createdAt, new Date(cursor)));
  }

  const postsList = await db
    .select({
      id: schema.posts.id,
      authorId: schema.posts.authorId,
      caption: schema.posts.caption,
      locationName: schema.posts.locationName,
      locationLat: schema.posts.locationLat,
      locationLng: schema.posts.locationLng,
      likesCount: schema.posts.likesCount,
      commentsCount: schema.posts.commentsCount,
      sharesCount: schema.posts.sharesCount,
      savesCount: schema.posts.savesCount,
      viewsCount: schema.posts.viewsCount,
      isSponsored: schema.posts.isSponsored,
      sponsorUserId: schema.posts.sponsorUserId,
      audience: schema.posts.audience,
      closeFriendsOnly: schema.posts.closeFriendsOnly,
      createdAt: schema.posts.createdAt,
      updatedAt: schema.posts.updatedAt,
      author: {
        id: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
      },
      mediaItems: sql`(SELECT json_agg(json_build_object('id', mi.id, 'url', mi.url, 'thumbnailUrl', mi.thumbnail_url, 'type', mi.type, 'width', mi.width, 'height', mi.height, 'duration', mi.duration, 'sortOrder', mi.sort_order) ORDER BY mi.sort_order) FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id)`,
      savedAt: schema.savedItems.createdAt,
    })
    .from(schema.savedItems)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.savedItems.saveableId))
    .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
    .where(and(...whereConditions))
    .limit(perPage + 1)
    .orderBy(desc(schema.savedItems.createdAt));

  const hasMore = postsList.length > perPage;
  const items = hasMore ? postsList.slice(0, perPage) : postsList;
  const nextCursor = hasMore ? items[items.length - 1].savedAt.toISOString() : null;

  const postIds = items.map((p) => p.id);
  const [likes, saves] = await Promise.all([
    postIds.length > 0 ? db.select({ likeableId: schema.likes.likeableId }).from(schema.likes).where(and(eq(schema.likes.userId, user.id), eq(schema.likes.likeableType, "POST"), inArray(schema.likes.likeableId, postIds))) : Promise.resolve([]),
    postIds.length > 0 ? db.select({ saveableId: schema.savedItems.saveableId }).from(schema.savedItems).where(and(eq(schema.savedItems.userId, user.id), eq(schema.savedItems.saveableType, "POST"), inArray(schema.savedItems.saveableId, postIds))) : Promise.resolve([]),
  ]);
  const likedSet = new Set(likes.map((l) => l.likeableId));
  const savedSet = new Set(saves.map((s) => s.saveableId));

  return c.json({
    success: true,
    data: {
      items: items.map((p) => ({
        ...p,
        author: { ...p.author, isFollowing: false },
        mediaItems: p.mediaItems || [],
        isLiked: likedSet.has(p.id),
        isSaved: true,
      })),
      nextCursor,
      hasMore,
    },
  });
});

// ============================================================
// USER POSTS GRID (with private account checks)
// ============================================================

postRouter.get("/user/:userId", async (c) => {
  const user = getCurrentUser(c);
  const targetId = c.req.param("userId");
  const { cursor, perPage } = getCursorPagination(c);

  const targetUser = await db.query.users.findFirst({
    where: eq(schema.users.id, targetId),
    columns: { id: true, isPrivate: true, username: true }
  });

  if (!targetUser) throw new HTTPException(404, { message: "User not found" });

  // Check private account access
  if (targetUser.isPrivate && targetId !== user.id) {
    const following = await db.query.follows.findFirst({
      where: and(
        eq(schema.follows.followerId, user.id),
        eq(schema.follows.followingId, targetId),
        eq(schema.follows.status, "ACCEPTED")
      )
    });
    if (!following) throw new HTTPException(403, { message: "This account is private" });
  }

  const whereConditions = [
    eq(schema.posts.authorId, targetId),
    isNull(schema.posts.deletedAt),
    isNull(schema.posts.archivedAt),
  ];

  if (cursor) {
    whereConditions.push(lt(schema.posts.createdAt, new Date(cursor)));
  }

  const postsList = await db
    .select({
      id: schema.posts.id,
      authorId: schema.posts.authorId,
      caption: schema.posts.caption,
      locationName: schema.posts.locationName,
      locationLat: schema.posts.locationLat,
      locationLng: schema.posts.locationLng,
      likesCount: schema.posts.likesCount,
      commentsCount: schema.posts.commentsCount,
      sharesCount: schema.posts.sharesCount,
      savesCount: schema.posts.savesCount,
      viewsCount: schema.posts.viewsCount,
      isSponsored: schema.posts.isSponsored,
      sponsorUserId: schema.posts.sponsorUserId,
      audience: schema.posts.audience,
      closeFriendsOnly: schema.posts.closeFriendsOnly,
      createdAt: schema.posts.createdAt,
      updatedAt: schema.posts.updatedAt,
      author: {
        id: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
      },
      mediaItems: sql`(SELECT json_agg(json_build_object('id', mi.id, 'url', mi.url, 'thumbnailUrl', mi.thumbnail_url, 'type', mi.type, 'width', mi.width, 'height', mi.height, 'duration', mi.duration, 'sortOrder', mi.sort_order) ORDER BY mi.sort_order) FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id)`,
    })
    .from(schema.posts)
    .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
    .where(and(...whereConditions))
    .limit(perPage + 1)
    .orderBy(desc(schema.posts.createdAt));

  const hasMore = postsList.length > perPage;
  const items = hasMore ? postsList.slice(0, perPage) : postsList;
  const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null;

  const postIds = items.map((p) => p.id);
  const [likes, saves] = await Promise.all([
    postIds.length > 0 ? db.select({ likeableId: schema.likes.likeableId }).from(schema.likes).where(and(eq(schema.likes.userId, user.id), eq(schema.likes.likeableType, "POST"), inArray(schema.likes.likeableId, postIds))) : Promise.resolve([]),
    postIds.length > 0 ? db.select({ saveableId: schema.savedItems.saveableId }).from(schema.savedItems).where(and(eq(schema.savedItems.userId, user.id), eq(schema.savedItems.saveableType, "POST"), inArray(schema.savedItems.saveableId, postIds))) : Promise.resolve([]),
  ]);
  const likedSet = new Set(likes.map((l) => l.likeableId));
  const savedSet = new Set(saves.map((s) => s.saveableId));

  const isFollowing = targetId !== user.id && await db.query.follows.findFirst({
    where: and(
      eq(schema.follows.followerId, user.id),
      eq(schema.follows.followingId, targetId),
      eq(schema.follows.status, "ACCEPTED")
    )
  });

  return c.json({
    success: true,
    data: {
      items: items.map((p) => ({
        ...p,
        author: { ...p.author, isFollowing: !!isFollowing },
        mediaItems: p.mediaItems || [],
        isLiked: likedSet.has(p.id),
        isSaved: savedSet.has(p.id),
      })),
      nextCursor,
      hasMore,
      user: {
        id: targetUser.id,
        username: targetUser.username,
        isPrivate: targetUser.isPrivate,
      },
    },
  });
});

// ============================================================
// SINGLE POST
// ============================================================

postRouter.get("/:id", async (c) => {
  const user = getCurrentUser(c);
  const postId = c.req.param("id");

  const post = await db.query.posts.findFirst({
    where: eq(schema.posts.id, postId),
    with: {
      author: true,
    },
  });

  if (!post) throw new HTTPException(404, { message: "Post not found" });

  if (post.author.isPrivate && post.authorId !== user.id) {
    const following = await db.query.follows.findFirst({
      where: and(
        eq(schema.follows.followerId, user.id),
        eq(schema.follows.followingId, post.authorId),
        eq(schema.follows.status, "ACCEPTED")
      )
    });
    if (!following) throw new HTTPException(403, { message: "This account is private" });
  }

  const [like, save, mediaItems] = await Promise.all([
    db.query.likes.findFirst({ where: and(eq(schema.likes.userId, user.id), eq(schema.likes.likeableType, "POST"), eq(schema.likes.likeableId, postId)) }),
    db.query.savedItems.findFirst({ where: and(eq(schema.savedItems.userId, user.id), eq(schema.savedItems.saveableType, "POST"), eq(schema.savedItems.saveableId, postId)) }),
    db.query.mediaItems.findMany({
      where: and(
        eq(schema.mediaItems.mediaableType, "post"),
        eq(schema.mediaItems.mediaableId, postId)
      ),
      orderBy: asc(schema.mediaItems.sortOrder),
    }),
  ]);

  return c.json({
    success: true,
    data: {
      post: {
        ...post,
        mediaItems,
        author: { ...post.author, isFollowing: post.authorId !== user.id },
        isLiked: !!like,
        isSaved: !!save,
      },
    },
  });
});

// ============================================================
// POST CRUD
// ============================================================

postRouter.post("/", zValidator("json", createPostSchema), async (c) => {
  const user = getCurrentUser(c);
  const { caption, locationName, locationLat, locationLng, audience, closeFriendsOnly, media } = c.req.valid("json");

  const [post] = await db.insert(schema.posts).values({
    authorId: user.id,
    caption,
    locationName,
    locationLat: toDecimalString(locationLat),
    locationLng: toDecimalString(locationLng),
    audience: audience || "PUBLIC",
    closeFriendsOnly: closeFriendsOnly || false,
  }).returning();

  if (media.length > 0) {
    await db.insert(schema.mediaItems).values(media.map((m, index) => ({
      mediaableType: "post",
      mediaableId: post.id,
      url: m.url,
      thumbnailUrl: m.url,
      type: m.type,
      width: m.width,
      height: m.height,
      duration: toDecimalString(m.duration),
      sortOrder: m.sortOrder ?? index,
    })));
  }

  await db.update(schema.users)
    .set({ postsCount: sql`${schema.users.postsCount} + 1` })
    .where(eq(schema.users.id, user.id));

  const pendingUploadIds = media.filter((m) => m.pendingUploadId).map((m) => m.pendingUploadId!);
  if (pendingUploadIds.length > 0) {
    await db.update(schema.pendingUploads)
      .set({ confirmed: true })
      .where(inArray(schema.pendingUploads.id, pendingUploadIds));
  }

  // Invalidate feed for followers (new post)
  await FeedService.invalidateFollowersFeed(user.id, post.id);

  const [createdPost, mediaItems] = await Promise.all([
    db.query.posts.findFirst({
      where: eq(schema.posts.id, post.id),
      with: { author: true },
    }),
    db.query.mediaItems.findMany({
      where: and(
        eq(schema.mediaItems.mediaableType, "post"),
        eq(schema.mediaItems.mediaableId, post.id)
      ),
      orderBy: asc(schema.mediaItems.sortOrder),
    }),
  ]);

  return c.json({
    success: true,
    data: {
      post: {
        ...createdPost!,
        mediaItems,
        author: { ...createdPost!.author, isFollowing: false },
        isLiked: false,
        isSaved: false,
      },
    },
  }, 201);
});

postRouter.patch("/:id", zValidator("json", updatePostSchema), async (c) => {
  const user = getCurrentUser(c);
  const postId = c.req.param("id");
  const data = c.req.valid("json");

  const post = await db.query.posts.findFirst({ where: eq(schema.posts.id, postId) });
  if (!post) throw new HTTPException(404, { message: "Post not found" });
  if (post.authorId !== user.id) throw new HTTPException(403, { message: "Not authorized to edit this post" });

  const [updated] = await db.update(schema.posts).set({
    ...data,
    locationLat: toDecimalString(data.locationLat),
    locationLng: toDecimalString(data.locationLng),
    updatedAt: new Date(),
  }).where(eq(schema.posts.id, postId)).returning();

  return c.json({ success: true, data: { post: updated } });
});

postRouter.delete("/:id", async (c) => {
  const user = getCurrentUser(c);
  const postId = c.req.param("id");

  const post = await db.query.posts.findFirst({ where: eq(schema.posts.id, postId) });
  if (!post) throw new HTTPException(404, { message: "Post not found" });
  if (post.authorId !== user.id) throw new HTTPException(403, { message: "Not authorized to delete this post" });

  await db.delete(schema.posts).where(eq(schema.posts.id, postId));
  await db.update(schema.users)
    .set({ postsCount: sql`${schema.users.postsCount} - 1` })
    .where(eq(schema.users.id, user.id));

  return c.status(204);
});

postRouter.post("/:id/archive", async (c) => {
  const user = getCurrentUser(c);
  const postId = c.req.param("id");

  const post = await db.query.posts.findFirst({ where: eq(schema.posts.id, postId) });
  if (!post) throw new HTTPException(404, { message: "Post not found" });
  if (post.authorId !== user.id) throw new HTTPException(403, { message: "Not authorized" });

  await db.update(schema.posts)
    .set({ archivedAt: new Date() })
    .where(eq(schema.posts.id, postId));

  return c.status(204);
});

postRouter.delete("/:id/archive", async (c) => {
  const user = getCurrentUser(c);
  const postId = c.req.param("id");

  const post = await db.query.posts.findFirst({ where: eq(schema.posts.id, postId) });
  if (!post) throw new HTTPException(404, { message: "Post not found" });
  if (post.authorId !== user.id) throw new HTTPException(403, { message: "Not authorized" });

  await db.update(schema.posts)
    .set({ archivedAt: null })
    .where(eq(schema.posts.id, postId));

  return c.status(204);
});

// ============================================================
// POST INTERACTIONS
// ============================================================

postRouter.post("/:id/like", async (c) => {
  const user = getCurrentUser(c);
  const postId = c.req.param("id");

  const [post, mediaItems] = await Promise.all([
    db.query.posts.findFirst({
      where: eq(schema.posts.id, postId),
    }),
    db.query.mediaItems.findMany({
      where: and(
        eq(schema.mediaItems.mediaableType, "post"),
        eq(schema.mediaItems.mediaableId, postId)
      ),
      orderBy: asc(schema.mediaItems.sortOrder),
    }),
  ]);
  if (!post) throw new HTTPException(404, { message: "Post not found" });

  const existing = await db.query.likes.findFirst({
    where: and(eq(schema.likes.userId, user.id), eq(schema.likes.likeableType, "POST"), eq(schema.likes.likeableId, postId))
  });
  if (existing) throw new HTTPException(409, { message: "Already liked this post" });

  await db.insert(schema.likes).values({ userId: user.id, likeableType: "POST", likeableId: postId });
  await db.update(schema.posts)
    .set({ likesCount: sql`${schema.posts.likesCount} + 1` })
    .where(eq(schema.posts.id, postId));

  if (post.authorId !== user.id) {
    await db.insert(schema.notifications).values({
      recipientId: post.authorId,
      actorId: user.id,
      type: "LIKE",
      referenceType: "post",
      referenceId: postId,
      previewText: post.caption ? post.caption.substring(0, 100) : undefined,
      thumbnailUrl: mediaItems[0]?.thumbnailUrl || mediaItems[0]?.url,
      deepLink: `/posts/${postId}`,
      groupKey: `like:post:${postId}`,
    });
  }

  return c.status(204);
});

postRouter.delete("/:id/like", async (c) => {
  const user = getCurrentUser(c);
  const postId = c.req.param("id");

  const result = await db.delete(schema.likes)
    .where(and(eq(schema.likes.userId, user.id), eq(schema.likes.likeableType, "POST"), eq(schema.likes.likeableId, postId)))
    .returning({ id: schema.likes.id });

  if (result.length === 0) throw new HTTPException(404, { message: "Not liked this post" });

  await db.update(schema.posts)
    .set({ likesCount: sql`${schema.posts.likesCount} - 1` })
    .where(eq(schema.posts.id, postId));

  return c.status(204);
});

postRouter.get("/:id/likes", async (c) => {
  const user = getCurrentUser(c);
  const postId = c.req.param("id");
  const { cursor, perPage } = getCursorPagination(c);

  const post = await db.query.posts.findFirst({ where: eq(schema.posts.id, postId) });
  if (!post) throw new HTTPException(404, { message: "Post not found" });

  const whereConditions = [eq(schema.likes.likeableType, "POST"), eq(schema.likes.likeableId, postId)];
  if (cursor) {
    whereConditions.push(lt(schema.likes.createdAt, new Date(cursor)));
  }

  const likers = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      fullName: schema.users.fullName,
      avatarUrl: schema.users.avatarUrl,
      isVerified: schema.users.isVerified,
      createdAt: schema.likes.createdAt,
    })
    .from(schema.likes)
    .innerJoin(schema.users, eq(schema.users.id, schema.likes.userId))
    .where(and(...whereConditions))
    .limit(perPage + 1)
    .orderBy(desc(schema.likes.createdAt));

  const hasMore = likers.length > perPage;
  const items = hasMore ? likers.slice(0, perPage) : likers;
  const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null;

  return c.json({
    success: true,
    data: { items, nextCursor, hasMore },
  });
});

postRouter.post("/:id/save", async (c) => {
  const user = getCurrentUser(c);
  const postId = c.req.param("id");
  const collectionId = c.req.query("collectionId");

  const post = await db.query.posts.findFirst({ where: eq(schema.posts.id, postId) });
  if (!post) throw new HTTPException(404, { message: "Post not found" });

  await db.insert(schema.savedItems)
    .values({ userId: user.id, saveableType: "POST", saveableId: postId, collectionId: collectionId || null })
    .onConflictDoNothing();

  await db.update(schema.posts)
    .set({ savesCount: sql`${schema.posts.savesCount} + 1` })
    .where(eq(schema.posts.id, postId));

  return c.status(204);
});

postRouter.delete("/:id/save", async (c) => {
  const user = getCurrentUser(c);
  const postId = c.req.param("id");

  await db.delete(schema.savedItems)
    .where(and(eq(schema.savedItems.userId, user.id), eq(schema.savedItems.saveableType, "POST"), eq(schema.savedItems.saveableId, postId)));

  await db.update(schema.posts)
    .set({ savesCount: sql`${schema.posts.savesCount} - 1` })
    .where(eq(schema.posts.id, postId));

  return c.status(204);
});

// ============================================================
// REPORT ENDPOINT
// ============================================================

postRouter.post("/:id/report", zValidator("json", reportSchema), async (c) => {
  const user = getCurrentUser(c);
  const postId = c.req.param("id");
  const { reason, description } = c.req.valid("json");

  const post = await db.query.posts.findFirst({ where: eq(schema.posts.id, postId) });
  if (!post) throw new HTTPException(404, { message: "Post not found" });

  await db.insert(schema.reports).values({
    reporterId: user.id,
    reportedType: "POST",
    reportedId: postId,
    reason,
    description,
  });

  return c.status(204);
});

// ============================================================
// COMMENTS ENDPOINTS
// ============================================================

postRouter.get("/:id/comments", async (c) => {
  const user = getCurrentUser(c);
  const postId = c.req.param("id");
  const cursor = c.req.query("cursor");
  const perPage = Math.min(Number(c.req.query("perPage")) || 20, 50);

  const post = await db.query.posts.findFirst({
    where: eq(schema.posts.id, postId),
    columns: { id: true, authorId: true }
  });
  if (!post) throw new HTTPException(404, { message: "Post not found" });

  if (post.authorId !== user.id) {
    const postAuthor = await db.query.users.findFirst({
      where: eq(schema.users.id, post.authorId),
      columns: { isPrivate: true }
    });
    if (postAuthor?.isPrivate) {
      const following = await db.query.follows.findFirst({
        where: and(
          eq(schema.follows.followerId, user.id),
          eq(schema.follows.followingId, post.authorId),
          eq(schema.follows.status, "ACCEPTED")
        )
      });
      if (!following) throw new HTTPException(403, { message: "This account is private" });
    }
  }

  const result = await getComments("POST", postId, user.id, cursor, perPage);

  return c.json({
    success: true,
    data: {
      items: result.items,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    },
  });
});

postRouter.post("/:id/comments", zValidator("json", commentSchema), async (c) => {
  const user = getCurrentUser(c);
  const postId = c.req.param("id");
  const { text, parentId } = c.req.valid("json");

  const post = await db.query.posts.findFirst({
    where: eq(schema.posts.id, postId),
    columns: { id: true, authorId: true }
  });
  if (!post) throw new HTTPException(404, { message: "Post not found" });

  if (post.authorId !== user.id) {
    const postAuthor = await db.query.users.findFirst({
      where: eq(schema.users.id, post.authorId),
      columns: { isPrivate: true }
    });
    if (postAuthor?.isPrivate) {
      const following = await db.query.follows.findFirst({
        where: and(
          eq(schema.follows.followerId, user.id),
          eq(schema.follows.followingId, post.authorId),
          eq(schema.follows.status, "ACCEPTED")
        )
      });
      if (!following) throw new HTTPException(403, { message: "This account is private" });
    }
  }

  const comment = await createComment({
    commentableType: "POST",
    commentableId: postId,
    authorId: user.id,
    text,
    parentId,
  });

  if (post.authorId !== user.id) {
    await db.insert(schema.notifications).values({
      recipientId: post.authorId,
      actorId: user.id,
      type: "COMMENT",
      referenceType: "post",
      referenceId: postId,
      previewText: text.substring(0, 100),
      deepLink: `/posts/${postId}`,
      groupKey: `comment:post:${postId}`,
    });
  }

  if (parentId) {
    const parentComment = await db.query.comments.findFirst({
      where: eq(schema.comments.id, parentId),
    });
    if (parentComment && parentComment.authorId !== user.id && parentComment.authorId !== post.authorId) {
      await db.insert(schema.notifications).values({
        recipientId: parentComment.authorId,
        actorId: user.id,
        type: "COMMENT",
        referenceType: "post",
        referenceId: postId,
        previewText: text.substring(0, 100),
        deepLink: `/posts/${postId}`,
        groupKey: `comment:post:${postId}`,
      });
    }
  }

  return c.json({ success: true, data: { comment } }, 201);
});

postRouter.delete("/:id/comments/:commentId", async (c) => {
  const user = getCurrentUser(c);
  const postId = c.req.param("id");
  const commentId = c.req.param("commentId");

  const post = await db.query.posts.findFirst({
    where: eq(schema.posts.id, postId),
    columns: { authorId: true },
  });
  if (!post) throw new HTTPException(404, { message: "Post not found" });

  await deleteComment(commentId, user.id, post.authorId);

  return c.status(204);
});

postRouter.patch("/comments/:commentId", zValidator("json", z.object({ text: z.string().min(1).max(2000) })), async (c) => {
  const user = getCurrentUser(c);
  const commentId = c.req.param("commentId");
  const { text } = c.req.valid("json");

  const updatedComment = await updateComment(commentId, user.id, { text });
  return c.json({ success: true, data: { comment: updatedComment } });
});

postRouter.post("/comments/:commentId/like", async (c) => {
  const user = getCurrentUser(c);
  const commentId = c.req.param("commentId");

  await likeComment(commentId, user.id);
  return c.status(204);
});

postRouter.delete("/comments/:commentId/like", async (c) => {
  const user = getCurrentUser(c);
  const commentId = c.req.param("commentId");

  await unlikeComment(commentId, user.id);
  return c.status(204);
});

postRouter.post("/comments/:commentId/report", zValidator("json", reportSchema), async (c) => {
  const user = getCurrentUser(c);
  const commentId = c.req.param("commentId");
  const { reason, description } = c.req.valid("json");

  await reportComment(commentId, user.id, reason, description);
  return c.json({ success: true, data: { message: "Comment reported successfully" } }, 201);
});

postRouter.get("/comments/:commentId/replies", async (c) => {
  const user = getCurrentUser(c);
  const commentId = c.req.param("commentId");
  const cursor = c.req.query("cursor");
  const perPage = Math.min(Number(c.req.query("perPage")) || 20, 50);

  const result = await getReplies(commentId, user.id, cursor, perPage);
  return c.json({
    success: true,
    data: {
      items: result.items,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    },
  });
});

export { postRouter };