/**
 * TUS Protocol Routes - Resumable Upload Endpoints
 *
 * Implements TUS 1.0.0 protocol:
 * - POST /v1/upload/tus/ - Create upload
 * - PATCH /v1/upload/tus/:id - Append chunk
 * - HEAD /v1/upload/tus/:id - Get upload status
 * - OPTIONS /v1/upload/tus/ - CORS preflight / protocol info
 * - DELETE /v1/upload/tus/:id - Cancel upload
 * - GET /v1/upload/tus/ - List user's uploads
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware, getCurrentUser } from "../middleware/auth";
import { db } from "../db/client";
import { eq, and, desc, lt } from "drizzle-orm";
import * as schema from "../db/schema";
import { HTTPException } from "hono/http-exception";
import { tusService, TusUploadMetadata } from "../services/tus-service";
import { randomUUID, createHash } from "crypto";

// ============================================================================
// Validation Schemas
// ============================================================================

const createUploadSchema = z.object({
  fileSize: z.number().positive().max(500 * 1024 * 1024), // max 500MB
  metadata: z.object({
    filename: z.string().min(1).max(255),
    filetype: z.string().regex(/^(image|video|audio)\//),
    targetType: z.enum(["post", "reel", "story", "avatar", "message"]),
    targetId: z.string().uuid().optional(),
    checksum: z.string().optional(), // SHA256 or MD5
    // Allow additional metadata fields
  }).passthrough(),
});

const appendChunkSchema = z.object({
  // Body will be raw binary data
}).strict();

const listUploadsSchema = z.object({
  status: z.enum(["created", "uploading", "completed", "failed", "expired"]).optional(),
  limit: z.number().positive().max(100).default(20).optional(),
  offset: z.number().min(0).default(0).optional(),
});

// ============================================================================
// TUS Router
// ============================================================================

const tusRouter = new Hono();

// Apply auth middleware to all TUS routes
tusRouter.use("*", authMiddleware);

// ============================================================================
// OPTIONS /v1/upload/tus/ - Protocol information and CORS
// ============================================================================

tusRouter.options("/", (c) => {
  // TUS protocol version
  c.header("Tus-Resumable", "1.0.0");
  c.header("Tus-Version", "1.0.0");
  c.header("Tus-Extension", "creation,creation-defer-length,expiration,checksum,termination");
  c.header("Tus-Max-Size", String(500 * 1024 * 1024));
  c.header("Access-Control-Allow-Methods", "POST, PATCH, HEAD, OPTIONS, DELETE, GET");
  c.header("Access-Control-Allow-Headers", "Tus-Resumable, Upload-Length, Upload-Metadata, Upload-Defer-Length, Upload-Concat, Upload-Offset, Content-Type, Authorization, Idempotency-Key");
  c.header("Access-Control-Expose-Headers", "Tus-Resumable, Upload-Length, Upload-Metadata, Upload-Offset, Location, Upload-Expires, Upload-Checksum-Algorithm");
  c.header("Access-Control-Max-Age", "86400");
  return c.body(null, 204);
});

// Also handle OPTIONS for specific upload
tusRouter.options("/:id", (c) => {
  c.header("Tus-Resumable", "1.0.0");
  c.header("Tus-Version", "1.0.0");
  c.header("Tus-Extension", "creation,creation-defer-length,expiration,checksum,termination");
  c.header("Access-Control-Allow-Methods", "PATCH, HEAD, OPTIONS, DELETE");
  c.header("Access-Control-Allow-Headers", "Tus-Resumable, Upload-Length, Upload-Metadata, Upload-Defer-Length, Upload-Concat, Upload-Offset, Content-Type, Authorization, Idempotency-Key");
  c.header("Access-Control-Expose-Headers", "Tus-Resumable, Upload-Length, Upload-Metadata, Upload-Offset, Location, Upload-Expires, Upload-Checksum-Algorithm");
  c.header("Access-Control-Max-Age", "86400");
  return c.body(null, 204);
});

// ============================================================================
// POST /v1/upload/tus/ - Create new upload
// ============================================================================

tusRouter.post("/", zValidator("json", createUploadSchema), async (c) => {
  const user = getCurrentUser(c);
  const { fileSize, metadata } = c.req.valid("json");

  try {
    // Create upload with TUS service
    const uploadInfo = await tusService.createUpload({
      fileSize,
      metadata: {
        ...metadata,
        userId: user.id,
        fileSize,
      } as TusUploadMetadata,
    });

    // Set TUS response headers
    c.header("Tus-Resumable", "1.0.0");
    c.header("Location", uploadInfo.uploadUrl);
    c.header("Upload-Expires", uploadInfo.expiresAt.toISOString());
    c.header("Upload-Length", String(fileSize));

    return c.json({
      success: true,
      data: {
        uploadId: uploadInfo.id,
        uploadUrl: uploadInfo.uploadUrl,
        expiresAt: uploadInfo.expiresAt.toISOString(),
        maxSize: 500 * 1024 * 1024,
      },
    }, 201);
  } catch (error) {
    console.error("[TUS Routes] Create upload failed:", error);
    throw new HTTPException(500, { message: "Failed to create upload" });
  }
});

// ============================================================================
// PATCH /v1/upload/tus/:id - Append chunk
// ============================================================================

tusRouter.patch("/:id", async (c) => {
  const user = getCurrentUser(c);
  const uploadId = c.req.param("id");

  // Get TUS headers
  const uploadOffsetHeader = c.req.header("Upload-Offset");
  const uploadChecksumHeader = c.req.header("Upload-Checksum");
  const contentType = c.req.header("Content-Type");

  // Validate Upload-Offset header
  if (!uploadOffsetHeader) {
    throw new HTTPException(400, { message: "Missing Upload-Offset header" });
  }

  const offset = parseInt(uploadOffsetHeader, 10);
  if (isNaN(offset) || offset < 0) {
    throw new HTTPException(400, { message: "Invalid Upload-Offset header" });
  }

  // Verify upload exists and belongs to user
  const upload = await db.query.tusUploads.findFirst({
    where: and(eq(schema.tusUploads.id, uploadId), eq(schema.tusUploads.userId, user.id)),
  });

  if (!upload) {
    throw new HTTPException(404, { message: "Upload not found" });
  }

  // Verify offset matches expected
  if (offset !== Number(upload.uploadedSize)) {
    c.header("Tus-Resumable", "1.0.0");
    c.header("Upload-Offset", String(upload.uploadedSize));
    throw new HTTPException(409, { message: "Offset mismatch" });
  }

  // Read request body (chunk data)
  const arrayBuffer = await c.req.arrayBuffer();
  const chunkData = new Uint8Array(arrayBuffer);

  // Verify chunk size matches Content-Length
  const contentLength = c.req.header("Content-Length");
  if (contentLength && parseInt(contentLength, 10) !== chunkData.length) {
    throw new HTTPException(400, { message: "Content-Length mismatch" });
  }

  // Verify checksum if provided
  if (uploadChecksumHeader) {
    const expectedChecksum = uploadChecksumHeader.split(" ")[1]; // e.g., "sha256 abc123"
    const algorithm = uploadChecksumHeader.split(" ")[0].toLowerCase();
    const actualChecksum = await computeChecksum(chunkData, algorithm);
    if (actualChecksum !== expectedChecksum) {
      throw new HTTPException(400, { message: "Checksum mismatch" });
    }
  }

  try {
    // Append chunk
    const result = await tusService.appendChunk({
      uploadId,
      offset,
      data: chunkData,
    });

    // Set TUS response headers
    c.header("Tus-Resumable", "1.0.0");
    c.header("Upload-Offset", String(result.offset));

    if (result.complete) {
      // Upload completed
      c.header("Upload-Length", String(upload.fileSize));
      return c.body(null, 204);
    } else {
      // Partial upload
      return c.body(null, 204);
    }
  } catch (error) {
    console.error("[TUS Routes] Append chunk failed:", error);

    if (error instanceof Error) {
      if (error.message.includes("Offset mismatch")) {
        c.header("Tus-Resumable", "1.0.0");
        c.header("Upload-Offset", String(upload.uploadedSize));
        throw new HTTPException(409, { message: error.message });
      }
      if (error.message.includes("expired")) {
        throw new HTTPException(410, { message: error.message });
      }
      if (error.message.includes("not in a valid state")) {
        throw new HTTPException(409, { message: error.message });
      }
    }

    throw new HTTPException(500, { message: "Failed to append chunk" });
  }
});

// ============================================================================
// HEAD /v1/upload/tus/:id - Get upload status (TUS protocol)
// GET /v1/upload/tus/:id - Get upload info (JSON)
// ============================================================================

// Handle both GET and HEAD for the same path
tusRouter.get("/:id", async (c) => {
  const user = getCurrentUser(c);
  const uploadId = c.req.param("id");
  const isHead = c.req.method === "HEAD";

  // For HEAD requests, we need to verify the upload exists and belongs to user
  // For GET requests, we use the service method which also checks ownership
  let upload: typeof schema.tusUploads.$inferSelect | null = null;
  let uploadInfo: any = null;

  if (isHead) {
    const uploadResult = await db.query.tusUploads.findFirst({
      where: and(eq(schema.tusUploads.id, uploadId), eq(schema.tusUploads.userId, user.id)),
    });

    if (!uploadResult) {
      throw new HTTPException(404, { message: "Upload not found" });
    }
    upload = uploadResult;
  } else {
    uploadInfo = await tusService.getUploadStatus(uploadId);

    if (!uploadInfo || uploadInfo.metadata.userId !== user.id) {
      throw new HTTPException(404, { message: "Upload not found" });
    }
  }

  // For HEAD requests, return only headers (TUS protocol)
  if (isHead) {
    // Set TUS response headers
    c.header("Tus-Resumable", "1.0.0");
    c.header("Upload-Offset", String(upload!.uploadedSize));
    c.header("Upload-Length", String(upload!.fileSize));
    c.header("Upload-Metadata", encodeMetadata(upload!.metadata as unknown as Record<string, string>));
    c.header("Upload-Expires", upload!.expiresAt.toISOString());

    // Add cache control
    c.header("Cache-Control", "no-store");

    return c.body(null, 200);
  }

  // For GET requests, return JSON
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
      createdAt: uploadInfo.createdAt.toISOString(),
      updatedAt: uploadInfo.updatedAt.toISOString(),
      expiresAt: uploadInfo.expiresAt.toISOString(),
    },
  });
});

// ============================================================================
// DELETE /v1/upload/tus/:id - Cancel/delete upload
// ============================================================================

tusRouter.delete("/:id", async (c) => {
  const user = getCurrentUser(c);
  const uploadId = c.req.param("id");

  const deleted = await tusService.deleteUpload(uploadId, user.id);

  if (!deleted) {
    throw new HTTPException(404, { message: "Upload not found" });
  }

  // Set TUS response headers
  c.header("Tus-Resumable", "1.0.0");

  return c.status(204);
});

// ============================================================================
// GET /v1/upload/tus/ - List user's uploads
// ============================================================================

tusRouter.get("/", zValidator("query", listUploadsSchema), async (c) => {
  const user = getCurrentUser(c);
  const { status, limit = 20, offset = 0 } = c.req.valid("query");

  const uploads = await tusService.listUserUploads(user.id, status);

  // Apply pagination
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

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Encode metadata for TUS Upload-Metadata header
 * Format: key value (base64),key2 value2 (base64),...
 */
