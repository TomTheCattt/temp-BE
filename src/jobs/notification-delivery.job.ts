import { db } from "../db/client.js";
import * as schema from "../db/schema.js";
import { eq, and, desc, sql, inArray, lt, isNull, ne } from "drizzle-orm";
import { pushNotificationService } from "../services/push-notification-service.js";
import { notificationTemplates, FormattedNotification } from "../services/notification-templates.js";
import { notificationTypeEnum } from "../db/schema.js";

type NotificationType = (typeof notificationTypeEnum.enumValues)[number];

/**
 * Notification Delivery Job
 * Background job for processing and delivering notifications
 * Handles batching, grouping, retries, and delivery via WebSocket and Push
 */

export interface NotificationJobPayload {
  notificationId: string;
  recipientId: string;
  actorId: string;
  type: NotificationType;
  referenceType?: string;
  referenceId?: string;
  previewText?: string;
  thumbnailUrl?: string;
  deepLink?: string;
  groupKey?: string;
  groupCount?: number;
  priority?: "low" | "normal" | "high" | "critical";
  // Template data
  actorName: string;
  actorUsername: string;
  actorAvatarUrl?: string;
  actorIsVerified?: boolean;
  postCaption?: string;
  postThumbnailUrl?: string;
  reelTitle?: string;
  reelThumbnailUrl?: string;
  storyThumbnailUrl?: string;
  commentText?: string;
  mentionText?: string;
  dmPreview?: string;
  callType?: "audio" | "video";
  isGroupCall?: boolean;
  groupName?: string;
  participantCount?: number;
  groupActorNames?: string[];
  alertType?: string;
  alertDetails?: string;
  actionRequired?: boolean;
}

export interface NotificationDeliveryResult {
  notificationId: string;
  inAppDelivered: boolean;
  pushDelivered: boolean;
  pushResult?: {
    total: number;
    successful: number;
    failed: number;
  };
  websocketDelivered: boolean;
  errors: string[];
}

export interface BatchNotificationJobPayload {
  notifications: NotificationJobPayload[];
  batchId: string;
}

// Job status tracking
export interface JobStatus {
  jobId: string;
  status: "pending" | "processing" | "completed" | "failed" | "partial";
  totalNotifications: number;
  processed: number;
  successful: number;
  failed: number;
  startedAt: Date;
  completedAt?: Date;
  errors: string[];
}

class NotificationDeliveryJob {
  private jobQueue: Map<string, JobStatus> = new Map();
  private jobPayloads: Map<string, BatchNotificationJobPayload> = new Map();
  private isProcessing = false;
  private batchSize = 50;
  private retryDelays = [1000, 5000, 30000, 300000]; // 1s, 5s, 30s, 5m
  private maxRetries = 3;

  /**
   * Queue a single notification for delivery
   */
  async queueNotification(payload: NotificationJobPayload): Promise<string> {
    const jobId = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const status: JobStatus = {
      jobId,
      status: "pending",
      totalNotifications: 1,
      processed: 0,
      successful: 0,
      failed: 0,
      startedAt: new Date(),
      errors: [],
    };

    this.jobQueue.set(jobId, status);

    // Process asynchronously
    this.processQueue().catch(console.error);

    return jobId;
  }

  /**
   * Queue multiple notifications as a batch
   */
  async queueBatch(payload: BatchNotificationJobPayload): Promise<string> {
    const jobId = `batch-${payload.batchId}`;

    const status: JobStatus = {
      jobId,
      status: "pending",
      totalNotifications: payload.notifications.length,
      processed: 0,
      successful: 0,
      failed: 0,
      startedAt: new Date(),
      errors: [],
    };

    this.jobQueue.set(jobId, status);

    // Store batch payload for processing
    this.jobPayloads.set(jobId, payload);

    // Process asynchronously
    this.processQueue().catch(console.error);

    return jobId;
  }

