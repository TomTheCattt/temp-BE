import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware, getCurrentUser } from "../middleware/auth";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, desc, lt } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { tusService, TusUploadMetadata } from "../services/tus-service";

// Magic bytes for file type validation
const MAGIC_BYTES: Record<string, number[][]> = {
  "image/jpeg": [[0xFF, 0xD8, 0xFF]],
  "image/png": [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]],
  "image/heic": [
    [0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63],
    [0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70, 0x6D, 0x69, 0x66, 0x31],
  ],
  "image/heif": [
    [0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63],
    [0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70, 0x6D, 0x69, 0x66, 0x31],
  ],
  "video/mp4": [
    [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6F, 0x6D],
    [0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6F, 0x6D],
    [0x00, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70, 0x6D, 0x70, 0x34, 0x32],
  ],
  "video/quicktime": [
    [0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20],
    [0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20],
  ],
  "video/webm": [[0x1A, 0x45, 0xDF, 0xA3]],
};

function validateMagicBytes(buffer: Uint8Array, contentType: string): boolean {
  const signatures = MAGIC_BYTES[contentType];
  if (!signatures) return false;

  return signatures.some((sig) =>
    sig.every((byte, index) => buffer[index] === byte)
  );
}

// Neon Object Storage configuration
const s3Client = new S3Client({
  region: "auto",
  endpoint: process.env.NEON_STORAGE_ENDPOINT || "https://storage.neon.tech",
  credentials: {
    accessKeyId: process.env.NEON_STORAGE_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.NEON_STORAGE_SECRET_ACCESS_KEY || "",
  },
});

const UPLOAD_BUCKET = "uploads";
const PUBLIC_BUCKET = "public";

const presignSchema = z.object({
  contentType: z.string().regex(/^(image|video)\//),
  maxSize: z.number().positive().max(100 * 1024 * 1024), // max 100MB
  prefix: z.string().optional().default("temp"),
});

const confirmUploadSchema = z.object({
  pendingUploadId: z.string().uuid(),
  targetType: z.enum(["post", "reel", "story", "avatar", "message"]),
  targetId: z.string().uuid().optional(),
});

function getFileExtension(contentType: string): string {
  const mimeMap: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
  };
  return mimeMap[contentType] || ".bin";
}

function generateStoragePath(userId: string, prefix: string, contentType: string): string {
  const ext = getFileExtension(contentType);
  const date = new Date();
  const dateStr = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
  return `${prefix}/${userId}/${dateStr}/${randomUUID()}${ext}`;
}

const uploadRouter = new Hono();
uploadRouter.use("*", authMiddleware);

// POST /v1/upload/presign - Get presigned URL for direct upload
uploadRouter.post("/presign", zValidator("json", presignSchema), async (c) => {
  const user = getCurrentUser(c);
  const { contentType, maxSize, prefix } = c.req.valid("json");

  const storagePath = generateStoragePath(user.id, prefix, contentType);
  const key = `${storagePath}`;

  // Create presigned PUT URL
  const command = new PutObjectCommand({
    Bucket: UPLOAD_BUCKET,
    Key: key,
    ContentType: contentType,
  });

  const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour

  // Create pending upload record
  const [pending] = await db
    .insert(schema.pendingUploads)
    .values({
      userId: user.id,
      storagePath: key,
      url: `${process.env.NEON_STORAGE_ENDPOINT}/${UPLOAD_BUCKET}/${key}`,
      confirmed: false,
    })
    .returning();

  return c.json({
    success: true,
    data: {
      uploadUrl: presignedUrl,
      pendingUploadId: pending.id,
      storagePath: key,
      url: pending.url,
      expiresIn: 3600,
    },
  });
});

