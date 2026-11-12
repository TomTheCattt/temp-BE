/**
 * Explore Service - Explore Page Algorithm
 * Implements: BE-063 (Explore page algorithm with non-followed + popular fallback)
 */

import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, desc, lt, inArray, not, isNull, sql, or, gte, exists, count } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

// ============================================================
// TYPES
// ============================================================

export interface ExploreItem {
  postId: string;
  authorId: string;
  caption: string | null;
  locationName: string | null;
  locationLat: string | null;
  locationLng: string | null;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  savesCount: number;
  viewsCount: number;
  isSponsored: boolean;
  sponsorUserId: string | null;
  audience: string;
  closeFriendsOnly: boolean;
  createdAt: Date;
  updatedAt: Date;
  username: string;
  fullName: string | null;
  avatarUrl: string | null;
  isVerified: boolean;
  isPrivate: boolean;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  mediaType: string | null;
  width: number | null;
  height: number | null;
  duration: string | null;
  sortOrder: number;
  engagementScore: number;
  hoursSincePost: number;
  // Explore-specific
  source: 'collaborative' | 'content_based' | 'trending' | 'popular' | 'hashtag' | 'location';
  reason?: string;
}

export interface ExploreCursor {
  timestamp: string;
  engagementScore: number;
  postId: string;
  source: string;
}

export interface ExploreResult {
  items: ExploreItem[];
  nextCursor: ExploreCursor | null;
  hasMore: boolean;
  sections: ExploreSection[];
}

export interface ExploreSection {
  id: string;
  title: string;
  type: 'for_you' | 'trending' | 'hashtags' | 'locations' | 'accounts' | 'reels';
  items: ExploreItem[];
  cursor?: ExploreCursor;
}

export interface UserInterestProfile {
  topHashtags: Map<string, number>;
  topLocations: Map<string, number>;
  topAuthors: Map<string, number>;
  contentTypes: Map<string, number>;
  activeHours: number[];
  engagementPatterns: Map<string, number>;
}

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const EXPLORE_WINDOW_DAYS = 14;
const COLLABORATIVE_LIMIT = 8;
const CONTENT_BASED_LIMIT = 6;
const TRENDING_LIMIT = 4;
const POPULAR_FALLBACK_LIMIT = 20;

// ============================================================
// EXPLORE SERVICE CLASS
// ============================================================

export class ExploreService {
  private userId: string;
  private interestProfile: UserInterestProfile | null = null;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Get explore feed with multiple algorithm sources
   */
  async getExploreFeed(cursor?: string, limit: number = DEFAULT_LIMIT): Promise<ExploreResult> {
    const safeLimit = Math.min(limit, MAX_LIMIT);
    const parsedCursor = cursor ? this.parseCursor(cursor) : null;

    // Build interest profile (cached)
    if (!this.interestProfile) {
      this.interestProfile = await this.buildInterestProfile();
    }

    // Get candidates from different sources
    const [
      collaborative,
      contentBased,
      trending,
      popular,
    ] = await Promise.all([
      this.getCollaborativeFiltering(parsedCursor, COLLABORATIVE_LIMIT),
      this.getContentBased(parsedCursor, CONTENT_BASED_LIMIT),
      this.getTrending(parsedCursor, TRENDING_LIMIT),
      this.getPopularFallback(parsedCursor, POPULAR_FALLBACK_LIMIT),
    ]);

    // Merge and deduplicate
    const merged = this.mergeAndRank(
      collaborative,
      contentBased,
      trending,
      popular,
      safeLimit * 2
    );

    // Apply diversity
    const diversified = this.applyExploreDiversity(merged);

    // Create sections for UI
    const sections = this.createSections(diversified);

    // Paginate
    const items = diversified.slice(0, safeLimit);
    const hasMore = diversified.length > safeLimit;
    const nextCursor = hasMore ? this.encodeCursor(diversified[safeLimit - 1]) : null;

    return {
      items,
      nextCursor,
      hasMore,
      sections,
    };
  }

  /**
   * Get explore sections for grid layout
   */
  async getExploreSections(): Promise<ExploreSection[]> {
    if (!this.interestProfile) {
      this.interestProfile = await this.buildInterestProfile();
    }

    const [
      forYou,
      trending,
      hashtags,
      locations,
      accounts,
    ] = await Promise.all([
      this.getForYouSection(),
      this.getTrendingSection(),
      this.getHashtagSection(),
      this.getLocationSection(),
      this.getSuggestedAccountsSection(),
    ]);

    return [forYou, trending, hashtags, locations, accounts].filter(Boolean);
  }

  // ============================================================
  // SOURCE ALGORITHMS
  // ============================================================