  /**
   * Process the job queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      for (const [jobId, status] of this.jobQueue.entries()) {
        if (jobId.includes(":payload")) continue;
        if (status.status !== "pending") continue;

        status.status = "processing";
        this.jobQueue.set(jobId, status);

        const payload = this.jobPayloads.get(jobId);

        if (payload) {
          await this.processBatch(jobId, payload);
        } else {
          // Single notification - find it in queue
          await this.processSingle(jobId, status);
        }

        status.status = status.failed === status.totalNotifications ? "failed" :
                        status.successful === status.totalNotifications ? "completed" : "partial";
        status.completedAt = new Date();
        this.jobQueue.set(jobId, status);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a batch of notifications
   */
  private async processBatch(jobId: string, payload: BatchNotificationJobPayload): Promise<void> {
    const status = this.jobQueue.get(jobId)!;

    // Group notifications by recipient for efficient delivery
    const byRecipient = new Map<string, NotificationJobPayload[]>();
    for (const notif of payload.notifications) {
      const existing = byRecipient.get(notif.recipientId) || [];
      existing.push(notif);
      byRecipient.set(notif.recipientId, existing);
    }

    // Process each recipient's notifications
    for (const [recipientId, notifications] of byRecipient.entries()) {
      try {
        // Apply grouping if needed
        const grouped = this.applyGrouping(notifications);

        for (const notif of grouped) {
          const result = await this.deliverNotification(notif);

          status.processed++;
          if (result.pushDelivered || result.inAppDelivered || result.websocketDelivered) {
            status.successful++;
          } else {
            status.failed++;
            status.errors.push(`Failed to deliver ${notif.notificationId}: ${result.errors.join(", ")}`);
          }
        }
      } catch (error) {
        status.processed += notifications.length;
        status.failed += notifications.length;
        status.errors.push(`Batch error for ${recipientId}: ${error}`);
      }
    }

    // Cleanup payload
    this.jobQueue.delete(`${jobId}:payload`);
  }

  /**
   * Process a single notification (legacy)
   */
  private async processSingle(jobId: string, status: JobStatus): Promise<void> {
    // In practice, single notifications would be stored somewhere
    // For now, this is a placeholder
    status.status = "completed";
    status.processed = 1;
    status.successful = 1;
    status.completedAt = new Date();
  }

  /**
   * Apply notification grouping/batching logic
   */
  private applyGrouping(notifications: NotificationJobPayload[]): NotificationJobPayload[] {
    // Group by groupKey
    const groups = new Map<string, NotificationJobPayload[]>();

    for (const notif of notifications) {
      const key = notif.groupKey || `${notif.type}:${notif.referenceType}:${notif.referenceId}`;
      const existing = groups.get(key) || [];
      existing.push(notif);
      groups.set(key, existing);
    }

    const result: NotificationJobPayload[] = [];

    for (const [key, group] of groups.entries()) {
      if (group.length === 1) {
        result.push(group[0]);
      } else {
        // Merge into single notification with groupCount
        const first = group[0];
        const actorNames = group.map(g => g.actorName).slice(0, 3); // Show up to 3 names

        result.push({
          ...first,
          groupKey: key,
          groupCount: group.length,
          groupActorNames: actorNames,
          // Update preview text for grouped notification
          previewText: this.formatGroupPreview(first.type, group.length, actorNames),
        });
      }
    }

    return result;
  }

  /**
   * Format preview text for grouped notifications
   */
  private formatGroupPreview(type: NotificationType, count: number, actorNames: string[]): string {
    const names = actorNames.slice(0, 2).join(", ");
    const others = count > 2 ? ` and ${count - 2} others` : "";

    const typeLabels: Record<NotificationType, string> = {
      LIKE: "liked your post",
      COMMENT: "commented on your post",
      FOLLOW: "followed you",
      FOLLOW_REQUEST: "requested to follow you",
      FOLLOW_ACCEPT: "accepted your follow request",
      MENTION: "mentioned you",
      TAGGED_IN_POST: "tagged you in a post",
      TAGGED_IN_COMMENT: "tagged you in a comment",
      TAGGED_IN_STORY: "mentioned you in a story",
      STORY_MENTION: "mentioned you in a story",
      STORY_REPLY: "replied to your story",
      REEL_LIKE: "liked your reel",
      REEL_COMMENT: "commented on your reel",
      LIVE_VIDEO: "started a live video",
      LIVE_JOIN: "joined your live video",
      DM_MESSAGE: "sent you a message",
      DM_REACTION: "reacted to your message",
      POST_REMINDER: "reminded you to post",
      ACHIEVEMENT: "unlocked an achievement",
      SECURITY_ALERT: "security alert",
      FEATURE_ANNOUNCEMENT: "announced a new feature",
    };

    const label = typeLabels[type] || "activity";

    if (count === 2) {
      return `${names} ${label}`;
    }
    return `${names}${others} ${label}`;
  }

