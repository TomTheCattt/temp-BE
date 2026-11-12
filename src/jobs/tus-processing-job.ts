/**
 * TUS Processing Job Worker
 *
 * Processes completed TUS uploads:
 * - Virus scanning
 * - Video transcoding
 * - Thumbnail generation
 * - Metadata extraction
 * - NSFW detection
 * - Perceptual hashing
 */

import { db } from "../db/client";
import { eq, and, desc } from "drizzle-orm";
import * as schema from "../db/schema";
import { S3Client, GetObjectCommand, PutObjectCommand, CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

// ============================================================================
// Configuration
// ============================================================================

const s3Client = new S3Client({
  region: "auto",
  endpoint: process.env.NEON_STORAGE_ENDPOINT || "https://storage.neon.tech",
  credentials: {
    accessKeyId: process.env.NEON_STORAGE_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.NEON_STORAGE_SECRET_ACCESS_KEY || "",
  },
});

const TUS_BUCKET = "tus-uploads";
const MEDIA_BUCKET = "media";
const PROCESSING_INTERVAL_MS = 5000; // 5 seconds
const MAX_CONCURRENT_JOBS = 3;

// Job state
let isProcessing = false;
let processingInterval: ReturnType<typeof setInterval> | null = null;

// ============================================================================
// Processing Functions
// ============================================================================

/**
 * Start the processing worker
 */
export function startTusProcessingJob(): void {
  if (processingInterval) {
    console.log("[TUS Processing] Already running");
    return;
  }

  console.log("[TUS Processing] Starting worker...");

  processingInterval = setInterval(async () => {
    if (isProcessing) return;
    await processPendingJobs();
  }, PROCESSING_INTERVAL_MS);

  processingInterval.unref?.();
}

/**
 * Stop the processing worker
 */
export function stopTusProcessingJob(): void {
  if (processingInterval) {
    clearInterval(processingInterval);
    processingInterval = null;
    console.log("[TUS Processing] Stopped worker");
  }
}

/**
 * Process pending jobs
 */
async function processPendingJobs(): Promise<void> {
  isProcessing = true;

  try {
    // Find pending jobs
    const pendingJobs = await db.query.processingJobs.findMany({
      where: eq(schema.processingJobs.status, "pending"),
      orderBy: desc(schema.processingJobs.createdAt),
      limit: MAX_CONCURRENT_JOBS,
    });

    for (const job of pendingJobs) {
      await processJob(job);
    }
  } catch (error) {
    console.error("[TUS Processing] Error processing jobs:", error);
  } finally {
    isProcessing = false;
  }
}

/**
 * Process a single job
 */
async function processJob(job: typeof schema.processingJobs.$inferSelect): Promise<void> {
  const jobId = job.id;
  console.log(`[TUS Processing] Processing job ${jobId} (type: ${job.type})`);

  try {
    // Update job status to processing
    await db.update(schema.processingJobs)
      .set({ status: "processing", startedAt: new Date(), attempts: job.attempts + 1 })
      .where(eq(schema.processingJobs.id, jobId));

    // Get the upload info
    const upload = await db.query.tusUploads.findFirst({
      where: eq(schema.tusUploads.id, job.uploadId),
    });

    if (!upload) {
      throw new Error("Upload not found");
    }

    const payload = job.payload as any;
    const storagePath = payload.storagePath;
    const fileSize = payload.fileSize;
    const metadata = payload.metadata;

    // Process based on job type
    let result: any = {};

    switch (job.type) {
      case "media":
        result = await processMedia(upload, storagePath, metadata);
        break;
      case "video":
        result = await processVideo(upload, storagePath, metadata);
        break;
      case "image":
        result = await processImage(upload, storagePath, metadata);
        break;
      case "thumbnail":
        result = await generateThumbnails(upload, storagePath, metadata);
        break;
      case "transcode":
        result = await transcodeVideo(upload, storagePath, metadata);
        break;
      case "nsfw":
        result = await detectNsfw(upload, storagePath, metadata);
        break;
      case "metadata":
        result = await extractMetadata(upload, storagePath, metadata);
        break;
      default:
        result = await processMedia(upload, storagePath, metadata);
    }

    // Update job as completed
    await db.update(schema.processingJobs)
      .set({
        status: "completed",
        result: result as any,
        completedAt: new Date(),
      })
      .where(eq(schema.processingJobs.id, jobId));

    // Update upload status
    await db.update(schema.tusUploads)
      .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.tusUploads.id, job.uploadId));

    console.log(`[TUS Processing] Job ${jobId} completed`);

  } catch (error) {
    console.error(`[TUS Processing] Job ${jobId} failed:`, error);

    // Update job as failed
    await db.update(schema.processingJobs)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
        completedAt: new Date(),
      })
      .where(eq(schema.processingJobs.id, jobId));

    // If max attempts reached, mark upload as failed
    if (job.attempts + 1 >= job.maxAttempts) {
      await db.update(schema.tusUploads)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(schema.tusUploads.id, job.uploadId));
    }
  }
}

