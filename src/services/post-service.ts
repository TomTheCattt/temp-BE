import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, desc, asc, count, sql, inArray, lt, gt, not, isNull, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

// ============================================================================
// Types
// ============================================================================

export interface CreatePostInput {
  authorId: string;
  caption?: string;
  locationName?: string;
  locationLat?: number;
  locationLng?: number;
  audience?: "PUBLIC" | "FOLLOWERS" | "CLOSE_FRIENDS";
  closeFriendsOnly?: boolean;
  media: Array<{
    url: string;
    type: "IMAGE" | "VIDEO";
    width?: number;
    height?: number;
    duration?: number;
    thumbnailUrl?: string;
    sortOrder: number;
    pendingUploadId?: string;
  }>;
}

export interface UpdatePostInput {
  caption?: string;
  locationName?: string;
  locationLat?: number;
  locationLng?: number;
  audience?: "PUBLIC" | "FOLLOWERS" | "CLOSE_FRIENDS";
  closeFriendsOnly?: boolean;
}

export interface PostWithDetails {
  id: string;
  authorId: string;
  caption: string | null;
  locationName: string | null;
  locationLat: string | null;
  locationLng: string | null;
  isSponsored: boolean;
  sponsorUserId: string | null;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  savesCount: number;
  viewsCount: number;
  audience: string;
  closeFriendsOnly: boolean;
  searchVector: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  archivedAt: Date | null;
  author: {
    id: string;
    username: string;
    fullName: string | null;
    avatarUrl: string | null;
    isVerified: boolean;
    isPrivate: boolean;
  };
  mediaItems: Array<{
    id: string;
    url: string;
    thumbnailUrl: string | null;
    type: string;
    width: number | null;
    height: number | null;
    duration: string | null;
    sortOrder: number;
  }>;
  isLiked?: boolean;
  isSaved?: boolean;
}

export interface FeedPost {
  id: string;
  authorId: string;
  caption: string | null;
  locationName: string | null;
  locationLat: string | null;
  locationLng: string | null;
  likesCount: number;
  commentsCount: number;
  isSponsored: boolean;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    username: string;
    fullName: string | null;
    avatarUrl: string | null;
    isVerified: boolean;
  };
  mediaItems: Array<{
    id: string;
    url: string;
    thumbnailUrl: string | null;
    type: string;
    width: number | null;
    height: number | null;
    duration: string | null;
    sortOrder: number;
  }> | null;
  isLiked?: boolean;
  isSaved?: boolean;
  isFollowing?: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

function toDecimalString(num?: number): string | undefined {
  return num !== undefined ? num.toString() : undefined;
}

function fromDecimalString(str?: string | null): number | null {
  if (!str) return null;
  const parsed = parseFloat(str);
  return isNaN(parsed) ? null : parsed;
}

async function fetchMediaItems(postId: string) {
  return db.query.mediaItems.findMany({
    where: and(
      eq(schema.mediaItems.mediaableType, "post"),
      eq(schema.mediaItems.mediaableId, postId)
    ),
    orderBy: asc(schema.mediaItems.sortOrder),
  });
}

function buildPostWithDetails(post: any, mediaItems: any[], isLiked?: boolean, isSaved?: boolean): PostWithDetails {
  return {
    id: post.id,
    authorId: post.authorId,
    caption: post.caption,
    locationName: post.locationName,
    locationLat: post.locationLat,
    locationLng: post.locationLng,
    isSponsored: post.isSponsored,
    sponsorUserId: post.sponsorUserId,
    likesCount: post.likesCount,
    commentsCount: post.commentsCount,
    sharesCount: post.sharesCount,
    savesCount: post.savesCount,
    viewsCount: post.viewsCount,
    audience: post.audience,
    closeFriendsOnly: post.closeFriendsOnly,
    searchVector: post.searchVector,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    deletedAt: post.deletedAt,
    archivedAt: post.archivedAt,
    author: post.author,
    mediaItems: mediaItems.map((m: any) => ({
      id: m.id,
      url: m.url,
      thumbnailUrl: m.thumbnailUrl,
      type: m.type,
      width: m.width,
      height: m.height,
      duration: m.duration,
      sortOrder: m.sortOrder,
    })),
    isLiked,
    isSaved,
  };
}

