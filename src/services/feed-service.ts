/**
 * Feed Service - Ranking Algorithm & Invalidation
 * Implements: BE-061 (Feed ranking), BE-062 (Cursor pagination), BE-066 (Invalidation)
 */

import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, desc, lt, inArray, not, isNull, sql, or, gte } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

// ============================================================
// TYPES
// ============================================================

export interface FeedItem {
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
  campaignId?: string;
  bidCents?: number;
}

export interface FeedCursor {
  timestamp: string; // ISO timestamp of last item
  engagementScore?: number; // For stable ordering when timestamps tie
  postId: string; // Unique tiebreaker
}

export interface FeedResult {
  items: FeedItem[];
  nextCursor: FeedCursor | null;
  hasMore: boolean;
  sponsoredInjected: number;
}

export interface FeedRankingSignals {
  // Interest signals
  userInterestScore: number;        // ML model: user's historical engagement with author/content type
  contentTypeAffinity: number;      // User prefers reels vs posts vs carousels

  // Recency
  timeDecay: number;                // Exponential decay: e^(-λ * hoursSincePost)

  // Relationship
  interactionFrequency: number;     // How often user interacts with author
  directInteractions: number;       // DMs, profile visits, shares
  isCloseFriend: boolean;           // Boost for close friends

  // Content Quality
  engagementRate: number;           // (likes + comments * 2 + shares * 3 + saves * 4) / impressions
  mediaQualityScore: number;        // Resolution, aspect ratio, caption length
  originalityScore: number;         // Duplicate detection

  // Diversity
  authorDiversity: number;          // Prevent same author dominating
  contentTypeDiversity: number;     // Mix of posts, reels, suggested
}

export interface RankedFeedItem extends FeedItem {
  score: number;
  signals: FeedRankingSignals;
}

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const FEED_WINDOW_DAYS = 30;
const TIME_DECAY_LAMBDA = 0.1; // Exponential decay factor
const SPONSORED_INJECTION_INTERVAL = 4; // Every 4 organic posts

// Ranking weights (sum should be ~1.0)
const WEIGHTS = {
  interest: 0.30,
  recency: 0.25,
  relationship: 0.20,
  quality: 0.15,
  diversity: 0.10,
};

// ============================================================
// FEED SERVICE CLASS
// ============================================================

export class FeedService {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Get home feed with ranking algorithm and cursor pagination
   */
  async getFeed(cursor?: string, limit: number = DEFAULT_LIMIT): Promise<FeedResult> {
    const safeLimit = Math.min(limit, MAX_LIMIT);
    const parsedCursor = cursor ? this.parseCursor(cursor) : null;

    // Get candidate posts from materialized view
    const candidates = await this.getFeedCandidates(parsedCursor, safeLimit * 2); // Fetch 2x for ranking

    if (candidates.length === 0) {
      return { items: [], nextCursor: null, hasMore: false, sponsoredInjected: 0 };
    }

    // Score each candidate
    const scored = await this.scoreCandidates(candidates);

    // Sort by score, apply diversity
    const ranked = this.applyDiversity(scored.sort((a, b) => b.score - a.score));

    // Inject sponsored content
    const withSponsored = await this.injectSponsoredContent(ranked, safeLimit);

    // Paginate
    const items = withSponsored.slice(0, safeLimit);
    const hasMore = withSponsored.length > safeLimit;
    const nextCursor = hasMore ? this.encodeCursor(items[items.length - 1]) : null;

    return {
      items,
      nextCursor,
      hasMore,
      sponsoredInjected: withSponsored.filter(i => i.isSponsored).length,
    };
  }