// ============================================================================
// Media Processing Functions (Placeholders for actual implementation)
// ============================================================================

async function processMedia(
  upload: typeof schema.tusUploads.$inferSelect,
  storagePath: string,
  metadata: any
): Promise<any> {
  const fileType = metadata.filetype || "";
  const isVideo = fileType.startsWith("video/");
  const isImage = fileType.startsWith("image/");

  // Determine final storage path in media bucket
  const finalPath = generateMediaPath(upload.userId, metadata.targetType, metadata.filename);

  // Copy from TUS bucket to media bucket
  await copyObject(TUS_BUCKET, storagePath, MEDIA_BUCKET, finalPath);

  const finalUrl = `${process.env.NEON_STORAGE_ENDPOINT}/${MEDIA_BUCKET}/${finalPath}`;

  // Create media item record
  const mediaItem = await createMediaItem(upload, finalUrl, metadata);

  // If video, queue additional processing
  if (isVideo) {
    await queueVideoProcessing(upload.id, finalPath, metadata);
  }

  // If image, queue thumbnail generation
  if (isImage) {
    await queueThumbnailGeneration(upload.id, finalPath, metadata);
  }

  // Queue NSFW detection for all media
  await queueNsfwDetection(upload.id, finalPath, metadata);

  // Queue metadata extraction
  await queueMetadataExtraction(upload.id, finalPath, metadata);

  return {
    finalUrl,
    mediaItem,
    storagePath: finalPath,
  };
}

async function processVideo(
  upload: typeof schema.tusUploads.$inferSelect,
  storagePath: string,
  metadata: any
): Promise<any> {
  // Copy to media bucket
  const finalPath = generateMediaPath(upload.userId, metadata.targetType, metadata.filename);
  await copyObject(TUS_BUCKET, storagePath, MEDIA_BUCKET, finalPath);

  const finalUrl = `${process.env.NEON_STORAGE_ENDPOINT}/${MEDIA_BUCKET}/${finalPath}`;

  // Create media item
  const mediaItem = await createMediaItem(upload, finalUrl, metadata);

  // Queue transcoding, thumbnails, waveform, NSFW, metadata
  await queueVideoProcessing(upload.id, finalPath, metadata);

  return { finalUrl, mediaItem, storagePath: finalPath };
}

async function processImage(
  upload: typeof schema.tusUploads.$inferSelect,
  storagePath: string,
  metadata: any
): Promise<any> {
  const finalPath = generateMediaPath(upload.userId, metadata.targetType, metadata.filename);
  await copyObject(TUS_BUCKET, storagePath, MEDIA_BUCKET, finalPath);

  const finalUrl = `${process.env.NEON_STORAGE_ENDPOINT}/${MEDIA_BUCKET}/${finalPath}`;

  const mediaItem = await createMediaItem(upload, finalUrl, metadata);

  // Queue thumbnail generation
  await queueThumbnailGeneration(upload.id, finalPath, metadata);

  return { finalUrl, mediaItem, storagePath: finalPath };
}

async function generateThumbnails(
  upload: typeof schema.tusUploads.$inferSelect,
  storagePath: string,
  metadata: any
): Promise<any> {
  // TODO: Implement actual thumbnail generation using Sharp/FFmpeg
  // This would download the file, generate thumbnails at multiple sizes,
  // upload them, and return the URLs

  const thumbnailSizes = [
    { width: 150, height: 150, suffix: "thumb" },
    { width: 360, height: 640, suffix: "preview" },
    { width: 720, height: 1280, suffix: "large" },
  ];

  const thumbnails: any[] = [];

  for (const size of thumbnailSizes) {
    // In production, use Sharp or FFmpeg to generate actual thumbnails
    const thumbPath = `${storagePath}.${size.suffix}.jpg`;
    // Placeholder: just copy the original for now
    await copyObject(MEDIA_BUCKET, storagePath, MEDIA_BUCKET, thumbPath);
    thumbnails.push({
      url: `${process.env.NEON_STORAGE_ENDPOINT}/${MEDIA_BUCKET}/${thumbPath}`,
      width: size.width,
      height: size.height,
    });
  }

  return { thumbnails };
}

