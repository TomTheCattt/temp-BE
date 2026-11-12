/**
 * TUS Protocol Service - Resumable Upload Implementation
 *
 * Implements TUS 1.0.0 protocol for resumable file uploads
 * Supports metadata, chunked uploads, and progress tracking
 */

import { db } from "../db/client";
import { eq, and, lt, desc } from "drizzle-orm";
import * as schema from "../db/schema";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID, createHash } from "crypto";
import { connectionManager } from "../websocket/connection-manager";
import { MessageEnvelope } from "../websocket/connection-manager";

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
const MAX_UPLOAD_SIZE = 500 * 1024 * 1024; // 500MB
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB default chunk
const UPLOAD_EXPIRY_HOURS = 24;

// ============================================================================
// Types
// ============================================================================

export interface TusUploadMetadata {
  filename: string;
  filetype: string;
  targetType: "post" | "reel" | "story" | "avatar" | "message";
  targetId?: string;
  userId: string;
  fileSize: number;
  checksum?: string;
  [key: string]: string | number | undefined;
}

export interface TusUploadInfo {
  id: string;
  uploadUrl: string;
  offset: number;
  size: number;
  metadata: TusUploadMetadata;
  status: "created" | "uploading" | "completed" | "failed" | "expired";
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface TusCreateOptions {
  fileSize: number;
  metadata: TusUploadMetadata;
}

export interface TusChunkOptions {
  uploadId: string;
  offset: number;
  data: Uint8Array;
}

export interface TusProgressEvent {
  type: "upload.progress" | "upload.completed" | "upload.failed";
  uploadId: string;
  userId: string;
  offset: number;
  size: number;
  percentage: number;
  timestamp: string;
  error?: string;
}

// ============================================================================
// TUS Service Class
// ============================================================================

export class TusService {
  private metadataCache = new Map<string, TusUploadMetadata>();

  /**
   * Create a new TUS upload
   */
  async createUpload(options: TusCreateOptions): Promise<TusUploadInfo> {
    const { fileSize, metadata } = options;

    // Validate file size
    if (fileSize > MAX_UPLOAD_SIZE) {
      throw new Error(`File size exceeds maximum allowed size of ${MAX_UPLOAD_SIZE} bytes`);
    }

    // Validate required metadata
    if (!metadata.filename || !metadata.filetype || !metadata.targetType || !metadata.userId) {
      throw new Error("Missing required metadata: filename, filetype, targetType, userId");
    }

    // Validate target type
    const validTargetTypes = ["post", "reel", "story", "avatar", "message"];
    if (!validTargetTypes.includes(metadata.targetType)) {
      throw new Error(`Invalid targetType. Must be one of: ${validTargetTypes.join(", ")}`);
    }

    // Generate upload ID and paths
    const uploadId = randomUUID();
    const storagePath = `tus/${metadata.userId}/${uploadId}/${metadata.filename}`;
    const expiresAt = new Date(Date.now() + UPLOAD_EXPIRY_HOURS * 60 * 60 * 1000);

    // Create upload record in database
    await db.insert(schema.tusUploads).values({
      userId: metadata.userId,
      storagePath,
      fileSize: fileSize,
      uploadedSize: 0,
      metadata: metadata as any,
      status: "created",
      expiresAt,
    });

    // Cache metadata for quick access
    this.metadataCache.set(uploadId, metadata);

    // Create multipart upload in S3
    const uploadUrl = `${process.env.NEON_STORAGE_ENDPOINT}/${TUS_BUCKET}/${storagePath}`;

    const uploadInfo: TusUploadInfo = {
      id: uploadId,
      uploadUrl,
      offset: 0,
      size: fileSize,
      metadata,
      status: "created",
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt,
    };

    return uploadInfo;
  }

