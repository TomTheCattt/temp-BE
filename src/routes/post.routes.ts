import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware, getCurrentUser } from "../middleware/auth";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, desc, asc, count, sql, inArray, lt, gt, not, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

const createPostSchema = z.object({
  caption: z.string().max(2200).optional(),
  locationName: z.string().max(200).optional(),
  locationLat: z.number().optional(),
  locationLng: z.number().optional(),
  media: z.array(
    z.object({
      url: z.string().url(),
      type: z.enum(["IMAGE", "VIDEO"]),
      width: z.number().optional(),
      height: z.number().optional(),
      duration: z.number().optional(),
      pendingUploadId: z.string().uuid().optional(),
    })
  ).min(1).max(10),
});

// Helper to convert numbers to strings for decimal fields
function toDecimalString(num?: number): string | undefined {
  return num !== undefined ? num.toString() : undefined;
}

const updatePostSchema = z.object({
  caption: z.string().max(2200).optional(),
  locationName: z.string().max(200).optional(),
  locationLat: z.number().optional(),
  locationLng: z.number().optional(),
});

function getPagination(c: any) {
  const page = Number(c.req.query("page")) || 1;
  const perPage = Math.min(Number(c.req.query("perPage")) || 20, 50);
  return { page, perPage, offset: (page - 1) * perPage };
}

// Cursor-based pagination helper
function getCursorPagination(c: any) {
  const cursor = c.req.query("cursor"); // ISO timestamp or UUID
  const perPage = Math.min(Number(c.req.query("perPage")) || 20, 50);
  return { cursor, perPage };
}

const postRouter = new Hono();
postRouter.use("*", authMiddleware);

postRouter.get("/feed", async (c) => {
  const user = getCurrentUser(c);
  const { cursor, perPage } = getCursorPagination(c);
  const following = await db.select({ followingId: schema.follows.followingId }).from(schema.follows).where(eq(schema.follows.followerId, user.id));
  const followingIds = following.map((f) => f.followingId);
  followingIds.push(user.id);
  const blocked = await db.select({ blockedId: schema.blocks.blockedId }).from(schema.blocks).where(eq(schema.blocks.blockerId, user.id));
  const blockedIds = blocked.map((b) => b.blockedId);

  // Build where conditions
  const whereConditions = [
    inArray(schema.posts.authorId, followingIds),
  ];

  // Exclude blocked users
  if (blockedIds.length > 0) {
    whereConditions.push(not(inArray(schema.posts.authorId, blockedIds)));
  }

  // Add cursor condition if provided
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
      isSponsored: schema.posts.isSponsored,
      createdAt: schema.posts.createdAt,
      updatedAt: schema.posts.updatedAt,
      author: {
        id: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
      },
      mediaItems: sql`(SELECT json_agg(json_build_object('id', mi.id, 'url', mi.url, 'thumbnailUrl', mi.thumbnail_url, 'type', mi.type, 'width', mi.width, 'height', mi.height, 'duration', mi.duration, 'sortOrder', mi.sort_order) ORDER BY mi.sort_order) FROM media_items mi WHERE mi.post_id = posts.id)`,
    })
    .from(schema.posts)
    .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
    .where(and(...whereConditions))
    .limit(perPage + 1) // Fetch one extra to determine hasMore
    .orderBy(desc(schema.posts.createdAt));

  const hasMore = postsList.length > perPage;
  const items = hasMore ? postsList.slice(0, perPage) : postsList;
  const nextCursor = hasMore ? items[items.length - 1].createdAt : null;

  const postIds = items.map((p) => p.id);
  const [likes, saves] = await Promise.all([
    postIds.length > 0 ? db.select({ postId: schema.likes.postId }).from(schema.likes).where(and(eq(schema.likes.userId, user.id), inArray(schema.likes.postId, postIds))) : Promise.resolve([]),
    postIds.length > 0 ? db.select({ postId: schema.savedPosts.postId }).from(schema.savedPosts).where(and(eq(schema.savedPosts.userId, user.id), inArray(schema.savedPosts.postId, postIds))) : Promise.resolve([]),
  ]);
  const likedSet = new Set(likes.map((l) => l.postId));
  const savedSet = new Set(saves.map((s) => s.postId));

  return c.json({
    success: true,
    data: {
      items: items.map((p) => ({
        ...p,
        author: { ...p.author, isFollowing: followingIds.includes(p.authorId) },
        mediaItems: p.mediaItems || [],
        isLiked: likedSet.has(p.id),
        isSaved: savedSet.has(p.id),
      })),
      nextCursor,
      hasMore,
    },
  });
});

