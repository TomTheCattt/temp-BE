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

  await s3Client.send(
    new PutObjectCommand({
      Bucket: UPLOAD_BUCKET,
      Key: storagePath,
      Body: new Uint8Array(arrayBuffer),
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

  await s3Client.send(
    new PutObjectCommand({
      Bucket: UPLOAD_BUCKET,
      Key: storagePath,
      Body: new Uint8Array(arrayBuffer),
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

  // In production, use Sharp to resize to 400x400
  await s3Client.send(
    new PutObjectCommand({
      Bucket: UPLOAD_BUCKET,
      Key: storagePath,
      Body: new Uint8Array(arrayBuffer),
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