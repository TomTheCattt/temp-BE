import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, isNull, inArray, sql, desc, lt, gt, or, asc } from "drizzle-orm";
import { getSearchService } from "../services/search-service";

// ============================================================================
// Types
// ============================================================================

export type IndexableContentType = "users" | "posts" | "reels" | "hashtags" | "locations" | "audio";

export interface IndexJobPayload {
  contentType: IndexableContentType;
  contentId: string;
  operation: "upsert" | "delete";
  priority?: "high" | "normal" | "low";
}

export interface BatchIndexJobPayload {
  contentType: IndexableContentType;
  contentIds: string[];
  priority?: "high" | "normal" | "low";
}

// ============================================================================
// Search Indexer Service
// ============================================================================

export class SearchIndexerJob {
  private searchService = getSearchService();
  private isRunning = false;
  private batchSize = 100;

  // ---------------------------------------------------------------------------
  // Real-time Indexing (Single Item)
  // ---------------------------------------------------------------------------

  async indexContent(payload: IndexJobPayload): Promise<void> {
    const { contentType, contentId, operation } = payload;

    try {
      if (operation === "delete") {
        await this.deleteFromIndex(contentType, contentId);
      } else {
        await this.upsertToIndex(contentType, contentId);
      }
    } catch (error) {
      console.error(`Failed to index ${contentType}:${contentId}:`, error);
      throw error;
    }
  }

  private async upsertToIndex(contentType: IndexableContentType, contentId: string): Promise<void> {
    let indexData: Partial<typeof schema.searchIndex.$inferInsert> | null = null;

    switch (contentType) {
      case "users":
        indexData = await this.buildUserIndexData(contentId);
        break;
      case "posts":
        indexData = await this.buildPostIndexData(contentId);
        break;
      case "reels":
        indexData = await this.buildReelIndexData(contentId);
        break;
      case "hashtags":
        indexData = await this.buildHashtagIndexData(contentId);
        break;
      case "locations":
        indexData = await this.buildLocationIndexData(contentId);
        break;
      case "audio":
        indexData = await this.buildAudioIndexData(contentId);
        break;
    }

    if (!indexData) {
      console.warn(`No data found for ${contentType}:${contentId}, skipping index`);
      return;
    }

    // Generate embedding for semantic search
    if (indexData.title || indexData.description) {
      const textToEmbed = `${indexData.title || ""} ${indexData.description || ""}`.trim();
      if (textToEmbed) {
        try {
          indexData.embedding = await this.searchService.generateEmbedding(textToEmbed);
        } catch (error) {
          console.error(`Failed to generate embedding for ${contentType}:${contentId}:`, error);
          // Continue without embedding
        }
      }
    }

    // Build search vector for BM25
    if (indexData.title || indexData.description) {
      const text = `${indexData.title || ""} ${indexData.description || ""}`.trim();
      indexData.searchVector = text;
    }

    // Upsert to search_index
    await db.insert(schema.searchIndex)
      .values({
        contentType,
        contentId,
        ...indexData,
      } as any)
      .onConflictDoUpdate({
        target: [schema.searchIndex.contentType, schema.searchIndex.contentId],
        set: {
          title: indexData.title,
          description: indexData.description,
          searchVector: indexData.searchVector,
          embedding: indexData.embedding,
          authorId: indexData.authorId,
          createdAt: indexData.createdAt,
          popularityScore: indexData.popularityScore,
        },
      });
  }

  private async deleteFromIndex(contentType: IndexableContentType, contentId: string): Promise<void> {
    await db.delete(schema.searchIndex)
      .where(and(
        eq(schema.searchIndex.contentType, contentType),
        eq(schema.searchIndex.contentId, contentId)
      ));
  }

  // ---------------------------------------------------------------------------
  // Build Index Data for Each Content Type
  // ---------------------------------------------------------------------------

  private async buildUserIndexData(userId: string) {
    const user = await db.query.users.findFirst({
      where: and(
        eq(schema.users.id, userId),
        isNull(schema.users.deletedAt)
      ),
    });

    if (!user) return null;

    return {
      title: user.username,
      description: user.bio || user.fullName || "",
      authorId: user.id,
      createdAt: user.createdAt,
      popularityScore: String((user.followersCount || 0) * 1.0 + (user.postsCount || 0) * 0.5),
    };
  }

  private async buildPostIndexData(postId: string) {
    const post = await db.query.posts.findFirst({
      where: and(
        eq(schema.posts.id, postId),
        isNull(schema.posts.deletedAt)
      ),
      with: { author: true },
    });

    if (!post) return null;

    // Get first media item for thumbnail
    const mediaItems = await db.query.mediaItems.findMany({
      where: and(
        eq(schema.mediaItems.mediaableType, "post"),
        eq(schema.mediaItems.mediaableId, postId)
      ),
      orderBy: (mi, { asc }) => [asc(mi.sortOrder)],
      limit: 1,
    });

    return {
      title: post.caption?.substring(0, 200) || "Post",
      description: post.caption || "",
      authorId: post.authorId,
      createdAt: post.createdAt,
      popularityScore: String(this.calculatePostPopularity(post)),
    };
  }