  /**
   * Collaborative Filtering: Posts liked by users similar to current user
   * "Users who liked what you liked also liked..."
   */
  private async getCollaborativeFiltering(
    cursor: ExploreCursor | null,
    limit: number
  ): Promise<ExploreItem[]> {
    // Find similar users based on co-likes
    const similarUsers = await this.findSimilarUsers(20);

    if (similarUsers.length === 0) return [];

    // Get posts liked by similar users that current user hasn't seen
    const conditions: Array<ReturnType<typeof sql>> = [
      inArray(schema.posts.authorId, similarUsers.map(u => u.userId)),
      not(exists(
        db.select()
          .from(schema.likes)
          .where(and(
            eq(schema.likes.userId, this.userId),
            and(eq(schema.likes.likeableType, 'POST'), eq(schema.likes.likeableId, schema.posts.id))
          ))
      )),
      gte(schema.posts.createdAt, new Date(Date.now() - EXPLORE_WINDOW_DAYS * 24 * 60 * 60 * 1000)),
      eq(schema.posts.audience, 'PUBLIC'),
      isNull(schema.posts.deletedAt),
      isNull(schema.posts.archivedAt),
    ];

    if (cursor) {
      conditions.push(
        or(
          lt(schema.posts.createdAt, new Date(cursor.timestamp)),
          and(
            eq(schema.posts.createdAt, new Date(cursor.timestamp)),
            lt(sql`(posts.likes_count + posts.comments_count * 2 + posts.shares_count * 3 + posts.saves_count * 4)`, cursor.engagementScore)
          )
        ) as ReturnType<typeof sql>
      );
    }

    // Exclude blocked users
    const blocked = await db.select({ blockedId: schema.blocks.blockedId })
      .from(schema.blocks)
      .where(eq(schema.blocks.blockerId, this.userId));
    if (blocked.length > 0) {
      conditions.push(not(inArray(schema.posts.authorId, blocked.map(b => b.blockedId))));
    }

    // Exclude followed users (explore is for non-followed)
    const following = await db.select({ followingId: schema.follows.followingId })
      .from(schema.follows)
      .where(and(eq(schema.follows.followerId, this.userId), eq(schema.follows.status, 'ACCEPTED')));
    if (following.length > 0) {
      conditions.push(not(inArray(schema.posts.authorId, following.map(f => f.followingId))));
    }
    conditions.push(not(eq(schema.posts.authorId, this.userId)));

    const results = await db
      .select({
        postId: schema.posts.id,
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
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
        isPrivate: schema.users.isPrivate,
        mediaUrl: sql`(SELECT mi.url FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('media_url'),
        thumbnailUrl: sql`(SELECT mi.thumbnail_url FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('thumbnail_url'),
        mediaType: sql`(SELECT mi.type FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('media_type'),
        width: sql`(SELECT mi.width FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('width'),
        height: sql`(SELECT mi.height FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('height'),
        duration: sql`(SELECT mi.duration FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('duration'),
        sortOrder: sql`(SELECT mi.sort_order FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('sort_order'),
        engagementScore: sql`(posts.likes_count + posts.comments_count * 2 + posts.shares_count * 3 + posts.saves_count * 4)::numeric`.as('engagement_score'),
        hoursSincePost: sql`EXTRACT(EPOCH FROM (NOW() - posts.created_at)) / 3600.0`.as('hours_since_post'),
      })
      .from(schema.posts)
      .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
      .where(and(...conditions))
      .limit(limit)
      .orderBy(
        desc(sql`(posts.likes_count + posts.comments_count * 2 + posts.shares_count * 3 + posts.saves_count * 4)`),
        desc(schema.posts.createdAt)
      );

    return results.map(r => ({ ...r, source: 'collaborative' as const, reason: 'Liked by similar users' })) as ExploreItem[];
  }

  /**
   * Content-Based: Posts matching user's interest profile (hashtags, locations, content types)
   */
  private async getContentBased(
    cursor: ExploreCursor | null,
    limit: number
  ): Promise<ExploreItem[]> {
    if (!this.interestProfile) return [];

    const topHashtags = Array.from(this.interestProfile.topHashtags.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag]) => tag);

    const topLocations = Array.from(this.interestProfile.topLocations.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([loc]) => loc);

    const conditions: Array<ReturnType<typeof sql>> = [
      gte(schema.posts.createdAt, new Date(Date.now() - EXPLORE_WINDOW_DAYS * 24 * 60 * 60 * 1000)),
      eq(schema.posts.audience, 'PUBLIC'),
      isNull(schema.posts.deletedAt),
      isNull(schema.posts.archivedAt),
    ];

    if (cursor) {
      conditions.push(
        or(
          lt(schema.posts.createdAt, new Date(cursor.timestamp)),
          and(
            eq(schema.posts.createdAt, new Date(cursor.timestamp)),
            lt(sql`(posts.likes_count + posts.comments_count * 2 + posts.shares_count * 3 + posts.saves_count * 4)`, cursor.engagementScore)
          )
        ) as ReturnType<typeof sql>
      );
    }

    // Exclude followed, blocked, self
    const [following, blocked] = await Promise.all([
      db.select({ followingId: schema.follows.followingId })
        .from(schema.follows)
        .where(and(eq(schema.follows.followerId, this.userId), eq(schema.follows.status, 'ACCEPTED'))),
      db.select({ blockedId: schema.blocks.blockedId })
        .from(schema.blocks)
        .where(eq(schema.blocks.blockerId, this.userId)),
    ]);

    const excludeIds = [
      ...following.map(f => f.followingId),
      ...blocked.map(b => b.blockedId),
      this.userId,
    ];
    if (excludeIds.length > 0) {
      conditions.push(not(inArray(schema.posts.authorId, excludeIds)));
    }

    // Hashtag matching through search_index
    if (topHashtags.length > 0) {
      // Use search_index for hashtag-based discovery
      const hashtagPosts = await db
        .select({ contentId: schema.searchIndex.contentId })
        .from(schema.searchIndex)
        .where(
          and(
            eq(schema.searchIndex.contentType, 'post'),
            sql`${schema.searchIndex.description} ILIKE ANY(ARRAY[${topHashtags.map(t => `#${t}`).join(',')}])`
          )
        )
        .limit(limit * 2);

      if (hashtagPosts.length > 0) {
        conditions.push(inArray(schema.posts.id, hashtagPosts.map(h => h.contentId)));
      }
    }

    const results = await db
      .select({
        postId: schema.posts.id,
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
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
        isPrivate: schema.users.isPrivate,
        mediaUrl: sql`(SELECT mi.url FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('media_url'),
        thumbnailUrl: sql`(SELECT mi.thumbnail_url FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('thumbnail_url'),
        mediaType: sql`(SELECT mi.type FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('media_type'),
        width: sql`(SELECT mi.width FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('width'),
        height: sql`(SELECT mi.height FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('height'),
        duration: sql`(SELECT mi.duration FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('duration'),
        sortOrder: sql`(SELECT mi.sort_order FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('sort_order'),
        engagementScore: sql`(posts.likes_count + posts.comments_count * 2 + posts.shares_count * 3 + posts.saves_count * 4)::numeric`.as('engagement_score'),
        hoursSincePost: sql`EXTRACT(EPOCH FROM (NOW() - posts.created_at)) / 3600.0`.as('hours_since_post'),
      })
      .from(schema.posts)
      .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
      .where(and(...conditions))
      .limit(limit)
      .orderBy(
        desc(sql`(posts.likes_count + posts.comments_count * 2 + posts.shares_count * 3 + posts.saves_count * 4)`),
        desc(schema.posts.createdAt)
      );

    return results.map(r => ({ ...r, source: 'content_based' as const, reason: 'Matches your interests' })) as ExploreItem[];
  }

  /**
   * Trending: Posts with high velocity (engagement/time) in network
   */
  private async getTrending(
    cursor: ExploreCursor | null,
    limit: number
  ): Promise<ExploreItem[]> {
    const conditions: Array<ReturnType<typeof sql>> = [
      gte(schema.posts.createdAt, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)), // Last 48 hours
      eq(schema.posts.audience, 'PUBLIC'),
      isNull(schema.posts.deletedAt),
      isNull(schema.posts.archivedAt),
      // High engagement velocity: engagement / hours since post
      sql`(posts.likes_count + posts.comments_count * 2 + posts.shares_count * 3 + posts.saves_count * 4) / GREATEST(EXTRACT(EPOCH FROM (NOW() - posts.created_at)) / 3600.0, 0.5) > 10`,
    ];

    if (cursor) {
      conditions.push(lt(schema.posts.createdAt, new Date(cursor.timestamp)));
    }

    // Exclude followed, blocked, self
    const [following, blocked] = await Promise.all([
      db.select({ followingId: schema.follows.followingId })
        .from(schema.follows)
        .where(and(eq(schema.follows.followerId, this.userId), eq(schema.follows.status, 'ACCEPTED'))),
      db.select({ blockedId: schema.blocks.blockedId })
        .from(schema.blocks)
        .where(eq(schema.blocks.blockerId, this.userId)),
    ]);

    const excludeIds = [
      ...following.map(f => f.followingId),
      ...blocked.map(b => b.blockedId),
      this.userId,
    ];
    if (excludeIds.length > 0) {
      conditions.push(not(inArray(schema.posts.authorId, excludeIds)));
    }

    const results = await db
      .select({
        postId: schema.posts.id,
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
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
        isPrivate: schema.users.isPrivate,
        mediaUrl: sql`(SELECT mi.url FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('media_url'),
        thumbnailUrl: sql`(SELECT mi.thumbnail_url FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('thumbnail_url'),
        mediaType: sql`(SELECT mi.type FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('media_type'),
        width: sql`(SELECT mi.width FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('width'),
        height: sql`(SELECT mi.height FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('height'),
        duration: sql`(SELECT mi.duration FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('duration'),
        sortOrder: sql`(SELECT mi.sort_order FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('sort_order'),
        engagementScore: sql`(posts.likes_count + posts.comments_count * 2 + posts.shares_count * 3 + posts.saves_count * 4)::numeric`.as('engagement_score'),
        hoursSincePost: sql`EXTRACT(EPOCH FROM (NOW() - posts.created_at)) / 3600.0`.as('hours_since_post'),
      })
      .from(schema.posts)
      .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
      .where(and(...conditions))
      .limit(limit)
      .orderBy(
        desc(sql`(posts.likes_count + posts.comments_count * 2 + posts.shares_count * 3 + posts.saves_count * 4) / GREATEST(EXTRACT(EPOCH FROM (NOW() - posts.created_at)) / 3600.0, 0.5)`),
        desc(schema.posts.createdAt)
      );

    return results.map(r => ({ ...r, source: 'trending' as const, reason: 'Trending now' })) as ExploreItem[];
  }

  /**
   * Popular Fallback: High engagement posts from everyone (when other sources empty)
   */
  private async getPopularFallback(
    cursor: ExploreCursor | null,
    limit: number
  ): Promise<ExploreItem[]> {
    const conditions: Array<ReturnType<typeof sql>> = [
      gte(schema.posts.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)), // Last 7 days
      eq(schema.posts.audience, 'PUBLIC'),
      isNull(schema.posts.deletedAt),
      isNull(schema.posts.archivedAt),
      sql`(posts.likes_count + posts.comments_count * 2 + posts.shares_count * 3 + posts.saves_count * 4) > 50`,
    ];

    if (cursor) {
      conditions.push(lt(schema.posts.createdAt, new Date(cursor.timestamp)));
    }

    // Exclude followed, blocked, self
    const [following, blocked] = await Promise.all([
      db.select({ followingId: schema.follows.followingId })
        .from(schema.follows)
        .where(and(eq(schema.follows.followerId, this.userId), eq(schema.follows.status, 'ACCEPTED'))),
      db.select({ blockedId: schema.blocks.blockedId })
        .from(schema.blocks)
        .where(eq(schema.blocks.blockerId, this.userId)),
    ]);

    const excludeIds = [
      ...following.map(f => f.followingId),
      ...blocked.map(b => b.blockedId),
      this.userId,
    ];
    if (excludeIds.length > 0) {
      conditions.push(not(inArray(schema.posts.authorId, excludeIds)));
    }

    const results = await db
      .select({
        postId: schema.posts.id,
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
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
        isPrivate: schema.users.isPrivate,
        mediaUrl: sql`(SELECT mi.url FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('media_url'),
        thumbnailUrl: sql`(SELECT mi.thumbnail_url FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('thumbnail_url'),
        mediaType: sql`(SELECT mi.type FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('media_type'),
        width: sql`(SELECT mi.width FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('width'),
        height: sql`(SELECT mi.height FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('height'),
        duration: sql`(SELECT mi.duration FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('duration'),
        sortOrder: sql`(SELECT mi.sort_order FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('sort_order'),
        engagementScore: sql`(posts.likes_count + posts.comments_count * 2 + posts.shares_count * 3 + posts.saves_count * 4)::numeric`.as('engagement_score'),
        hoursSincePost: sql`EXTRACT(EPOCH FROM (NOW() - posts.created_at)) / 3600.0`.as('hours_since_post'),
      })
      .from(schema.posts)
      .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
      .where(and(...conditions))
      .limit(limit)
      .orderBy(
        desc(sql`(posts.likes_count + posts.comments_count * 2 + posts.shares_count * 3 + posts.saves_count * 4)`),
        desc(schema.posts.createdAt)
      );

    return results.map(r => ({ ...r, source: 'popular' as const, reason: 'Popular posts' })) as ExploreItem[];
  }

  // ============================================================
  // HELPER METHODS
  // ============================================================

  /**
   * Find similar users based on co-likes (collaborative filtering)
   */
  private async findSimilarUsers(limit: number): Promise<Array<{ userId: string; similarity: number }>> {
    // Get user's liked posts in last 30 days
    const userLikes = await db
      .select({ postId: schema.likes.likeableId })
      .from(schema.likes)
      .where(
        and(
          eq(schema.likes.userId, this.userId),
          eq(schema.likes.likeableType, 'POST'),
          gte(schema.likes.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
        )
      );

    if (userLikes.length === 0) return [];

    const likedPostIds = userLikes.map(l => l.postId);

    // Find users who also liked these posts (excluding self)
    const coLikers = await db
      .select({
        userId: schema.likes.userId,
        commonLikes: sql<number>`count(DISTINCT ${schema.likes.likeableId})`.as('common_likes'),
      })
      .from(schema.likes)
      .where(
        and(
          inArray(schema.likes.likeableId, likedPostIds),
          eq(schema.likes.likeableType, 'POST'),
          not(eq(schema.likes.userId, this.userId))
        )
      )
      .groupBy(schema.likes.userId)
      .having(sql`count(DISTINCT ${schema.likes.likeableId}) >= 3`)
      .orderBy(desc(sql`count(DISTINCT ${schema.likes.likeableId})`))
      .limit(limit);

    // Calculate Jaccard similarity
    const userLikeCount = likedPostIds.length;
    return coLikers.map(row => ({
      userId: row.userId,
      similarity: Number(row.commonLikes) / (userLikeCount + Number(row.commonLikes) - Number(row.commonLikes)),
    }));
  }

  /**
   * Build user interest profile from engagement history
   */
  private async buildInterestProfile(): Promise<UserInterestProfile> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      hashtagEngagements,
      locationEngagements,
      authorEngagements,
      contentTypeEngagements,
      hourEngagements,
    ] = await Promise.all([
      // Hashtags from liked/commented posts
      db
        .select({
          tag: schema.hashtags.tag,
          count: sql<number>`count(*)`.as('count'),
        })
        .from(schema.likes)
        .innerJoin(schema.posts, and(eq(schema.posts.id, schema.likes.likeableId), eq(schema.likes.likeableType, 'POST')))
        .innerJoin(schema.hashtagUsages, and(
          eq(schema.hashtagUsages.usageId, schema.posts.id),
          eq(schema.hashtagUsages.usageType, 'post')
        ))
        .innerJoin(schema.hashtags, eq(schema.hashtags.id, schema.hashtagUsages.hashtagId))
        .where(
          and(
            eq(schema.likes.userId, this.userId),
            eq(schema.likes.likeableType, 'POST'),
            gte(schema.likes.createdAt, thirtyDaysAgo)
          )
        )
        .groupBy(schema.hashtags.tag)
        .orderBy(desc(sql`count(*)`))
        .limit(50),

      // Locations from engaged posts
      db
        .select({
          name: schema.locations.name,
          count: sql<number>`count(*)`.as('count'),
        })
        .from(schema.likes)
        .innerJoin(schema.posts, and(eq(schema.posts.id, schema.likes.likeableId), eq(schema.likes.likeableType, 'POST')))
        .innerJoin(schema.locations, eq(schema.locations.id, schema.posts.locationId))
        .where(
          and(
            eq(schema.likes.userId, this.userId),
            eq(schema.likes.likeableType, 'POST'),
            gte(schema.likes.createdAt, thirtyDaysAgo)
          )
        )
        .groupBy(schema.locations.name)
        .orderBy(desc(sql`count(*)`))
        .limit(20),

      // Authors user engages with
      db
        .select({
          authorId: schema.posts.authorId,
          count: sql<number>`count(*)`.as('count'),
        })
        .from(schema.likes)
        .innerJoin(schema.posts, and(eq(schema.posts.id, schema.likes.likeableId), eq(schema.likes.likeableType, 'POST')))
        .where(
          and(
            eq(schema.likes.userId, this.userId),
            eq(schema.likes.likeableType, 'POST'),
            gte(schema.likes.createdAt, thirtyDaysAgo)
          )
        )
        .groupBy(schema.posts.authorId)
        .orderBy(desc(sql`count(*)`))
        .limit(30),

      // Content types
      db
        .select({
          type: schema.mediaItems.type,
          count: sql<number>`count(*)`.as('count'),
        })
        .from(schema.likes)
        .innerJoin(schema.posts, and(eq(schema.posts.id, schema.likes.likeableId), eq(schema.likes.likeableType, 'POST')))
        .innerJoin(schema.mediaItems, and(
          eq(schema.mediaItems.mediaableId, schema.posts.id),
          eq(schema.mediaItems.mediaableType, 'post')
        ))
        .where(
          and(
            eq(schema.likes.userId, this.userId),
            eq(schema.likes.likeableType, 'POST'),
            gte(schema.likes.createdAt, thirtyDaysAgo)
          )
        )
        .groupBy(schema.mediaItems.type)
        .orderBy(desc(sql`count(*)`)),

      // Active hours
      db
        .select({
          hour: sql<number>`EXTRACT(HOUR FROM ${schema.likes.createdAt})`.as('hour'),
          count: sql<number>`count(*)`.as('count'),
        })
        .from(schema.likes)
        .where(
          and(
            eq(schema.likes.userId, this.userId),
            gte(schema.likes.createdAt, thirtyDaysAgo)
          )
        )
        .groupBy(sql`EXTRACT(HOUR FROM ${schema.likes.createdAt})`)
        .orderBy(desc(sql`count(*)`)),
    ]);

    return {
      topHashtags: new Map(hashtagEngagements.map(h => [h.tag, Number(h.count)])),
      topLocations: new Map(locationEngagements.map(l => [l.name, Number(l.count)])),
      topAuthors: new Map(authorEngagements.map(a => [a.authorId, Number(a.count)])),
      contentTypes: new Map(contentTypeEngagements.map(c => [c.type, Number(c.count)])),
      activeHours: hourEngagements.map(h => Number(h.hour)),
      engagementPatterns: new Map(),
    };
  }

  /**
   * Merge and rank results from different sources
   */
  private mergeAndRank(
    collaborative: ExploreItem[],
    contentBased: ExploreItem[],
    trending: ExploreItem[],
    popular: ExploreItem[],
    limit: number
  ): ExploreItem[] {
    const all = new Map<string, ExploreItem>();

    // Source priority weights
    const sourceWeights = {
      collaborative: 1.0,
      content_based: 0.9,
      trending: 0.8,
      popular: 0.5,
    };

    const addItems = (items: ExploreItem[], source: keyof typeof sourceWeights) => {
      for (const item of items) {
        const existing = all.get(item.postId);
        if (!existing || sourceWeights[source] > sourceWeights[existing.source as keyof typeof sourceWeights]) {
          // Boost score by source weight
          item.engagementScore = item.engagementScore * sourceWeights[source];
          all.set(item.postId, item);
        }
      }
    };

    addItems(collaborative, 'collaborative');
    addItems(contentBased, 'content_based');
    addItems(trending, 'trending');
    addItems(popular, 'popular');

    // Sort by boosted engagement score
    return Array.from(all.values())
      .sort((a, b) => b.engagementScore - a.engagementScore)
      .slice(0, limit);
  }

  /**
   * Apply diversity for explore (author, content type, source)
   */
  private applyExploreDiversity(items: ExploreItem[]): ExploreItem[] {
    const authorCount = new Map<string, number>();
    const sourceCount = new Map<string, number>();
    const typeCount = new Map<string, number>();
    const result: ExploreItem[] = [];

    const maxPerAuthor = 2;
    const maxPerSource = Math.ceil(items.length / 4);
    const maxPerType = Math.ceil(items.length / 3);

    for (const item of items) {
      const authorCnt = authorCount.get(item.authorId) || 0;
      const sourceCnt = sourceCount.get(item.source) || 0;
      const typeCnt = typeCount.get(item.mediaType || 'UNKNOWN') || 0;

      if (authorCnt < maxPerAuthor && sourceCnt < maxPerSource && typeCnt < maxPerType) {
        authorCount.set(item.authorId, authorCnt + 1);
        sourceCount.set(item.source, sourceCnt + 1);
        typeCount.set(item.mediaType || 'UNKNOWN', typeCnt + 1);
        result.push(item);
      }
    }

    return result;
  }

  /**
   * Create explore sections for UI
   */
  private createSections(items: ExploreItem[]): ExploreSection[] {
    const sections: ExploreSection[] = [];

    // For You section (top personalized)
    const forYou = items.filter(i => i.source === 'collaborative' || i.source === 'content_based').slice(0, 10);
    if (forYou.length > 0) {
      sections.push({
        id: 'for_you',
        title: 'For You',
        type: 'for_you',
        items: forYou,
      });
    }

    // Trending section
    const trending = items.filter(i => i.source === 'trending').slice(0, 6);
    if (trending.length > 0) {
      sections.push({
        id: 'trending',
        title: 'Trending',
        type: 'trending',
        items: trending,
      });
    }

    // Popular fallback
    const popular = items.filter(i => i.source === 'popular').slice(0, 6);
    if (popular.length > 0) {
      sections.push({
        id: 'popular',
        title: 'Popular',
        type: 'trending',
        items: popular,
      });
    }

    return sections;
  }

  // ============================================================
  // SECTION-SPECIFIC METHODS
  // ============================================================

  private async getForYouSection(): Promise<ExploreSection> {
    const items = await this.getCollaborativeFiltering(null, 10);
    return {
      id: 'for_you',
      title: 'For You',
      type: 'for_you',
      items,
    };
  }

  private async getTrendingSection(): Promise<ExploreSection> {
    const items = await this.getTrending(null, 8);
    return {
      id: 'trending',
      title: 'Trending Now',
      type: 'trending',
      items,
    };
  }

  private async getHashtagSection(): Promise<ExploreSection> {
    if (!this.interestProfile) return { id: 'hashtags', title: 'Hashtags', type: 'hashtags', items: [] };

    const topHashtags = Array.from(this.interestProfile.topHashtags.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Get sample posts for each hashtag
    const items: ExploreItem[] = [];
    for (const [tag] of topHashtags) {
      const posts = await db
        .select({
          postId: schema.posts.id,
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
          username: schema.users.username,
          fullName: schema.users.fullName,
          avatarUrl: schema.users.avatarUrl,
          isVerified: schema.users.isVerified,
          isPrivate: schema.users.isPrivate,
          mediaUrl: sql<string | null>`(SELECT mi.url FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('media_url'),
          thumbnailUrl: sql<string | null>`(SELECT mi.thumbnail_url FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('thumbnail_url'),
          mediaType: sql<string | null>`(SELECT mi.type FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('media_type'),
          width: sql<number | null>`(SELECT mi.width FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('width'),
          height: sql<number | null>`(SELECT mi.height FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('height'),
          duration: sql<string | null>`(SELECT mi.duration FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('duration'),
          sortOrder: sql<number>`(SELECT COALESCE(mi.sort_order, 0) FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('sort_order'),
          engagementScore: sql<number>`(posts.likes_count + posts.comments_count * 2 + posts.shares_count * 3 + posts.saves_count * 4)::numeric`.as('engagement_score'),
          hoursSincePost: sql<number>`EXTRACT(EPOCH FROM (NOW() - posts.created_at)) / 3600.0`.as('hours_since_post'),
        })
        .from(schema.posts)
        .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
        .innerJoin(schema.hashtagUsages, and(
          eq(schema.hashtagUsages.usageId, schema.posts.id),
          eq(schema.hashtagUsages.usageType, 'post')
        ))
        .innerJoin(schema.hashtags, eq(schema.hashtags.id, schema.hashtagUsages.hashtagId))
        .where(
          and(
            eq(schema.hashtags.tag, tag),
            eq(schema.posts.audience, 'PUBLIC'),
            isNull(schema.posts.deletedAt),
            isNull(schema.posts.archivedAt),
            not(eq(schema.posts.authorId, this.userId))
          )
        )
        .orderBy(desc(schema.posts.likesCount))
        .limit(2);

      items.push(...posts.map(p => ({ ...p, source: 'hashtag' as const, reason: `#${tag}` })));
    }

    return {
      id: 'hashtags',
      title: 'Hashtags You Might Like',
      type: 'hashtags',
      items: items.slice(0, 10),
    };
  }

  private async getLocationSection(): Promise<ExploreSection> {
    if (!this.interestProfile) return { id: 'locations', title: 'Locations', type: 'locations', items: [] };

    const topLocations = Array.from(this.interestProfile.topLocations.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const items: ExploreItem[] = [];
    for (const [loc] of topLocations) {
      const posts = await db
        .select({
          postId: schema.posts.id,
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
          username: schema.users.username,
          fullName: schema.users.fullName,
          avatarUrl: schema.users.avatarUrl,
          isVerified: schema.users.isVerified,
          isPrivate: schema.users.isPrivate,
          mediaUrl: sql<string | null>`(SELECT mi.url FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('media_url'),
          thumbnailUrl: sql<string | null>`(SELECT mi.thumbnail_url FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('thumbnail_url'),
          mediaType: sql<string | null>`(SELECT mi.type FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('media_type'),
          width: sql<number | null>`(SELECT mi.width FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('width'),
          height: sql<number | null>`(SELECT mi.height FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('height'),
          duration: sql<string | null>`(SELECT mi.duration FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('duration'),
          sortOrder: sql<number>`(SELECT COALESCE(mi.sort_order, 0) FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('sort_order'),
          engagementScore: sql<number>`(posts.likes_count + posts.comments_count * 2 + posts.shares_count * 3 + posts.saves_count * 4)::numeric`.as('engagement_score'),
          hoursSincePost: sql<number>`EXTRACT(EPOCH FROM (NOW() - posts.created_at)) / 3600.0`.as('hours_since_post'),
        })
        .from(schema.posts)
        .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
        .where(
          and(
            eq(schema.posts.locationName, loc),
            eq(schema.posts.audience, 'PUBLIC'),
            isNull(schema.posts.deletedAt),
            isNull(schema.posts.archivedAt),
            not(eq(schema.posts.authorId, this.userId))
          )
        )
        .orderBy(desc(schema.posts.likesCount))
        .limit(3);

      items.push(...posts.map(p => ({ ...p, source: 'location' as const, reason: `Near ${loc}` })));
    }

    return {
      id: 'locations',
      title: 'Places You Might Like',
      type: 'locations',
      items: items.slice(0, 9),
    };
  }

  private async getSuggestedAccountsSection(): Promise<ExploreSection> {
    // Suggest accounts based on followers of followed users
    const following = await db
      .select({ followingId: schema.follows.followingId })
      .from(schema.follows)
      .where(and(eq(schema.follows.followerId, this.userId), eq(schema.follows.status, 'ACCEPTED')));

    if (following.length === 0) return { id: 'accounts', title: 'Suggested Accounts', type: 'accounts', items: [] };

    const followingIds = following.map(f => f.followingId);

    // Get followers of followed users (friends of friends)
    const suggestions = await db
      .select({
        userId: schema.follows.followerId,
        mutualCount: sql<number>`count(*)`.as('mutual_count'),
      })
      .from(schema.follows)
      .where(
        and(
          inArray(schema.follows.followingId, followingIds),
          eq(schema.follows.status, 'ACCEPTED'),
          not(eq(schema.follows.followerId, this.userId)),
          not(inArray(schema.follows.followerId, followingIds))
        )
      )
      .groupBy(schema.follows.followerId)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    // Get user details
    const userIds = suggestions.map(s => s.userId);
    if (userIds.length === 0) return { id: 'accounts', title: 'Suggested Accounts', type: 'accounts', items: [] };

    const users = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
        isPrivate: schema.users.isPrivate,
        followersCount: schema.users.followersCount,
      })
      .from(schema.users)
      .where(inArray(schema.users.id, userIds));

    // Convert to explore items (using first post as preview)
    const items: ExploreItem[] = [];
    for (const user of users) {
      const mutual = suggestions.find(s => s.userId === user.id);
      const post = await db
        .select({
          postId: schema.posts.id,
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
          username: schema.users.username,
          fullName: schema.users.fullName,
          avatarUrl: schema.users.avatarUrl,
          isVerified: schema.users.isVerified,
          isPrivate: schema.users.isPrivate,
          mediaUrl: sql<string | null>`(SELECT mi.url FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('media_url'),
          thumbnailUrl: sql<string | null>`(SELECT mi.thumbnail_url FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('thumbnail_url'),
          mediaType: sql<string | null>`(SELECT mi.type FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('media_type'),
          width: sql<number | null>`(SELECT mi.width FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('width'),
          height: sql<number | null>`(SELECT mi.height FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('height'),
          duration: sql<string | null>`(SELECT mi.duration FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('duration'),
          sortOrder: sql<number>`(SELECT COALESCE(mi.sort_order, 0) FROM media_items mi WHERE mi.mediaable_type = 'post' AND mi.mediaable_id = posts.id ORDER BY mi.sort_order LIMIT 1)`.as('sort_order'),
          engagementScore: sql<number>`(posts.likes_count + posts.comments_count * 2 + posts.shares_count * 3 + posts.saves_count * 4)::numeric`.as('engagement_score'),
          hoursSincePost: sql<number>`EXTRACT(EPOCH FROM (NOW() - posts.created_at)) / 3600.0`.as('hours_since_post'),
        })
        .from(schema.posts)
        .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
        .where(
          and(
            eq(schema.posts.authorId, user.id),
            eq(schema.posts.audience, 'PUBLIC'),
            isNull(schema.posts.deletedAt),
            isNull(schema.posts.archivedAt)
          )
        )
        .orderBy(desc(schema.posts.createdAt))
        .limit(1);

      if (post.length > 0) {
        items.push({
          ...post[0],
          source: 'collaborative',
          reason: `${mutual?.mutualCount || 0} mutual followers`,
        });
      }
    }

    return {
      id: 'accounts',
      title: 'Suggested For You',
      type: 'accounts',
      items: items.slice(0, 10),
    };
  }

  // ============================================================
  // CURSOR HELPERS
  // ============================================================

  private parseCursor(cursor: string): ExploreCursor {
    try {
      const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
      return JSON.parse(decoded);
    } catch {
      throw new HTTPException(400, { message: 'Invalid cursor' });
    }
  }

  private encodeCursor(item: ExploreItem): ExploreCursor {
    return {
      timestamp: item.createdAt.toISOString(),
      engagementScore: item.engagementScore,
      postId: item.postId,
      source: item.source,
    };
  }

  getCursorString(cursor: ExploreCursor): string {
    return Buffer.from(JSON.stringify(cursor)).toString('base64');
  }
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

export function createExploreService(userId: string): ExploreService {
  return new ExploreService(userId);
}