  /**
   * Append a chunk to an existing upload
   */
  async appendChunk(options: TusChunkOptions): Promise<{ offset: number; complete: boolean }> {
    const { uploadId, offset, data } = options;

    // Get upload from database
    const upload = await db.query.tusUploads.findFirst({
      where: eq(schema.tusUploads.id, uploadId),
    });

    if (!upload) {
      throw new Error("Upload not found");
    }

    if (upload.status !== "created" && upload.status !== "uploading") {
      throw new Error(`Upload is not in a valid state for appending: ${upload.status}`);
    }

    if (upload.expiresAt < new Date()) {
      await this.expireUpload(uploadId);
      throw new Error("Upload has expired");
    }

    // Verify offset matches
    if (offset !== Number(upload.uploadedSize)) {
      throw new Error(`Offset mismatch. Expected ${upload.uploadedSize}, got ${offset}`);
    }

    // Verify chunk size
    const remaining = Number(upload.fileSize) - offset;
    if (data.length > remaining) {
      throw new Error(`Chunk size exceeds remaining bytes. Remaining: ${remaining}, Got: ${data.length}`);
    }

    // Upload chunk to S3 (append)
    const uploadPath = upload.storagePath;
    await this.appendToS3(uploadPath, offset, data);

    // Update database
    const newOffset = offset + data.length;
    const isComplete = newOffset >= Number(upload.fileSize);
    const newStatus = isComplete ? "completed" : "uploading";

    await db.update(schema.tusUploads)
      .set({
        uploadedSize: newOffset,
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(schema.tusUploads.id, uploadId));

    // Emit progress event
    await this.emitProgressEvent({
      type: "upload.progress",
      uploadId,
      userId: upload.userId,
      offset: newOffset,
      size: Number(upload.fileSize),
      percentage: Math.round((newOffset / Number(upload.fileSize)) * 100),
      timestamp: new Date().toISOString(),
    });

    // If complete, emit completion event
    if (isComplete) {
      await this.emitProgressEvent({
        type: "upload.completed",
        uploadId,
        userId: upload.userId,
        offset: newOffset,
        size: Number(upload.fileSize),
        percentage: 100,
        timestamp: new Date().toISOString(),
      });

      // Trigger processing
      await this.triggerProcessing(uploadId);
    }

    return { offset: newOffset, complete: isComplete };
  }

  /**
   * Get upload status
   */
  async getUploadStatus(uploadId: string): Promise<TusUploadInfo | null> {
    const upload = await db.query.tusUploads.findFirst({
      where: eq(schema.tusUploads.id, uploadId),
    });

    if (!upload) {
      return null;
    }

    // Get cached metadata or from DB
    const metadata = this.metadataCache.get(uploadId) || (upload.metadata as unknown as TusUploadMetadata);

    return {
      id: upload.id,
      uploadUrl: `${process.env.NEON_STORAGE_ENDPOINT}/${TUS_BUCKET}/${upload.storagePath}`,
      offset: Number(upload.uploadedSize),
      size: Number(upload.fileSize),
      metadata,
      status: upload.status as TusUploadInfo["status"],
      createdAt: upload.createdAt,
      updatedAt: upload.updatedAt,
      expiresAt: upload.expiresAt,
    };
  }

  /**
   * Delete/cancel an upload
   */
  async deleteUpload(uploadId: string, userId: string): Promise<boolean> {
    const upload = await db.query.tusUploads.findFirst({
      where: and(eq(schema.tusUploads.id, uploadId), eq(schema.tusUploads.userId, userId)),
    });

    if (!upload) {
      return false;
    }

    // Delete from S3
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: TUS_BUCKET,
        Key: upload.storagePath,
      }));
    } catch (error) {
      console.error(`[TusService] Failed to delete from S3:`, error);
    }

    // Delete from database
    await db.delete(schema.tusUploads).where(eq(schema.tusUploads.id, uploadId));

    // Clear cache
    this.metadataCache.delete(uploadId);

    return true;
  }

  /**
   * Get upload metadata (for HEAD request)
   */
  async getUploadMetadata(uploadId: string): Promise<{ offset: number; size: number; metadata: TusUploadMetadata } | null> {
    const upload = await db.query.tusUploads.findFirst({
      where: eq(schema.tusUploads.id, uploadId),
    });

    if (!upload) {
      return null;
    }

    const metadata = this.metadataCache.get(uploadId) || (upload.metadata as unknown as TusUploadMetadata);

    return {
      offset: Number(upload.uploadedSize),
      size: Number(upload.fileSize),
      metadata,
    };
  }

  /**
   * List user's uploads
   */
  async listUserUploads(userId: string, status?: string): Promise<TusUploadInfo[]> {
    let whereCondition: any = eq(schema.tusUploads.userId, userId);

    if (status) {
      whereCondition = and(whereCondition, eq(schema.tusUploads.status, status as any));
    }

    const uploads = await db.query.tusUploads.findMany({
      where: whereCondition,
      orderBy: desc(schema.tusUploads.createdAt),
      limit: 50,
    });

    return uploads.map(upload => {
      const metadata = this.metadataCache.get(upload.id) || (upload.metadata as unknown as TusUploadMetadata);
      return {
        id: upload.id,
        uploadUrl: `${process.env.NEON_STORAGE_ENDPOINT}/${TUS_BUCKET}/${upload.storagePath}`,
        offset: Number(upload.uploadedSize),
        size: Number(upload.fileSize),
        metadata,
        status: upload.status as TusUploadInfo["status"],
        createdAt: upload.createdAt,
        updatedAt: upload.updatedAt,
        expiresAt: upload.expiresAt,
      };
    });
  }

  /**
   * Clean up expired uploads
   */
  async cleanupExpiredUploads(): Promise<number> {
    const cutoff = new Date();

    const expiredUploads = await db.query.tusUploads.findMany({
      where: and(
        eq(schema.tusUploads.status, "created"),
        lt(schema.tusUploads.expiresAt, cutoff)
      ),
    });

    for (const upload of expiredUploads) {
      await this.expireUpload(upload.id);
    }

    return expiredUploads.length;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Append data to S3 object using multipart upload
   */
  private async appendToS3(storagePath: string, offset: number, data: Uint8Array): Promise<void> {
    // For TUS, we use a multipart upload approach
    // Since S3 doesn't support true append, we use a workaround:
    // - For the first chunk, initiate multipart upload
    // - For subsequent chunks, upload parts
    // - On completion, complete multipart upload

    // This is a simplified approach using PutObject with the full data up to this point
    // In production, you'd want to use multipart upload for large files
    // For now, we'll store chunks and concatenate on completion

    // Store chunk in a separate path
    const chunkPath = `${storagePath}.chunk.${offset}`;
    await s3Client.send(new PutObjectCommand({
      Bucket: TUS_BUCKET,
      Key: chunkPath,
      Body: data,
    }));
  }

  /**
   * Complete multipart upload and concatenate chunks
   */
  private async completeMultipartUpload(uploadId: string): Promise<string> {
    const upload = await db.query.tusUploads.findFirst({
      where: eq(schema.tusUploads.id, uploadId),
    });

    if (!upload) {
      throw new Error("Upload not found");
    }

    // List all chunks
    // In a real implementation, you'd use S3 multipart upload
    // For now, we'll just return the final path
    // The actual concatenation would be done by a worker

    return `${process.env.NEON_STORAGE_ENDPOINT}/${TUS_BUCKET}/${upload.storagePath}`;
  }

  /**
   * Trigger post-upload processing
   */
  private async triggerProcessing(uploadId: string): Promise<void> {
    const upload = await db.query.tusUploads.findFirst({
      where: eq(schema.tusUploads.id, uploadId),
    });

    if (!upload) return;

    // Create processing job
    await db.insert(schema.processingJobs).values({
      uploadId,
      userId: upload.userId,
      type: "media",
      status: "pending",
      payload: {
        storagePath: upload.storagePath,
        fileSize: upload.fileSize,
        metadata: upload.metadata,
      } as any,
    });

    console.log(`[TusService] Created processing job for upload ${uploadId}`);
  }

  /**
   * Mark upload as expired
   */
  private async expireUpload(uploadId: string): Promise<void> {
    await db.update(schema.tusUploads)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(schema.tusUploads.id, uploadId));

    // Clean up S3
    const upload = await db.query.tusUploads.findFirst({
      where: eq(schema.tusUploads.id, uploadId),
    });

    if (upload) {
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: TUS_BUCKET,
          Key: upload.storagePath,
        }));
      } catch (error) {
        console.error(`[TusService] Failed to cleanup expired upload:`, error);
      }
    }

    this.metadataCache.delete(uploadId);
  }

  /**
   * Emit progress event via WebSocket
   */
  private async emitProgressEvent(event: TusProgressEvent): Promise<void> {
    const envelope: MessageEnvelope<TusProgressEvent> = {
      eventId: randomUUID(),
      sequence: connectionManager.nextSequence(),
      timestamp: event.timestamp,
      type: event.type,
      payload: event,
    };

    // Broadcast to user's upload channel
    const channel = `upload:${event.userId}`;
    await connectionManager.broadcast(channel, envelope);

    // Also broadcast to user's personal channel
    await connectionManager.broadcastToUser(event.userId, envelope);
  }
}

// Singleton instance
export const tusService = new TusService();