postRouter.get("/explore", async (c) => {
  const user = getCurrentUser(c);
  const { cursor, perPage } = getCursorPagination(c);
  const blocked = await db.select({ blockedId: schema.blocks.blockedId }).from(schema.blocks).where(eq(schema.blocks.blockerId, user.id));
  const blockedIds = blocked.map((b) => b.blockedId);
  const following = await db.select({ followingId: schema.follows.followingId }).from(schema.follows).where(eq(schema.follows.followerId, user.id));
  const followingIds = following.map((f) => f.followingId);
  followingIds.push(user.id);

  const whereConditions = [];

  // Exclude following users (explore shows non-following content)
  if (followingIds.length > 0) {
    whereConditions.push(not(inArray(schema.posts.authorId, followingIds)));
  }

  // Exclude blocked users
  if (blockedIds.length > 0) {
    whereConditions.push(not(inArray(schema.posts.authorId, blockedIds)));
  }

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
      isSponsored: schema.posts.isSponsored,
      createdAt: schema.posts.createdAt,
      updatedAt: schema.posts.updatedAt,
      author: {
        id: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
      },
      mediaItems: sql`(SELECT json_agg(json_build_object('id', mi.id, 'url', mi.url, 'thumbnailUrl', mi.thumbnail_url, 'type', mi.type, 'width', mi.width, 'height', mi.height, 'duration', mi.duration, 'sortOrder', mi.sort_order) ORDER BY mi.sort_order) FROM media_items mi WHERE mi.post_id = posts.id)`,
    })
    .from(schema.posts)
    .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
    .where(and(...whereConditions))
    .limit(perPage + 1)
    .orderBy(desc(schema.posts.likesCount), desc(schema.posts.createdAt));

  const hasMore = postsList.length > perPage;
  const items = hasMore ? postsList.slice(0, perPage) : postsList;
  const nextCursor = hasMore ? items[items.length - 1].createdAt : null;

  const postIds = items.map((p) => p.id);
  const [likes, saves] = await Promise.all([
    postIds.length > 0 ? db.select({ postId: schema.likes.postId }).from(schema.likes).where(and(eq(schema.likes.userId, user.id), inArray(schema.likes.postId, postIds))) : Promise.resolve([]),
    postIds.length > 0 ? db.select({ postId: schema.savedPosts.postId }).from(schema.savedPosts).where(and(eq(schema.savedPosts.userId, user.id), inArray(schema.savedPosts.postId, postIds))) : Promise.resolve([]),
  ]);
  const likedSet = new Set(likes.map((l) => l.postId));
  const savedSet = new Set(saves.map((s) => s.postId));

  return c.json({
    success: true,
    data: {
      items: items.map((p) => ({
        ...p,
        author: { ...p.author, isFollowing: false },
        mediaItems: p.mediaItems || [],
        isLiked: likedSet.has(p.id),
        isSaved: savedSet.has(p.id),
      })),
      nextCursor,
      hasMore,
    },
  });
});

postRouter.get("/saved", async (c) => {
  const user = getCurrentUser(c);
  const { cursor, perPage } = getCursorPagination(c);

  const whereConditions = [eq(schema.savedPosts.userId, user.id)];
  if (cursor) {
    whereConditions.push(lt(schema.savedPosts.createdAt, new Date(cursor)));
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
      isSponsored: schema.posts.isSponsored,
      createdAt: schema.posts.createdAt,
      updatedAt: schema.posts.updatedAt,
      author: {
        id: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
      },
      mediaItems: sql`(SELECT json_agg(json_build_object('id', mi.id, 'url', mi.url, 'thumbnailUrl', mi.thumbnail_url, 'type', mi.type, 'width', mi.width, 'height', mi.height, 'duration', mi.duration, 'sortOrder', mi.sort_order) ORDER BY mi.sort_order) FROM media_items mi WHERE mi.post_id = posts.id)`,
    })
    .from(schema.savedPosts)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.savedPosts.postId))
    .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
    .where(and(...whereConditions))
    .limit(perPage + 1)
    .orderBy(desc(schema.savedPosts.createdAt));

  const hasMore = postsList.length > perPage;
  const items = hasMore ? postsList.slice(0, perPage) : postsList;
  const nextCursor = hasMore ? items[items.length - 1].createdAt : null;

  const postIds = items.map((p) => p.id);
  const [likes, saves] = await Promise.all([
    postIds.length > 0 ? db.select({ postId: schema.likes.postId }).from(schema.likes).where(and(eq(schema.likes.userId, user.id), inArray(schema.likes.postId, postIds))) : Promise.resolve([]),
    postIds.length > 0 ? db.select({ postId: schema.savedPosts.postId }).from(schema.savedPosts).where(and(eq(schema.savedPosts.userId, user.id), inArray(schema.savedPosts.postId, postIds))) : Promise.resolve([]),
  ]);
  const likedSet = new Set(likes.map((l) => l.postId));
  const savedSet = new Set(saves.map((s) => s.postId));

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

