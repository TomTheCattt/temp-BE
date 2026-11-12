/**
 * Reel Service - Feed Algorithm, Audio Management, Engagement
 * Implements: BE-091 (Reels feed), BE-094 (Audio management), BE-095 (Engagement)
 */

import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, desc, asc, count, sql, inArray, lt, not, isNull, or, gte } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

// ============================================================
// TYPES
// ============================================================

export interface ReelItem {
  id: string;
  authorId: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  caption: string | null;
  audioId: string | null;
  audioName: string | null;
  audioArtist: string | null;
  isOriginalAudio: boolean;
  duration: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  savesCount: number;
  viewsCount: number;
  playsCount: number;
  audience: string;
  allowRemix: boolean;
  allowDownload: boolean;
  searchVector: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  author: {
    id: string;
    username: string;
    fullName: string | null;
    avatarUrl: string | null;
    isVerified: boolean;
    isPrivate: boolean;
  };
  isFollowing?: boolean;
}

export interface ReelWithEngagement extends ReelItem {
  isLiked: boolean;
  isSaved: boolean;
  isFollowing?: boolean;
  audio?: {
    id: string;
    name: string;
    artist: string | null;
    audioUrl: string;
    duration: number | null;
    waveformData: any;
    isLicensed: boolean;
    usageCount: number;
  } | null;
}

export interface ReelCursor {
  timestamp: string;
  score?: number;
  reelId: string;
}