function buildFeedPost(post: any, mediaItems: any[], isLiked?: boolean, isSaved?: boolean, isFollowing?: boolean): FeedPost {
  return {
    id: post.id,
    authorId: post.authorId,
    caption: post.caption,
    locationName: post.locationName,
    locationLat: post.locationLat,
    locationLng: post.locationLng,
    likesCount: post.likesCount,
    commentsCount: post.commentsCount,
    isSponsored: post.isSponsored,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    author: post.author,
    mediaItems: mediaItems ? mediaItems.map((m: any) => ({
      id: m.id,
      url: m.url,
      thumbnailUrl: m.thumbnailUrl,
      type: m.type,
      width: m.width,
      height: m.height,
      duration: m.duration,
      sortOrder: m.sortOrder,
    })) : null,
    isLiked,
    isSaved,
    isFollowing,
  };
}

// ============================================================================
// Post Service Class
// ============================================================================

export class PostService {
  /**
   * Create a new post with media items
   */
  async createPost(input: CreatePostInput): Promise<PostWithDetails> {
    const { authorId, caption, locationName, locationLat, locationLng, audience = "PUBLIC", closeFriendsOnly = false, media } = input;

    // Validate media count (1-10)
    if (media.length < 1 || media.length > 10) {
      throw new HTTPException(400, { message: "Post must have 1-10 media items" });
    }

    // Validate media ordering (sortOrder should be sequential starting from 0)
    const sortedMedia = [...media].sort((a, b) => a.sortOrder - b.sortOrder);
    for (let i = 0; i < sortedMedia.length; i++) {
      if (sortedMedia[i].sortOrder !== i) {
        throw new HTTPException(400, { message: "Media sortOrder must be sequential starting from 0" });
      }
    }

    // Insert post
    const [post] = await db.insert(schema.posts).values({
      authorId,
      caption,
      locationName,
      locationLat: toDecimalString(locationLat),
      locationLng: toDecimalString(locationLng),
      audience,
      closeFriendsOnly,
    }).returning();

    // Insert media items with proper sort order
    if (sortedMedia.length > 0) {
      await db.insert(schema.mediaItems).values(
        sortedMedia.map((m) => ({
          mediaableType: "post",
          mediaableId: post.id,
          url: m.url,
          thumbnailUrl: m.thumbnailUrl,
          type: m.type,
          width: m.width,
          height: m.height,
          duration: toDecimalString(m.duration),
          sortOrder: m.sortOrder,
        }))
      );
    }

    // Update user posts count
    await db.update(schema.users)
      .set({ postsCount: sql`${schema.users.postsCount} + 1` })
      .where(eq(schema.users.id, authorId));

    // Confirm pending uploads
    const pendingUploadIds = sortedMedia.filter((m) => m.pendingUploadId).map((m) => m.pendingUploadId!);
    if (pendingUploadIds.length > 0) {
      await db.update(schema.pendingUploads)
        .set({ confirmed: true })
        .where(inArray(schema.pendingUploads.id, pendingUploadIds));
    }

    // Fetch created post with all details
    const createdPost = await db.query.posts.findFirst({
      where: eq(schema.posts.id, post.id),
      with: { author: true },
    });

    if (!createdPost) {
      throw new HTTPException(500, { message: "Failed to create post" });
    }

    const mediaItems = await fetchMediaItems(post.id);

    return buildPostWithDetails(createdPost, mediaItems);
  }