  /**
   * Deliver a single notification (in-app + push + websocket)
   */
  async deliverNotification(payload: NotificationJobPayload): Promise<NotificationDeliveryResult> {
    const errors: string[] = [];
    let inAppDelivered = false;
    let pushDelivered = false;
    let websocketDelivered = false;
    let pushResult: { total: number; successful: number; failed: number } | undefined;

    try {
      // 1. Format notification using templates
      const formatted = notificationTemplates.formatPush(payload.type, {
        actorName: payload.actorName,
        actorUsername: payload.actorUsername,
        actorAvatarUrl: payload.actorAvatarUrl,
        actorIsVerified: payload.actorIsVerified,
        referenceType: payload.referenceType,
        referenceId: payload.referenceId,
        postCaption: payload.postCaption,
        postThumbnailUrl: payload.postThumbnailUrl,
        reelTitle: payload.reelTitle,
        reelThumbnailUrl: payload.reelThumbnailUrl,
        storyThumbnailUrl: payload.storyThumbnailUrl,
        commentText: payload.commentText,
        mentionText: payload.mentionText,
        dmPreview: payload.dmPreview,
        callType: payload.callType,
        isGroupCall: payload.isGroupCall,
        groupName: payload.groupName,
        participantCount: payload.participantCount,
        groupCount: payload.groupCount,
        groupActorNames: payload.groupActorNames,
        alertType: payload.alertType,
        alertDetails: payload.alertDetails,
        actionRequired: payload.actionRequired,
      });

      // 2. Save to database (in-app notification)
      try {
        await db.insert(schema.notifications).values({
          id: payload.notificationId,
          recipientId: payload.recipientId,
          actorId: payload.actorId,
          type: payload.type,
          referenceType: payload.referenceType,
          referenceId: payload.referenceId,
          previewText: formatted.previewText || formatted.body,
          thumbnailUrl: formatted.thumbnailUrl,
          deepLink: formatted.deepLink,
          groupKey: payload.groupKey,
          groupCount: payload.groupCount || 1,
          isRead: false,
          createdAt: new Date(),
        });
        inAppDelivered = true;
      } catch (error) {
        // Check if it's a duplicate (unique constraint on groupKey)
        if (error instanceof Error && error.message.includes("unique")) {
          // Notification already exists, update groupCount
          if (payload.groupKey && payload.groupCount && payload.groupCount > 1) {
            await db
              .update(schema.notifications)
              .set({
                groupCount: payload.groupCount,
                previewText: formatted.previewText || formatted.body,
                createdAt: new Date(), // Update timestamp for grouping
              })
              .where(and(
                eq(schema.notifications.recipientId, payload.recipientId),
                eq(schema.notifications.groupKey, payload.groupKey)
              ));
            inAppDelivered = true;
          }
        } else {
          errors.push(`Database error: ${error}`);
        }
      }

      // 3. Send push notification
      try {
        const pushRes = await pushNotificationService.sendToUser(
          payload.recipientId,
          formatted,
          { platforms: ["IOS", "ANDROID", "WEB"] }
        );
        pushResult = pushRes;
        pushDelivered = pushRes.successful > 0;

        if (pushRes.failed > 0) {
          errors.push(`Push failed for ${pushRes.failed} devices`);
        }
      } catch (error) {
        errors.push(`Push error: ${error}`);
      }

      // 4. Send via WebSocket (real-time)
      try {
        // This would integrate with the WebSocket connection manager
        // For now, we'll mark as pending - the WebSocket server should handle this
        websocketDelivered = await this.sendViaWebSocket(payload.recipientId, formatted, payload.notificationId);
      } catch (error) {
        errors.push(`WebSocket error: ${error}`);
      }

    } catch (error) {
      errors.push(`Delivery error: ${error}`);
    }

    return {
      notificationId: payload.notificationId,
      inAppDelivered,
      pushDelivered,
      pushResult,
      websocketDelivered,
      errors,
    };
  }

  /**
   * Send notification via WebSocket to connected clients
   */
  private async sendViaWebSocket(
    userId: string,
    formatted: FormattedNotification,
    notificationId: string
  ): Promise<boolean> {
    // This would integrate with the WebSocket connection manager
    // The WebSocket server should have a method to broadcast to user
    // For now, we'll return true assuming the WS server handles it
    // In a real implementation, you'd import the connection manager and call:
    // connectionManager.broadcastToUser(userId, { type: "notification.new", payload: {...} });

    // We'll use a dynamic import to avoid circular dependencies
    try {
      const { connectionManager } = await import("../websocket/connection-manager.js");
      connectionManager.broadcastToUser(userId, {
        type: "notification.new",
        payload: {
          id: notificationId,
          title: formatted.title,
          body: formatted.body,
          previewText: formatted.previewText,
          thumbnailUrl: formatted.thumbnailUrl,
          deepLink: formatted.deepLink,
          category: formatted.category,
          priority: formatted.priority,
          createdAt: new Date().toISOString(),
        },
      });
      return true;
    } catch {
      // WebSocket manager not available or user not connected
      return false;
    }
  }