postRouter.get("/user/:userId", async (c) => {
  const user = getCurrentUser(c);
  const targetId = c.req.param("userId");
  const { cursor, perPage } = getCursorPagination(c);
  const targetUser = await db.query.users.findFirst({ where: eq(schema.users.id, targetId), columns: { id: true, isPrivate: true } });
  if (!targetUser) throw new HTTPException(404, { message: "User not found" });
  if (targetUser.isPrivate && targetId !== user.id) {
    const following = await db.query.follows.findFirst({ where: and(eq(schema.follows.followerId, user.id), eq(schema.follows.followingId, targetId)) });
    if (!following) throw new HTTPException(403, { message: "This account is private" });
  }

  const whereConditions = [eq(schema.posts.authorId, targetId)];
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
      isSponsored: schema.posts.isSponsored,
      createdAt: schema.posts.createdAt,
      updatedAt: schema.posts.updatedAt,
      author: {
        id: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
      },
      mediaItems: sql`(SELECT json_agg(json_build_object('id', mi.id, 'url', mi.url, 'thumbnailUrl', mi.thumbnail_url, 'type', mi.type, 'width', mi.width, 'height', mi.height, 'duration', mi.duration, 'sortOrder', mi.sort_order) ORDER BY mi.sort_order) FROM media_items mi WHERE mi.post_id = posts.id)`,
    })
    .from(schema.posts)
    .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
    .where(and(...whereConditions))
    .limit(perPage + 1)
    .orderBy(desc(schema.posts.createdAt));

  const hasMore = postsList.length > perPage;
  const items = hasMore ? postsList.slice(0, perPage) : postsList;
  const nextCursor = hasMore ? items[items.length - 1].createdAt : null;

  const postIds = items.map((p) => p.id);
  const [likes, saves] = await Promise.all([
    postIds.length > 0 ? db.select({ postId: schema.likes.postId }).from(schema.likes).where(and(eq(schema.likes.userId, user.id), inArray(schema.likes.postId, postIds))) : Promise.resolve([]),
    postIds.length > 0 ? db.select({ postId: schema.savedPosts.postId }).from(schema.savedPosts).where(and(eq(schema.savedPosts.userId, user.id), inArray(schema.savedPosts.postId, postIds))) : Promise.resolve([]),
  ]);
  const likedSet = new Set(likes.map((l) => l.postId));
  const savedSet = new Set(saves.map((s) => s.postId));

  return c.json({
    success: true,
    data: {
      items: items.map((p) => ({
        ...p,
        author: { ...p.author, isFollowing: targetId !== user.id },
        mediaItems: p.mediaItems || [],
        isLiked: likedSet.has(p.id),
        isSaved: savedSet.has(p.id),
      })),
      nextCursor,
      hasMore,
    },
  });
});

postRouter.get("/:id", async (c) => {
  const user = getCurrentUser(c);
  const postId = c.req.param("id");
  const post = await db.query.posts.findFirst({ where: eq(schema.posts.id, postId), with: { author: true, mediaItems: { orderBy: asc(schema.mediaItems.sortOrder) } } });
  if (!post) throw new HTTPException(404, { message: "Post not found" });
  if (post.author.isPrivate && post.authorId !== user.id) {
    const following = await db.query.follows.findFirst({ where: and(eq(schema.follows.followerId, user.id), eq(schema.follows.followingId, post.authorId)) });
    if (!following) throw new HTTPException(403, { message: "This account is private" });
  }
  const [like, save] = await Promise.all([
    db.query.likes.findFirst({ where: and(eq(schema.likes.userId, user.id), eq(schema.likes.postId, postId)) }),
    db.query.savedPosts.findFirst({ where: and(eq(schema.savedPosts.userId, user.id), eq(schema.savedPosts.postId, postId)) }),
  ]);
  return c.json({ success: true, data: { post: { ...post, author: { ...post.author, isFollowing: post.authorId !== user.id }, isLiked: !!like, isSaved: !!save } } });
});

