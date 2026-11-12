/**
 * Media Routes
 * Endpoints for media processing status, CDN URL rewriting, and media management
 * Implements BE-109: CDN integration (Cloudflare/Neon CDN)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, getCurrentUser } from '../middleware/auth';
import { db } from '../db/client';
import * as schema from '../db/schema';
import { eq, and, desc, sql, lt } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { env } from '../config/env';
import {
  rewriteMediaUrlToCdn,
  rewriteMediaItemUrls,
  getSignedCdnUrl,
  processVideoUpload,
  processImageUpload,
  extractMetadata,
  generatePerceptualHash,
  detectNSFW,
} from '../services/media-processor';

/**
 * Check if user has admin access
 * Uses ADMIN_EMAILS env variable (comma-separated list of admin emails)
 * Falls back to checking settings.isAdmin in user's JSON settings
 */
function isAdmin(user: typeof schema.users.$inferSelect): boolean {
  const adminEmails = env.ADMIN_EMAILS?.split(',').map((e: string) => e.trim().toLowerCase()) || [];
  if (adminEmails.length > 0 && user.email) {
    return adminEmails.includes(user.email.toLowerCase());
  }
  // Fallback to settings.isAdmin (settings is jsonb, cast to access property)
  const settings = user.settings as Record<string, unknown> | undefined;
  return settings?.isAdmin === true;
}
import {
  triggerMediaTranscoding,
  triggerThumbnailGeneration,
  triggerMediaCleanup,
  getTranscodingJobStatus,
  getThumbnailJobStatus,
  getMediaCleanupStatus,
} from '../jobs';

const mediaRouter = new Hono();
mediaRouter.use('*', authMiddleware);

// ============================================================================
// MEDIA PROCESSING STATUS
// ============================================================================

// GET /v1/media/pending/:id/status - Get processing status for a pending upload
mediaRouter.get('/pending/:id/status', async (c) => {
  const user = getCurrentUser(c);
  const pendingUploadId = c.req.param('id');

  const pending = await db.query.pendingUploads.findFirst({
    where: and(
      eq(schema.pendingUploads.id, pendingUploadId),
      eq(schema.pendingUploads.userId, user.id)
    ),
  });

  if (!pending) {
    throw new HTTPException(404, { message: 'Pending upload not found' });
  }

  // Check if media item exists
  const mediaItem = await db.query.mediaItems.findFirst({
    where: eq(schema.mediaItems.url, `${process.env.NEON_STORAGE_ENDPOINT}/uploads/${pending.storagePath}`),
  });

  return c.json({
    success: true,
    data: {
      pendingUploadId: pending.id,
      storagePath: pending.storagePath,
      confirmed: pending.confirmed,
      createdAt: pending.createdAt,
      mediaItem: mediaItem ? {
        id: mediaItem.id,
        url: rewriteMediaUrlToCdn(mediaItem.url),
        thumbnailUrl: mediaItem.thumbnailUrl ? rewriteMediaUrlToCdn(mediaItem.thumbnailUrl) : null,
        type: mediaItem.type,
        width: mediaItem.width,
        height: mediaItem.height,
        duration: mediaItem.duration,
        processingStatus: mediaItem.processingStatus,
        processingError: mediaItem.processingError,
        metadata: mediaItem.metadata,
        createdAt: mediaItem.createdAt,
      } : null,
    },
  });
});

// GET /v1/media/jobs/status - Get status of all media processing jobs
mediaRouter.get('/jobs/status', async (c) => {
  const user = getCurrentUser(c);

  // Only allow admins to see job status
  if (!isAdmin(user)) {
    throw new HTTPException(403, { message: 'Admin access required' });
  }

  const [transcodingStatus, thumbnailStatus, cleanupStatus] = await Promise.all([
    getTranscodingJobStatus(),
    getThumbnailJobStatus(),
    getMediaCleanupStatus(),
  ]);

  return c.json({
    success: true,
    data: {
      transcoding: transcodingStatus,
      thumbnailGeneration: thumbnailStatus,
      cleanup: cleanupStatus,
    },
  });
});

// ============================================================================
// ADMIN: TRIGGER MEDIA JOBS
// ============================================================================

// POST /v1/media/jobs/transcoding/trigger - Manually trigger video transcoding
mediaRouter.post('/jobs/transcoding/trigger', async (c) => {
  const user = getCurrentUser(c);

  if (!isAdmin(user)) {
    throw new HTTPException(403, { message: 'Admin access required' });
  }

  const result = await triggerMediaTranscoding();

  return c.json({
    success: result.success,
    data: {
      processedCount: result.processedCount,
      durationMs: result.durationMs,
    },
  });
});