export interface FeedResult {
  items: ReelWithEngagement[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface AudioTrack {
  id: string;
  name: string;
  artist: string | null;
  audioUrl: string;
  duration: number | null;
  waveformData: any;
  isLicensed: boolean;
  usageCount: number;
  createdAt: Date;
}

export interface SavedAudio {
  audioId: string;
  savedAt: Date;
  audio: AudioTrack;
}

export interface ReelRankingSignals {
  // Interest signals
  userInterestScore: number;
  contentTypeAffinity: number;

  // Recency
  timeDecay: number;

  // Relationship
  interactionFrequency: number;
  directInteractions: number;
  isCloseFriend: boolean;
  isFollowing: boolean;

  // Content Quality
  engagementRate: number;
  mediaQualityScore: number;
  completionRate: number;

  // Virality
  velocityScore: number;
  shareRate: number;

  // Diversity
  authorDiversity: number;
}

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const FEED_WINDOW_DAYS = 30;
const TIME_DECAY_LAMBDA = 0.15; // Faster decay for reels
const TRENDING_WINDOW_HOURS = 24;

// Ranking weights (sum = 1.0)
const WEIGHTS = {
  interest: 0.25,
  recency: 0.20,
  relationship: 0.15,
  quality: 0.20,
  virality: 0.15,
  diversity: 0.05,
};

// ============================================================
// REEL SERVICE CLASS
// ============================================================

export class ReelService {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  // ============================================================
  // FEED ALGORITHM (BE-091, BE-094)
  // ============================================================

  /**
   * Get personalized reels feed with ranking algorithm
   * Uses cursor-based pagination for infinite scroll
   */
  async getFeed(cursor?: string, limit: number = DEFAULT_LIMIT): Promise<FeedResult> {
    const safeLimit = Math.min(limit, MAX_LIMIT);
    const parsedCursor = cursor ? this.parseCursor(cursor) : null;

    // Get candidate reels from followed users + trending
    const candidates = await this.getFeedCandidates(parsedCursor, safeLimit * 3);

    if (candidates.length === 0) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    // Score each candidate
    const scored = await this.scoreCandidates(candidates);

    // Sort by score, apply diversity
    const ranked = this.applyDiversity(scored.sort((a, b) => b.score - a.score));

    // Paginate
    const items = ranked.slice(0, safeLimit);
    const hasMore = ranked.length > safeLimit;
    const nextCursor = hasMore ? this.encodeCursor(items[items.length - 1]) : null;

    return {
      items,
      nextCursor: nextCursor ? this.getCursorString(nextCursor) : null,
      hasMore,
    };
  }

  /**
   * Get trending/explore reels (popular + personalized)
   */
  async getExplore(cursor?: string, limit: number = DEFAULT_LIMIT): Promise<FeedResult> {
    const safeLimit = Math.min(limit, MAX_LIMIT);
    const parsedCursor = cursor ? this.parseCursor(cursor) : null;

    // Get trending reels (high velocity in last 24h) + personalized
    const candidates = await this.getExploreCandidates(parsedCursor, safeLimit * 3);

    if (candidates.length === 0) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    // Score with more weight on virality
    const scored = await this.scoreExploreCandidates(candidates);

    // Apply diversity
    const ranked = this.applyDiversity(scored.sort((a, b) => b.score - a.score));

    // Paginate
    const items = ranked.slice(0, safeLimit);
    const hasMore = ranked.length > safeLimit;
    const nextCursor = hasMore ? this.encodeCursor(items[items.length - 1]) : null;

    return {
      items,
      nextCursor: nextCursor ? this.getCursorString(nextCursor) : null,
      hasMore,
    };
  }

  /**
   * Get user's reels grid (profile page)
   */
  async getUserReels(
    targetUserId: string,
    cursor?: string,
    limit: number = DEFAULT_LIMIT,
    currentUserId?: string
  ): Promise<FeedResult & { total: number }> {
    const safeLimit = Math.min(limit, MAX_LIMIT);
    const parsedCursor = cursor ? new Date(cursor) : null;

    // Check privacy
    const targetUser = await db.query.users.findFirst({
      where: eq(schema.users.id, targetUserId),
      columns: { id: true, isPrivate: true },
    });

    if (!targetUser) {
      throw new HTTPException(404, { message: "User not found" });
    }

    if (targetUser.isPrivate && targetUserId !== currentUserId) {
      const following = await db.query.follows.findFirst({
        where: and(
          eq(schema.follows.followerId, currentUserId!),
          eq(schema.follows.followingId, targetUserId),
          eq(schema.follows.status, "ACCEPTED")
        ),
      });
      if (!following) {
        throw new HTTPException(403, { message: "This account is private" });
      }
    }

    // Check blocks
    if (currentUserId) {
      const isBlocked = await this.checkBlock(currentUserId, targetUserId);
      if (isBlocked) {
        throw new HTTPException(403, { message: "You cannot view these reels" });
      }
    }

    const whereConditions = [
      eq(schema.reels.authorId, targetUserId),
      isNull(schema.reels.deletedAt),
    ];

    // If not own profile, only show public reels
    if (targetUserId !== currentUserId) {
      whereConditions.push(eq(schema.reels.audience, "public"));
    }

    if (parsedCursor) {
      whereConditions.push(lt(schema.reels.createdAt, parsedCursor));
    }

    const [reelsList, total] = await Promise.all([
      db.select({
        id: schema.reels.id,
        authorId: schema.reels.authorId,
        videoUrl: schema.reels.videoUrl,
        thumbnailUrl: schema.reels.thumbnailUrl,
        caption: schema.reels.caption,
        audioId: schema.reels.audioId,
        audioName: schema.reels.audioName,
        audioArtist: schema.reels.audioArtist,
        isOriginalAudio: schema.reels.isOriginalAudio,
        duration: schema.reels.duration,
        likesCount: schema.reels.likesCount,
        commentsCount: schema.reels.commentsCount,
        sharesCount: schema.reels.sharesCount,
        savesCount: schema.reels.savesCount,
        viewsCount: schema.reels.viewsCount,
        playsCount: schema.reels.playsCount,
        audience: schema.reels.audience,
        allowRemix: schema.reels.allowRemix,
        allowDownload: schema.reels.allowDownload,
        searchVector: schema.reels.searchVector,
        createdAt: schema.reels.createdAt,
        updatedAt: schema.reels.updatedAt,
        deletedAt: schema.reels.deletedAt,
        author: {
          id: schema.users.id,
          username: schema.users.username,
          fullName: schema.users.fullName,
          avatarUrl: schema.users.avatarUrl,
          isVerified: schema.users.isVerified,
          isPrivate: schema.users.isPrivate,
        },
      })
        .from(schema.reels)
        .innerJoin(schema.users, eq(schema.users.id, schema.reels.authorId))
        .where(and(...whereConditions))
        .limit(safeLimit + 1)
        .orderBy(desc(schema.reels.createdAt)),
      db.select({ count: count() })
        .from(schema.reels)
        .where(and(eq(schema.reels.authorId, targetUserId), isNull(schema.reels.deletedAt))),
    ]);

    const hasMore = reelsList.length > safeLimit;
    const items = hasMore ? reelsList.slice(0, safeLimit) : reelsList;
    const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null;

    // Check engagement state for current user
    const reelIds = items.map((r) => r.id);
    let likedSet = new Set<string>();
    let savedSet = new Set<string>();

    if (currentUserId && reelIds.length > 0) {
      const [likes, saves] = await Promise.all([
        db.select({ reelId: schema.likes.likeableId })
          .from(schema.likes)
          .where(and(
            eq(schema.likes.userId, currentUserId),
            eq(schema.likes.likeableType, "REEL"),
            inArray(schema.likes.likeableId, reelIds)
          )),
        db.select({ reelId: schema.savedItems.saveableId })
          .from(schema.savedItems)
          .where(and(
            eq(schema.savedItems.userId, currentUserId),
            eq(schema.savedItems.saveableType, "REEL"),
            inArray(schema.savedItems.saveableId, reelIds)
          )),
      ]);
      likedSet = new Set(likes.map((l) => l.reelId));
      savedSet = new Set(saves.map((s) => s.reelId));
    }

    // Fetch audio info for reels
    const audioIds = [...new Set(items.filter(r => r.audioId).map(r => r.audioId!))];
    const audioMap = new Map<string, AudioTrack>();
    if (audioIds.length > 0) {
      const audioTracks = await db.query.audioTracks.findMany({
        where: inArray(schema.audioTracks.id, audioIds),
      });
      for (const audio of audioTracks) {
        audioMap.set(audio.id, {
          id: audio.id,
          name: audio.name,
          artist: audio.artist,
          audioUrl: audio.audioUrl,
          duration: audio.duration ? parseFloat(audio.duration.toString()) : null,
          waveformData: audio.waveformData,
          isLicensed: audio.isLicensed,
          usageCount: audio.usageCount,
          createdAt: audio.createdAt,
        });
      }
    }

    const enrichedItems: ReelWithEngagement[] = items.map((r) => ({
      ...r,
      duration: parseFloat(r.duration.toString()),
      isLiked: likedSet.has(r.id),
      isSaved: savedSet.has(r.id),
      isFollowing: targetUserId !== currentUserId,
      audio: r.audioId ? audioMap.get(r.audioId) || null : null,
    }));

    return {
      items: enrichedItems,
      nextCursor,
      hasMore,
      total: total[0]?.count || 0,
    };
  }

  /**
   * Get single reel by ID with audio info
   */
  async getReelById(reelId: string, currentUserId: string): Promise<ReelWithEngagement | null> {
    const reel = await db.query.reels.findFirst({
      where: and(eq(schema.reels.id, reelId), isNull(schema.reels.deletedAt)),
      with: { author: true, audio: true },
    });

    if (!reel) {
      return null;
    }

    // Check private account permissions
    if (reel.author.isPrivate && reel.authorId !== currentUserId) {
      const following = await db.query.follows.findFirst({
        where: and(
          eq(schema.follows.followerId, currentUserId),
          eq(schema.follows.followingId, reel.authorId),
          eq(schema.follows.status, "ACCEPTED")
        ),
      });
      if (!following) {
        throw new HTTPException(403, { message: "This account is private" });
      }
    }

    // Check block permissions
    const isBlocked = await this.checkBlock(currentUserId, reel.authorId);
    if (isBlocked) {
      throw new HTTPException(403, { message: "You cannot view this reel" });
    }

    // Check engagement state
    const [like, save] = await Promise.all([
      db.query.likes.findFirst({
        where: and(
          eq(schema.likes.userId, currentUserId),
          eq(schema.likes.likeableType, "REEL"),
          eq(schema.likes.likeableId, reelId)
        ),
      }),
      db.query.savedItems.findFirst({
        where: and(
          eq(schema.savedItems.userId, currentUserId),
          eq(schema.savedItems.saveableType, "REEL"),
          eq(schema.savedItems.saveableId, reelId)
        ),
      }),
    ]);

    // Check if following author
    const following = await db.query.follows.findFirst({
      where: and(
        eq(schema.follows.followerId, currentUserId),
        eq(schema.follows.followingId, reel.authorId),
        eq(schema.follows.status, "ACCEPTED")
      ),
    });

    return {
      id: reel.id,
      authorId: reel.authorId,
      videoUrl: reel.videoUrl,
      thumbnailUrl: reel.thumbnailUrl,
      caption: reel.caption,
      audioId: reel.audioId,
      audioName: reel.audioName,
      audioArtist: reel.audioArtist,
      isOriginalAudio: reel.isOriginalAudio,
      duration: parseFloat(reel.duration.toString()),
      likesCount: reel.likesCount,
      commentsCount: reel.commentsCount,
      sharesCount: reel.sharesCount,
      savesCount: reel.savesCount,
      viewsCount: reel.viewsCount,
      playsCount: reel.playsCount,
      audience: reel.audience,
      allowRemix: reel.allowRemix,
      allowDownload: reel.allowDownload,
      searchVector: reel.searchVector,
      createdAt: reel.createdAt,
      updatedAt: reel.updatedAt,
      deletedAt: reel.deletedAt,
      author: {
        id: reel.author.id,
        username: reel.author.username,
        fullName: reel.author.fullName,
        avatarUrl: reel.author.avatarUrl,
        isVerified: reel.author.isVerified,
        isPrivate: reel.author.isPrivate,
      },
      isLiked: !!like,
      isSaved: !!save,
      isFollowing: reel.authorId !== currentUserId ? !!following : false,
      audio: reel.audio ? {
        id: reel.audio.id,
        name: reel.audio.name,
        artist: reel.audio.artist,
        audioUrl: reel.audio.audioUrl,
        duration: reel.audio.duration ? parseFloat(reel.audio.duration.toString()) : null,
        waveformData: reel.audio.waveformData,
        isLicensed: reel.audio.isLicensed,
        usageCount: reel.audio.usageCount,
      } : null,
    };
  }

  // ============================================================
  // REEL CRUD (BE-093, BE-097)
  // ============================================================

  /**
   * Create a new reel
   */
  async createReel(input: {
    authorId: string;
    videoUrl: string;
    thumbnailUrl?: string;
    caption?: string;
    duration: number;
    audioId?: string;
    audioName?: string;
    audioArtist?: string;
    isOriginalAudio?: boolean;
    audience?: string;
    allowRemix?: boolean;
    allowDownload?: boolean;
  }): Promise<ReelWithEngagement> {
    const [reel] = await db
      .insert(schema.reels)
      .values({
        authorId: input.authorId,
        videoUrl: input.videoUrl,
        thumbnailUrl: input.thumbnailUrl,
        caption: input.caption,
        duration: input.duration.toString(),
        audioId: input.audioId,
        audioName: input.audioName,
        audioArtist: input.audioArtist,
        isOriginalAudio: input.isOriginalAudio ?? true,
        audience: input.audience || "public",
        allowRemix: input.allowRemix ?? true,
        allowDownload: input.allowDownload ?? false,
      })
      .returning();

    // Update user reels count
    await db.update(schema.users)
      .set({ reelsCount: sql`${schema.users.reelsCount} + 1` })
      .where(eq(schema.users.id, input.authorId));

    // If using licensed audio, increment usage count
    if (input.audioId) {
      await db.update(schema.audioTracks)
        .set({ usageCount: sql`${schema.audioTracks.usageCount} + 1` })
        .where(eq(schema.audioTracks.id, input.audioId));
    }

    // Fetch created reel with author and audio
    const createdReel = await this.getReelById(reel.id, input.authorId);
    if (!createdReel) {
      throw new HTTPException(500, { message: "Failed to create reel" });
    }

    return createdReel;
  }

  /**
   * Update reel (caption only for now)
   */
  async updateReel(reelId: string, userId: string, input: {
    caption?: string;
    audioName?: string;
    audioArtist?: string;
  }): Promise<ReelWithEngagement> {
    const reel = await db.query.reels.findFirst({
      where: eq(schema.reels.id, reelId),
    });

    if (!reel) {
      throw new HTTPException(404, { message: "Reel not found" });
    }

    if (reel.deletedAt) {
      throw new HTTPException(404, { message: "Reel not found" });
    }

    if (reel.authorId !== userId) {
      throw new HTTPException(403, { message: "Not authorized to edit this reel" });
    }

    const updateData: any = {
      updatedAt: new Date(),
    };

    if (input.caption !== undefined) updateData.caption = input.caption;
    if (input.audioName !== undefined) updateData.audioName = input.audioName;
    if (input.audioArtist !== undefined) updateData.audioArtist = input.audioArtist;

    const [updated] = await db.update(schema.reels)
      .set(updateData)
      .where(eq(schema.reels.id, reelId))
      .returning();

    const updatedReel = await this.getReelById(reelId, userId);
    if (!updatedReel) {
      throw new HTTPException(500, { message: "Failed to fetch updated reel" });
    }

    return updatedReel;
  }

  /**
   * Delete a reel
   */
  async deleteReel(reelId: string, userId: string): Promise<void> {
    const reel = await db.query.reels.findFirst({
      where: eq(schema.reels.id, reelId),
    });

    if (!reel) {
      throw new HTTPException(404, { message: "Reel not found" });
    }

    if (reel.deletedAt) {
      throw new HTTPException(404, { message: "Reel not found" });
    }

    if (reel.authorId !== userId) {
      throw new HTTPException(403, { message: "Not authorized to delete this reel" });
    }

    await db.delete(schema.reels).where(eq(schema.reels.id, reelId));

    // Update user reels count
    await db.update(schema.users)
      .set({ reelsCount: sql`${schema.users.reelsCount} - 1` })
      .where(eq(schema.users.id, userId));
  }

  // ============================================================
  // ENGAGEMENT (BE-095)
  // ============================================================

  /**
   * Like a reel
   */
  async likeReel(reelId: string, userId: string): Promise<void> {
    const reel = await db.query.reels.findFirst({
      where: eq(schema.reels.id, reelId),
      with: { author: true },
    });

    if (!reel) {
      throw new HTTPException(404, { message: "Reel not found" });
    }

    if (reel.deletedAt) {
      throw new HTTPException(404, { message: "Reel not found" });
    }

    // Check permissions
    await this.checkReelAccess(reel, userId);

    const existing = await db.query.likes.findFirst({
      where: and(
        eq(schema.likes.userId, userId),
        eq(schema.likes.likeableType, "REEL"),
        eq(schema.likes.likeableId, reelId)
      ),
    });

    if (existing) {
      throw new HTTPException(409, { message: "Already liked this reel" });
    }

    // Insert like
    await db.insert(schema.likes).values({
      userId,
      likeableType: "REEL",
      likeableId: reelId,
    });

    // Increment likes count
    await db.update(schema.reels)
      .set({ likesCount: sql`${schema.reels.likesCount} + 1` })
      .where(eq(schema.reels.id, reelId));

    // Create notification for reel author (if not self)
    if (reel.authorId !== userId) {
      await db.insert(schema.notifications).values({
        recipientId: reel.authorId,
        actorId: userId,
        type: "REEL_LIKE",
        referenceType: "reel",
        referenceId: reelId,
        previewText: reel.caption ? reel.caption.substring(0, 100) : undefined,
        thumbnailUrl: reel.thumbnailUrl,
        deepLink: `/reels/${reelId}`,
        groupKey: `like:reel:${reelId}`,
      });
    }
  }

  /**
   * Unlike a reel
   */
  async unlikeReel(reelId: string, userId: string): Promise<void> {
    const result = await db.delete(schema.likes)
      .where(and(
        eq(schema.likes.userId, userId),
        eq(schema.likes.likeableType, "REEL"),
        eq(schema.likes.likeableId, reelId)
      ))
      .returning({ id: schema.likes.id });

    if (result.length === 0) {
      throw new HTTPException(404, { message: "Not liked this reel" });
    }

    // Decrement likes count
    await db.update(schema.reels)
      .set({ likesCount: sql`${schema.reels.likesCount} - 1` })
      .where(eq(schema.reels.id, reelId));
  }

  /**
   * Save a reel
   */
  async saveReel(reelId: string, userId: string, collectionId?: string): Promise<void> {
    const reel = await db.query.reels.findFirst({
      where: eq(schema.reels.id, reelId),
    });

    if (!reel) {
      throw new HTTPException(404, { message: "Reel not found" });
    }

    if (reel.deletedAt) {
      throw new HTTPException(404, { message: "Reel not found" });
    }

    // Check permissions
    await this.checkReelAccess(reel, userId);

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
      saveableType: "REEL",
      saveableId: reelId,
    }).onConflictDoNothing();

    // Increment saves count
    await db.update(schema.reels)
      .set({ savesCount: sql`${schema.reels.savesCount} + 1` })
      .where(eq(schema.reels.id, reelId));
  }