postRouter.post("/", zValidator("json", createPostSchema), async (c) => {
  const user = getCurrentUser(c);
  const { caption, locationName, locationLat, locationLng, media } = c.req.valid("json");
  const [post] = await db.insert(schema.posts).values({
    authorId: user.id,
    caption,
    locationName,
    locationLat: toDecimalString(locationLat),
    locationLng: toDecimalString(locationLng)
  }).returning();
  if (media.length > 0) {
    await db.insert(schema.mediaItems).values(media.map((m, index) => ({
      postId: post.id,
      url: m.url,
      type: m.type,
      width: m.width,
      height: m.height,
      duration: toDecimalString(m.duration),
      sortOrder: index
    })));
  }
  await db.update(schema.users).set({ postsCount: sql`${schema.users.postsCount} + 1` }).where(eq(schema.users.id, user.id));
  const pendingUploadIds = media.filter((m) => m.pendingUploadId).map((m) => m.pendingUploadId!);
  if (pendingUploadIds.length > 0) {
    await db.update(schema.pendingUploads).set({ confirmed: true }).where(inArray(schema.pendingUploads.id, pendingUploadIds));
  }
  const createdPost = await db.query.posts.findFirst({ where: eq(schema.posts.id, post.id), with: { author: true, mediaItems: { orderBy: asc(schema.mediaItems.sortOrder) } } });
  return c.json({ success: true, data: { post: { ...createdPost!, author: { ...createdPost!.author, isFollowing: false }, isLiked: false, isSaved: false } } }, 201);
});

postRouter.put("/:id", zValidator("json", updatePostSchema), async (c) => {
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
    updatedAt: new Date()
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
  await db.update(schema.users).set({ postsCount: sql`${schema.users.postsCount} - 1` }).where(eq(schema.users.id, user.id));
  return c.status(204);
});

postRouter.post("/:id/like", async (c) => {
  const user = getCurrentUser(c);
  const postId = c.req.param("id");
  const post = await db.query.posts.findFirst({
    where: eq(schema.posts.id, postId),
    with: { mediaItems: true }
  });
  if (!post) throw new HTTPException(404, { message: "Post not found" });
  const existing = await db.query.likes.findFirst({ where: and(eq(schema.likes.userId, user.id), eq(schema.likes.postId, postId)) });
  if (existing) throw new HTTPException(409, { message: "Already liked this post" });
  await db.insert(schema.likes).values({ userId: user.id, postId });
  await db.update(schema.posts).set({ likesCount: sql`${schema.posts.likesCount} + 1` }).where(eq(schema.posts.id, postId));
  if (post.authorId !== user.id) {
    await db.insert(schema.notifications).values({ recipientId: post.authorId, actorId: user.id, type: "LIKE", postId, postThumbnailUrl: post.mediaItems?.[0]?.thumbnailUrl || post.mediaItems?.[0]?.url });
  }
  return c.status(204);
});

postRouter.delete("/:id/like", async (c) => {
  const user = getCurrentUser(c);
  const postId = c.req.param("id");
  const result = await db.delete(schema.likes).where(and(eq(schema.likes.userId, user.id), eq(schema.likes.postId, postId))).returning({ id: schema.likes.id });
  if (result.length === 0) throw new HTTPException(404, { message: "Not liked this post" });
  await db.update(schema.posts).set({ likesCount: sql`${schema.posts.likesCount} - 1` }).where(eq(schema.posts.id, postId));
  return c.status(204);
});

postRouter.post("/:id/save", async (c) => {
  const user = getCurrentUser(c);
  const postId = c.req.param("id");
  const post = await db.query.posts.findFirst({ where: eq(schema.posts.id, postId) });
  if (!post) throw new HTTPException(404, { message: "Post not found" });
  await db.insert(schema.savedPosts).values({ userId: user.id, postId }).onConflictDoNothing();
  return c.status(204);
});