// POST /v1/media/jobs/thumbnail/trigger - Manually trigger thumbnail generation
mediaRouter.post('/jobs/thumbnail/trigger', async (c) => {
  const user = getCurrentUser(c);

  if (!isAdmin(user)) {
    throw new HTTPException(403, { message: 'Admin access required' });
  }

  const result = await triggerThumbnailGeneration();

  return c.json({
    success: result.success,
    data: {
      processedCount: result.processedCount,
      durationMs: result.durationMs,
    },
  });
});

// POST /v1/media/jobs/cleanup/trigger - Manually trigger media cleanup
mediaRouter.post('/jobs/cleanup/trigger', async (c) => {
  const user = getCurrentUser(c);

  if (!isAdmin(user)) {
    throw new HTTPException(403, { message: 'Admin access required' });
  }

  const result = await triggerMediaCleanup();

  return c.json({
    success: result.success,
    data: {
      deletedCount: result.deletedCount,
      freedBytes: result.freedBytes,
      durationMs: result.durationMs,
    },
  });
});

// ============================================================================
// CDN URL REWRITING
// ============================================================================

// POST /v1/media/rewrite-url - Rewrite media URL to use CDN
const rewriteUrlSchema = z.object({
  url: z.string().url(),
});

mediaRouter.post('/rewrite-url', zValidator('json', rewriteUrlSchema), async (c) => {
  const { url } = c.req.valid('json');

  const cdnUrl = rewriteMediaUrlToCdn(url);

  return c.json({
    success: true,
    data: {
      originalUrl: url,
      cdnUrl,
      rewritten: cdnUrl !== url,
    },
  });
});

// POST /v1/media/rewrite-urls - Rewrite multiple media URLs to use CDN
const rewriteUrlsSchema = z.object({
  urls: z.array(z.string().url()).max(100),
});

mediaRouter.post('/rewrite-urls', zValidator('json', rewriteUrlsSchema), async (c) => {
  const { urls } = c.req.valid('json');

  const rewritten = urls.map(url => ({
    originalUrl: url,
    cdnUrl: rewriteMediaUrlToCdn(url),
    rewritten: rewriteMediaUrlToCdn(url) !== url,
  }));

  return c.json({
    success: true,
    data: { urls: rewritten },
  });
});

// GET /v1/media/signed-url/:storagePath - Get signed CDN URL for private media
const signedUrlSchema = z.object({
  bucket: z.enum(['uploads', 'media', 'thumbnails']).default('media'),
  expiresIn: z.number().positive().max(86400).default(3600), // Max 24 hours
});

mediaRouter.get('/signed-url/:storagePath', zValidator('query', signedUrlSchema), async (c) => {
  const storagePath = c.req.param('storagePath');
  const { bucket, expiresIn } = c.req.valid('query');

  const signedUrl = await getSignedCdnUrl(storagePath, bucket, expiresIn);

  return c.json({
    success: true,
    data: {
      storagePath,
      bucket,
      signedUrl,
      expiresIn,
    },
  });
});

// ============================================================================
// MEDIA METADATA
// ============================================================================

// GET /v1/media/metadata/:storagePath - Extract metadata from media file
mediaRouter.get('/metadata/:storagePath', async (c) => {
  const user = getCurrentUser(c);
  const storagePath = c.req.param('storagePath');

  // Verify user owns this file
  const pending = await db.query.pendingUploads.findFirst({
    where: and(
      eq(schema.pendingUploads.storagePath, storagePath),
      eq(schema.pendingUploads.userId, user.id)
    ),
  });

  if (!pending) {
    // Check media_items
    const mediaItem = await db.query.mediaItems.findFirst({
      where: eq(schema.mediaItems.url, `${process.env.NEON_STORAGE_ENDPOINT}/uploads/${storagePath}`),
    });

    if (!mediaItem) {
      throw new HTTPException(404, { message: 'Media file not found or access denied' });
    }
  }

  try {
    const metadata = await extractMetadata(storagePath);
    const pHash = await generatePerceptualHash(storagePath);
    const nsfwResult = await detectNSFW(storagePath);

    return c.json({
      success: true,
      data: {
        storagePath,
        metadata,
        perceptualHash: pHash,
        nsfw: nsfwResult,
      },
    });
  } catch (error) {
    throw new HTTPException(500, { message: 'Failed to extract metadata' });
  }
});

// ============================================================================
// MANUAL PROCESSING TRIGGERS (for testing/admin)
// ============================================================================

// POST /v1/media/process/video - Manually process a video upload
const processVideoSchema = z.object({
  pendingUploadId: z.string().uuid(),
});