function encodeMetadata(metadata: Record<string, string>): string {
  return Object.entries(metadata)
    .map(([key, value]) => {
      // TUS metadata keys must be ASCII, values base64 encoded
      const encodedKey = key.replace(/[^a-zA-Z0-9_-]/g, "");
      const encodedValue = Buffer.from(value).toString("base64");
      return `${encodedKey} ${encodedValue}`;
    })
    .join(",");
}

/**
 * Decode metadata from TUS Upload-Metadata header
 */
export function decodeMetadata(metadataHeader: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pairs = metadataHeader.split(",");

  for (const pair of pairs) {
    const spaceIndex = pair.indexOf(" ");
    if (spaceIndex === -1) continue;

    const key = pair.slice(0, spaceIndex).trim();
    const encodedValue = pair.slice(spaceIndex + 1).trim();

    try {
      const value = Buffer.from(encodedValue, "base64").toString("utf-8");
      result[key] = value;
    } catch {
      // Invalid base64, skip
    }
  }

  return result;
}

/**
 * Compute checksum of data
 */
async function computeChecksum(data: Uint8Array, algorithm: string): Promise<string> {
  const hash = createHash(algorithm === "md5" ? "md5" : "sha256");
  hash.update(data);
  return hash.digest("hex");
}

export { tusRouter };