  /**
   * Get a single post by ID with full details
   */
  async getPostById(postId: string, currentUserId: string): Promise<PostWithDetails | null> {
    const post = await db.query.posts.findFirst({
      where: eq(schema.posts.id, postId),
      with: { author: true },
    });

    if (!post) {
      return null;
    }

    // Check if post is deleted
    if (post.deletedAt) {
      return null;
    }

    // Check private account permissions
    if (post.author.isPrivate && post.authorId !== currentUserId) {
      const following = await db.query.follows.findFirst({
        where: and(
          eq(schema.follows.followerId, currentUserId),
          eq(schema.follows.followingId, post.authorId),
          eq(schema.follows.status, "ACCEPTED")
        ),
      });
      if (!following) {
        throw new HTTPException(403, { message: "This account is private" });
      }
    }

    // Check block permissions
    const isBlocked = await this.checkBlock(currentUserId, post.authorId);
    if (isBlocked) {
      throw new HTTPException(403, { message: "You cannot view this post" });
    }

    // Check if current user liked/saved this post
    const [like, save, mediaItems] = await Promise.all([
      db.query.likes.findFirst({
        where: and(
          eq(schema.likes.userId, currentUserId),
          eq(schema.likes.likeableType, "POST"),
          eq(schema.likes.likeableId, postId)
        ),
      }),
      db.query.savedItems.findFirst({
        where: and(
          eq(schema.savedItems.userId, currentUserId),
          eq(schema.savedItems.saveableType, "POST"),
          eq(schema.savedItems.saveableId, postId)
        ),
      }),
      fetchMediaItems(postId),
    ]);

    return buildPostWithDetails(post, mediaItems, !!like, !!save);
  }

  /**
   * Update a post (caption, location, audience)
   */
  async updatePost(postId: string, userId: string, input: UpdatePostInput): Promise<PostWithDetails> {
    const post = await db.query.posts.findFirst({
      where: eq(schema.posts.id, postId),
    });

    if (!post) {
      throw new HTTPException(404, { message: "Post not found" });
    }

    if (post.deletedAt) {
      throw new HTTPException(404, { message: "Post not found" });
    }

    if (post.authorId !== userId) {
      throw new HTTPException(403, { message: "Not authorized to edit this post" });
    }

    const updateData: any = {
      updatedAt: new Date(),
    };

    if (input.caption !== undefined) updateData.caption = input.caption;
    if (input.locationName !== undefined) updateData.locationName = input.locationName;
    if (input.locationLat !== undefined) updateData.locationLat = toDecimalString(input.locationLat);
    if (input.locationLng !== undefined) updateData.locationLng = toDecimalString(input.locationLng);
    if (input.audience !== undefined) updateData.audience = input.audience;
    if (input.closeFriendsOnly !== undefined) updateData.closeFriendsOnly = input.closeFriendsOnly;

    const [updated] = await db.update(schema.posts)
      .set(updateData)
      .where(eq(schema.posts.id, postId))
      .returning();

    // Fetch updated post with details
    const updatedPost = await db.query.posts.findFirst({
      where: eq(schema.posts.id, postId),
      with: { author: true },
    });

    if (!updatedPost) {
      throw new HTTPException(500, { message: "Failed to fetch updated post" });
    }

    const mediaItems = await fetchMediaItems(postId);

    return buildPostWithDetails(updatedPost, mediaItems);
  }

  /**
   * Delete a post (cascade delete media, likes, comments, saves)
   */
  async deletePost(postId: string, userId: string): Promise<void> {
    const post = await db.query.posts.findFirst({
      where: eq(schema.posts.id, postId),
    });

    if (!post) {
      throw new HTTPException(404, { message: "Post not found" });
    }

    if (post.deletedAt) {
      throw new HTTPException(404, { message: "Post not found" });
    }

    if (post.authorId !== userId) {
      throw new HTTPException(403, { message: "Not authorized to delete this post" });
    }

    // Soft delete the post (set deletedAt)
    await db.update(schema.posts)
      .set({ deletedAt: new Date() })
      .where(eq(schema.posts.id, postId));

    // Update user posts count
    await db.update(schema.users)
      .set({ postsCount: sql`${schema.users.postsCount} - 1` })
      .where(eq(schema.users.id, userId));

    // Note: The actual cascade deletion of related records (media, likes, comments, saves)
    // is handled by database foreign key constraints with ON DELETE CASCADE
    // The schema has proper foreign keys set up for this
  }

