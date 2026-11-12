/**
 * Thumbnail Generation Job
 * Job queue worker for thumbnail generation (Sharp for images, FFmpeg for video)
 * Implements BE-106: Thumbnail generation (Sharp for images, FFmpeg for video)
 */

import { neon } from '@neondatabase/serverless';
import { env } from '../config/env';
import {
  generateImageThumbnail,
  generateVideoThumbnail,
  extractMetadata,
  rewriteMediaUrlToCdn,
} from '../services/media-processor';

let thumbnailInterval: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

interface ThumbnailJob {
  id: string;
  pendingUploadId: string;
  userId: string;
  storagePath: string;
  mediaType: 'reel' | 'story' | 'post' | 'avatar' | 'message';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  createdAt: Date;
}

const UPLOAD_BUCKET = 'uploads';
const STORAGE_BASE_URL = `${env.NEON_STORAGE_ENDPOINT}/${UPLOAD_BUCKET}`;

/**
 * Get pending thumbnail generation jobs from database
 */
async function getPendingThumbnailJobs(limit: number = 20): Promise<ThumbnailJob[]> {
  const sqlClient = neon(env.DATABASE_URL);

  // Get confirmed uploads that don't have thumbnails generated yet
  const jobs = await sqlClient`
    SELECT
      pu.id as pending_upload_id,
      pu.user_id,
      pu.storage_path,
      pu.id as job_id
    FROM pending_uploads pu
    WHERE pu.confirmed = true
      AND NOT EXISTS (
        SELECT 1 FROM media_items mi
        WHERE mi.url = ${STORAGE_BASE_URL} || '/' || pu.storage_path
      )
    ORDER BY pu.created_at ASC
    LIMIT ${limit}
  `;

  return jobs.map((job: any) => ({
    id: job.job_id,
    pendingUploadId: job.pending_upload_id,
    userId: job.user_id,
    storagePath: job.storage_path,
    mediaType: inferMediaType(job.storage_path),
    status: 'pending' as const,
    createdAt: new Date(),
  }));
}

function inferMediaType(storagePath: string): 'reel' | 'story' | 'post' | 'avatar' | 'message' {
  if (storagePath.includes('/reels/')) return 'reel';
  if (storagePath.includes('/stories/')) return 'story';
  if (storagePath.includes('/avatars/')) return 'avatar';
  if (storagePath.includes('/messages/')) return 'message';
  return 'post';
}

function isVideoFile(storagePath: string): boolean {
  return /\.(mp4|mov|webm|mkv|avi)$/i.test(storagePath);
}

function isImageFile(storagePath: string): boolean {
  return /\.(jpg|jpeg|png|webp|heic|heif|avif)$/i.test(storagePath);
}

/**
 * Get thumbnail dimensions based on media type
 */
function getThumbnailDimensions(mediaType: string): { width: number; height: number } {
  switch (mediaType) {
    case 'reel':
      return { width: 640, height: 360 };
    case 'story':
      return { width: 540, height: 960 };
    case 'avatar':
      return { width: 200, height: 200 };
    case 'message':
      return { width: 300, height: 300 };
    default: // post
      return { width: 640, height: 640 };
  }
}

/**
 * Process a single thumbnail generation job
 */