// POST /v1/upload/confirm - Confirm pending upload
uploadRouter.post("/confirm", zValidator("json", confirmUploadSchema), async (c) => {
  const user = getCurrentUser(c);
  const { pendingUploadId, targetType, targetId } = c.req.valid("json");

  const pending = await db.query.pendingUploads.findFirst({
    where: and(eq(schema.pendingUploads.id, pendingUploadId), eq(schema.pendingUploads.userId, user.id)),
  });

  if (!pending) {
    throw new HTTPException(404, { message: "Pending upload not found" });
  }

  if (pending.confirmed) {
    throw new HTTPException(409, { message: "Upload already confirmed" });
  }

  // Verify target exists if targetId provided
  if (targetId) {
    let targetExists = false;
    switch (targetType) {
      case "post":
        targetExists = !!(await db.query.posts.findFirst({ where: eq(schema.posts.id, targetId) }));
        break;
      case "reel":
        targetExists = !!(await db.query.reels.findFirst({ where: eq(schema.reels.id, targetId) }));
        break;
      case "story":
        targetExists = !!(await db.query.stories.findFirst({ where: eq(schema.stories.id, targetId) }));
        break;
      case "avatar":
        targetExists = true; // Avatar update handled in user profile
        break;
      case "message":
        targetExists = !!(await db.query.messages.findFirst({ where: eq(schema.messages.id, targetId) }));
        break;
    }
    if (!targetExists) {
      throw new HTTPException(400, { message: "Target resource not found" });
    }
  }

  // Mark as confirmed
  await db.update(schema.pendingUploads).set({ confirmed: true }).where(eq(schema.pendingUploads.id, pendingUploadId));

  return c.json({
    success: true,
    data: {
      pendingUploadId,
      url: pending.url,
      storagePath: pending.storagePath,
    },
  });
});

// POST /v1/upload/image - Upload image directly (multipart)
uploadRouter.post("/image", async (c) => {
  const user = getCurrentUser(c);
  const formData = await c.req.formData();
  const file = formData.get("file") as File;

  if (!file) {
    throw new HTTPException(400, { message: "No file provided" });
  }

  if (!file.type.startsWith("image/")) {
    throw new HTTPException(400, { message: "File must be an image" });
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new HTTPException(400, { message: "Image must be less than 10MB" });
  }

  const storagePath = generateStoragePath(user.id, "images", file.type);
  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  // Validate magic bytes
  if (!validateMagicBytes(buffer, file.type)) {
    throw new HTTPException(400, { message: "Invalid file format: content does not match declared type" });
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: UPLOAD_BUCKET,
      Key: storagePath,
      Body: buffer,
      ContentType: file.type,
    })
  );

  const [pending] = await db
    .insert(schema.pendingUploads)
    .values({
      userId: user.id,
      storagePath,
      url: `${process.env.NEON_STORAGE_ENDPOINT}/${UPLOAD_BUCKET}/${storagePath}`,
      confirmed: false,
    })
    .returning();

  // Get dimensions if possible (would need sharp for proper detection)
  return c.json({
    success: true,
    data: {
      url: pending.url,
      width: 0, // Would need image processing
      height: 0,
      pendingUploadId: pending.id,
    },
  });
});

// POST /v1/upload/video - Upload video directly (multipart)
uploadRouter.post("/video", async (c) => {
  const user = getCurrentUser(c);
  const formData = await c.req.formData();
  const file = formData.get("file") as File;

  if (!file) {
    throw new HTTPException(400, { message: "No file provided" });
  }

  if (!file.type.startsWith("video/")) {
    throw new HTTPException(400, { message: "File must be a video" });
  }

  if (file.size > 100 * 1024 * 1024) {
    throw new HTTPException(400, { message: "Video must be less than 100MB" });
  }

  const storagePath = generateStoragePath(user.id, "videos", file.type);
  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  // Validate magic bytes
  if (!validateMagicBytes(buffer, file.type)) {
    throw new HTTPException(400, { message: "Invalid file format: content does not match declared type" });
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: UPLOAD_BUCKET,
      Key: storagePath,
      Body: buffer,
      ContentType: file.type,
    })
  );

  // Generate thumbnail URL (would need video processing)
  const thumbnailPath = storagePath.replace(/\.[^.]+$/, "_thumb.jpg");

  const [pending] = await db
    .insert(schema.pendingUploads)
    .values({
      userId: user.id,
      storagePath,
      url: `${process.env.NEON_STORAGE_ENDPOINT}/${UPLOAD_BUCKET}/${storagePath}`,
      confirmed: false,
    })
    .returning();

  return c.json({
    success: true,
    data: {
      url: pending.url,
      thumbnailUrl: `${process.env.NEON_STORAGE_ENDPOINT}/${UPLOAD_BUCKET}/${thumbnailPath}`,
      duration: 0, // Would need video processing
      width: 0,
      height: 0,
      pendingUploadId: pending.id,
    },
  });
});