  /**
   * Archive/Unarchive a post
   */
  async archivePost(postId: string, userId: string, archive: boolean): Promise<void> {
    const post = await db.query.posts.findFirst({
      where: eq(schema.posts.id, postId),
    });

    if (!post) {
      throw new HTTPException(404, { message: "Post not found" });
    }

    if (post.authorId !== userId) {
      throw new HTTPException(403, { message: "Not authorized to archive this post" });
    }

    await db.update(schema.posts)
      .set({ archivedAt: archive ? new Date() : null })
      .where(eq(schema.posts.id, postId));
  }

  /**
   * Like a post
   */
  async likePost(postId: string, userId: string): Promise<void> {
    const post = await db.query.posts.findFirst({
      where: eq(schema.posts.id, postId),
      with: { author: true },
    });

    if (!post) {
      throw new HTTPException(404, { message: "Post not found" });
    }

    if (post.deletedAt) {
      throw new HTTPException(404, { message: "Post not found" });
    }

    // Check permissions (private account, blocks)
    await this.checkPostAccess(post, userId);

    const existing = await db.query.likes.findFirst({
      where: and(
        eq(schema.likes.userId, userId),
        eq(schema.likes.likeableType, "POST"),
        eq(schema.likes.likeableId, postId)
      ),
    });

    if (existing) {
      throw new HTTPException(409, { message: "Already liked this post" });
    }

    // Insert like
    await db.insert(schema.likes).values({
      userId,
      likeableType: "POST",
      likeableId: postId,
    });

    // Increment likes count
    await db.update(schema.posts)
      .set({ likesCount: sql`${schema.posts.likesCount} + 1` })
      .where(eq(schema.posts.id, postId));

    // Create notification for post author (if not self)
    if (post.authorId !== userId) {
      // Get first media item for thumbnail
      const mediaItems = await fetchMediaItems(postId);
      await db.insert(schema.notifications).values({
        recipientId: post.authorId,
        actorId: userId,
        type: "LIKE",
        referenceType: "post",
        referenceId: postId,
        previewText: post.caption ? post.caption.substring(0, 100) : undefined,
        thumbnailUrl: mediaItems[0]?.thumbnailUrl || mediaItems[0]?.url,
        deepLink: `/posts/${postId}`,
        groupKey: `like:post:${postId}`,
      });
    }
  }

  /**
   * Unlike a post
   */
  async unlikePost(postId: string, userId: string): Promise<void> {
    const result = await db.delete(schema.likes)
      .where(and(
        eq(schema.likes.userId, userId),
        eq(schema.likes.likeableType, "POST"),
        eq(schema.likes.likeableId, postId)
      ))
      .returning({ id: schema.likes.id });

    if (result.length === 0) {
      throw new HTTPException(404, { message: "Not liked this post" });
    }

    // Decrement likes count
    await db.update(schema.posts)
      .set({ likesCount: sql`${schema.posts.likesCount} - 1` })
      .where(eq(schema.posts.id, postId));
  }

  /**
   * Save a post to a collection
   */
  async savePost(postId: string, userId: string, collectionId?: string): Promise<void> {
    const post = await db.query.posts.findFirst({
      where: eq(schema.posts.id, postId),
    });

    if (!post) {
      throw new HTTPException(404, { message: "Post not found" });
    }

    if (post.deletedAt) {
      throw new HTTPException(404, { message: "Post not found" });
    }

    // Check permissions
    await this.checkPostAccess(post, userId);

    // Verify collection belongs to user if provided
    if (collectionId) {
      const collection = await db.query.collections.findFirst({
        where: and(
          eq(schema.collections.id, collectionId),
          eq(schema.collections.userId, userId)
        ),
      });
      if (!collection) {
        throw new HTTPException(404, { message: "Collection not found" });
      }
    }

    await db.insert(schema.savedItems).values({
      userId,
      collectionId: collectionId || null,
      saveableType: "POST",
      saveableId: postId,
    }).onConflictDoNothing();

    // Increment saves count
    await db.update(schema.posts)
      .set({ savesCount: sql`${schema.posts.savesCount} + 1` })
      .where(eq(schema.posts.id, postId));
  }

