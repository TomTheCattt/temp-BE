/**
 * Jobs Index - Export all background jobs
 * Centralized job management for the Instagram clone backend
 */

import {
  startFeedRefreshJob,
  stopFeedRefreshJob,
  triggerFeedRefresh,
} from './feed-refresh-job';

import {
  startStoryExpirationJob,
  stopStoryExpirationJob,
  triggerStoryExpirationCleanup,
} from './story-expiration-job';

import {
  startMediaTranscodingJob,
  stopMediaTranscodingJob,
  triggerMediaTranscoding,
  getTranscodingJobStatus,
} from './media-transcoding.job';

import {
  startThumbnailGenerationJob,
  stopThumbnailGenerationJob,
  triggerThumbnailGeneration,
  getThumbnailJobStatus,
} from './thumbnail-generation.job';

import {
  startMediaCleanupJob,
  stopMediaCleanupJob,
  triggerMediaCleanup,
  getMediaCleanupStatus,
} from './media-cleanup.job';

import {
  notificationDeliveryJob,
} from './notification-delivery.job';

import {
  getSearchIndexerJob,
  runPopularityScoreUpdate,
  runSearchIndexCleanup,
  runFullReindex,
} from './search-indexer.job';

import {
  startAnalyticsAggregationJob,
  stopAnalyticsAggregationJob,
  getAnalyticsJob,
} from './analytics-aggregation.job';

// Re-export all
export {
  startFeedRefreshJob,
  stopFeedRefreshJob,
  triggerFeedRefresh,
  startStoryExpirationJob,
  stopStoryExpirationJob,
  triggerStoryExpirationCleanup,
  startMediaTranscodingJob,
  stopMediaTranscodingJob,
  triggerMediaTranscoding,
  getTranscodingJobStatus,
  startThumbnailGenerationJob,
  stopThumbnailGenerationJob,
  triggerThumbnailGeneration,
  getThumbnailJobStatus,
  startMediaCleanupJob,
  stopMediaCleanupJob,
  triggerMediaCleanup,
  getMediaCleanupStatus,
  notificationDeliveryJob,
  getSearchIndexerJob,
  runPopularityScoreUpdate,
  runSearchIndexCleanup,
  runFullReindex,
  startAnalyticsAggregationJob,
  stopAnalyticsAggregationJob,
  getAnalyticsJob,
};

/**
 * Start all background jobs
 * Call this during application startup
 */
export function startAllJobs(): void {
  console.log('[Jobs] Starting all background jobs...');

  // Core jobs
  startFeedRefreshJob();
  startStoryExpirationJob();

  // Media pipeline jobs (Phase 5)
  startMediaTranscodingJob();
  startThumbnailGenerationJob();
  startMediaCleanupJob();

  // Notification delivery job (Phase 8)
  notificationDeliveryJob.startCleanupInterval();

  // Analytics aggregation job (Phase 10)
  startAnalyticsAggregationJob();

  console.log('[Jobs] All background jobs started');
}

/**
 * Stop all background jobs
 * Call this during application shutdown
 */
export function stopAllJobs(): void {
  console.log('[Jobs] Stopping all background jobs...');

  stopFeedRefreshJob();
  stopStoryExpirationJob();
  stopMediaTranscodingJob();
  stopThumbnailGenerationJob();
  stopMediaCleanupJob();

  notificationDeliveryJob.stopCleanupInterval();
  stopAnalyticsAggregationJob();

  console.log('[Jobs] All background jobs stopped');
}

/**
 * Get status of all jobs
 */
export async function getAllJobsStatus(): Promise<Record<string, any>> {
  const [
    transcodingStatus,
    thumbnailStatus,
    cleanupStatus,
  ] = await Promise.all([
    getTranscodingJobStatus(),
    getThumbnailJobStatus(),
    getMediaCleanupStatus(),
  ]);

  return {
    feedRefresh: { isRunning: true },
    storyExpiration: { isRunning: true },
    mediaTranscoding: transcodingStatus,
    thumbnailGeneration: thumbnailStatus,
    mediaCleanup: cleanupStatus,
    analyticsAggregation: { isRunning: getAnalyticsJob() !== null },
  };
}

export default {
  startAllJobs,
  stopAllJobs,
  getAllJobsStatus,
};