postRouter.delete("/:id/save", async (c) => {
  const user = getCurrentUser(c);
  const postId = c.req.param("id");
  await db.delete(schema.savedPosts).where(and(eq(schema.savedPosts.userId, user.id), eq(schema.savedPosts.postId, postId)));
  return c.status(204);
});

// GET /v1/posts/:id/comments - Get post comments
postRouter.get("/:id/comments", async (c) => {
  const user = getCurrentUser(c);
  const postId = c.req.param("id");
  const { page, perPage, offset } = getPagination(c);

  const post = await db.query.posts.findFirst({ where: eq(schema.posts.id, postId), columns: { id: true, authorId: true } });
  if (!post) throw new HTTPException(404, { message: "Post not found" });

  // Check if user can view post (private account check)
  if (post.authorId !== user.id) {
    const postAuthor = await db.query.users.findFirst({ where: eq(schema.users.id, post.authorId), columns: { isPrivate: true } });
    if (postAuthor?.isPrivate) {
      const following = await db.query.follows.findFirst({ where: and(eq(schema.follows.followerId, user.id), eq(schema.follows.followingId, post.authorId)) });
      if (!following) throw new HTTPException(403, { message: "This account is private" });
    }
  }

  const [commentsList, total] = await Promise.all([
    db
      .select({
        id: schema.comments.id,
        postId: schema.comments.postId,
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
      .where(and(eq(schema.comments.postId, postId), isNull(schema.comments.parentId)))
      .orderBy(desc(schema.comments.createdAt))
      .limit(perPage)
      .offset(offset),
    db.select({ count: count() }).from(schema.comments).where(and(eq(schema.comments.postId, postId), isNull(schema.comments.parentId))),
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

// POST /v1/posts/:id/comments - Add post comment
postRouter.post("/:id/comments", zValidator("json", z.object({ text: z.string().min(1).max(1000), parentId: z.string().uuid().optional() })), async (c) => {
  const user = getCurrentUser(c);
  const postId = c.req.param("id");
  const { text, parentId } = c.req.valid("json");

  const post = await db.query.posts.findFirst({ where: eq(schema.posts.id, postId), columns: { id: true, authorId: true } });
  if (!post) throw new HTTPException(404, { message: "Post not found" });

  // Check if user can comment (private account check)
  if (post.authorId !== user.id) {
    const postAuthor = await db.query.users.findFirst({ where: eq(schema.users.id, post.authorId), columns: { isPrivate: true } });
    if (postAuthor?.isPrivate) {
      const following = await db.query.follows.findFirst({ where: and(eq(schema.follows.followerId, user.id), eq(schema.follows.followingId, post.authorId)) });
      if (!following) throw new HTTPException(403, { message: "This account is private" });
    }
  }

  if (parentId) {
    const parentComment = await db.query.comments.findFirst({ where: eq(schema.comments.id, parentId) });
    if (!parentComment || parentComment.postId !== postId) {
      throw new HTTPException(400, { message: "Invalid parent comment" });
    }
  }

  const [comment] = await db
    .insert(schema.comments)
    .values({
      postId,
      authorId: user.id,
      text,
      parentId,
    })
    .returning();

  // Increment comments count on post
  await db.update(schema.posts).set({ commentsCount: sql`${schema.posts.commentsCount} + 1` }).where(eq(schema.posts.id, postId));

  // Notify post author (if not self)
  if (post.authorId !== user.id) {
    await db.insert(schema.notifications).values({ recipientId: post.authorId, actorId: user.id, type: "COMMENT", postId, commentText: text });
  }

  // If replying to a comment, notify parent comment author
  if (parentId) {
    const parentComment = await db.query.comments.findFirst({ where: eq(schema.comments.id, parentId) });
    if (parentComment && parentComment.authorId !== user.id && parentComment.authorId !== post.authorId) {
      await db.insert(schema.notifications).values({ recipientId: parentComment.authorId, actorId: user.id, type: "COMMENT", postId, commentText: text });
    }
  }

  const createdComment = await db.query.comments.findFirst({
    where: eq(schema.comments.id, comment.id),
    with: { author: true },
  });

  return c.json({ success: true, data: { comment: createdComment } }, 201);
});

export { postRouter };
