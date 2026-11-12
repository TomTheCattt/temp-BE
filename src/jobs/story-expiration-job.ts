/**
 * Story expiration cleanup job.
 * Deletes stories that have expired (24h TTL).
 * Runs every hour to clean up expired stories.
 */

import { neon } from '@neondatabase/serverless';
import { env } from '../config/env';

let expirationInterval: ReturnType<typeof setInterval> | null = null;
let isCleaning = false;

/**
 * Delete expired stories and their associated media from storage
 */
async function cleanupExpiredStories(): Promise<void> {
  if (isCleaning) {
    console.log('[StoryExpiration] Skipping - previous cleanup still running');
    return;
  }

  isCleaning = true;
  const startTime = Date.now();

  try {
    const sql = neon(env.DATABASE_URL);

    // First, get expired stories with their media URLs for storage cleanup
    const expiredStories = await sql`
      SELECT s.id, s.author_id, array_agg(si.media_url) as media_urls
      FROM stories s
      INNER JOIN story_items si ON si.story_id = s.id
      WHERE s.expires_at < NOW()
        AND s.deleted_at IS NULL
      GROUP BY s.id, s.author_id
      LIMIT 1000
    `;

    if (expiredStories.length > 0) {
      console.log(`[StoryExpiration] Found ${expiredStories.length} expired stories to clean up`);

      // Delete from storage (S3/Neon Storage)
      // Note: In production, you'd delete the actual media files
      // For now, we'll just log what would be deleted
      for (const story of expiredStories) {
        console.log(`[StoryExpiration] Would delete media for story ${story.id}:`, story.media_urls);
      }

      // Delete expired stories from database (cascade will handle story_items, story_views, story_replies)
      await sql`
        DELETE FROM stories
        WHERE expires_at < NOW()
          AND deleted_at IS NULL
      `;

      const deletedCount = expiredStories.length;
      const duration = Date.now() - startTime;
      console.log(`[StoryExpiration] Deleted ${deletedCount} expired stories in ${duration}ms`);
    } else {
      console.log('[StoryExpiration] No expired stories found');
    }
  } catch (error) {
    console.error('[StoryExpiration] Error:', error);
  } finally {
    isCleaning = false;
  }
}

/**
 * Start the story expiration job (runs every hour)
 */
export function startStoryExpirationJob(): void {
  if (expirationInterval) {
    console.log('[StoryExpiration] Job already running');
    return;
  }

  console.log('[StoryExpiration] Starting job (every hour)');

  // Run immediately on start
  cleanupExpiredStories();

  // Then every hour (3600000 ms)
  expirationInterval = setInterval(() => {
    cleanupExpiredStories();
  }, 3600000);

  // Handle graceful shutdown
  process.on('SIGTERM', stopStoryExpirationJob);
  process.on('SIGINT', stopStoryExpirationJob);
}

/**
 * Stop the story expiration job
 */
export function stopStoryExpirationJob(): void {
  if (expirationInterval) {
    clearInterval(expirationInterval);
    expirationInterval = null;
    console.log('[StoryExpiration] Job stopped');
  }
}

/**
 * Manual trigger for story expiration cleanup (useful for testing or admin endpoints)
 */
export async function triggerStoryExpirationCleanup(): Promise<{ success: boolean; durationMs: number; deletedCount: number }> {
  const startTime = Date.now();
  let deletedCount = 0;

  try {
    const sql = neon(env.DATABASE_URL);

    const expiredStories = await sql`
      SELECT s.id, s.author_id, array_agg(si.media_url) as media_urls
      FROM stories s
      INNER JOIN story_items si ON si.story_id = s.id
      WHERE s.expires_at < NOW()
        AND s.deleted_at IS NULL
      GROUP BY s.id, s.author_id
      LIMIT 1000
    `;

    if (expiredStories.length > 0) {
      await sql`
        DELETE FROM stories
        WHERE expires_at < NOW()
          AND deleted_at IS NULL
      `;
      deletedCount = expiredStories.length;
    }

    return { success: true, durationMs: Date.now() - startTime, deletedCount };
  } catch (error) {
    console.error('[StoryExpiration] Manual trigger error:', error);
    return { success: false, durationMs: Date.now() - startTime, deletedCount: 0 };
  }
}