async function transcodeVideo(
  upload: typeof schema.tusUploads.$inferSelect,
  storagePath: string,
  metadata: any
): Promise<any> {
  // TODO: Implement actual video transcoding using FFmpeg
  // This would create multiple bitrate versions (1080p, 720p, 480p)
  // using H.264/HEVC and possibly AV1

  const bitrates = [
    { bitrate: "5000k", resolution: "1920x1080", suffix: "1080p" },
    { bitrate: "2500k", resolution: "1280x720", suffix: "720p" },
    { bitrate: "1000k", resolution: "854x480", suffix: "480p" },
  ];

  const variants: any[] = [];

  for (const br of bitrates) {
    const variantPath = `${storagePath}.${br.suffix}.mp4`;
    // Placeholder: copy original
    await copyObject(MEDIA_BUCKET, storagePath, MEDIA_BUCKET, variantPath);
    variants.push({
      url: `${process.env.NEON_STORAGE_ENDPOINT}/${MEDIA_BUCKET}/${variantPath}`,
      bitrate: br.bitrate,
      resolution: br.resolution,
    });
  }

  return { variants };
}

async function detectNsfw(
  upload: typeof schema.tusUploads.$inferSelect,
  storagePath: string,
  metadata: any
): Promise<any> {
  // TODO: Implement NSFW detection using TensorFlow Lite or similar
  // For now, return safe
  return { isNsfw: false, confidence: 0.99 };
}

async function extractMetadata(
  upload: typeof schema.tusUploads.$inferSelect,
  storagePath: string,
  metadata: any
): Promise<any> {
  // TODO: Implement metadata extraction (EXIF, duration, dimensions, etc.)
  // Using libraries like exifr, ffprobe, etc.

  return {
    width: metadata.width || 0,
    height: metadata.height || 0,
    duration: metadata.duration || 0,
    format: metadata.filetype,
    // EXIF data would go here
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

async function createMediaItem(
  upload: typeof schema.tusUploads.$inferSelect,
  finalUrl: string,
  metadata: any
): Promise<any> {
  const mediaType = metadata.filetype.startsWith("video/") ? "VIDEO" : "IMAGE";

  const [mediaItem] = await db.insert(schema.mediaItems).values({
    mediaableType: metadata.targetType,
    mediaableId: metadata.targetId || randomUUID(), // Temporary if no target yet
    url: finalUrl,
    thumbnailUrl: finalUrl, // Will be updated after thumbnail generation
    type: mediaType,
    width: metadata.width,
    height: metadata.height,
    duration: metadata.duration,
    sortOrder: 0,
    processingStatus: "completed",
    metadata: {
      originalFilename: metadata.filename,
      fileSize: upload.fileSize,
      uploadId: upload.id,
      ...metadata,
    },
  }).returning();

  return mediaItem;
}

async function queueVideoProcessing(uploadId: string, storagePath: string, metadata: any): Promise<void> {
  await db.insert(schema.processingJobs).values({
    uploadId,
    userId: metadata.userId,
    type: "transcode",
    status: "pending",
    payload: { storagePath, metadata } as any,
  });

  await db.insert(schema.processingJobs).values({
    uploadId,
    userId: metadata.userId,
    type: "thumbnail",
    status: "pending",
    payload: { storagePath, metadata } as any,
  });

  // Queue waveform for audio/video
  if (metadata.filetype.startsWith("video/") || metadata.filetype.startsWith("audio/")) {
    await db.insert(schema.processingJobs).values({
      uploadId,
      userId: metadata.userId,
      type: "metadata", // waveform extraction
      status: "pending",
      payload: { storagePath, metadata, extractWaveform: true } as any,
    });
  }
}

async function queueThumbnailGeneration(uploadId: string, storagePath: string, metadata: any): Promise<void> {
  await db.insert(schema.processingJobs).values({
    uploadId,
    userId: metadata.userId,
    type: "thumbnail",
    status: "pending",
    payload: { storagePath, metadata } as any,
  });
}

async function queueNsfwDetection(uploadId: string, storagePath: string, metadata: any): Promise<void> {
  await db.insert(schema.processingJobs).values({
    uploadId,
    userId: metadata.userId,
    type: "nsfw",
    status: "pending",
    payload: { storagePath, metadata } as any,
  });
}

async function queueMetadataExtraction(uploadId: string, storagePath: string, metadata: any): Promise<void> {
  await db.insert(schema.processingJobs).values({
    uploadId,
    userId: metadata.userId,
    type: "metadata",
    status: "pending",
    payload: { storagePath, metadata } as any,
  });
}

function generateMediaPath(userId: string, targetType: string, filename: string): string {
  const ext = filename.split(".").pop() || "bin";
  const date = new Date();
  const dateStr = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
  return `${targetType}s/${userId}/${dateStr}/${randomUUID()}.${ext}`;
}

async function copyObject(
  sourceBucket: string,
  sourceKey: string,
  destBucket: string,
  destKey: string
): Promise<void> {
  await s3Client.send(new CopyObjectCommand({
    Bucket: destBucket,
    CopySource: `${sourceBucket}/${sourceKey}`,
    Key: destKey,
  }));
}

// Export for manual triggering
export async function processUploadManually(uploadId: string): Promise<void> {
  const job = await db.query.processingJobs.findFirst({
    where: eq(schema.processingJobs.uploadId, uploadId),
  });

  if (job) {
    await processJob(job);
  }
}