  /**
   * Get candidate posts from materialized view
   */
  private async getFeedCandidates(
    cursor: FeedCursor | null,
    limit: number
  ): Promise<FeedItem[]> {
    let query: string;
    const windowStart = new Date(Date.now() - FEED_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    if (cursor) {
      query = `
        SELECT * FROM feed_items
        WHERE (created_at < '${cursor.timestamp}'
          OR (created_at = '${cursor.timestamp}' AND engagement_score < ${cursor.engagementScore || 0})
          OR (created_at = '${cursor.timestamp}' AND engagement_score = ${cursor.engagementScore || 0} AND post_id < '${cursor.postId}'))
          AND created_at >= '${windowStart}'
        ORDER BY created_at DESC, engagement_score DESC, post_id DESC
        LIMIT ${limit}
      `;
    } else {
      query = `
        SELECT * FROM feed_items
        WHERE created_at >= '${windowStart}'
        ORDER BY created_at DESC, engagement_score DESC, post_id DESC
        LIMIT ${limit}
      `;
    }

    const result = await db.execute(sql.raw(query));
    return result.rows as unknown as FeedItem[];
  }

  /**
   * Score candidates using ranking algorithm
   */
  private async scoreCandidates(candidates: FeedItem[]): Promise<RankedFeedItem[]> {
    // Batch fetch signals for all candidates
    const authorIds = [...new Set(candidates.map(c => c.authorId))];

    const [
      interactions,
      closeFriends,
      userPostTypes,
    ] = await Promise.all([
      this.getUserAuthorInteractions(authorIds),
      this.getUserCloseFriends(),
      this.getUserContentTypeAffinity(),
    ]);

    return candidates.map(candidate => {
      const signals = this.computeSignals(candidate, {
        interactions: interactions.get(candidate.authorId) || { frequency: 0, direct: 0 },
        isCloseFriend: closeFriends.has(candidate.authorId),
        contentTypeAffinity: userPostTypes,
      });

      const score = this.calculateScore(signals);

      return { ...candidate, score, signals };
    });
  }

  /**
   * Compute ranking signals for a candidate
   */
  private computeSignals(
    candidate: FeedItem,
    context: {
      interactions: { frequency: number; direct: number };
      isCloseFriend: boolean;
      contentTypeAffinity: Map<string, number>;
    }
  ): FeedRankingSignals {
    const hoursSincePost = candidate.hoursSincePost;

    // Time decay: exponential decay
    const timeDecay = Math.exp(-TIME_DECAY_LAMBDA * hoursSincePost);

    // Interest score (simplified - would use ML model in production)
    const userInterestScore = Math.min(context.interactions.frequency / 10, 1.0);

    // Content type affinity
    const contentTypeAffinity = context.contentTypeAffinity.get(candidate.mediaType || 'IMAGE') || 0.5;

    // Relationship signals
    const interactionFrequency = Math.min(context.interactions.frequency / 20, 1.0);
    const directInteractions = Math.min(context.interactions.direct / 5, 1.0);

    // Quality signals
    const engagementRate = candidate.engagementScore / Math.max(candidate.viewsCount || 1, 1);
    const mediaQualityScore = this.computeMediaQuality(candidate);
    const originalityScore = 1.0; // Placeholder for duplicate detection

    // Diversity signals (computed later in applyDiversity)
    const authorDiversity = 1.0;
    const contentTypeDiversity = 1.0;

    return {
      userInterestScore,
      contentTypeAffinity,
      timeDecay,
      interactionFrequency,
      directInteractions,
      isCloseFriend: context.isCloseFriend,
      engagementRate,
      mediaQualityScore,
      originalityScore,
      authorDiversity,
      contentTypeDiversity,
    };
  }

  /**
   * Calculate final score from signals
   */
  private calculateScore(signals: FeedRankingSignals): number {
    // Interest component
    const interestScore = signals.userInterestScore * WEIGHTS.interest;

    // Recency component
    const recencyScore = signals.timeDecay * WEIGHTS.recency;

    // Relationship component
    const relationshipScore = (
      (signals.interactionFrequency * 0.6) +
      (signals.directInteractions * 0.2) +
      (signals.isCloseFriend ? 0.2 : 0)
    ) * WEIGHTS.relationship;

    // Quality component
    const qualityScore = (
      (signals.engagementRate * 0.5) +
      (signals.mediaQualityScore * 0.3) +
      (signals.originalityScore * 0.2)
    ) * WEIGHTS.quality;

    // Diversity component (base, modified in applyDiversity)
    const diversityScore = (
      (signals.authorDiversity * 0.5) +
      (signals.contentTypeDiversity * 0.5)
    ) * WEIGHTS.diversity;

    // Close friend boost (applied after weighting)
    const closeFriendBoost = signals.isCloseFriend ? 0.15 : 0;

    return interestScore + recencyScore + relationshipScore + qualityScore + diversityScore + closeFriendBoost;
  }

  /**
   * Compute media quality score
   */
  private computeMediaQuality(candidate: FeedItem): number {
    let score = 0.5; // Base score

    // Resolution bonus
    if (candidate.width && candidate.height) {
      const megapixels = (candidate.width * candidate.height) / 1_000_000;
      if (megapixels >= 2) score += 0.2;
      else if (megapixels >= 1) score += 0.1;
    }

    // Aspect ratio check (prefer 4:5 or 1:1)
    if (candidate.width && candidate.height) {
      const ratio = candidate.width / candidate.height;
      if (ratio >= 0.8 && ratio <= 1.25) score += 0.15; // Near square
      else if (ratio >= 0.7 && ratio <= 1.4) score += 0.1;
    }

    // Caption length (moderate length is good)
    if (candidate.caption) {
      const len = candidate.caption.length;
      if (len >= 50 && len <= 500) score += 0.1;
      else if (len > 0) score += 0.05;
    }

    // Video duration (short videos preferred for feed)
    if (candidate.mediaType === 'VIDEO' && candidate.duration) {
      const dur = parseFloat(candidate.duration);
      if (dur >= 3 && dur <= 60) score += 0.1; // Sweet spot
    }

    return Math.min(score, 1.0);
  }

  /**
   * Apply diversity filtering to prevent same author dominating
   */
  private applyDiversity(ranked: RankedFeedItem[]): RankedFeedItem[] {
    const authorCount = new Map<string, number>();
    const result: RankedFeedItem[] = [];
    const maxPerAuthor = 3; // Max posts from same author in top 20

    for (const item of ranked) {
      const count = authorCount.get(item.authorId) || 0;
      if (count < maxPerAuthor) {
        // Apply diversity penalty based on how many from same author already shown
        const diversityPenalty = count * 0.05;
        item.score = item.score * (1 - diversityPenalty);
        item.signals.authorDiversity = 1 - diversityPenalty;
        authorCount.set(item.authorId, count + 1);
        result.push(item);
      }
    }

    // Re-sort after diversity adjustment
    return result.sort((a, b) => b.score - a.score);
  }

  /**
   * Inject sponsored content into feed
   */
  private async injectSponsoredContent(
    organicItems: RankedFeedItem[],
    limit: number
  ): Promise<RankedFeedItem[]> {
    if (organicItems.length === 0) return organicItems;

    try {
      // Get sponsored posts for this user
      const sponsoredResult = await db.execute(sql`
        SELECT * FROM get_sponsored_posts_for_feed(${this.userId}::uuid, 3)
      `);

      const sponsoredPosts = sponsoredResult.rows as unknown as FeedItem[];
      if (sponsoredPosts.length === 0) return organicItems;

      const result: RankedFeedItem[] = [];
      let sponsoredIndex = 0;

      for (let i = 0; i < organicItems.length && result.length < limit; i++) {
        result.push(organicItems[i]);

        // Inject sponsored content at intervals
        if (
          sponsoredIndex < sponsoredPosts.length &&
          (i + 1) % SPONSORED_INJECTION_INTERVAL === 0 &&
          result.length < limit
        ) {
          const sponsored = sponsoredPosts[sponsoredIndex];
          result.push({
            ...sponsored,
            score: 0, // Sponsored items don't need score
            signals: {} as FeedRankingSignals,
          });
          sponsoredIndex++;
        }
      }

      // Add remaining sponsored if space
      while (sponsoredIndex < sponsoredPosts.length && result.length < limit) {
        const sponsored = sponsoredPosts[sponsoredIndex];
        result.push({
          ...sponsored,
          score: 0,
          signals: {} as FeedRankingSignals,
        });
        sponsoredIndex++;
      }

      return result;
    } catch (error) {
      console.error('Failed to inject sponsored content:', error);
      return organicItems; // Fallback to organic only
    }
  }

  /**
   * Get user's interaction frequency with authors
   */
  private async getUserAuthorInteractions(
    authorIds: string[]
  ): Promise<Map<string, { frequency: number; direct: number }>> {
    if (authorIds.length === 0) return new Map();

    // Get likes, comments, shares, saves from user to these authors in last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      likes,
      comments,
      shares,
      saves,
      dms,
      profileViews,
    ] = await Promise.all([
      // Likes on posts from these authors
      db
        .select({
          authorId: schema.posts.authorId,
          count: sql<number>`count(*)`.as('count'),
        })
        .from(schema.likes)
        .innerJoin(schema.posts, eq(schema.posts.id, schema.likes.likeableId))
        .where(
          and(
            eq(schema.likes.userId, this.userId),
            inArray(schema.posts.authorId, authorIds),
            gte(schema.likes.createdAt, thirtyDaysAgo)
          )
        )
        .groupBy(schema.posts.authorId),

      // Comments on posts from these authors
      db
        .select({
          authorId: schema.posts.authorId,
          count: sql<number>`count(*)`.as('count'),
        })
        .from(schema.comments)
        .innerJoin(schema.posts, eq(schema.posts.id, schema.comments.commentableId))
        .where(
          and(
            eq(schema.comments.authorId, this.userId),
            inArray(schema.posts.authorId, authorIds),
            gte(schema.comments.createdAt, thirtyDaysAgo)
          )
        )
        .groupBy(schema.posts.authorId),

      // Shares (if implemented)
      Promise.resolve([]),
      // Saves
      db
        .select({
          authorId: schema.posts.authorId,
          count: sql<number>`count(*)`.as('count'),
        })
        .from(schema.savedItems)
        .innerJoin(schema.posts, eq(schema.posts.id, schema.savedItems.saveableId))
        .where(
          and(
            eq(schema.savedItems.userId, this.userId),
            eq(schema.savedItems.saveableType, 'POST'),
            inArray(schema.posts.authorId, authorIds),
            gte(schema.savedItems.createdAt, thirtyDaysAgo)
          )
        )
        .groupBy(schema.posts.authorId),

      // DMs with these authors
      db
        .select({
          userId: schema.conversationMembers.userId,
          count: sql<number>`count(*)`.as('count'),
        })
        .from(schema.conversationMembers)
        .innerJoin(schema.conversations, eq(schema.conversations.id, schema.conversationMembers.conversationId))
        .innerJoin(schema.messages, eq(schema.messages.conversationId, schema.conversations.id))
        .where(
          and(
            eq(schema.conversationMembers.userId, this.userId),
            inArray(schema.messages.senderId, authorIds),
            gte(schema.messages.createdAt, thirtyDaysAgo)
          )
        )
        .groupBy(schema.conversationMembers.userId),

      // Profile views (if tracked)
      Promise.resolve([]),
    ]);

    const result = new Map<string, { frequency: number; direct: number }>();

    const addFrequency = (arr: any[], weight: number) => {
      for (const row of arr) {
        const id = row.authorId || row.userId;
        const existing = result.get(id) || { frequency: 0, direct: 0 };
        existing.frequency += Number(row.count) * weight;
        result.set(id, existing);
      }
    };

    const addDirect = (arr: any[], weight: number) => {
      for (const row of arr) {
        const id = row.authorId || row.userId;
        const existing = result.get(id) || { frequency: 0, direct: 0 };
        existing.direct += Number(row.count) * weight;
        result.set(id, existing);
      }
    };

    addFrequency(likes, 1);
    addFrequency(comments, 2);
    addFrequency(shares, 3);
    addFrequency(saves, 4);
    addDirect(dms, 5);
    addDirect(profileViews, 2);

    return result;
  }