  /**
   * Unsave a post
   */
  async unsavePost(postId: string, userId: string): Promise<void> {
    await db.delete(schema.savedItems)
      .where(and(
        eq(schema.savedItems.userId, userId),
        eq(schema.savedItems.saveableType, "POST"),
        eq(schema.savedItems.saveableId, postId)
      ));

    // Decrement saves count
    await db.update(schema.posts)
      .set({ savesCount: sql`${schema.posts.savesCount} - 1` })
      .where(eq(schema.posts.id, postId));
  }

  /**
   * Get paginated list of users who liked a post
   */
  async getPostLikes(postId: string, currentUserId: string, cursor?: string, perPage = 20): Promise<PaginatedResult<any>> {
    const post = await db.query.posts.findFirst({
      where: eq(schema.posts.id, postId),
      columns: { id: true, authorId: true },
    });

    if (!post) {
      throw new HTTPException(404, { message: "Post not found" });
    }

    // Check permissions
    await this.checkPostAccess(post, currentUserId);

    const whereConditions = [
      eq(schema.likes.likeableType, "POST"),
      eq(schema.likes.likeableId, postId),
    ];

    if (cursor) {
      whereConditions.push(lt(schema.likes.createdAt, new Date(cursor)));
    }

    const likesList = await db
      .select({
        id: schema.likes.id,
        userId: schema.likes.userId,
        createdAt: schema.likes.createdAt,
        user: {
          id: schema.users.id,
          username: schema.users.username,
          fullName: schema.users.fullName,
          avatarUrl: schema.users.avatarUrl,
          isVerified: schema.users.isVerified,
        },
      })
      .from(schema.likes)
      .innerJoin(schema.users, eq(schema.users.id, schema.likes.userId))
      .where(and(...whereConditions))
      .limit(perPage + 1)
      .orderBy(desc(schema.likes.createdAt));

    const hasMore = likesList.length > perPage;
    const items = hasMore ? likesList.slice(0, perPage) : likesList;
    const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null;

    return { items, nextCursor, hasMore };
  }

  /**
   * Report a post
   */
  async reportPost(postId: string, reporterId: string, reason: string, description?: string): Promise<void> {
    const post = await db.query.posts.findFirst({
      where: eq(schema.posts.id, postId),
    });

    if (!post) {
      throw new HTTPException(404, { message: "Post not found" });
    }

    await db.insert(schema.reports).values({
      reporterId,
      reportedType: "POST",
      reportedId: postId,
      reason: reason as any,
      description,
    });
  }

  /**
   * Get feed posts (from followed users)
   */
  async getFeed(userId: string, cursor?: string, perPage = 20): Promise<PaginatedResult<FeedPost>> {
    // Get users that current user follows (accepted)
    const following = await db.select({ followingId: schema.follows.followingId })
      .from(schema.follows)
      .where(and(
        eq(schema.follows.followerId, userId),
        eq(schema.follows.status, "ACCEPTED")
      ));

    const followingIds = following.map((f) => f.followingId);
    followingIds.push(userId); // Include own posts

    // Get blocked users
    const blocked = await db.select({ blockedId: schema.blocks.blockedId })
      .from(schema.blocks)
      .where(eq(schema.blocks.blockerId, userId));
    const blockedIds = blocked.map((b) => b.blockedId);

    // Build where conditions
    const whereConditions = [
      inArray(schema.posts.authorId, followingIds),
      isNull(schema.posts.deletedAt),
      eq(schema.posts.audience, "PUBLIC"), // Only public posts in feed for now
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
      })
      .from(schema.posts)
      .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
      .where(and(...whereConditions))
      .limit(perPage + 1)
      .orderBy(desc(schema.posts.createdAt));