  /**
   * Unsave a reel
   */
  async unsaveReel(reelId: string, userId: string): Promise<void> {
    await db.delete(schema.savedItems)
      .where(and(
        eq(schema.savedItems.userId, userId),
        eq(schema.savedItems.saveableType, "REEL"),
        eq(schema.savedItems.saveableId, reelId)
      ));

    // Decrement saves count
    await db.update(schema.reels)
      .set({ savesCount: sql`${schema.reels.savesCount} - 1` })
      .where(eq(schema.reels.id, reelId));
  }

  /**
   * Share a reel (to DM)
   */
  async shareReel(reelId: string, userId: string, conversationId: string): Promise<void> {
    const reel = await db.query.reels.findFirst({
      where: eq(schema.reels.id, reelId),
      with: { author: true },
    });

    if (!reel) {
      throw new HTTPException(404, { message: "Reel not found" });
    }

    if (reel.deletedAt) {
      throw new HTTPException(404, { message: "Reel not found" });
    }

    // Verify user is member of conversation
    const member = await db.query.conversationMembers.findFirst({
      where: and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, userId)
      ),
    });

    if (!member) {
      throw new HTTPException(403, { message: "Not a member of this conversation" });
    }

    // Increment shares count
    await db.update(schema.reels)
      .set({ sharesCount: sql`${schema.reels.sharesCount} + 1` })
      .where(eq(schema.reels.id, reelId));

    // Create share message in conversation
    await db.insert(schema.messages).values({
      conversationId,
      senderId: userId,
      contentType: "REEL_SHARE",
      mediaUrl: reel.videoUrl,
      mediaThumbnail: reel.thumbnailUrl,
      mediaMetadata: {
        reelId: reel.id,
        caption: reel.caption,
        authorUsername: reel.author.username,
        authorAvatar: reel.author.avatarUrl,
      },
    });
  }

  /**
   * Increment view count
   */
  async incrementViews(reelId: string): Promise<void> {
    await db.update(schema.reels)
      .set({ viewsCount: sql`${schema.reels.viewsCount} + 1` })
      .where(eq(schema.reels.id, reelId));
  }

  /**
   * Increment plays count
   */
  async incrementPlays(reelId: string): Promise<void> {
    await db.update(schema.reels)
      .set({ playsCount: sql`${schema.reels.playsCount} + 1` })
      .where(eq(schema.reels.id, reelId));
  }

  /**
   * Get users who liked a reel
   */
  async getReelLikes(reelId: string, currentUserId: string, cursor?: string, perPage = 20): Promise<{
    items: any[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const reel = await db.query.reels.findFirst({
      where: eq(schema.reels.id, reelId),
      columns: { id: true, authorId: true },
    });

    if (!reel) {
      throw new HTTPException(404, { message: "Reel not found" });
    }

    // Check permissions
    await this.checkReelAccess(reel, currentUserId);

    const whereConditions = [
      eq(schema.likes.likeableType, "REEL"),
      eq(schema.likes.likeableId, reelId),
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

  // ============================================================
  // AUDIO MANAGEMENT (BE-094)
  // ============================================================

  /**
   * Get audio track by ID
   */
  async getAudioTrack(audioId: string): Promise<AudioTrack | null> {
    const audio = await db.query.audioTracks.findFirst({
      where: eq(schema.audioTracks.id, audioId),
    });

    if (!audio) {
      return null;
    }

    return {
      id: audio.id,
      name: audio.name,
      artist: audio.artist,
      audioUrl: audio.audioUrl,
      duration: audio.duration ? parseFloat(audio.duration.toString()) : null,
      waveformData: audio.waveformData,
      isLicensed: audio.isLicensed,
      usageCount: audio.usageCount,
      createdAt: audio.createdAt,
    };
  }

  /**
   * Search audio tracks
   */
  async searchAudioTracks(query: string, cursor?: string, perPage = 20): Promise<{
    items: AudioTrack[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const safeLimit = Math.min(perPage, MAX_LIMIT);
    const whereConditions = [
      sql`${schema.audioTracks.name} ILIKE ${`%${query}%`}`,
    ];

    if (cursor) {
      whereConditions.push(lt(schema.audioTracks.createdAt, new Date(cursor)));
    }

    const audioList = await db.select({
      id: schema.audioTracks.id,
      name: schema.audioTracks.name,
      artist: schema.audioTracks.artist,
      audioUrl: schema.audioTracks.audioUrl,
      duration: schema.audioTracks.duration,
      waveformData: schema.audioTracks.waveformData,
      isLicensed: schema.audioTracks.isLicensed,
      usageCount: schema.audioTracks.usageCount,
      createdAt: schema.audioTracks.createdAt,
    })
      .from(schema.audioTracks)
      .where(and(...whereConditions))
      .limit(safeLimit + 1)
      .orderBy(desc(schema.audioTracks.usageCount), desc(schema.audioTracks.createdAt));

    const hasMore = audioList.length > safeLimit;
    const items = hasMore ? audioList.slice(0, safeLimit) : audioList;
    const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null;

    return {
      items: items.map(a => ({
        ...a,
        duration: a.duration ? parseFloat(a.duration.toString()) : null,
      })),
      nextCursor,
      hasMore,
    };
  }

  /**
   * Get trending audio tracks (high usage in recent period)
   */
  async getTrendingAudio(cursor?: string, perPage = 20): Promise<{
    items: AudioTrack[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const safeLimit = Math.min(perPage, MAX_LIMIT);
    const trendingWindow = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Last 7 days

    const whereConditions = [
      gte(schema.audioTracks.createdAt, trendingWindow),
    ];

    if (cursor) {
      whereConditions.push(lt(schema.audioTracks.createdAt, new Date(cursor)));
    }

    const audioList = await db.select({
      id: schema.audioTracks.id,
      name: schema.audioTracks.name,
      artist: schema.audioTracks.artist,
      audioUrl: schema.audioTracks.audioUrl,
      duration: schema.audioTracks.duration,
      waveformData: schema.audioTracks.waveformData,
      isLicensed: schema.audioTracks.isLicensed,
      usageCount: schema.audioTracks.usageCount,
      createdAt: schema.audioTracks.createdAt,
    })
      .from(schema.audioTracks)
      .where(and(...whereConditions))
      .limit(safeLimit + 1)
      .orderBy(desc(schema.audioTracks.usageCount), desc(schema.audioTracks.createdAt));

    const hasMore = audioList.length > safeLimit;
    const items = hasMore ? audioList.slice(0, safeLimit) : audioList;
    const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null;

    return {
      items: items.map(a => ({
        ...a,
        duration: a.duration ? parseFloat(a.duration.toString()) : null,
      })),
      nextCursor,
      hasMore,
    };
  }

  /**
   * Save audio track for user
   */
  async saveAudio(audioId: string, userId: string): Promise<void> {
    const audio = await db.query.audioTracks.findFirst({
      where: eq(schema.audioTracks.id, audioId),
    });

    if (!audio) {
      throw new HTTPException(404, { message: "Audio track not found" });
    }

    await db.insert(schema.savedItems).values({
      userId,
      saveableType: "AUDIO",
      saveableId: audioId,
    }).onConflictDoNothing();
  }

  /**
   * Unsave audio track
   */
  async unsaveAudio(audioId: string, userId: string): Promise<void> {
    await db.delete(schema.savedItems)
      .where(and(
        eq(schema.savedItems.userId, userId),
        eq(schema.savedItems.saveableType, "AUDIO"),
        eq(schema.savedItems.saveableId, audioId)
      ));
  }

  /**
   * Get user's saved audio tracks
   */
  async getSavedAudio(userId: string, cursor?: string, perPage = 20): Promise<{
    items: SavedAudio[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const safeLimit = Math.min(perPage, MAX_LIMIT);

    const whereConditions = [
      eq(schema.savedItems.userId, userId),
      eq(schema.savedItems.saveableType, "AUDIO"),
    ];

    if (cursor) {
      whereConditions.push(lt(schema.savedItems.createdAt, new Date(cursor)));
    }

    const savedList = await db
      .select({
        audioId: schema.savedItems.saveableId,
        savedAt: schema.savedItems.createdAt,
        audio: {
          id: schema.audioTracks.id,
          name: schema.audioTracks.name,
          artist: schema.audioTracks.artist,
          audioUrl: schema.audioTracks.audioUrl,
          duration: schema.audioTracks.duration,
          waveformData: schema.audioTracks.waveformData,
          isLicensed: schema.audioTracks.isLicensed,
          usageCount: schema.audioTracks.usageCount,
          createdAt: schema.audioTracks.createdAt,
        },
      })
      .from(schema.savedItems)
      .innerJoin(schema.audioTracks, eq(schema.audioTracks.id, schema.savedItems.saveableId))
      .where(and(...whereConditions))
      .limit(safeLimit + 1)
      .orderBy(desc(schema.savedItems.createdAt));

    const hasMore = savedList.length > safeLimit;
    const items = hasMore ? savedList.slice(0, safeLimit) : savedList;
    const nextCursor = hasMore ? items[items.length - 1].savedAt.toISOString() : null;

    return {
      items: items.map(s => ({
        audioId: s.audioId,
        savedAt: s.savedAt,
        audio: {
          ...s.audio,
          duration: s.audio.duration ? parseFloat(s.audio.duration.toString()) : null,
        },
      })),
      nextCursor,
      hasMore,
    };
  }

  /**
   * Get reels using a specific audio track
   */
  async getReelsByAudio(audioId: string, cursor?: string, perPage = 20): Promise<FeedResult> {
    const safeLimit = Math.min(perPage, MAX_LIMIT);
    const parsedCursor = cursor ? new Date(cursor) : null;

    const whereConditions = [
      eq(schema.reels.audioId, audioId),
      isNull(schema.reels.deletedAt),
      eq(schema.reels.audience, "public"),
    ];

    if (parsedCursor) {
      whereConditions.push(lt(schema.reels.createdAt, parsedCursor));
    }

    const reelsList = await db.select({
      id: schema.reels.id,
      authorId: schema.reels.authorId,
      videoUrl: schema.reels.videoUrl,
      thumbnailUrl: schema.reels.thumbnailUrl,
      caption: schema.reels.caption,
      audioId: schema.reels.audioId,
      audioName: schema.reels.audioName,
      audioArtist: schema.reels.audioArtist,
      isOriginalAudio: schema.reels.isOriginalAudio,
      duration: schema.reels.duration,
      likesCount: schema.reels.likesCount,
      commentsCount: schema.reels.commentsCount,
      sharesCount: schema.reels.sharesCount,
      savesCount: schema.reels.savesCount,
      viewsCount: schema.reels.viewsCount,
      playsCount: schema.reels.playsCount,
      audience: schema.reels.audience,
      allowRemix: schema.reels.allowRemix,
      allowDownload: schema.reels.allowDownload,
      searchVector: schema.reels.searchVector,
      createdAt: schema.reels.createdAt,
      updatedAt: schema.reels.updatedAt,
      deletedAt: schema.reels.deletedAt,
      author: {
        id: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
        isPrivate: schema.users.isPrivate,
      },
    })
      .from(schema.reels)
      .innerJoin(schema.users, eq(schema.users.id, schema.reels.authorId))
      .where(and(...whereConditions))
      .limit(safeLimit + 1)
      .orderBy(desc(schema.reels.viewsCount), desc(schema.reels.createdAt));

    const hasMore = reelsList.length > safeLimit;
    const items = hasMore ? reelsList.slice(0, safeLimit) : reelsList;
    const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null;

    return {
      items: items.map(r => ({
        ...r,
        duration: parseFloat(r.duration.toString()),
        isLiked: false,
        isSaved: false,
      })),
      nextCursor,
      hasMore,
    };
  }

  // ============================================================
  // REEL REMIX/DUET (BE-098 - Future)
  // ============================================================

  /**
   * Create a remix/duet of a reel
   */
  async createRemix(input: {
    authorId: string;
    originalReelId: string;
    videoUrl: string;
    thumbnailUrl?: string;
    caption?: string;
    duration: number;
    remixType: "REMIX" | "DUET";
  }): Promise<ReelWithEngagement> {
    const originalReel = await db.query.reels.findFirst({
      where: eq(schema.reels.id, input.originalReelId),
      with: { author: true },
    });

    if (!originalReel) {
      throw new HTTPException(404, { message: "Original reel not found" });
    }

    if (!originalReel.allowRemix) {
      throw new HTTPException(403, { message: "Remix not allowed for this reel" });
    }

    if (originalReel.deletedAt) {
      throw new HTTPException(404, { message: "Original reel not found" });
    }

    // Create remix reel using original audio
    const [reel] = await db
      .insert(schema.reels)
      .values({
        authorId: input.authorId,
        videoUrl: input.videoUrl,
        thumbnailUrl: input.thumbnailUrl,
        caption: input.caption,
        duration: input.duration.toString(),
        audioId: originalReel.audioId,
        audioName: originalReel.audioName,
        audioArtist: originalReel.audioArtist,
        isOriginalAudio: false,
        audience: "public",
        allowRemix: true,
        allowDownload: false,
      })
      .returning();

    // Update user reels count
    await db.update(schema.users)
      .set({ reelsCount: sql`${schema.users.reelsCount} + 1` })
      .where(eq(schema.users.id, input.authorId));

    // Increment usage count for audio
    if (originalReel.audioId) {
      await db.update(schema.audioTracks)
        .set({ usageCount: sql`${schema.audioTracks.usageCount} + 1` })
        .where(eq(schema.audioTracks.id, originalReel.audioId));
    }

    // Create notification for original author
    if (originalReel.authorId !== input.authorId) {
      await db.insert(schema.notifications).values({
        recipientId: originalReel.authorId,
        actorId: input.authorId,
        type: "REEL_COMMENT",
        referenceType: "reel",
        referenceId: reel.id,
        previewText: `${input.remixType} of your reel`,
        thumbnailUrl: input.thumbnailUrl,
        deepLink: `/reels/${reel.id}`,
      });
    }

    const createdReel = await this.getReelById(reel.id, input.authorId);
    if (!createdReel) {
      throw new HTTPException(500, { message: "Failed to create remix" });
    }

    return createdReel;
  }

  // ============================================================
  // REPORTING (BE-097)
  // ============================================================

  /**
   * Report a reel
   */
  async reportReel(reelId: string, reporterId: string, reason: string, description?: string): Promise<void> {
    const reel = await db.query.reels.findFirst({
      where: eq(schema.reels.id, reelId),
    });

    if (!reel) {
      throw new HTTPException(404, { message: "Reel not found" });
    }

    await db.insert(schema.reports).values({
      reporterId,
      reportedType: "REEL",
      reportedId: reelId,
      reason: reason as any,
      description,
    });
  }

  // ============================================================
  // PRIVATE HELPER METHODS
  // ============================================================

  /**
   * Get candidate reels for feed (from followed users)
   */
  private async getFeedCandidates(cursor: ReelCursor | null, limit: number): Promise<ReelWithEngagement[]> {
    // Get users that current user follows (accepted)
    const following = await db.select({ followingId: schema.follows.followingId })
      .from(schema.follows)
      .where(and(
        eq(schema.follows.followerId, this.userId),
        eq(schema.follows.status, "ACCEPTED")
      ));

    const followingIds = following.map((f) => f.followingId);
    followingIds.push(this.userId); // Include own reels

    // Get blocked users
    const blocked = await db.select({ blockedId: schema.blocks.blockedId })
      .from(schema.blocks)
      .where(eq(schema.blocks.blockerId, this.userId));
    const blockedIds = blocked.map((b) => b.blockedId);

    const windowStart = new Date(Date.now() - FEED_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const whereConditions = [
      inArray(schema.reels.authorId, followingIds),
      isNull(schema.reels.deletedAt),
      eq(schema.reels.audience, "public"),
      gte(schema.reels.createdAt, windowStart),
    ];

    // Exclude blocked users
    if (blockedIds.length > 0) {
      whereConditions.push(not(inArray(schema.reels.authorId, blockedIds)));
    }

    if (cursor) {
      whereConditions.push(lt(schema.reels.createdAt, new Date(cursor.timestamp)));
    }

    const reelsList = await db.select({
      id: schema.reels.id,
      authorId: schema.reels.authorId,
      videoUrl: schema.reels.videoUrl,
      thumbnailUrl: schema.reels.thumbnailUrl,
      caption: schema.reels.caption,
      audioId: schema.reels.audioId,
      audioName: schema.reels.audioName,
      audioArtist: schema.reels.audioArtist,
      isOriginalAudio: schema.reels.isOriginalAudio,
      duration: schema.reels.duration,
      likesCount: schema.reels.likesCount,
      commentsCount: schema.reels.commentsCount,
      sharesCount: schema.reels.sharesCount,
      savesCount: schema.reels.savesCount,
      viewsCount: schema.reels.viewsCount,
      playsCount: schema.reels.playsCount,
      audience: schema.reels.audience,
      allowRemix: schema.reels.allowRemix,
      allowDownload: schema.reels.allowDownload,
      searchVector: schema.reels.searchVector,
      createdAt: schema.reels.createdAt,
      updatedAt: schema.reels.updatedAt,
      deletedAt: schema.reels.deletedAt,
      author: {
        id: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
        isPrivate: schema.users.isPrivate,
      },
    })
      .from(schema.reels)
      .innerJoin(schema.users, eq(schema.users.id, schema.reels.authorId))
      .where(and(...whereConditions))
      .limit(limit)
      .orderBy(desc(schema.reels.createdAt));

    // Check engagement state
    const reelIds = reelsList.map((r) => r.id);
    let likedSet = new Set<string>();
    let savedSet = new Set<string>();

    if (reelIds.length > 0) {
      const [likes, saves] = await Promise.all([
        db.select({ reelId: schema.likes.likeableId })
          .from(schema.likes)
          .where(and(
            eq(schema.likes.userId, this.userId),
            eq(schema.likes.likeableType, "REEL"),
            inArray(schema.likes.likeableId, reelIds)
          )),
        db.select({ reelId: schema.savedItems.saveableId })
          .from(schema.savedItems)
          .where(and(
            eq(schema.savedItems.userId, this.userId),
            eq(schema.savedItems.saveableType, "REEL"),
            inArray(schema.savedItems.saveableId, reelIds)
          )),
      ]);
      likedSet = new Set(likes.map((l) => l.reelId));
      savedSet = new Set(saves.map((s) => s.reelId));
    }

    // Fetch audio info
    const audioIds = [...new Set(reelsList.filter(r => r.audioId).map(r => r.audioId!))];
    const audioMap = new Map<string, AudioTrack>();
    if (audioIds.length > 0) {
      const audioTracks = await db.query.audioTracks.findMany({
        where: inArray(schema.audioTracks.id, audioIds),
      });
      for (const audio of audioTracks) {
        audioMap.set(audio.id, {
          id: audio.id,
          name: audio.name,
          artist: audio.artist,
          audioUrl: audio.audioUrl,
          duration: audio.duration ? parseFloat(audio.duration.toString()) : null,
          waveformData: audio.waveformData,
          isLicensed: audio.isLicensed,
          usageCount: audio.usageCount,
          createdAt: audio.createdAt,
        });
      }
    }

    // Check following status for authors
    const authorIds = [...new Set(reelsList.map(r => r.authorId))];
    const followingAuthors = await db.select({ followingId: schema.follows.followingId })
      .from(schema.follows)
      .where(and(
        eq(schema.follows.followerId, this.userId),
        inArray(schema.follows.followingId, authorIds),
        eq(schema.follows.status, "ACCEPTED")
      ));
    const followingSet = new Set(followingAuthors.map(f => f.followingId));

    return reelsList.map(r => ({
      ...r,
      duration: parseFloat(r.duration.toString()),
      isLiked: likedSet.has(r.id),
      isSaved: savedSet.has(r.id),
      isFollowing: followingSet.has(r.authorId),
      audio: r.audioId ? audioMap.get(r.audioId) || null : null,
    }));
  }

  /**
   * Get candidate reels for explore (trending + non-followed)
   */
  private async getExploreCandidates(cursor: ReelCursor | null, limit: number): Promise<ReelWithEngagement[]> {
    // Get blocked users
    const blocked = await db.select({ blockedId: schema.blocks.blockedId })
      .from(schema.blocks)
      .where(eq(schema.blocks.blockerId, this.userId));
    const blockedIds = blocked.map((b) => b.blockedId);

    // Get followed users
    const following = await db.select({ followingId: schema.follows.followingId })
      .from(schema.follows)
      .where(and(
        eq(schema.follows.followerId, this.userId),
        eq(schema.follows.status, "ACCEPTED")
      ));
    const followingIds = following.map((f) => f.followingId);
    followingIds.push(this.userId); // Exclude self

    const trendingWindow = new Date(Date.now() - TRENDING_WINDOW_HOURS * 60 * 60 * 1000);

    const baseWhereConditions = [
      isNull(schema.reels.deletedAt),
      eq(schema.reels.audience, "public"),
      gte(schema.reels.createdAt, trendingWindow),
    ];

    // Exclude blocked users
    if (blockedIds.length > 0) {
      baseWhereConditions.push(not(inArray(schema.reels.authorId, blockedIds)));
    }

    if (cursor) {
      baseWhereConditions.push(lt(schema.reels.createdAt, new Date(cursor.timestamp)));
    }

    // First, try to get trending reels from users NOT followed (true explore)
    const nonFollowedWhereConditions = [...baseWhereConditions];
    if (followingIds.length > 0) {
      nonFollowedWhereConditions.push(not(inArray(schema.reels.authorId, followingIds)));
    }

    let reelsList = await db.select({
      id: schema.reels.id,
      authorId: schema.reels.authorId,
      videoUrl: schema.reels.videoUrl,
      thumbnailUrl: schema.reels.thumbnailUrl,
      caption: schema.reels.caption,
      audioId: schema.reels.audioId,
      audioName: schema.reels.audioName,
      audioArtist: schema.reels.audioArtist,
      isOriginalAudio: schema.reels.isOriginalAudio,
      duration: schema.reels.duration,
      likesCount: schema.reels.likesCount,
      commentsCount: schema.reels.commentsCount,
      sharesCount: schema.reels.sharesCount,
      savesCount: schema.reels.savesCount,
      viewsCount: schema.reels.viewsCount,
      playsCount: schema.reels.playsCount,
      audience: schema.reels.audience,
      allowRemix: schema.reels.allowRemix,
      allowDownload: schema.reels.allowDownload,
      searchVector: schema.reels.searchVector,
      createdAt: schema.reels.createdAt,
      updatedAt: schema.reels.updatedAt,
      deletedAt: schema.reels.deletedAt,
      author: {
        id: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
        isPrivate: schema.users.isPrivate,
      },
    })
      .from(schema.reels)
      .innerJoin(schema.users, eq(schema.users.id, schema.reels.authorId))
      .where(and(...nonFollowedWhereConditions))
      .limit(limit)
      .orderBy(desc(schema.reels.playsCount), desc(schema.reels.viewsCount), desc(schema.reels.createdAt));

    // Fallback: if no reels from non-followed users, show trending from everyone (except blocked and self)
    if (reelsList.length === 0) {
      reelsList = await db.select({
        id: schema.reels.id,
        authorId: schema.reels.authorId,
        videoUrl: schema.reels.videoUrl,
        thumbnailUrl: schema.reels.thumbnailUrl,
        caption: schema.reels.caption,
        audioId: schema.reels.audioId,
        audioName: schema.reels.audioName,
        audioArtist: schema.reels.audioArtist,
        isOriginalAudio: schema.reels.isOriginalAudio,
        duration: schema.reels.duration,
        likesCount: schema.reels.likesCount,
        commentsCount: schema.reels.commentsCount,
        sharesCount: schema.reels.sharesCount,
        savesCount: schema.reels.savesCount,
        viewsCount: schema.reels.viewsCount,
        playsCount: schema.reels.playsCount,
        audience: schema.reels.audience,
        allowRemix: schema.reels.allowRemix,
        allowDownload: schema.reels.allowDownload,
        searchVector: schema.reels.searchVector,
        createdAt: schema.reels.createdAt,
        updatedAt: schema.reels.updatedAt,
        deletedAt: schema.reels.deletedAt,
        author: {
          id: schema.users.id,
          username: schema.users.username,
          fullName: schema.users.fullName,
          avatarUrl: schema.users.avatarUrl,
          isVerified: schema.users.isVerified,
          isPrivate: schema.users.isPrivate,
        },
      })
        .from(schema.reels)
        .innerJoin(schema.users, eq(schema.users.id, schema.reels.authorId))
        .where(and(...baseWhereConditions))
        .limit(limit)
        .orderBy(desc(schema.reels.playsCount), desc(schema.reels.viewsCount), desc(schema.reels.createdAt));
    }

    // Check engagement state
    const reelIds = reelsList.map((r) => r.id);
    let likedSet = new Set<string>();
    let savedSet = new Set<string>();

    if (reelIds.length > 0) {
      const [likes, saves] = await Promise.all([
        db.select({ reelId: schema.likes.likeableId })
          .from(schema.likes)
          .where(and(
            eq(schema.likes.userId, this.userId),
            eq(schema.likes.likeableType, "REEL"),
            inArray(schema.likes.likeableId, reelIds)
          )),
        db.select({ reelId: schema.savedItems.saveableId })
          .from(schema.savedItems)
          .where(and(
            eq(schema.savedItems.userId, this.userId),
            eq(schema.savedItems.saveableType, "REEL"),
            inArray(schema.savedItems.saveableId, reelIds)
          )),
      ]);
      likedSet = new Set(likes.map((l) => l.reelId));
      savedSet = new Set(saves.map((s) => s.reelId));
    }

    // Fetch audio info
    const audioIds = [...new Set(reelsList.filter(r => r.audioId).map(r => r.audioId!))];
    const audioMap = new Map<string, AudioTrack>();
    if (audioIds.length > 0) {
      const audioTracks = await db.query.audioTracks.findMany({
        where: inArray(schema.audioTracks.id, audioIds),
      });
      for (const audio of audioTracks) {
        audioMap.set(audio.id, {
          id: audio.id,
          name: audio.name,
          artist: audio.artist,
          audioUrl: audio.audioUrl,
          duration: audio.duration ? parseFloat(audio.duration.toString()) : null,
          waveformData: audio.waveformData,
          isLicensed: audio.isLicensed,
          usageCount: audio.usageCount,
          createdAt: audio.createdAt,
        });
      }
    }

    // Check following status
    const authorIds = [...new Set(reelsList.map(r => r.authorId))];
    const followingAuthors = await db.select({ followingId: schema.follows.followingId })
      .from(schema.follows)
      .where(and(
        eq(schema.follows.followerId, this.userId),
        inArray(schema.follows.followingId, authorIds),
        eq(schema.follows.status, "ACCEPTED")
      ));
    const followingSet = new Set(followingAuthors.map(f => f.followingId));

    return reelsList.map(r => ({
      ...r,
      duration: parseFloat(r.duration.toString()),
      isLiked: likedSet.has(r.id),
      isSaved: savedSet.has(r.id),
      isFollowing: followingSet.has(r.authorId),
      audio: r.audioId ? audioMap.get(r.audioId) || null : null,
    }));
  }

  /**
   * Score candidates for feed using ranking algorithm
   */
  private async scoreCandidates(candidates: ReelWithEngagement[]): Promise<(ReelWithEngagement & { score: number })[]> {
    const authorIds = [...new Set(candidates.map(c => c.authorId))];

    const [
      interactions,
      closeFriends,
    ] = await Promise.all([
      this.getUserAuthorInteractions(authorIds),
      this.getUserCloseFriends(),
    ]);

    return candidates.map(candidate => {
      const signals = this.computeSignals(candidate, {
        interactions: interactions.get(candidate.authorId) || { frequency: 0, direct: 0 },
        isCloseFriend: closeFriends.has(candidate.authorId),
        isFollowing: candidate.isFollowing ?? false,
      });

      const score = this.calculateScore(signals);
      return { ...candidate, score };
    });
  }

  /**
   * Score candidates for explore with more virality weight
   */
  private async scoreExploreCandidates(candidates: ReelWithEngagement[]): Promise<(ReelWithEngagement & { score: number })[]> {
    const authorIds = [...new Set(candidates.map(c => c.authorId))];

    const [
      interactions,
      closeFriends,
    ] = await Promise.all([
      this.getUserAuthorInteractions(authorIds),
      this.getUserCloseFriends(),
    ]);

    return candidates.map(candidate => {
      const signals = this.computeExploreSignals(candidate, {
        interactions: interactions.get(candidate.authorId) || { frequency: 0, direct: 0 },
        isCloseFriend: closeFriends.has(candidate.authorId),
        isFollowing: candidate.isFollowing ?? false,
      });

      const score = this.calculateExploreScore(signals);
      return { ...candidate, score };
    });
  }

  /**
   * Compute ranking signals for feed
   */
  private computeSignals(
    candidate: ReelItem,
    context: {
      interactions: { frequency: number; direct: number };
      isCloseFriend: boolean;
      isFollowing: boolean;
    }
  ): ReelRankingSignals {
    const hoursSincePost = (Date.now() - candidate.createdAt.getTime()) / (1000 * 60 * 60);

    // Time decay: exponential decay
    const timeDecay = Math.exp(-TIME_DECAY_LAMBDA * hoursSincePost);

    // Interest score
    const userInterestScore = Math.min(context.interactions.frequency / 10, 1.0);

    // Content type affinity (reels preferred)
    const contentTypeAffinity = 0.8; // User is in reels feed

    // Relationship signals
    const interactionFrequency = Math.min(context.interactions.frequency / 20, 1.0);
    const directInteractions = Math.min(context.interactions.direct / 5, 1.0);

    // Quality signals
    const engagementRate = (candidate.likesCount + candidate.commentsCount * 2 + candidate.sharesCount * 3 + candidate.savesCount * 4) / Math.max(candidate.viewsCount || 1, 1);
    const mediaQualityScore = this.computeMediaQuality(candidate);
    const completionRate = candidate.playsCount / Math.max(candidate.viewsCount || 1, 1);

    // Virality signals
    const velocityScore = this.computeVelocity(candidate);
    const shareRate = candidate.sharesCount / Math.max(candidate.viewsCount || 1, 1);

    // Diversity (computed later)
    const authorDiversity = 1.0;

    return {
      userInterestScore,
      contentTypeAffinity,
      timeDecay,
      interactionFrequency,
      directInteractions,
      isCloseFriend: context.isCloseFriend,
      isFollowing: context.isFollowing,
      engagementRate: Math.min(engagementRate, 1.0),
      mediaQualityScore,
      completionRate: Math.min(completionRate, 1.0),
      velocityScore,
      shareRate: Math.min(shareRate, 1.0),
      authorDiversity,
    };
  }

  /**
   * Compute ranking signals for explore (more virality weight)
   */
  private computeExploreSignals(
    candidate: ReelItem,
    context: {
      interactions: { frequency: number; direct: number };
      isCloseFriend: boolean;
      isFollowing: boolean;
    }
  ): ReelRankingSignals {
    const baseSignals = this.computeSignals(candidate, context);
    // Boost virality signals for explore
    return {
      ...baseSignals,
      velocityScore: baseSignals.velocityScore * 1.5,
      shareRate: baseSignals.shareRate * 1.5,
    };
  }

  /**
   * Calculate final score from signals (feed)
   */
  private calculateScore(signals: ReelRankingSignals): number {
    const interestScore = signals.userInterestScore * WEIGHTS.interest;
    const recencyScore = signals.timeDecay * WEIGHTS.recency;
    const relationshipScore = (
      (signals.interactionFrequency * 0.4) +
      (signals.directInteractions * 0.2) +
      (signals.isCloseFriend ? 0.2 : 0) +
      (signals.isFollowing ? 0.2 : 0)
    ) * WEIGHTS.relationship;
    const qualityScore = (
      (signals.engagementRate * 0.4) +
      (signals.mediaQualityScore * 0.2) +
      (signals.completionRate * 0.4)
    ) * WEIGHTS.quality;
    const viralityScore = (
      (signals.velocityScore * 0.6) +
      (signals.shareRate * 0.4)
    ) * WEIGHTS.virality;
    const diversityScore = signals.authorDiversity * WEIGHTS.diversity;

    // Close friend boost
    const closeFriendBoost = signals.isCloseFriend ? 0.1 : 0;

    return interestScore + recencyScore + relationshipScore + qualityScore + viralityScore + diversityScore + closeFriendBoost;
  }

  /**
   * Calculate final score from signals (explore)
   */
  private calculateExploreScore(signals: ReelRankingSignals): number {
    // More weight on virality and quality for explore
    const EXPLORE_WEIGHTS = {
      interest: 0.15,
      recency: 0.15,
      relationship: 0.10,
      quality: 0.25,
      virality: 0.30,
      diversity: 0.05,
    };

    const interestScore = signals.userInterestScore * EXPLORE_WEIGHTS.interest;
    const recencyScore = signals.timeDecay * EXPLORE_WEIGHTS.recency;
    const relationshipScore = (
      (signals.interactionFrequency * 0.4) +
      (signals.directInteractions * 0.2) +
      (signals.isCloseFriend ? 0.2 : 0) +
      (signals.isFollowing ? 0.2 : 0)
    ) * EXPLORE_WEIGHTS.relationship;
    const qualityScore = (
      (signals.engagementRate * 0.4) +
      (signals.mediaQualityScore * 0.2) +
      (signals.completionRate * 0.4)
    ) * EXPLORE_WEIGHTS.quality;
    const viralityScore = (
      (signals.velocityScore * 0.6) +
      (signals.shareRate * 0.4)
    ) * EXPLORE_WEIGHTS.virality;
    const diversityScore = signals.authorDiversity * EXPLORE_WEIGHTS.diversity;

    return interestScore + recencyScore + relationshipScore + qualityScore + viralityScore + diversityScore;
  }

  /**
   * Compute media quality score
   */
  private computeMediaQuality(candidate: ReelItem): number {
    // For reels, quality is based on engagement and video properties
    let score = 0.5; // Base score

    // Engagement rate bonus
    const engagementRate = (candidate.likesCount + candidate.commentsCount * 2 + candidate.sharesCount * 3 + candidate.savesCount * 4) / Math.max(candidate.viewsCount || 1, 1);
    if (engagementRate > 0.1) score += 0.2;
    else if (engagementRate > 0.05) score += 0.1;

    // Completion rate bonus
    const completionRate = candidate.playsCount / Math.max(candidate.viewsCount || 1, 1);
    if (completionRate > 0.5) score += 0.2;
    else if (completionRate > 0.3) score += 0.1;

    // Has caption bonus
    if (candidate.caption && candidate.caption.length > 20) score += 0.1;

    // Has audio bonus
    if (candidate.audioId || candidate.audioName) score += 0.1;

    return Math.min(score, 1.0);
  }

  /**
   * Compute velocity score (how fast it's gaining engagement)
   */
  private computeVelocity(candidate: ReelItem): number {
    const hoursSincePost = (Date.now() - candidate.createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursSincePost < 1) return 1.0; // Very new

    const totalEngagement = candidate.likesCount + candidate.commentsCount * 2 + candidate.sharesCount * 3 + candidate.savesCount * 4;
    const engagementPerHour = totalEngagement / Math.max(hoursSincePost, 0.5);

    // Normalize (100 engagements/hour = 1.0)
    return Math.min(engagementPerHour / 100, 1.0);
  }

  /**
   * Apply diversity filtering
   */
  private applyDiversity(ranked: (ReelWithEngagement & { score: number })[]): (ReelWithEngagement & { score: number })[] {
    const authorCount = new Map<string, number>();
    const result: (ReelWithEngagement & { score: number })[] = [];
    const maxPerAuthor = 2; // Max reels from same author in top 20

    for (const item of ranked) {
      const count = authorCount.get(item.authorId) || 0;
      if (count < maxPerAuthor) {
        const diversityPenalty = count * 0.08;
        item.score = item.score * (1 - diversityPenalty);
        authorCount.set(item.authorId, count + 1);
        result.push(item);
      }
    }

    return result.sort((a, b) => b.score - a.score);
  }

  /**
   * Get user's interaction frequency with authors
   */
  private async getUserAuthorInteractions(
    authorIds: string[]
  ): Promise<Map<string, { frequency: number; direct: number }>> {
    if (authorIds.length === 0) return new Map();

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      likes,
      comments,
      shares,
      saves,
      dms,
    ] = await Promise.all([
      db.select({
        authorId: schema.reels.authorId,
        count: sql<number>`count(*)`.as('count'),
      })
        .from(schema.likes)
        .innerJoin(schema.reels, eq(schema.reels.id, schema.likes.likeableId))
        .where(
          and(
            eq(schema.likes.userId, this.userId),
            eq(schema.likes.likeableType, "REEL"),
            inArray(schema.reels.authorId, authorIds),
            gte(schema.likes.createdAt, thirtyDaysAgo)
          )
        )
        .groupBy(schema.reels.authorId),

      db.select({
        authorId: schema.reels.authorId,
        count: sql<number>`count(*)`.as('count'),
      })
        .from(schema.comments)
        .innerJoin(schema.reels, eq(schema.reels.id, schema.comments.commentableId))
        .where(
          and(
            eq(schema.comments.authorId, this.userId),
            eq(schema.comments.commentableType, "REEL"),
            inArray(schema.reels.authorId, authorIds),
            gte(schema.comments.createdAt, thirtyDaysAgo)
          )
        )
        .groupBy(schema.reels.authorId),

      // Shares (track via messages with REEL_SHARE)
      db.select({
        authorId: schema.reels.authorId,
        count: sql<number>`count(*)`.as('count'),
      })
        .from(schema.messages)
        .innerJoin(schema.reels, eq(schema.reels.id, sql`${schema.messages.mediaMetadata}->>'reelId'`))
        .where(
          and(
            eq(schema.messages.senderId, this.userId),
            eq(schema.messages.contentType, "REEL_SHARE"),
            inArray(sql`${schema.messages.mediaMetadata}->>'reelId'`, authorIds.map(id => `'${id}'`)),
            gte(schema.messages.createdAt, thirtyDaysAgo)
          )
        )
        .groupBy(schema.reels.authorId),

      db.select({
        authorId: schema.reels.authorId,
        count: sql<number>`count(*)`.as('count'),
      })
        .from(schema.savedItems)
        .innerJoin(schema.reels, eq(schema.reels.id, schema.savedItems.saveableId))
        .where(
          and(
            eq(schema.savedItems.userId, this.userId),
            eq(schema.savedItems.saveableType, "REEL"),
            inArray(schema.reels.authorId, authorIds),
            gte(schema.savedItems.createdAt, thirtyDaysAgo)
          )
        )
        .groupBy(schema.reels.authorId),

      // DMs with these authors
      db.select({
        userId: schema.messages.senderId,
        count: sql<number>`count(*)`.as('count'),
      })
        .from(schema.messages)
        .innerJoin(schema.conversationMembers, eq(schema.conversationMembers.conversationId, schema.messages.conversationId))
        .where(
          and(
            eq(schema.conversationMembers.userId, this.userId),
            inArray(schema.messages.senderId, authorIds),
            gte(schema.messages.createdAt, thirtyDaysAgo)
          )
        )
        .groupBy(schema.messages.senderId),
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
   * Check if user has access to reel (private account, blocks)
   */
  private async checkReelAccess(reel: any, currentUserId: string): Promise<void> {
    // Check private account
    if (reel.author?.isPrivate && reel.authorId !== currentUserId) {
      const following = await db.query.follows.findFirst({
        where: and(
          eq(schema.follows.followerId, currentUserId),
          eq(schema.follows.followingId, reel.authorId),
          eq(schema.follows.status, "ACCEPTED")
        ),
      });
      if (!following) {
        throw new HTTPException(403, { message: "This account is private" });
      }
    }

    // Check blocks
    const isBlocked = await this.checkBlock(currentUserId, reel.authorId);
    if (isBlocked) {
      throw new HTTPException(403, { message: "You cannot view this reel" });
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

  /**
   * Parse cursor string to ReelCursor
   */
  private parseCursor(cursor: string): ReelCursor {
    try {
      const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
      return JSON.parse(decoded);
    } catch {
      throw new HTTPException(400, { message: 'Invalid cursor' });
    }
  }

  /**
   * Encode ReelCursor to base64 string
   */
  private encodeCursor(item: ReelItem & { score: number }): ReelCursor {
    const cursor: ReelCursor = {
      timestamp: item.createdAt.toISOString(),
      score: item.score,
      reelId: item.id,
    };
    return cursor;
  }

  /**
   * Get cursor string for response
   */
  private getCursorString(cursor: ReelCursor): string {
    return Buffer.from(JSON.stringify(cursor)).toString('base64');
  }
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

let reelServiceInstance: ReelService | null = null;

/**
 * Create a ReelService instance for a user
 */
export function createReelService(userId: string): ReelService {
  return new ReelService(userId);
}

/**
 * Get the singleton ReelService instance (for internal use)
 */
export function getReelService(): ReelService {
  if (!reelServiceInstance) {
    reelServiceInstance = new ReelService("system");
  }
  return reelServiceInstance;
}

export function setReelService(service: ReelService): void {
  reelServiceInstance = service;
}