/**
 * Application-level cron job for refreshing the feed materialized view.
 * Since pg_cron is unavailable on Neon, we use setInterval as a fallback.
 * Runs every 30 seconds to match the requirement.
 */

import { neon } from '@neondatabase/serverless';
import { env } from '../config/env';

let refreshInterval: ReturnType<typeof setInterval> | null = null;
let isRefreshing = false;

/**
 * Refresh the feed_items materialized view
 */
async function refreshFeedMaterializedView(): Promise<void> {
  if (isRefreshing) {
    console.log('[FeedRefresh] Skipping - previous refresh still running');
    return;
  }

  isRefreshing = true;
  const startTime = Date.now();

  try {
    const sql = neon(env.DATABASE_URL);
    await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY feed_items`;
    const duration = Date.now() - startTime;
    console.log(`[FeedRefresh] Completed in ${duration}ms`);
  } catch (error) {
    console.error('[FeedRefresh] Error:', error);
  } finally {
    isRefreshing = false;
  }
}

/**
 * Start the feed refresh job (every 30 seconds)
 */
export function startFeedRefreshJob(): void {
  if (refreshInterval) {
    console.log('[FeedRefresh] Job already running');
    return;
  }

  console.log('[FeedRefresh] Starting job (every 30 seconds)');

  // Run immediately on start
  refreshFeedMaterializedView();

  // Then every 30 seconds
  refreshInterval = setInterval(() => {
    refreshFeedMaterializedView();
  }, 30000);

  // Handle graceful shutdown
  process.on('SIGTERM', stopFeedRefreshJob);
  process.on('SIGINT', stopFeedRefreshJob);
}

/**
 * Stop the feed refresh job
 */
export function stopFeedRefreshJob(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
    console.log('[FeedRefresh] Job stopped');
  }
}

/**
 * Manual trigger for feed refresh (useful for testing or admin endpoints)
 */
export async function triggerFeedRefresh(): Promise<{ success: boolean; durationMs: number }> {
  const startTime = Date.now();
  try {
    await refreshFeedMaterializedView();
    return { success: true, durationMs: Date.now() - startTime };
  } catch (error) {
    return { success: false, durationMs: Date.now() - startTime };
  }
}