    const hasMore = postsList.length > perPage;
    const items = hasMore ? postsList.slice(0, perPage) : postsList;
    const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null;

    // Check which posts are liked/saved by current user
    const postIds = items.map((p) => p.id);
    const [likes, saves] = await Promise.all([
      postIds.length > 0
        ? db.select({ postId: schema.likes.likeableId })
            .from(schema.likes)
            .where(and(
              eq(schema.likes.userId, userId),
              eq(schema.likes.likeableType, "POST"),
              inArray(schema.likes.likeableId, postIds)
            ))
        : Promise.resolve([]),
      postIds.length > 0
        ? db.select({ postId: schema.savedItems.saveableId })
            .from(schema.savedItems)
            .where(and(
              eq(schema.savedItems.userId, userId),
              eq(schema.savedItems.saveableType, "POST"),
              inArray(schema.savedItems.saveableId, postIds)
            ))
        : Promise.resolve([]),
    ]);

    const likedSet = new Set(likes.map((l) => l.postId));
    const savedSet = new Set(saves.map((s) => s.postId));

    // Also check if author is followed
    const followedSet = new Set(followingIds);

    // Fetch media items for all posts
    const mediaItemsMap = new Map<string, any[]>();
    for (const post of items) {
      const mediaItems = await fetchMediaItems(post.id);
      mediaItemsMap.set(post.id, mediaItems);
    }

    const enrichedItems = items.map((p) => buildFeedPost(
      p,
      mediaItemsMap.get(p.id) || [],
      likedSet.has(p.id),
      savedSet.has(p.id),
      followedSet.has(p.authorId)
    ));