  private async buildReelIndexData(reelId: string) {
    const reel = await db.query.reels.findFirst({
      where: and(
        eq(schema.reels.id, reelId),
        isNull(schema.reels.deletedAt)
      ),
      with: { author: true },
    });

    if (!reel) return null;

    return {
      title: reel.caption?.substring(0, 200) || "Reel",
      description: reel.caption || "",
      authorId: reel.authorId,
      createdAt: reel.createdAt,
      popularityScore: String(this.calculateReelPopularity(reel)),
    };
  }

  private async buildHashtagIndexData(hashtagId: string) {
    const hashtag = await db.query.hashtags.findFirst({
      where: eq(schema.hashtags.id, hashtagId),
    });

    if (!hashtag || hashtag.isBlocked) return null;

    return {
      title: `#${hashtag.tag}`,
      description: `Posts: ${hashtag.postsCount}, Reels: ${hashtag.reelsCount}`,
      authorId: null,
      createdAt: hashtag.createdAt,
      popularityScore: String((hashtag.postsCount || 0) + (hashtag.reelsCount || 0)),
    };
  }

  private async buildLocationIndexData(locationId: string) {
    const location = await db.query.locations.findFirst({
      where: eq(schema.locations.id, locationId),
    });

    if (!location) return null;

    return {
      title: location.name,
      description: location.address || location.category || "",
      authorId: null,
      createdAt: location.createdAt,
      popularityScore: String(location.postsCount || 0),
    };
  }

  private async buildAudioIndexData(audioId: string) {
    const audio = await db.query.audioTracks.findFirst({
      where: eq(schema.audioTracks.id, audioId),
    });

    if (!audio) return null;

    return {
      title: audio.name,
      description: audio.artist ? `by ${audio.artist}` : "",
      authorId: null,
      createdAt: audio.createdAt,
      popularityScore: String(audio.usageCount || 0),
    };
  }

  private calculatePostPopularity(post: any): number {
    const hoursSinceCreation = (Date.now() - new Date(post.createdAt).getTime()) / (1000 * 60 * 60);
    const timeDecay = Math.max(0.1, 1 / (1 + hoursSinceCreation / 24)); // Decay over days

    const engagement =
      (post.likesCount || 0) * 1.0 +
      (post.commentsCount || 0) * 2.0 +
      (post.sharesCount || 0) * 3.0 +
      (post.savesCount || 0) * 4.0;

    return engagement * timeDecay;
  }

  private calculateReelPopularity(reel: any): number {
    const hoursSinceCreation = (Date.now() - new Date(reel.createdAt).getTime()) / (1000 * 60 * 60);
    const timeDecay = Math.max(0.1, 1 / (1 + hoursSinceCreation / 24));

    const engagement =
      (reel.likesCount || 0) * 1.0 +
      (reel.commentsCount || 0) * 2.0 +
      (reel.sharesCount || 0) * 3.0 +
      (reel.playsCount || 0) * 0.1;

    return engagement * timeDecay;
  }

  // ---------------------------------------------------------------------------
  // Batch Indexing
  // ---------------------------------------------------------------------------

  async batchIndex(payload: BatchIndexJobPayload): Promise<{ success: number; failed: number }> {
    const { contentType, contentIds, priority = "normal" } = payload;
    let success = 0;
    let failed = 0;

    // Process in chunks
    for (let i = 0; i < contentIds.length; i += this.batchSize) {
      const chunk = contentIds.slice(i, i + this.batchSize);

      await Promise.all(
        chunk.map(async (contentId) => {
          try {
            await this.upsertToIndex(contentType, contentId);
            success++;
          } catch (error) {
            console.error(`Batch index failed for ${contentType}:${contentId}:`, error);
            failed++;
          }
        })
      );
    }

    return { success, failed };
  }

  // ---------------------------------------------------------------------------
  // Full Reindex (for maintenance)
  // ---------------------------------------------------------------------------