// POST /v1/upload/avatar - Upload avatar (processed to 400x400)
uploadRouter.post("/avatar", async (c) => {
  const user = getCurrentUser(c);
  const formData = await c.req.formData();
  const file = formData.get("file") as File;

  if (!file) {
    throw new HTTPException(400, { message: "No file provided" });
  }

  if (!file.type.startsWith("image/")) {
    throw new HTTPException(400, { message: "File must be an image" });
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new HTTPException(400, { message: "Avatar must be less than 10MB" });
  }

  const storagePath = generateStoragePath(user.id, "avatars", file.type);
  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  // Validate magic bytes
  if (!validateMagicBytes(buffer, file.type)) {
    throw new HTTPException(400, { message: "Invalid file format: content does not match declared type" });
  }

  // In production, use Sharp to resize to 400x400
  await s3Client.send(
    new PutObjectCommand({
      Bucket: UPLOAD_BUCKET,
      Key: storagePath,
      Body: buffer,
      ContentType: file.type,
    })
  );

  const avatarUrl = `${process.env.NEON_STORAGE_ENDPOINT}/${UPLOAD_BUCKET}/${storagePath}`;

  // Update user avatar
  await db.update(schema.users).set({ avatarUrl, updatedAt: new Date() }).where(eq(schema.users.id, user.id));

  // Create confirmed pending upload
  await db
    .insert(schema.pendingUploads)
    .values({
      userId: user.id,
      storagePath,
      url: avatarUrl,
      confirmed: true,
    })
    .onConflictDoNothing();

  return c.json({ success: true, data: { url: avatarUrl } });
});

// ============================================================================
// TUS Protocol Integration
// ============================================================================