    return { items: enrichedItems, nextCursor, hasMore };
  }

  /**
   * Get explore posts (popular posts from non-followed users)
   */
  async getExplore(userId: string, cursor?: string, perPage = 20): Promise<PaginatedResult<FeedPost> & { isFallback: boolean }> {
    // Get blocked users
    const blocked = await db.select({ blockedId: schema.blocks.blockedId })
      .from(schema.blocks)
      .where(eq(schema.blocks.blockerId, userId));
    const blockedIds = blocked.map((b) => b.blockedId);

    // Get followed users
    const following = await db.select({ followingId: schema.follows.followingId })
      .from(schema.follows)
      .where(and(
        eq(schema.follows.followerId, userId),
        eq(schema.follows.status, "ACCEPTED")
      ));
    const followingIds = following.map((f) => f.followingId);
    followingIds.push(userId); // Exclude self

    const baseWhereConditions = [
      isNull(schema.posts.deletedAt),
      eq(schema.posts.audience, "PUBLIC"),
    ];

    // Exclude blocked users
    if (blockedIds.length > 0) {
      baseWhereConditions.push(not(inArray(schema.posts.authorId, blockedIds)));
    }

    if (cursor) {
      baseWhereConditions.push(lt(schema.posts.createdAt, new Date(cursor)));
    }

    // First, try to get posts from users NOT followed (true explore)
    const nonFollowedWhereConditions = [...baseWhereConditions];
    if (followingIds.length > 0) {
      nonFollowedWhereConditions.push(not(inArray(schema.posts.authorId, followingIds)));
    }

    let postsList = await db
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
      })
      .from(schema.posts)
      .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
      .where(and(...nonFollowedWhereConditions))
      .limit(perPage + 1)
      .orderBy(desc(schema.posts.likesCount), desc(schema.posts.createdAt));

    let isFallback = false;

    // Fallback: if no posts from non-followed users, show popular posts from everyone (except blocked and self)
    if (postsList.length === 0) {
      isFallback = true;
      postsList = await db
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
        })
        .from(schema.posts)
        .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
        .where(and(...baseWhereConditions))
        .limit(perPage + 1)
        .orderBy(desc(schema.posts.likesCount), desc(schema.posts.createdAt));
    }

    const hasMore = postsList.length > perPage;
    const items = hasMore ? postsList.slice(0, perPage) : postsList;
    const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null;

    // Check which posts are liked/saved by current user
    const postIds = items.map((p) => p.id);
    const [likes, saves] = await Promise.all([
      postIds.length > 0
        ? db.select({ postId: schema.likes.likeableId })
            .from(schema.likes)
            .where(and(
              eq(schema.likes.userId, userId),
              eq(schema.likes.likeableType, "POST"),
              inArray(schema.likes.likeableId, postIds)
            ))
        : Promise.resolve([]),
      postIds.length > 0
        ? db.select({ postId: schema.savedItems.saveableId })
            .from(schema.savedItems)
            .where(and(
              eq(schema.savedItems.userId, userId),
              eq(schema.savedItems.saveableType, "POST"),
              inArray(schema.savedItems.saveableId, postIds)
            ))
        : Promise.resolve([]),
    ]);

    const likedSet = new Set(likes.map((l) => l.postId));
    const savedSet = new Set(saves.map((s) => s.postId));
    const followedSet = new Set(followingIds);

    // Fetch media items for all posts
    const mediaItemsMap = new Map<string, any[]>();
    for (const post of items) {
      const mediaItems = await fetchMediaItems(post.id);
      mediaItemsMap.set(post.id, mediaItems);
    }

    const enrichedItems = items.map((p) => buildFeedPost(
      p,
      mediaItemsMap.get(p.id) || [],
      likedSet.has(p.id),
      savedSet.has(p.id),
      followedSet.has(p.authorId)
    ));

    return { items: enrichedItems, nextCursor, hasMore, isFallback };
  }

  /**
   * Get saved posts for current user
   */
  async getSavedPosts(userId: string, cursor?: string, perPage = 20): Promise<PaginatedResult<FeedPost>> {
    const whereConditions = [
      eq(schema.savedItems.userId, userId),
      eq(schema.savedItems.saveableType, "POST"),
    ];

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

    // Check which posts are liked by current user
    const postIds = items.map((p) => p.id);
    const [likes] = await Promise.all([
      postIds.length > 0
        ? db.select({ postId: schema.likes.likeableId })
            .from(schema.likes)
            .where(and(
              eq(schema.likes.userId, userId),
              eq(schema.likes.likeableType, "POST"),
              inArray(schema.likes.likeableId, postIds)
            ))
        : Promise.resolve([]),
    ]);

    const likedSet = new Set(likes.map((l) => l.postId));

    // Fetch media items for all posts
    const mediaItemsMap = new Map<string, any[]>();
    for (const post of items) {
      const mediaItems = await fetchMediaItems(post.id);
      mediaItemsMap.set(post.id, mediaItems);
    }

    const enrichedItems = items.map((p) => buildFeedPost(
      p,
      mediaItemsMap.get(p.id) || [],
      likedSet.has(p.id),
      true,
      false
    ));

    return { items: enrichedItems, nextCursor, hasMore };
  }

  /**
   * Get user posts (with privacy checks)
   */
  async getUserPosts(targetUserId: string, currentUserId: string, cursor?: string, perPage = 20): Promise<PaginatedResult<FeedPost>> {
    const targetUser = await db.query.users.findFirst({
      where: eq(schema.users.id, targetUserId),
      columns: { id: true, isPrivate: true },
    });

    if (!targetUser) {
      throw new HTTPException(404, { message: "User not found" });
    }

    // Check if private account and not following
    if (targetUser.isPrivate && targetUserId !== currentUserId) {
      const following = await db.query.follows.findFirst({
        where: and(
          eq(schema.follows.followerId, currentUserId),
          eq(schema.follows.followingId, targetUserId),
          eq(schema.follows.status, "ACCEPTED")
        ),
      });
      if (!following) {
        throw new HTTPException(403, { message: "This account is private" });
      }
    }

    // Check blocks
    const isBlocked = await this.checkBlock(currentUserId, targetUserId);
    if (isBlocked) {
      throw new HTTPException(403, { message: "You cannot view these posts" });
    }

    const whereConditions = [
      eq(schema.posts.authorId, targetUserId),
      isNull(schema.posts.deletedAt),
    ];

    // If not own profile, only show public posts
    if (targetUserId !== currentUserId) {
      whereConditions.push(eq(schema.posts.audience, "PUBLIC"));
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
      })
      .from(schema.posts)
      .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
      .where(and(...whereConditions))
      .limit(perPage + 1)
      .orderBy(desc(schema.posts.createdAt));

    const hasMore = postsList.length > perPage;
    const items = hasMore ? postsList.slice(0, perPage) : postsList;
    const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null;

    // Check likes/saves
    const postIds = items.map((p) => p.id);
    const [likes, saves] = await Promise.all([
      postIds.length > 0
        ? db.select({ postId: schema.likes.likeableId })
            .from(schema.likes)
            .where(and(
              eq(schema.likes.userId, currentUserId),
              eq(schema.likes.likeableType, "POST"),
              inArray(schema.likes.likeableId, postIds)
            ))
        : Promise.resolve([]),
      postIds.length > 0
        ? db.select({ postId: schema.savedItems.saveableId })
            .from(schema.savedItems)
            .where(and(
              eq(schema.savedItems.userId, currentUserId),
              eq(schema.savedItems.saveableType, "POST"),
              inArray(schema.savedItems.saveableId, postIds)
            ))
        : Promise.resolve([]),
    ]);

    const likedSet = new Set(likes.map((l) => l.postId));
    const savedSet = new Set(saves.map((s) => s.postId));

    // Fetch media items for all posts
    const mediaItemsMap = new Map<string, any[]>();
    for (const post of items) {
      const mediaItems = await fetchMediaItems(post.id);
      mediaItemsMap.set(post.id, mediaItems);
    }

    const enrichedItems = items.map((p) => buildFeedPost(
      p,
      mediaItemsMap.get(p.id) || [],
      likedSet.has(p.id),
      savedSet.has(p.id),
      targetUserId !== currentUserId
    ));

    return { items: enrichedItems, nextCursor, hasMore };
  }

  /**
   * Check if a user has access to a post (private account, blocks)
   */
  private async checkPostAccess(post: any, currentUserId: string): Promise<void> {
    // Check private account
    if (post.author?.isPrivate && post.authorId !== currentUserId) {
      const following = await db.query.follows.findFirst({
        where: and(
          eq(schema.follows.followerId, currentUserId),
          eq(schema.follows.followingId, post.authorId),
          eq(schema.follows.status, "ACCEPTED")
        ),
      });
      if (!following) {
        throw new HTTPException(403, { message: "This account is private" });
      }
    }

    // Check blocks
    const isBlocked = await this.checkBlock(currentUserId, post.authorId);
    if (isBlocked) {
      throw new HTTPException(403, { message: "You cannot view this post" });
    }
  }

  /**
   * Check if user is blocked (either direction)
   */
  private async checkBlock(userId: string, targetUserId: string): Promise<boolean> {
    const block = await db.query.blocks.findFirst({
      where: or(
        and(
          eq(schema.blocks.blockerId, userId),
          eq(schema.blocks.blockedId, targetUserId)
        ),
        and(
          eq(schema.blocks.blockerId, targetUserId),
          eq(schema.blocks.blockedId, userId)
        )
      ),
    });
    return !!block;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let postServiceInstance: PostService | null = null;

export function getPostService(): PostService {
  if (!postServiceInstance) {
    postServiceInstance = new PostService();
  }
  return postServiceInstance;
}

export function setPostService(service: PostService): void {
  postServiceInstance = service;
}