  /**
   * Retry failed notifications
   */
  async retryFailedNotifications(olderThanMinutes: number = 5): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);

    // Find notifications that failed to deliver push but have active device tokens
    // This is a simplified version - in practice you'd track delivery attempts
    const failedNotifications = await db
      .select()
      .from(schema.notifications)
      .where(and(
        eq(schema.notifications.isRead, false),
        lt(schema.notifications.createdAt, cutoff),
        // Add logic to find notifications that need retry
      ))
      .limit(100);

    let retried = 0;
    for (const notif of failedNotifications) {
      // Check if user has active device tokens
      const tokens = await pushNotificationService.getUserDeviceTokens(notif.recipientId);
      if (tokens.length > 0) {
        await this.queueNotification({
          notificationId: notif.id,
          recipientId: notif.recipientId,
          actorId: notif.actorId,
          type: notif.type as NotificationType,
          referenceType: notif.referenceType || undefined,
          referenceId: notif.referenceId || undefined,
          previewText: notif.previewText || undefined,
          thumbnailUrl: notif.thumbnailUrl || undefined,
          deepLink: notif.deepLink || undefined,
          groupKey: notif.groupKey || undefined,
          groupCount: notif.groupCount || undefined,
          // Would need to fetch actor info from users table
          actorName: "", // Fetch from DB
          actorUsername: "",
        });
        retried++;
      }
    }

    return retried;
  }

  /**
   * Process notification digests (daily/weekly)
   */
  async processDigests(): Promise<{ daily: number; weekly: number }> {
    const now = new Date();
    const results = { daily: 0, weekly: 0 };

    // Get users who have digest preferences enabled
    // This would query user settings for digest preferences
    // For now, we'll return 0

    return results;
  }

  /**
   * Send critical alert to user (bypasses preferences)
   */
  async sendCriticalAlert(
    userId: string,
    alertType: string,
    title: string,
    message: string,
    actionUrl?: string
  ): Promise<NotificationDeliveryResult> {
    const notificationId = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const formatted = notificationTemplates.formatPush("SECURITY_ALERT", {
      actorName: "Instagram Security",
      actorUsername: "security",
      alertType,
      alertDetails: message,
      actionRequired: !!actionUrl,
    });

    // Override title and body for critical alert
    formatted.title = title;
    formatted.body = message;
    formatted.priority = "critical";
    formatted.category = "security";
    if (actionUrl) {
      formatted.deepLink = actionUrl;
    }

    return await this.deliverNotification({
      notificationId,
      recipientId: userId,
      actorId: "system",
      type: "SECURITY_ALERT",
      referenceType: "security_alert",
      referenceId: notificationId,
      previewText: message,
      deepLink: formatted.deepLink,
      groupKey: `security:${alertType}`,
      groupCount: 1,
      actorName: "Instagram Security",
      actorUsername: "security",
      alertType,
      alertDetails: message,
      actionRequired: !!actionUrl,
    });
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: string): JobStatus | undefined {
    return this.jobQueue.get(jobId);
  }

  /**
   * Get all job statuses
   */
  getAllJobStatuses(): JobStatus[] {
    return Array.from(this.jobQueue.values())
      .filter(j => !j.jobId.includes(":payload"))
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }

  /**
   * Cleanup old job statuses
   */
  cleanupOldJobs(olderThanHours: number = 24): number {
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    let cleaned = 0;

    for (const [jobId, status] of this.jobQueue.entries()) {
      if (status.completedAt && status.completedAt < cutoff) {
        this.jobQueue.delete(jobId);
        this.jobPayloads.delete(jobId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Start periodic cleanup of old jobs and retry failed notifications
   */
  private cleanupInterval: NodeJS.Timeout | null = null;

  startCleanupInterval(intervalMs: number = 5 * 60 * 1000): void { // Every 5 minutes
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(async () => {
      try {
        // Cleanup old job statuses
        this.cleanupOldJobs(24);

        // Retry failed notifications
        await this.retryFailedNotifications(5);

        // Process digests if needed
        await this.processDigests();
      } catch (error) {
        console.error('[NotificationDeliveryJob] Cleanup error:', error);
      }
    }, intervalMs);

    // Don't prevent process exit
    this.cleanupInterval.unref?.();

    console.log('[NotificationDeliveryJob] Cleanup interval started');
  }

  stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('[NotificationDeliveryJob] Cleanup interval stopped');
    }
  }
}

// Export singleton instance
export const notificationDeliveryJob = new NotificationDeliveryJob();