async function processThumbnailJob(job: ThumbnailJob): Promise<void> {
  const sqlClient = neon(env.DATABASE_URL);

  console.log(`[ThumbnailGen] Processing job ${job.id} for ${job.storagePath}`);

  try {
    let result;

    if (isVideoFile(job.storagePath)) {
      const dims = getThumbnailDimensions(job.mediaType);
      result = await generateVideoThumbnail(job.userId, job.storagePath, {
        inputPath: job.storagePath,
        outputPath: '', // Not used directly in the function
        width: dims.width,
        height: dims.height,
        timestamp: job.mediaType === 'reel' ? 1 : 0.5,
      });
    } else if (isImageFile(job.storagePath)) {
      const dims = getThumbnailDimensions(job.mediaType);
      result = await generateImageThumbnail(job.userId, job.storagePath, {
        inputPath: job.storagePath,
        outputPath: '', // Not used directly in the function
        width: dims.width,
        height: dims.height,
        fit: job.mediaType === 'avatar' ? 'cover' : 'inside',
      });
    } else {
      console.log(`[ThumbnailGen] Unsupported file type for ${job.storagePath}`);
      return;
    }

    if (!result.success) {
      throw new Error(result.error || 'Thumbnail generation failed');
    }

    // Extract metadata for the media item
    const metadata = await extractMetadata(job.storagePath);

    // Determine media type for database
    const dbMediaType = isVideoFile(job.storagePath) ? 'VIDEO' : 'IMAGE';

    // Create media_items record with thumbnail
    await sqlClient`
      INSERT INTO media_items (
        mediaable_type,
        mediaable_id,
        url,
        thumbnail_url,
        type,
        width,
        height,
        duration,
        processing_status,
        metadata,
        created_at
      ) VALUES (
        ${job.mediaType},
        ${job.pendingUploadId},
        ${rewriteMediaUrlToCdn(STORAGE_BASE_URL + '/' + job.storagePath)},
        ${result.thumbnailUrl ? rewriteMediaUrlToCdn(result.thumbnailUrl) : null},
        ${dbMediaType},
        ${metadata.width},
        ${metadata.height},
        ${metadata.duration || null},
        'completed',
        ${JSON.stringify({
          ...metadata,
          thumbnailGenerated: true,
          thumbnailUrl: result.thumbnailUrl,
        })},
        NOW()
      )
    `;

    // Mark pending upload as having thumbnail generated
    await sqlClient`
      UPDATE pending_uploads
      SET updated_at = NOW()
      WHERE id = ${job.pendingUploadId}
    `;

    console.log(`[ThumbnailGen] Job ${job.id} completed successfully`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[ThumbnailGen] Job ${job.id} failed:`, errorMessage);

    // Update pending_uploads with error
    await sqlClient`
      UPDATE pending_uploads
      SET updated_at = NOW()
      WHERE id = ${job.pendingUploadId}
    `;
  }
}

/**
 * Main thumbnail generation loop
 */
async function runThumbnailLoop(): Promise<void> {
  if (isProcessing) {
    console.log('[ThumbnailGen] Skipping - previous run still processing');
    return;
  }

  isProcessing = true;
  const startTime = Date.now();

  try {
    const jobs = await getPendingThumbnailJobs(10); // Process 10 at a time

    if (jobs.length === 0) {
      console.log('[ThumbnailGen] No pending jobs');
      return;
    }

    console.log(`[ThumbnailGen] Found ${jobs.length} jobs to process`);

    // Process jobs sequentially
    for (const job of jobs) {
      await processThumbnailJob(job);
    }

    const duration = Date.now() - startTime;
    console.log(`[ThumbnailGen] Processed ${jobs.length} jobs in ${duration}ms`);

  } catch (error) {
    console.error('[ThumbnailGen] Loop error:', error);
  } finally {
    isProcessing = false;
  }
}

/**
 * Start the thumbnail generation job (runs every 60 seconds)
 */
export function startThumbnailGenerationJob(): void {
  if (thumbnailInterval) {
    console.log('[ThumbnailGen] Job already running');
    return;
  }

  console.log('[ThumbnailGen] Starting job (every 60 seconds)');

  // Run immediately on start
  runThumbnailLoop();

  // Then every 60 seconds
  thumbnailInterval = setInterval(() => {
    runThumbnailLoop();
  }, 60000);

  // Handle graceful shutdown
  process.on('SIGTERM', stopThumbnailGenerationJob);
  process.on('SIGINT', stopThumbnailGenerationJob);
}

/**
 * Stop the thumbnail generation job
 */
export function stopThumbnailGenerationJob(): void {
  if (thumbnailInterval) {
    clearInterval(thumbnailInterval);
    thumbnailInterval = null;
    console.log('[ThumbnailGen] Job stopped');
  }
}

/**
 * Manual trigger for thumbnail generation (useful for testing or admin endpoints)
 */
export async function triggerThumbnailGeneration(): Promise<{ success: boolean; durationMs: number; processedCount: number }> {
  const startTime = Date.now();
  let processedCount = 0;

  try {
    const jobs = await getPendingThumbnailJobs(20);

    for (const job of jobs) {
      await processThumbnailJob(job);
      processedCount++;
    }

    return { success: true, durationMs: Date.now() - startTime, processedCount };
  } catch (error) {
    console.error('[ThumbnailGen] Manual trigger error:', error);
    return { success: false, durationMs: Date.now() - startTime, processedCount: 0 };
  }
}

/**
 * Get thumbnail generation job status
 */
export async function getThumbnailJobStatus(): Promise<{
  isRunning: boolean;
  pendingJobsCount: number;
}> {
  const sqlClient = neon(env.DATABASE_URL);

  const result = await sqlClient`
    SELECT COUNT(*) as count
    FROM pending_uploads pu
    WHERE pu.confirmed = true
      AND NOT EXISTS (
        SELECT 1 FROM media_items mi
        WHERE mi.url = ${STORAGE_BASE_URL} || '/' || pu.storage_path
      )
  `;

  return {
    isRunning: thumbnailInterval !== null,
    pendingJobsCount: Number(result[0]?.count || 0),
  };
}

export default {
  startThumbnailGenerationJob,
  stopThumbnailGenerationJob,
  triggerThumbnailGeneration,
  getThumbnailJobStatus,
  processThumbnailJob,
};