  async fullReindex(contentType: IndexableContentType, options: { batchSize?: number; limit?: number } = {}): Promise<{ processed: number; failed: number }> {
    const { batchSize = this.batchSize, limit } = options;
    let processed = 0;
    let failed = 0;

    let ids: string[] = [];

    switch (contentType) {
      case "users":
        ids = await this.getAllUserIds(limit);
        break;
      case "posts":
        ids = await this.getAllPostIds(limit);
        break;
      case "reels":
        ids = await this.getAllReelIds(limit);
        break;
      case "hashtags":
        ids = await this.getAllHashtagIds(limit);
        break;
      case "locations":
        ids = await this.getAllLocationIds(limit);
        break;
      case "audio":
        ids = await this.getAllAudioIds(limit);
        break;
    }

    console.log(`Starting full reindex for ${contentType}: ${ids.length} items`);

    for (let i = 0; i < ids.length; i += batchSize) {
      const chunk = ids.slice(i, i + batchSize);
      const result = await this.batchIndex({ contentType, contentIds: chunk });
      processed += result.success;
      failed += result.failed;

      // Log progress
      if ((i + batchSize) % (batchSize * 10) === 0) {
        console.log(`Reindex progress: ${i + chunk.length}/${ids.length} ${contentType}`);
      }
    }

    console.log(`Full reindex complete for ${contentType}: ${processed} success, ${failed} failed`);
    return { processed, failed };
  }

  private async getAllUserIds(limit?: number): Promise<string[]> {
    const query = db.select({ id: schema.users.id })
      .from(schema.users)
      .where(isNull(schema.users.deletedAt))
      .orderBy(desc(schema.users.followersCount));

    if (limit) query.limit(limit);
    const results = await query;
    return results.map(r => r.id);
  }

  private async getAllPostIds(limit?: number): Promise<string[]> {
    const query = db.select({ id: schema.posts.id })
      .from(schema.posts)
      .where(and(isNull(schema.posts.deletedAt), eq(schema.posts.audience, "PUBLIC")))
      .orderBy(desc(schema.posts.createdAt));

    if (limit) query.limit(limit);
    const results = await query;
    return results.map(r => r.id);
  }

  private async getAllReelIds(limit?: number): Promise<string[]> {
    const query = db.select({ id: schema.reels.id })
      .from(schema.reels)
      .where(and(isNull(schema.reels.deletedAt), eq(schema.reels.audience, "public")))
      .orderBy(desc(schema.reels.createdAt));

    if (limit) query.limit(limit);
    const results = await query;
    return results.map(r => r.id);
  }

  private async getAllHashtagIds(limit?: number): Promise<string[]> {
    const query = db.select({ id: schema.hashtags.id })
      .from(schema.hashtags)
      .where(eq(schema.hashtags.isBlocked, false))
      .orderBy(sql`(${schema.hashtags.postsCount} + ${schema.hashtags.reelsCount}) DESC`);

    if (limit) query.limit(limit);
    const results = await query;
    return results.map(r => r.id);
  }

  private async getAllLocationIds(limit?: number): Promise<string[]> {
    const query = db.select({ id: schema.locations.id })
      .from(schema.locations)
      .orderBy(desc(schema.locations.postsCount));

    if (limit) query.limit(limit);
    const results = await query;
    return results.map(r => r.id);
  }

  private async getAllAudioIds(limit?: number): Promise<string[]> {
    const query = db.select({ id: schema.audioTracks.id })
      .from(schema.audioTracks)
      .orderBy(desc(schema.audioTracks.usageCount));

    if (limit) query.limit(limit);
    const results = await query;
    return results.map(r => r.id);
  }

  // ---------------------------------------------------------------------------
  // Popularity Score Updates (periodic)
  // ---------------------------------------------------------------------------

