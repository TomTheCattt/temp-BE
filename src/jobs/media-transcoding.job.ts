/**
 * Media Transcoding Job
 * Job queue worker for video transcoding using FFmpeg
 * Implements BE-105: Video transcoding pipeline (FFmpeg via job queue)
 */

import { neon } from '@neondatabase/serverless';
import { env } from '../config/env';
import { sql } from 'drizzle-orm';
import {
  transcodeVideo,
  generateVideoThumbnail,
  extractMetadata,
  generatePerceptualHash,
  detectNSFW,
  processVideoUpload,
  rewriteMediaUrlToCdn,
} from '../services/media-processor';

let transcodingInterval: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

// Job status tracking
interface TranscodingJob {
  id: string;
  pendingUploadId: string;
  userId: string;
  storagePath: string;
  mediaType: 'reel' | 'story' | 'post' | 'message';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

const UPLOAD_BUCKET = 'uploads';
const STORAGE_BASE_URL = `${env.NEON_STORAGE_ENDPOINT}/${UPLOAD_BUCKET}`;

/**
 * Get pending transcoding jobs from database
 */
async function getPendingTranscodingJobs(limit: number = 10): Promise<TranscodingJob[]> {
  const sqlClient = neon(env.DATABASE_URL);

  // We need to construct the URL check differently - check if media_items has a record for this storage path
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
      AND (
        pu.storage_path LIKE '%.mp4'
        OR pu.storage_path LIKE '%.mov'
        OR pu.storage_path LIKE '%.webm'
        OR pu.storage_path LIKE '%.mkv'
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

function inferMediaType(storagePath: string): 'reel' | 'story' | 'post' | 'message' {
  if (storagePath.includes('/reels/')) return 'reel';
  if (storagePath.includes('/stories/')) return 'story';
  if (storagePath.includes('/messages/')) return 'message';
  return 'post';
}

/**
 * Process a single transcoding job
 */
async function processTranscodingJob(job: TranscodingJob): Promise<void> {
  const sqlClient = neon(env.DATABASE_URL);

  console.log(`[MediaTranscoding] Processing job ${job.id} for ${job.storagePath}`);

  try {
    // Update status to processing
    await sqlClient`
      UPDATE pending_uploads
      SET updated_at = NOW()
      WHERE id = ${job.pendingUploadId}
    `;

    // Process the video upload
    const result = await processVideoUpload(
      job.userId,
      job.pendingUploadId,
      job.storagePath,
      job.mediaType
    );

    if (!result.success) {
      throw new Error(result.error || 'Video processing failed');
    }

    const mediaData = result.mediaData!;

    // Create media_items record
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
        ${rewriteMediaUrlToCdn(mediaData.url!)},
        ${mediaData.thumbnailUrl ? rewriteMediaUrlToCdn(mediaData.thumbnailUrl) : null},
        ${mediaData.type},
        ${mediaData.width},
        ${mediaData.height},
        ${mediaData.duration},
        'completed',
        ${JSON.stringify(mediaData.metadata)},
        NOW()
      )
    `;

    // Mark pending upload as processed
    await sqlClient`
      UPDATE pending_uploads
      SET updated_at = NOW()
      WHERE id = ${job.pendingUploadId}
    `;

    console.log(`[MediaTranscoding] Job ${job.id} completed successfully`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[MediaTranscoding] Job ${job.id} failed:`, errorMessage);

    // Update pending_uploads with error
    await sqlClient`
      UPDATE pending_uploads
      SET updated_at = NOW()
      WHERE id = ${job.pendingUploadId}
    `;

    // Could add a processing_error field to pending_uploads or create a separate job_logs table
  }
}

/**
 * Main transcoding loop
 */
async function runTranscodingLoop(): Promise<void> {
  if (isProcessing) {
    console.log('[MediaTranscoding] Skipping - previous run still processing');
    return;
  }

  isProcessing = true;
  const startTime = Date.now();

  try {
    const jobs = await getPendingTranscodingJobs(5); // Process 5 at a time

    if (jobs.length === 0) {
      console.log('[MediaTranscoding] No pending jobs');
      return;
    }

    console.log(`[MediaTranscoding] Found ${jobs.length} jobs to process`);

    // Process jobs sequentially (could be parallelized with worker pool)
    for (const job of jobs) {
      await processTranscodingJob(job);
    }

    const duration = Date.now() - startTime;
    console.log(`[MediaTranscoding] Processed ${jobs.length} jobs in ${duration}ms`);

  } catch (error) {
    console.error('[MediaTranscoding] Loop error:', error);
  } finally {
    isProcessing = false;
  }
}

/**
 * Start the media transcoding job (runs every 30 seconds)
 */
export function startMediaTranscodingJob(): void {
  if (transcodingInterval) {
    console.log('[MediaTranscoding] Job already running');
    return;
  }

  console.log('[MediaTranscoding] Starting job (every 30 seconds)');

  // Run immediately on start
  runTranscodingLoop();

  // Then every 30 seconds
  transcodingInterval = setInterval(() => {
    runTranscodingLoop();
  }, 30000);

  // Handle graceful shutdown
  process.on('SIGTERM', stopMediaTranscodingJob);
  process.on('SIGINT', stopMediaTranscodingJob);
}

/**
 * Stop the media transcoding job
 */
export function stopMediaTranscodingJob(): void {
  if (transcodingInterval) {
    clearInterval(transcodingInterval);
    transcodingInterval = null;
    console.log('[MediaTranscoding] Job stopped');
  }
}

/**
 * Manual trigger for transcoding (useful for testing or admin endpoints)
 */
export async function triggerMediaTranscoding(): Promise<{ success: boolean; durationMs: number; processedCount: number }> {
  const startTime = Date.now();
  let processedCount = 0;

  try {
    const jobs = await getPendingTranscodingJobs(10);

    for (const job of jobs) {
      await processTranscodingJob(job);
      processedCount++;
    }

    return { success: true, durationMs: Date.now() - startTime, processedCount };
  } catch (error) {
    console.error('[MediaTranscoding] Manual trigger error:', error);
    return { success: false, durationMs: Date.now() - startTime, processedCount };
  }
}

/**
 * Get transcoding job status
 */
export async function getTranscodingJobStatus(): Promise<{
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
      AND (
        pu.storage_path LIKE '%.mp4'
        OR pu.storage_path LIKE '%.mov'
        OR pu.storage_path LIKE '%.webm'
        OR pu.storage_path LIKE '%.mkv'
      )
  `;

  return {
    isRunning: transcodingInterval !== null,
    pendingJobsCount: Number(result[0]?.count || 0),
  };
}

export default {
  startMediaTranscodingJob,
  stopMediaTranscodingJob,
  triggerMediaTranscoding,
  getTranscodingJobStatus,
  processTranscodingJob,
};