// POST /v1/upload/tus/init - Initialize a TUS resumable upload
// Alternative to presigned URL for large files (>50MB) or unreliable networks
const tusInitSchema = z.object({
  fileSize: z.number().positive().max(500 * 1024 * 1024), // max 500MB
  filename: z.string().min(1).max(255),
  filetype: z.string().regex(/^(image|video|audio)\//),
  targetType: z.enum(["post", "reel", "story", "avatar", "message"]),
  targetId: z.string().uuid().optional(),
  checksum: z.string().optional(),
});

uploadRouter.post("/tus/init", zValidator("json", tusInitSchema), async (c) => {
  const user = getCurrentUser(c);
  const { fileSize, filename, filetype, targetType, targetId, checksum } = c.req.valid("json");

  // Validate file size against limits
  const maxSizes: Record<string, number> = {
    image: 50 * 1024 * 1024,   // 50MB for images
    video: 500 * 1024 * 1024,  // 500MB for videos
    audio: 100 * 1024 * 1024,  // 100MB for audio
  };

  const mediaType = filetype.split("/")[0];
  const maxSize = maxSizes[mediaType] || 50 * 1024 * 1024;

  if (fileSize > maxSize) {
    throw new HTTPException(400, { message: `File size exceeds maximum for ${mediaType}: ${maxSize} bytes` });
  }

  // Create TUS upload
  const metadata: TusUploadMetadata = {
    filename,
    filetype,
    targetType,
    targetId: targetId || "",
    userId: user.id,
    fileSize,
    checksum,
  };

  const uploadInfo = await tusService.createUpload({ fileSize, metadata });

  return c.json({
    success: true,
    data: {
      uploadId: uploadInfo.id,
      uploadUrl: uploadInfo.uploadUrl,
      tusUrl: `/v1/upload/tus/${uploadInfo.id}`, // Full TUS endpoint
      expiresAt: uploadInfo.expiresAt.toISOString(),
      maxSize: 500 * 1024 * 1024,
      chunkSize: 5 * 1024 * 1024, // Recommended chunk size
    },
  });
});

// GET /v1/upload/tus/:id/status - Get TUS upload status
uploadRouter.get("/tus/:id/status", async (c) => {
  const user = getCurrentUser(c);
  const uploadId = c.req.param("id");

  const uploadInfo = await tusService.getUploadStatus(uploadId);

  if (!uploadInfo || uploadInfo.metadata.userId !== user.id) {
    throw new HTTPException(404, { message: "Upload not found" });
  }

  const isComplete = uploadInfo.status === "completed";
  let finalUrl = null;
  let mediaItem = null;

  if (isComplete) {
    // Get the final URL from processing job result
    const processingJob = await db.query.processingJobs.findFirst({
      where: eq(schema.processingJobs.uploadId, uploadId),
      orderBy: desc(schema.processingJobs.createdAt),
    });

    if (processingJob?.result) {
      const result = processingJob.result as any;
      finalUrl = result.finalUrl || result.url;
      mediaItem = result.mediaItem;
    }
  }

  return c.json({
    success: true,
    data: {
      uploadId: uploadInfo.id,
      uploadUrl: uploadInfo.uploadUrl,
      offset: uploadInfo.offset,
      size: uploadInfo.size,
      percentage: uploadInfo.size > 0 ? Math.round((uploadInfo.offset / uploadInfo.size) * 100) : 0,
      metadata: uploadInfo.metadata,
      status: uploadInfo.status,
      finalUrl,
      mediaItem,
      createdAt: uploadInfo.createdAt.toISOString(),
      updatedAt: uploadInfo.updatedAt.toISOString(),
      expiresAt: uploadInfo.expiresAt.toISOString(),
    },
  });
});

// POST /v1/upload/tus/:id/confirm - Confirm completed TUS upload and link to target
const tusConfirmSchema = z.object({
  targetType: z.enum(["post", "reel", "story", "avatar", "message"]),
  targetId: z.string().uuid().optional(),
});

uploadRouter.post("/tus/:id/confirm", zValidator("json", tusConfirmSchema), async (c) => {
  const user = getCurrentUser(c);
  const uploadId = c.req.param("id");
  const { targetType, targetId } = c.req.valid("json");

  const uploadInfo = await tusService.getUploadStatus(uploadId);

  if (!uploadInfo || uploadInfo.metadata.userId !== user.id) {
    throw new HTTPException(404, { message: "Upload not found" });
  }

  if (uploadInfo.status !== "completed") {
    throw new HTTPException(400, { message: "Upload not yet completed" });
  }

  // Verify target if provided
  if (targetId) {
    let targetExists = false;
    switch (targetType) {
      case "post":
        targetExists = !!(await db.query.posts.findFirst({ where: eq(schema.posts.id, targetId) }));
        break;
      case "reel":
        targetExists = !!(await db.query.reels.findFirst({ where: eq(schema.reels.id, targetId) }));
        break;
      case "story":
        targetExists = !!(await db.query.stories.findFirst({ where: eq(schema.stories.id, targetId) }));
        break;
      case "avatar":
        targetExists = true;
        break;
      case "message":
        targetExists = !!(await db.query.messages.findFirst({ where: eq(schema.messages.id, targetId) }));
        break;
    }
    if (!targetExists) {
      throw new HTTPException(400, { message: "Target resource not found" });
    }
  }

  // Update metadata with target info
  const updatedMetadata = {
    ...uploadInfo.metadata,
    targetType,
    targetId: targetId || "",
  };

  await db.update(schema.tusUploads)
    .set({ metadata: updatedMetadata as any, updatedAt: new Date() })
    .where(eq(schema.tusUploads.id, uploadId));

  // Create pending upload record for backward compatibility
  const [pending] = await db
    .insert(schema.pendingUploads)
    .values({
      userId: user.id as string,
      storagePath: (uploadInfo.metadata.targetType === "avatar" ? `avatars/${user.id}/avatar` : uploadInfo.metadata.storagePath || `tus/${user.id}/${uploadId}/${uploadInfo.metadata.filename}`) as string,
      url: uploadInfo.uploadUrl as string,
      confirmed: true,
    })
    .returning();

  return c.json({
    success: true,
    data: {
      pendingUploadId: pending.id,
      url: uploadInfo.uploadUrl,
      uploadId,
    },
  });
});

// GET /v1/upload/tus - List user's TUS uploads
uploadRouter.get("/tus", async (c) => {
  const user = getCurrentUser(c);
  const status = c.req.query("status");
  const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const uploads = await tusService.listUserUploads(user.id, status);

  const paginated = uploads.slice(offset, offset + limit);

  return c.json({
    success: true,
    data: paginated.map(upload => ({
      uploadId: upload.id,
      uploadUrl: upload.uploadUrl,
      offset: upload.offset,
      size: upload.size,
      percentage: upload.size > 0 ? Math.round((upload.offset / upload.size) * 100) : 0,
      metadata: upload.metadata,
      status: upload.status,
      createdAt: upload.createdAt.toISOString(),
      updatedAt: upload.updatedAt.toISOString(),
      expiresAt: upload.expiresAt.toISOString(),
    })),
    pagination: {
      limit,
      offset,
      total: uploads.length,
    },
  });
});

// DELETE /v1/upload/tus/:id - Cancel TUS upload
uploadRouter.delete("/tus/:id", async (c) => {
  const user = getCurrentUser(c);
  const uploadId = c.req.param("id");

  const deleted = await tusService.deleteUpload(uploadId, user.id);

  if (!deleted) {
    throw new HTTPException(404, { message: "Upload not found" });
  }

  return c.status(204);
});

// GET /v1/upload/pending/:id - Get pending upload status
uploadRouter.get("/pending/:id", async (c) => {
  const user = getCurrentUser(c);
  const pendingUploadId = c.req.param("id");

  const pending = await db.query.pendingUploads.findFirst({
    where: and(eq(schema.pendingUploads.id, pendingUploadId), eq(schema.pendingUploads.userId, user.id)),
  });

  if (!pending) {
    throw new HTTPException(404, { message: "Pending upload not found" });
  }

  return c.json({
    success: true,
    data: {
      pendingUploadId: pending.id,
      url: pending.url,
      storagePath: pending.storagePath,
      confirmed: pending.confirmed,
      createdAt: pending.createdAt,
    },
  });
});

// DELETE /v1/upload/pending/:id - Delete pending upload
uploadRouter.delete("/pending/:id", async (c) => {
  const user = getCurrentUser(c);
  const pendingUploadId = c.req.param("id");

  const pending = await db.query.pendingUploads.findFirst({
    where: and(eq(schema.pendingUploads.id, pendingUploadId), eq(schema.pendingUploads.userId, user.id)),
  });

  if (!pending) {
    throw new HTTPException(404, { message: "Pending upload not found" });
  }

  // Delete from storage
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: UPLOAD_BUCKET,
      Key: pending.storagePath,
    })
  );

  // Delete record
  await db.delete(schema.pendingUploads).where(eq(schema.pendingUploads.id, pendingUploadId));

  return c.status(204);
});

export { uploadRouter };