  /**
   * Get user's close friends
   */
  private async getUserCloseFriends(): Promise<Set<string>> {
    const friends = await db
      .select({ friendId: schema.closeFriends.friendId })
      .from(schema.closeFriends)
      .where(eq(schema.closeFriends.userId, this.userId));

    return new Set(friends.map(f => f.friendId));
  }

  /**
   * Get user's content type affinity (IMAGE, VIDEO, CAROUSEL)
   */
  private async getUserContentTypeAffinity(): Promise<Map<string, number>> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const engagements = await db
      .select({
        mediaType: schema.mediaItems.type,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(schema.likes)
      .innerJoin(schema.posts, eq(schema.posts.id, schema.likes.likeableId))
      .innerJoin(schema.mediaItems, and(
        eq(schema.mediaItems.mediaableId, schema.posts.id),
        eq(schema.mediaItems.mediaableType, 'post')
      ))
      .where(
        and(
          eq(schema.likes.userId, this.userId),
          gte(schema.likes.createdAt, thirtyDaysAgo)
        )
      )
      .groupBy(schema.mediaItems.type);

    const total = engagements.reduce((sum, e) => sum + Number(e.count), 0);
    const result = new Map<string, number>();

    for (const e of engagements) {
      result.set(e.mediaType, Number(e.count) / Math.max(total, 1));
    }

    return result;
  }

  /**
   * Parse cursor string to FeedCursor
   */
  private parseCursor(cursor: string): FeedCursor {
    try {
      const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
      return JSON.parse(decoded);
    } catch {
      throw new HTTPException(400, { message: 'Invalid cursor' });
    }
  }

  /**
   * Encode FeedCursor to base64 string
   */
  private encodeCursor(item: FeedItem): FeedCursor {
    const cursor: FeedCursor = {
      timestamp: item.createdAt.toISOString(),
      engagementScore: item.engagementScore,
      postId: item.postId,
    };
    return cursor;
  }

  /**
   * Get cursor string for response
   */
  getCursorString(cursor: FeedCursor): string {
    return Buffer.from(JSON.stringify(cursor)).toString('base64');
  }

  // ============================================================
  // FEED INVALIDATION (BE-066)
  // ============================================================

  /**
   * Invalidate feed for a user (called on follow/unfollow/block/new post)
   * Uses pg_notify for real-time invalidation
   */
  static async invalidateUserFeed(userId: string, reason: string, metadata?: any): Promise<void> {
    const payload = JSON.stringify({
      userId,
      reason,
      metadata,
      timestamp: new Date().toISOString(),
    });

    await db.execute(sql`SELECT pg_notify('feed_invalidate', ${payload})`);
  }

  /**
   * Invalidate feed for all followers of an author (new post)
   */
  static async invalidateFollowersFeed(authorId: string, postId: string): Promise<void> {
    const payload = JSON.stringify({
      authorId,
      postId,
      reason: 'new_post',
      timestamp: new Date().toISOString(),
    });

    await db.execute(sql`SELECT pg_notify('feed_invalidate_new_post', ${payload})`);
  }

  /**
   * Invalidate feed on follow/unfollow
   */
  static async invalidateFollowFeed(
    followerId: string,
    followingId: string,
    action: 'follow' | 'unfollow'
  ): Promise<void> {
    const payload = JSON.stringify({
      followerId,
      followingId,
      action,
      reason: 'follow_change',
      timestamp: new Date().toISOString(),
    });

    await db.execute(sql`SELECT pg_notify('feed_invalidate_follow', ${payload})`);
  }

  /**
   * Invalidate feed on block/unblock
   */
  static async invalidateBlockFeed(
    blockerId: string,
    blockedId: string,
    action: 'block' | 'unblock'
  ): Promise<void> {
    const payload = JSON.stringify({
      blockerId,
      blockedId,
      action,
      reason: 'block_change',
      timestamp: new Date().toISOString(),
    });

    await db.execute(sql`SELECT pg_notify('feed_invalidate_block', ${payload})`);
  }

  /**
   * Listen for feed invalidation events (for real-time updates)
   * Returns an async iterator that yields invalidation events
   */
  static async *listenForInvalidation(): AsyncGenerator<{
    userId: string;
    reason: string;
    metadata?: any;
  }> {
    // This would be implemented with a LISTEN/NOTIFY listener
    // For now, return empty - real implementation needs pg-listen or similar
    return;
  }
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Create a FeedService instance for a user
 */
export function createFeedService(userId: string): FeedService {
  return new FeedService(userId);
}

/**
 * Record sponsored impression for frequency capping
 */
export async function recordSponsoredImpression(
  sponsoredPostId: string,
  userId: string
): Promise<void> {
  await db.insert(schema.sponsoredImpressions).values({
    sponsoredPostId,
    userId,
    impressionDate: new Date(),
  }).onConflictDoNothing({ target: [schema.sponsoredImpressions.sponsoredPostId, schema.sponsoredImpressions.userId, schema.sponsoredImpressions.impressionDate] });
}

/**
 * Get sponsored post performance metrics
 */
export async function getSponsoredPostMetrics(sponsoredPostId: string): Promise<{
  impressions: number;
  clicks: number;
  spentCents: number;
  ctr: number;
  cpm: number;
}> {
  const [impressions, clicks, spent] = await Promise.all([
    db.select({ count: sql<number>`count(*)` })
      .from(schema.sponsoredImpressions)
      .where(eq(schema.sponsoredImpressions.sponsoredPostId, sponsoredPostId)),
    db.select({ count: sql<number>`count(*)` })
      .from(schema.sponsoredClicks)
      .where(eq(schema.sponsoredClicks.sponsoredPostId, sponsoredPostId)),
    db.select({ spentCents: schema.sponsoredPosts.spentCents })
      .from(schema.sponsoredPosts)
      .where(eq(schema.sponsoredPosts.id, sponsoredPostId)),
  ]);

  const imp = Number(impressions[0]?.count || 0);
  const clk = Number(clicks[0]?.count || 0);
  const spentCents = Number(spent[0]?.spentCents || 0);

  return {
    impressions: imp,
    clicks: clk,
    spentCents,
    ctr: imp > 0 ? clk / imp : 0,
    cpm: imp > 0 ? (spentCents / imp) * 1000 : 0,
  };
}