  async updatePopularityScores(contentType: IndexableContentType, limit = 1000): Promise<number> {
    let updated = 0;

    switch (contentType) {
      case "posts": {
        const results = await db.execute(sql`
          UPDATE ${schema.searchIndex} si
          SET popularity_score = sub.new_score
          FROM (
            SELECT
              p.id,
              (p.likes_count + p.comments_count * 2 + p.shares_count * 3 + p.saves_count * 4) *
              GREATEST(0.1, 1 / (1 + EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 86400)) as new_score
            FROM ${schema.posts} p
            WHERE p.deleted_at IS NULL
              AND p.audience = 'PUBLIC'
            ORDER BY new_score DESC
            LIMIT ${limit}
          ) sub
          WHERE si.content_type = 'posts' AND si.content_id = sub.id
            AND si.popularity_score IS DISTINCT FROM sub.new_score
        `);
        updated = results.rowCount || 0;
        break;
      }
      case "reels": {
        const results = await db.execute(sql`
          UPDATE ${schema.searchIndex} si
          SET popularity_score = sub.new_score
          FROM (
            SELECT
              r.id,
              (r.likes_count + r.comments_count * 2 + r.shares_count * 3 + r.plays_count * 0.1) *
              GREATEST(0.1, 1 / (1 + EXTRACT(EPOCH FROM (NOW() - r.created_at)) / 86400)) as new_score
            FROM ${schema.reels} r
            WHERE r.deleted_at IS NULL
              AND r.audience = 'public'
            ORDER BY new_score DESC
            LIMIT ${limit}
          ) sub
          WHERE si.content_type = 'reels' AND si.content_id = sub.id
            AND si.popularity_score IS DISTINCT FROM sub.new_score
        `);
        updated = results.rowCount || 0;
        break;
      }
      case "users": {
        const results = await db.execute(sql`
          UPDATE ${schema.searchIndex} si
          SET popularity_score = sub.new_score
          FROM (
            SELECT
              u.id,
              (u.followers_count + u.posts_count * 0.5) as new_score
            FROM ${schema.users} u
            WHERE u.deleted_at IS NULL
            ORDER BY new_score DESC
            LIMIT ${limit}
          ) sub
          WHERE si.content_type = 'users' AND si.content_id = sub.id
            AND si.popularity_score IS DISTINCT FROM sub.new_score
        `);
        updated = results.rowCount || 0;
        break;
      }
    }

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Cleanup Orphaned Index Entries
  // ---------------------------------------------------------------------------

  async cleanupOrphanedEntries(): Promise<number> {
    // Find index entries where the source content no longer exists
    const orphanedPosts = await db.execute(sql`
      DELETE FROM ${schema.searchIndex} si
      WHERE si.content_type = 'posts'
        AND NOT EXISTS (SELECT 1 FROM ${schema.posts} p WHERE p.id = si.content_id)
    `);

    const orphanedReels = await db.execute(sql`
      DELETE FROM ${schema.searchIndex} si
      WHERE si.content_type = 'reels'
        AND NOT EXISTS (SELECT 1 FROM ${schema.reels} r WHERE r.id = si.content_id)
    `);

    const orphanedUsers = await db.execute(sql`
      DELETE FROM ${schema.searchIndex} si
      WHERE si.content_type = 'users'
        AND NOT EXISTS (SELECT 1 FROM ${schema.users} u WHERE u.id = si.content_id AND u.deleted_at IS NULL)
    `);

    const orphanedHashtags = await db.execute(sql`
      DELETE FROM ${schema.searchIndex} si
      WHERE si.content_type = 'hashtags'
        AND NOT EXISTS (SELECT 1 FROM ${schema.hashtags} h WHERE h.id = si.content_id AND h.is_blocked = FALSE)
    `);

    const orphanedLocations = await db.execute(sql`
      DELETE FROM ${schema.searchIndex} si
      WHERE si.content_type = 'locations'
        AND NOT EXISTS (SELECT 1 FROM ${schema.locations} l WHERE l.id = si.content_id)
    `);

    const orphanedAudio = await db.execute(sql`
      DELETE FROM ${schema.searchIndex} si
      WHERE si.content_type = 'audio'
        AND NOT EXISTS (SELECT 1 FROM ${schema.audioTracks} a WHERE a.id = si.content_id)
    `);

    const total = (orphanedPosts.rowCount || 0) +
                  (orphanedReels.rowCount || 0) +
                  (orphanedUsers.rowCount || 0) +
                  (orphanedHashtags.rowCount || 0) +
                  (orphanedLocations.rowCount || 0) +
                  (orphanedAudio.rowCount || 0);

    if (total > 0) {
      console.log(`Cleaned up ${total} orphaned search index entries`);
    }

    return total;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let searchIndexerJobInstance: SearchIndexerJob | null = null;

export function getSearchIndexerJob(): SearchIndexerJob {
  if (!searchIndexerJobInstance) {
    searchIndexerJobInstance = new SearchIndexerJob();
  }
  return searchIndexerJobInstance;
}

export function setSearchIndexerJob(job: SearchIndexerJob): void {
  searchIndexerJobInstance = job;
}

// ============================================================================
// Cron Job Functions (to be called by scheduler)
// ============================================================================

export async function runPopularityScoreUpdate(): Promise<void> {
  const indexer = getSearchIndexerJob();

  console.log("Starting popularity score update...");

  const postsUpdated = await indexer.updatePopularityScores("posts", 5000);
  const reelsUpdated = await indexer.updatePopularityScores("reels", 5000);
  const usersUpdated = await indexer.updatePopularityScores("users", 1000);

  console.log(`Popularity scores updated: ${postsUpdated} posts, ${reelsUpdated} reels, ${usersUpdated} users`);
}

export async function runSearchIndexCleanup(): Promise<void> {
  const indexer = getSearchIndexerJob();

  console.log("Starting search index cleanup...");
  const cleaned = await indexer.cleanupOrphanedEntries();
  console.log(`Cleaned up ${cleaned} orphaned entries`);
}

export async function runFullReindex(contentType: IndexableContentType): Promise<void> {
  const indexer = getSearchIndexerJob();

  console.log(`Starting full reindex for ${contentType}...`);
  const result = await indexer.fullReindex(contentType, { batchSize: 50 });
  console.log(`Full reindex complete: ${result.processed} processed, ${result.failed} failed`);
}