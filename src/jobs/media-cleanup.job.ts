/**
 * Media Cleanup Job
 * Cleans up orphaned files, expired pending uploads, and failed processing artifacts
 * Implements BE-110: Media cleanup (orphaned files, expired pending uploads)
 */

import { neon } from '@neondatabase/serverless';
import { env } from '../config/env';
import { S3Client, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { rewriteMediaUrlToCdn } from '../services/media-processor';

let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let isCleaning = false;

// Neon Object Storage configuration
const s3Client = new S3Client({
  region: 'auto',
  endpoint: env.NEON_STORAGE_ENDPOINT || 'https://storage.neon.tech',
  credentials: {
    accessKeyId: env.NEON_STORAGE_ACCESS_KEY_ID || '',
    secretAccessKey: env.NEON_STORAGE_SECRET_ACCESS_KEY || '',
  },
});

const UPLOAD_BUCKET = 'uploads';
const PROCESSED_BUCKET = 'media';
const THUMBNAIL_BUCKET = 'thumbnails';

// Configuration
const PENDING_UPLOAD_EXPIRY_HOURS = 24; // Expire unconfirmed uploads after 24 hours
const ORPHANED_FILE_EXPIRY_DAYS = 7; // Delete orphaned files after 7 days
const FAILED_PROCESSING_RETENTION_DAYS = 30; // Keep failed processing records for 30 days

/**
 * Clean up expired pending uploads (unconfirmed uploads older than 24 hours)
 */
async function cleanupExpiredPendingUploads(): Promise<{ deletedCount: number; freedBytes: number }> {
  const sql = neon(env.DATABASE_URL);
  let deletedCount = 0;
  let freedBytes = 0;

  try {
    // Find expired pending uploads
    const expiredUploads = await sql`
      SELECT id, storage_path
      FROM pending_uploads
      WHERE confirmed = false
        AND created_at < NOW() - INTERVAL '${PENDING_UPLOAD_EXPIRY_HOURS} hours'
      LIMIT 1000
    `;

    if (expiredUploads.length === 0) {
      console.log('[MediaCleanup] No expired pending uploads found');
      return { deletedCount: 0, freedBytes: 0 };
    }

    console.log(`[MediaCleanup] Found ${expiredUploads.length} expired pending uploads`);

    // Delete from storage
    for (const upload of expiredUploads) {
      try {
        const command = new DeleteObjectCommand({
          Bucket: UPLOAD_BUCKET,
          Key: upload.storage_path,
        });
        await s3Client.send(command);
        freedBytes += 0; // Would need HEAD request to get size
        deletedCount++;
      } catch (err) {
        console.error(`[MediaCleanup] Failed to delete ${upload.storage_path}:`, err);
      }
    }

    // Delete from database
    const ids = expiredUploads.map(u => u.id);
    if (ids.length > 0) {
      await sql`
        DELETE FROM pending_uploads
        WHERE id = ANY(${ids})
      `;
    }

    console.log(`[MediaCleanup] Deleted ${deletedCount} expired pending uploads`);

  } catch (error) {
    console.error('[MediaCleanup] Error cleaning expired pending uploads:', error);
  }

  return { deletedCount, freedBytes };
}

/**
 * Clean up orphaned files in storage (files not referenced in database)
 */
async function cleanupOrphanedFiles(): Promise<{ deletedCount: number; freedBytes: number }> {
  let deletedCount = 0;
  let freedBytes = 0;

  const buckets = [UPLOAD_BUCKET, PROCESSED_BUCKET, THUMBNAIL_BUCKET];

  for (const bucket of buckets) {
    try {
      console.log(`[MediaCleanup] Scanning bucket: ${bucket}`);

      // List all objects in bucket
      const listCommand = new ListObjectsV2Command({
        Bucket: bucket,
        MaxKeys: 10000, // Adjust based on needs
      });

      const listResponse = await s3Client.send(listCommand);
      const objects = listResponse.Contents || [];

      if (objects.length === 0) {
        console.log(`[MediaCleanup] Bucket ${bucket} is empty`);
        continue;
      }

      console.log(`[MediaCleanup] Found ${objects.length} objects in ${bucket}`);

      // For each object, check if it's referenced in database
      // This is a simplified check - in production, you'd want to batch this
      const sql = neon(env.DATABASE_URL);

      for (const obj of objects) {
        if (!obj.Key) continue;

        // Skip if object is newer than ORPHANED_FILE_EXPIRY_DAYS
        if (obj.LastModified) {
          const ageDays = (Date.now() - obj.LastModified.getTime()) / (1000 * 60 * 60 * 24);
          if (ageDays < ORPHANED_FILE_EXPIRY_DAYS) {
            continue;
          }
        }

        // Check if referenced in media_items or pending_uploads
        const storagePath = obj.Key;
        const fullUrl = `${env.NEON_STORAGE_ENDPOINT}/${bucket}/${storagePath}`;

        const referenced = await sql`
          SELECT 1 FROM media_items WHERE url = ${fullUrl}
          UNION ALL
          SELECT 1 FROM pending_uploads WHERE storage_path = ${storagePath}
          UNION ALL
          SELECT 1 FROM users WHERE avatar_url = ${fullUrl} OR avatar_thumb_url = ${fullUrl}
          UNION ALL
          SELECT 1 FROM stories WHERE id IN (
            SELECT story_id FROM story_items WHERE media_url = ${fullUrl} OR thumbnail_url = ${fullUrl}
          )
          UNION ALL
          SELECT 1 FROM reels WHERE video_url = ${fullUrl} OR thumbnail_url = ${fullUrl}
          UNION ALL
          SELECT 1 FROM posts WHERE id IN (
            SELECT mediaable_id FROM media_items WHERE url = ${fullUrl}
          )
          LIMIT 1
        `;

        if (referenced.length === 0) {
          // Not referenced - orphaned file
          try {
            const deleteCommand = new DeleteObjectCommand({
              Bucket: bucket,
              Key: storagePath,
            });
            await s3Client.send(deleteCommand);
            freedBytes += obj.Size || 0;
            deletedCount++;
            console.log(`[MediaCleanup] Deleted orphaned file: ${bucket}/${storagePath}`);
          } catch (err) {
            console.error(`[MediaCleanup] Failed to delete orphaned ${bucket}/${storagePath}:`, err);
          }
        }
      }

    } catch (error) {
      console.error(`[MediaCleanup] Error scanning bucket ${bucket}:`, error);
    }
  }

  return { deletedCount, freedBytes };
}

/**
 * Clean up failed processing records (old failed media_items)
 */
async function cleanupFailedProcessing(): Promise<{ deletedCount: number }> {
  const sql = neon(env.DATABASE_URL);
  let deletedCount = 0;

  try {
    // Delete failed media_items older than retention period
    const result = await sql`
      DELETE FROM media_items
      WHERE processing_status = 'failed'
        AND created_at < NOW() - INTERVAL '${FAILED_PROCESSING_RETENTION_DAYS} days'
      RETURNING id
    `;

    deletedCount = result.length;
    console.log(`[MediaCleanup] Deleted ${deletedCount} failed processing records`);

  } catch (error) {
    console.error('[MediaCleanup] Error cleaning failed processing records:', error);
  }

  return { deletedCount };
}

/**
 * Clean up expired story media (stories have 24h TTL)
 * Note: This is also handled by story-expiration-job.ts
 */
async function cleanupExpiredStoryMedia(): Promise<{ deletedCount: number }> {
  const sql = neon(env.DATABASE_URL);
  let deletedCount = 0;

  try {
    // Find expired stories that haven't been cleaned up
    const expiredStories = await sql`
      SELECT s.id, array_agg(si.media_url) as media_urls, array_agg(si.thumbnail_url) as thumb_urls
      FROM stories s
      LEFT JOIN story_items si ON si.story_id = s.id
      WHERE s.expires_at < NOW()
        AND s.deleted_at IS NULL
      GROUP BY s.id
      LIMIT 500
    `;

    if (expiredStories.length === 0) {
      return { deletedCount: 0 };
    }

    console.log(`[MediaCleanup] Found ${expiredStories.length} expired stories with media`);

    // Delete media from storage
    for (const story of expiredStories) {
      const urls = [...(story.media_urls || []), ...(story.thumb_urls || [])].filter(Boolean);

      for (const url of urls) {
        try {
          // Extract bucket and key from URL
          const urlParts = url.replace(`${env.NEON_STORAGE_ENDPOINT}/`, '').split('/');
          const bucket = urlParts[0];
          const key = urlParts.slice(1).join('/');

          if (bucket && key) {
            const command = new DeleteObjectCommand({ Bucket: bucket, Key: key });
            await s3Client.send(command);
          }
        } catch (err) {
          console.error(`[MediaCleanup] Failed to delete story media ${url}:`, err);
        }
      }
    }

    // Delete expired stories (cascade will handle story_items, story_views, story_replies)
    await sql`
      DELETE FROM stories
      WHERE expires_at < NOW()
        AND deleted_at IS NULL
    `;

    deletedCount = expiredStories.length;
    console.log(`[MediaCleanup] Cleaned up ${deletedCount} expired stories`);

  } catch (error) {
    console.error('[MediaCleanup] Error cleaning expired story media:', error);
  }

  return { deletedCount };
}

/**
 * Main cleanup loop
 */
async function runCleanupLoop(): Promise<void> {
  if (isCleaning) {
    console.log('[MediaCleanup] Skipping - previous cleanup still running');
    return;
  }

  isCleaning = true;
  const startTime = Date.now();

  try {
    console.log('[MediaCleanup] Starting cleanup cycle');

    // Run all cleanup tasks
    const [pendingResult, orphanedResult, failedResult, storyResult] = await Promise.all([
      cleanupExpiredPendingUploads(),
      cleanupOrphanedFiles(),
      cleanupFailedProcessing(),
      cleanupExpiredStoryMedia(),
    ]);

    const totalDeleted = pendingResult.deletedCount + orphanedResult.deletedCount +
                        failedResult.deletedCount + storyResult.deletedCount;
    const totalFreed = pendingResult.freedBytes + orphanedResult.freedBytes;

    const duration = Date.now() - startTime;
    console.log(`[MediaCleanup] Completed in ${duration}ms - Deleted: ${totalDeleted}, Freed: ${formatBytes(totalFreed)}`);

  } catch (error) {
    console.error('[MediaCleanup] Cleanup loop error:', error);
  } finally {
    isCleaning = false;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Start the media cleanup job (runs every 6 hours)
 */
export function startMediaCleanupJob(): void {
  if (cleanupInterval) {
    console.log('[MediaCleanup] Job already running');
    return;
  }

  console.log('[MediaCleanup] Starting job (every 6 hours)');

  // Run immediately on start
  runCleanupLoop();

  // Then every 6 hours (21600000 ms)
  cleanupInterval = setInterval(() => {
    runCleanupLoop();
  }, 21600000);

  // Handle graceful shutdown
  process.on('SIGTERM', stopMediaCleanupJob);
  process.on('SIGINT', stopMediaCleanupJob);
}

/**
 * Stop the media cleanup job
 */
export function stopMediaCleanupJob(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log('[MediaCleanup] Job stopped');
  }
}

/**
 * Manual trigger for media cleanup (useful for testing or admin endpoints)
 */
export async function triggerMediaCleanup(): Promise<{
  success: boolean;
  durationMs: number;
  deletedCount: number;
  freedBytes: number;
}> {
  const startTime = Date.now();
  let totalDeleted = 0;
  let totalFreed = 0;

  try {
    const [pendingResult, orphanedResult, failedResult, storyResult] = await Promise.all([
      cleanupExpiredPendingUploads(),
      cleanupOrphanedFiles(),
      cleanupFailedProcessing(),
      cleanupExpiredStoryMedia(),
    ]);

    totalDeleted = pendingResult.deletedCount + orphanedResult.deletedCount +
                   failedResult.deletedCount + storyResult.deletedCount;
    totalFreed = pendingResult.freedBytes + orphanedResult.freedBytes;

    return {
      success: true,
      durationMs: Date.now() - startTime,
      deletedCount: totalDeleted,
      freedBytes: totalFreed,
    };
  } catch (error) {
    console.error('[MediaCleanup] Manual trigger error:', error);
    return {
      success: false,
      durationMs: Date.now() - startTime,
      deletedCount: 0,
      freedBytes: 0,
    };
  }
}

/**
 * Get media cleanup job status
 */
export async function getMediaCleanupStatus(): Promise<{
  isRunning: boolean;
  config: {
    pendingUploadExpiryHours: number;
    orphanedFileExpiryDays: number;
    failedProcessingRetentionDays: number;
  };
}> {
  return {
    isRunning: cleanupInterval !== null,
    config: {
      pendingUploadExpiryHours: PENDING_UPLOAD_EXPIRY_HOURS,
      orphanedFileExpiryDays: ORPHANED_FILE_EXPIRY_DAYS,
      failedProcessingRetentionDays: FAILED_PROCESSING_RETENTION_DAYS,
    },
  };
}

export default {
  startMediaCleanupJob,
  stopMediaCleanupJob,
  triggerMediaCleanup,
  getMediaCleanupStatus,
  runCleanupLoop,
};