mediaRouter.post('/process/video', zValidator('json', processVideoSchema), async (c) => {
  const user = getCurrentUser(c);
  const { pendingUploadId } = c.req.valid('json');

  const pending = await db.query.pendingUploads.findFirst({
    where: and(
      eq(schema.pendingUploads.id, pendingUploadId),
      eq(schema.pendingUploads.userId, user.id)
    ),
  });

  if (!pending) {
    throw new HTTPException(404, { message: 'Pending upload not found' });
  }

  if (!pending.confirmed) {
    throw new HTTPException(400, { message: 'Upload not confirmed' });
  }

  const result = await processVideoUpload(user.id, pendingUploadId, pending.storagePath, 'post');

  if (!result.success) {
    throw new HTTPException(500, { message: result.error || 'Video processing failed' });
  }

  return c.json({
    success: true,
    data: result.mediaData,
  });
});

// POST /v1/media/process/image - Manually process an image upload
const processImageSchema = z.object({
  pendingUploadId: z.string().uuid(),
  mediaType: z.enum(['post', 'story', 'avatar', 'message']).default('post'),
});

mediaRouter.post('/process/image', zValidator('json', processImageSchema), async (c) => {
  const user = getCurrentUser(c);
  const { pendingUploadId, mediaType } = c.req.valid('json');

  const pending = await db.query.pendingUploads.findFirst({
    where: and(
      eq(schema.pendingUploads.id, pendingUploadId),
      eq(schema.pendingUploads.userId, user.id)
    ),
  });

  if (!pending) {
    throw new HTTPException(404, { message: 'Pending upload not found' });
  }

  if (!pending.confirmed) {
    throw new HTTPException(400, { message: 'Upload not confirmed' });
  }

  const result = await processImageUpload(user.id, pendingUploadId, pending.storagePath, mediaType);

  if (!result.success) {
    throw new HTTPException(500, { message: result.error || 'Image processing failed' });
  }

  return c.json({
    success: true,
    data: result.mediaData,
  });
});

// ============================================================================
// MEDIA LISTING
// ============================================================================

// GET /v1/media/user - Get user's media items
const mediaListSchema = z.object({
  type: z.enum(['IMAGE', 'VIDEO', 'CAROUSEL', 'AUDIO']).optional(),
  processingStatus: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
  limit: z.coerce.number().positive().max(100).default(20),
  cursor: z.string().optional(),
});

mediaRouter.get('/user', zValidator('query', mediaListSchema), async (c) => {
  const user = getCurrentUser(c);
  const { type, processingStatus, limit, cursor } = c.req.valid('query');

  // For polymorphic media_items, we need to find media by user
  // This is a simplified query - in production you'd want to query by user's content
  const conditions = [
    // Media items where user is author (via polymorphic association)
    // This requires joining with posts/reels/stories/messages
    // For now, we'll use a simpler approach
    type ? eq(schema.mediaItems.type, type) : sql`1=1`,
    processingStatus ? eq(schema.mediaItems.processingStatus, processingStatus) : sql`1=1`,
  ];

  if (cursor) {
    const cursorDate = new Date(cursor);
    conditions.push(lt(schema.mediaItems.createdAt, cursorDate));
  }

  const items = await db
    .select()
    .from(schema.mediaItems)
    .where(and(...conditions))
    .orderBy(desc(schema.mediaItems.createdAt))
    .limit(limit + 1);
  const hasMore = items.length > limit;
  const results = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? results[results.length - 1].createdAt.toISOString() : null;

  // Rewrite URLs to CDN
  const rewrittenItems = results.map(item => rewriteMediaItemUrls(item));

  return c.json({
    success: true,
    data: {
      items: rewrittenItems,
      nextCursor,
      hasMore,
    },
  });
});

// GET /v1/media/pending - Get user's pending uploads
const pendingListSchema = z.object({
  confirmed: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().positive().max(100).default(20),
  cursor: z.string().optional(),
});

mediaRouter.get('/pending', zValidator('query', pendingListSchema), async (c) => {
  const user = getCurrentUser(c);
  const { confirmed, limit, cursor } = c.req.valid('query');

  const conditions = [
    eq(schema.pendingUploads.userId, user.id),
  ];

  if (confirmed !== undefined) {
    conditions.push(eq(schema.pendingUploads.confirmed, confirmed === 'true'));
  }

  if (cursor) {
    const cursorDate = new Date(cursor);
    conditions.push(lt(schema.pendingUploads.createdAt, cursorDate));
  }

  const items = await db
    .select()
    .from(schema.pendingUploads)
    .where(and(...conditions))
    .orderBy(desc(schema.pendingUploads.createdAt))
    .limit(limit + 1);
  const hasMore = items.length > limit;
  const results = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? results[results.length - 1].createdAt.toISOString() : null;

  // Rewrite URLs to CDN
  const rewrittenItems = results.map(item => ({
    ...item,
    url: rewriteMediaUrlToCdn(item.url),
  }));

  return c.json({
    success: true,
    data: {
      items: rewrittenItems,
      nextCursor,
      hasMore,
    },
  });
});

export { mediaRouter };