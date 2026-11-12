import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, inArray, lt, isNotNull, sql } from "drizzle-orm";
import { notificationTemplates, FormattedNotification, APNSPayload, FCMPayload } from "./notification-templates";

/**
 * Push Notification Service
 * Handles sending push notifications via APNs (iOS) and FCM (Android/Web)
 * Supports both regular and VoIP push for calls
 */

// APNs Configuration
interface APNsConfig {
  keyId: string;
  teamId: string;
  bundleId: string;
  voipBundleId: string;
  privateKey: string;
  production: boolean;
}

// FCM Configuration
interface FCMConfig {
  projectId: string;
  privateKey: string;
  clientEmail: string;
  credentialsPath?: string;
}

// Device token with platform info
export interface DeviceToken {
  id: string;
  userId: string;
  token: string;
  platform: "IOS" | "ANDROID" | "WEB";
  deviceId?: string;
  appVersion?: string;
  osVersion?: string;
  voipToken?: string;
  sandbox: boolean;
  topics: string[];
  lastUsedAt?: Date;
  expiresAt?: Date;
  isActive: boolean;
  createdAt: Date;
}

// Push send result
export interface PushSendResult {
  success: boolean;
  token: string;
  platform: string;
  error?: string;
  apnsId?: string;
  fcmMessageId?: string;
}

// Batch send result
export interface BatchPushResult {
  total: number;
  successful: number;
  failed: number;
  results: PushSendResult[];
  invalidTokens: string[]; // Tokens that should be removed
}

// Notification send options
export interface SendNotificationOptions {
  type: string;
  data: Parameters<typeof notificationTemplates.formatPush>[1];
  priority?: "low" | "normal" | "high" | "critical";
  collapseKey?: string; // FCM collapse key for grouping
  ttl?: number; // Time to live in seconds
  voip?: boolean; // For CallKit VoIP push
}

class PushNotificationService {
  private apnsConfig: APNsConfig | null = null;
  private fcmConfig: FCMConfig | null = null;
  private apnsClient: any = null;
  private fcmClient: any = null;
  private initialized = false;

  /**
   * Initialize the push notification service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load APNs config from environment
    const apnsKeyId = process.env.APNS_KEY_ID;
    const apnsTeamId = process.env.APNS_TEAM_ID;
    const apnsBundleId = process.env.APNS_BUNDLE_ID || "com.instagram-clone";
    const apnsVoipBundleId = process.env.APNS_VOIP_BUNDLE_ID || "com.instagram-clone.voip";
    const apnsPrivateKey = process.env.APNS_PRIVATE_KEY;
    const apnsProduction = process.env.APNS_PRODUCTION === "true";

    if (apnsKeyId && apnsTeamId && apnsPrivateKey) {
      this.apnsConfig = {
        keyId: apnsKeyId,
        teamId: apnsTeamId,
        bundleId: apnsBundleId,
        voipBundleId: apnsVoipBundleId,
        privateKey: apnsPrivateKey.replace(/\\n/g, "\n"),
        production: apnsProduction,
      };
      await this.initAPNs();
    }

    // Load FCM config from environment
    const fcmProjectId = process.env.FCM_PROJECT_ID;
    const fcmPrivateKey = process.env.FCM_PRIVATE_KEY;
    const fcmClientEmail = process.env.FCM_CLIENT_EMAIL;
    const fcmCredentialsPath = process.env.FCM_CREDENTIALS_PATH;

    if (fcmProjectId && (fcmPrivateKey || fcmCredentialsPath)) {
      this.fcmConfig = {
        projectId: fcmProjectId,
        privateKey: fcmPrivateKey?.replace(/\\n/g, "\n") || "",
        clientEmail: fcmClientEmail || "",
        credentialsPath: fcmCredentialsPath,
      };
      await this.initFCM();
    }

    this.initialized = true;
  }

  /**
   * Initialize APNs client using apn library
   */
  private async initAPNs(): Promise<void> {
    try {
      // Dynamic import to avoid bundling issues
      // @ts-ignore - optional dependency
      const apn = await import("apn");

      this.apnsClient = new apn.Provider({
        token: {
          key: this.apnsConfig!.privateKey,
          keyId: this.apnsConfig!.keyId,
          teamId: this.apnsConfig!.teamId,
        },
        production: this.apnsConfig!.production,
      });

      // Handle connection errors
      this.apnsClient.on("error", (err: Error) => {
        console.error("[APNs] Connection error:", err);
      });

      console.log("[PushNotificationService] APNs initialized");
    } catch (error) {
      console.error("[PushNotificationService] Failed to initialize APNs:", error);
      this.apnsClient = null;
    }
  }

  /**
   * Initialize FCM client using firebase-admin
   */
  private async initFCM(): Promise<void> {
    try {
      // @ts-ignore - optional dependency
      const { initializeApp, getApps, cert } = await import("firebase-admin/app");
      // @ts-ignore - optional dependency
      const { getMessaging } = await import("firebase-admin/messaging");

      if (getApps().length === 0) {
        if (this.fcmConfig!.credentialsPath) {
          initializeApp({
            credential: cert(this.fcmConfig!.credentialsPath),
            projectId: this.fcmConfig!.projectId,
          });
        } else {
          initializeApp({
            credential: cert({
              projectId: this.fcmConfig!.projectId,
              privateKey: this.fcmConfig!.privateKey,
              clientEmail: this.fcmConfig!.clientEmail,
            }),
            projectId: this.fcmConfig!.projectId,
          });
        }
      }

      this.fcmClient = getMessaging();
      console.log("[PushNotificationService] FCM initialized");
    } catch (error) {
      console.error("[PushNotificationService] Failed to initialize FCM:", error);
      this.fcmClient = null;
    }
  }

  /**
   * Register a device token for a user
   */
  async registerDeviceToken(
    userId: string,
    token: string,
    platform: "IOS" | "ANDROID" | "WEB",
    options: {
      deviceId?: string;
      appVersion?: string;
      osVersion?: string;
      voipToken?: string;
      sandbox?: boolean;
      topics?: string[];
    } = {}
  ): Promise<DeviceToken> {
    // Check if token already exists
    const existing = await db.query.deviceTokens.findFirst({
      where: eq(schema.deviceTokens.token, token),
    });

    if (existing) {
      // Update existing token
      const updated = await db
        .update(schema.deviceTokens)
        .set({
          userId,
          platform,
          deviceId: options.deviceId,
          appVersion: options.appVersion,
          osVersion: options.osVersion,
          voipToken: options.voipToken,
          sandbox: options.sandbox ?? false,
          topics: options.topics ?? [],
          lastUsedAt: new Date(),
          isActive: true,
        })
        .where(eq(schema.deviceTokens.id, existing.id))
        .returning();

      return this.mapToDeviceToken(updated[0]);
    }

    // Create new device token
    const created = await db
      .insert(schema.deviceTokens)
      .values({
        userId,
        token,
        platform,
        deviceId: options.deviceId,
        appVersion: options.appVersion,
        osVersion: options.osVersion,
        voipToken: options.voipToken,
        sandbox: options.sandbox ?? false,
        topics: options.topics ?? [],
        lastUsedAt: new Date(),
        isActive: true,
      })
      .returning();

    return this.mapToDeviceToken(created[0]);
  }

  /**
   * Update device token (e.g., update lastUsedAt, mark inactive)
   */
  async updateDeviceToken(token: string, updates: Partial<DeviceToken>): Promise<DeviceToken | null> {
    const { updatedAt, createdAt, ...validUpdates } = updates as any;
    const result = await db
      .update(schema.deviceTokens)
      .set(validUpdates)
      .where(eq(schema.deviceTokens.token, token))
      .returning();

    if (result.length === 0) return null;
    return this.mapToDeviceToken(result[0]);
  }

  /**
   * Get active device tokens for a user
   */
  async getUserDeviceTokens(userId: string, platform?: "IOS" | "ANDROID" | "WEB"): Promise<DeviceToken[]> {
    const conditions = [
      eq(schema.deviceTokens.userId, userId),
      eq(schema.deviceTokens.isActive, true),
    ];

    if (platform) {
      conditions.push(eq(schema.deviceTokens.platform, platform));
    }

    // Also filter out expired tokens
    conditions.push(
      // Token doesn't expire OR expires in the future
      // Note: We can't do OR easily in drizzle, so we'll filter in memory
      isNotNull(schema.deviceTokens.token)
    );

    const tokens = await db
      .select()
      .from(schema.deviceTokens)
      .where(and(...conditions));

    // Filter out expired tokens
    const now = new Date();
    const validTokens = tokens.filter(t => !t.expiresAt || t.expiresAt > now);

    return validTokens.map(this.mapToDeviceToken);
  }

  /**
   * Get VoIP tokens for a user (for CallKit)
   */
  async getUserVoIPTokens(userId: string): Promise<DeviceToken[]> {
    const tokens = await db
      .select()
      .from(schema.deviceTokens)
      .where(and(
        eq(schema.deviceTokens.userId, userId),
        eq(schema.deviceTokens.isActive, true),
        eq(schema.deviceTokens.platform, "IOS"),
        isNotNull(schema.deviceTokens.voipToken)
      ));

    const now = new Date();
    return tokens
      .filter(t => t.voipToken && (!t.expiresAt || t.expiresAt > now))
      .map(this.mapToDeviceToken);
  }

  /**
   * Cleanup expired/invalid device tokens
   */
  async cleanupDeviceTokens(): Promise<number> {
    const now = new Date();

    // Mark expired tokens as inactive
    const expiredResult = await db
      .update(schema.deviceTokens)
      .set({ isActive: false })
      .where(and(
        eq(schema.deviceTokens.isActive, true),
        lt(schema.deviceTokens.expiresAt, now)
      ));

    // Also cleanup tokens not used in 90 days
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const staleResult = await db
      .update(schema.deviceTokens)
      .set({ isActive: false })
      .where(and(
        eq(schema.deviceTokens.isActive, true),
        lt(schema.deviceTokens.lastUsedAt, ninetyDaysAgo)
      ));

    return (expiredResult.rowCount || 0) + (staleResult.rowCount || 0);
  }

  /**
   * Send notification to a single device token
   */
  async sendToToken(
    token: string,
    platform: "IOS" | "ANDROID" | "WEB",
    formatted: FormattedNotification,
    options: { voip?: boolean } = {}
  ): Promise<PushSendResult> {
    try {
      if (platform === "IOS") {
        if (options.voip) {
          return await this.sendVoIPToToken(token, formatted);
        }
        return await this.sendAPNsToToken(token, formatted);
      } else if (platform === "ANDROID" || platform === "WEB") {
        return await this.sendFCMToToken(token, formatted);
      } else {
        return { success: false, token, platform, error: `Unsupported platform: ${platform}` };
      }
    } catch (error) {
      return {
        success: false,
        token,
        platform,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Send APNs notification to a single token
   */
  private async sendAPNsToToken(token: string, formatted: FormattedNotification): Promise<PushSendResult> {
    if (!this.apnsClient) {
      return { success: false, token, platform: "IOS", error: "APNs not initialized" };
    }

    // @ts-ignore - optional dependency
    const apn = await import("apn");
    const notification: any = new apn.Notification();

    // Set APNs payload
    if (formatted.apnsPayload) {
      Object.assign(notification, formatted.apnsPayload);
    } else {
      notification.alert = {
        title: formatted.title,
        body: formatted.body,
      };
      notification.badge = formatted.badge;
      notification.sound = formatted.sound || "default";
      notification.topic = this.apnsConfig!.bundleId;
      notification.category = formatted.category;
      notification.threadId = formatted.deepLink; // Use deepLink as threadId fallback
      notification.mutableContent = 1;
      notification.contentAvailable = formatted.priority === "critical" ? 1 : 0;

      // Custom payload - only include properties available on FormattedNotification
      notification.payload = {
        notificationId: formatted.deepLink,
        type: formatted.category,
        deepLink: formatted.deepLink,
        // Note: actorId, referenceType, referenceId, groupKey, groupCount are only available in APNSPayload
        // which is not present in this branch
      };
    }

    try {
      const result = await this.apnsClient.send(notification, token);

      // Check for failures
      if (result.failed.length > 0) {
        const failure = result.failed[0];
        const shouldRemove = failure.response?.statusCode === 410 || // Unregistered
                           failure.response?.statusCode === 400;     // Bad device token

        return {
          success: false,
          token,
          platform: "IOS",
          error: failure.response?.reason || "APNs send failed",
          apnsId: failure.device,
        };
      }

      return {
        success: true,
        token,
        platform: "IOS",
        apnsId: result.sent[0]?.device,
      };
    } catch (error) {
      return {
        success: false,
        token,
        platform: "IOS",
        error: error instanceof Error ? error.message : "APNs send error",
      };
    }
  }

  /**
   * Send VoIP push notification (for CallKit)
   */
  private async sendVoIPToToken(token: string, formatted: FormattedNotification): Promise<PushSendResult> {
    if (!this.apnsClient) {
      return { success: false, token, platform: "IOS", error: "APNs not initialized" };
    }

    // @ts-ignore - optional dependency
    const apn = await import("apn");
    const notification: any = new apn.Notification();

    // VoIP push specific settings
    notification.pushType = "voip";
    notification.topic = this.apnsConfig!.voipBundleId;
    notification.expiry = Math.floor(Date.now() / 1000) + 30; // 30 seconds TTL for VoIP
    notification.priority = 10; // High priority for VoIP

    // VoIP payload requires content-available
    notification.contentAvailable = 1;
    notification.mutableContent = 1;

    // VoIP payload structure for CallKit
    const callkit = formatted.apnsPayload?.callkit;
    notification.payload = {
      aps: {
        "content-available": 1,
        "mutable-content": 1,
      },
      callkit: {
        uuid: callkit?.uuid || formatted.apnsPayload?.notificationId,
        handle: callkit?.handle || formatted.title,
        handleType: callkit?.handleType || "generic",
        hasVideo: callkit?.hasVideo || false,
        isGroupCall: callkit?.isGroupCall || false,
        callId: callkit?.callId || formatted.apnsPayload?.referenceId,
        roomId: callkit?.roomId,
        iceServers: callkit?.iceServers || [],
        callerName: callkit?.callerName || formatted.title,
        callerAvatar: callkit?.callerAvatar || "",
      },
    };

    try {
      const result = await this.apnsClient.send(notification, token);

      if (result.failed.length > 0) {
        const failure = result.failed[0];
        return {
          success: false,
          token,
          platform: "IOS",
          error: failure.response?.reason || "VoIP push failed",
          apnsId: failure.device,
        };
      }

      return {
        success: true,
        token,
        platform: "IOS",
        apnsId: result.sent[0]?.device,
      };
    } catch (error) {
      return {
        success: false,
        token,
        platform: "IOS",
        error: error instanceof Error ? error.message : "VoIP send error",
      };
    }
  }

  /**
   * Send FCM notification to a single token
   */
  private async sendFCMToToken(token: string, formatted: FormattedNotification): Promise<PushSendResult> {
    if (!this.fcmClient) {
      return { success: false, token, platform: "ANDROID", error: "FCM not initialized" };
    }

    try {
      const message = {
        token,
        notification: formatted.fcmPayload?.notification,
        data: formatted.fcmPayload?.data,
        android: formatted.fcmPayload?.android,
        apns: formatted.fcmPayload?.apns ? {
          payload: formatted.fcmPayload.apns,
          headers: {
            "apns-priority": "10",
            "apns-push-type": "alert",
          },
        } : undefined,
        webpush: {
          notification: {
            title: formatted.title,
            body: formatted.body,
            icon: "/icons/notification-icon.png",
            badge: "/icons/badge-icon.png",
            image: formatted.thumbnailUrl,
            actions: [
              { action: "open", title: "Open" },
              { action: "dismiss", title: "Dismiss" },
            ],
          },
          fcmOptions: {
            link: formatted.deepLink,
          },
        },
      };

      const response = await this.fcmClient.send(message);

      return {
        success: true,
        token,
        platform: "ANDROID",
        fcmMessageId: response,
      };
    } catch (error: any) {
      // Check for invalid token errors
      const shouldRemove = error.code === "messaging/registration-token-not-registered" ||
                          error.code === "messaging/invalid-registration-token" ||
                          error.code === "messaging/invalid-argument";

      return {
        success: false,
        token,
        platform: "ANDROID",
        error: error.message,
      };
    }
  }

  /**
   * Send notification to all devices of a user
   */
  async sendToUser(
    userId: string,
    formatted: FormattedNotification,
    options: { voip?: boolean; platforms?: ("IOS" | "ANDROID" | "WEB")[] } = {}
  ): Promise<BatchPushResult> {
    const tokens = await this.getUserDeviceTokens(userId);

    // Filter by platform if specified
    const filteredTokens = options.platforms
      ? tokens.filter(t => options.platforms!.includes(t.platform))
      : tokens;

    if (filteredTokens.length === 0) {
      return {
        total: 0,
        successful: 0,
        failed: 0,
        results: [],
        invalidTokens: [],
      };
    }

    return await this.sendToTokens(filteredTokens, formatted, { voip: options.voip });
  }

  /**
   * Send notification to multiple tokens
   */
  async sendToTokens(
    tokens: DeviceToken[],
    formatted: FormattedNotification,
    options: { voip?: boolean } = {}
  ): Promise<BatchPushResult> {
    const results: PushSendResult[] = [];
    const invalidTokens: string[] = [];

    // Send in parallel with concurrency limit
    const concurrency = 10;
    for (let i = 0; i < tokens.length; i += concurrency) {
      const batch = tokens.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(token => this.sendToToken(token.token, token.platform, formatted, { voip: options.voip }))
      );

      for (const result of batchResults) {
        results.push(result);
        if (!result.success && this.shouldRemoveToken(result.error || "")) {
          invalidTokens.push(result.token);
        }
      }
    }

    // Cleanup invalid tokens
    if (invalidTokens.length > 0) {
      await this.removeInvalidTokens(invalidTokens);
    }

    return {
      total: tokens.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
      invalidTokens,
    };
  }

  /**
   * Send notification by type (uses templates)
   */
  async sendByType(
    userId: string,
    type: string,
    templateData: Parameters<typeof notificationTemplates.formatPush>[1],
    options: { voip?: boolean; platforms?: ("IOS" | "ANDROID" | "WEB")[] } = {}
  ): Promise<BatchPushResult> {
    const formatted = notificationTemplates.formatPush(type as any, templateData);
    return await this.sendToUser(userId, formatted, options);
  }

  /**
   * Send incoming call VoIP push (CallKit)
   */
  async sendIncomingCallPush(
    calleeId: string,
    callData: {
      callId: string;
      roomId: string;
      callerId: string;
      callerName: string;
      callerUsername: string;
      callerAvatarUrl?: string;
      hasVideo: boolean;
      isGroupCall: boolean;
      iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
    }
  ): Promise<BatchPushResult> {
    const voipTokens = await this.getUserVoIPTokens(calleeId);

    if (voipTokens.length === 0) {
      return {
        total: 0,
        successful: 0,
        failed: 0,
        results: [],
        invalidTokens: [],
      };
    }

    // Format VoIP push payload
    const formatted: FormattedNotification = {
      title: callData.callerName,
      body: callData.hasVideo ? "Incoming video call" : "Incoming voice call",
      deepLink: `instagram-clone://call/${callData.callId}`,
      category: "call",
      priority: "critical",
      apnsPayload: {
        aps: {
          alert: {
            title: callData.callerName,
            body: callData.hasVideo ? "Video call" : "Voice call",
          },
          "content-available": 1,
          "mutable-content": 1,
          category: "call",
          threadId: callData.callId,
        },
        notificationId: callData.callId,
        type: "incoming_call",
        deepLink: `instagram-clone://call/${callData.callId}`,
        actorId: callData.callerId,
        referenceType: "call",
        referenceId: callData.callId,
      },
    };

    // Add CallKit specific data to APNs payload
    if (formatted.apnsPayload) {
      formatted.apnsPayload.callkit = {
        uuid: callData.callId,
        handle: callData.callerUsername,
        handleType: "generic",
        hasVideo: callData.hasVideo,
        isGroupCall: callData.isGroupCall,
        callId: callData.callId,
        roomId: callData.roomId,
        iceServers: callData.iceServers,
        callerName: callData.callerName,
        callerAvatar: callData.callerAvatarUrl || "",
      };
    }

    return await this.sendToTokens(voipTokens, formatted, { voip: true });
  }

  /**
   * Check if token should be removed based on error
   */
  private shouldRemoveToken(error: string): boolean {
    const removeErrors = [
      "Unregistered",
      "BadDeviceToken",
      "DeviceTokenNotForTopic",
      "registration-token-not-registered",
      "invalid-registration-token",
      "invalid-argument",
    ];
    return removeErrors.some(e => error.includes(e));
  }

  /**
   * Remove invalid tokens from database
   */
  private async removeInvalidTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;

    await db
      .update(schema.deviceTokens)
      .set({ isActive: false })
      .where(inArray(schema.deviceTokens.token, tokens));
  }

  /**
   * Map database row to DeviceToken interface
   */
  private mapToDeviceToken(row: typeof schema.deviceTokens.$inferSelect): DeviceToken {
    return {
      id: row.id,
      userId: row.userId,
      token: row.token,
      platform: row.platform,
      deviceId: row.deviceId ?? undefined,
      appVersion: row.appVersion ?? undefined,
      osVersion: row.osVersion ?? undefined,
      voipToken: row.voipToken ?? undefined,
      sandbox: row.sandbox,
      topics: row.topics || [],
      lastUsedAt: row.lastUsedAt ?? undefined,
      expiresAt: row.expiresAt ?? undefined,
      isActive: row.isActive,
      createdAt: row.createdAt,
    };
  }

  /**
   * Get push service stats
   */
  async getStats(): Promise<{
    apnsInitialized: boolean;
    fcmInitialized: boolean;
    totalActiveTokens: number;
    tokensByPlatform: Record<string, number>;
  }> {
    const tokens = await db
      .select({
        platform: schema.deviceTokens.platform,
        count: sql<number>`count(*)`,
      })
      .from(schema.deviceTokens)
      .where(eq(schema.deviceTokens.isActive, true))
      .groupBy(schema.deviceTokens.platform);

    const tokensByPlatform: Record<string, number> = {};
    let totalActiveTokens = 0;
    for (const t of tokens) {
      tokensByPlatform[t.platform] = t.count;
      totalActiveTokens += t.count;
    }

    return {
      apnsInitialized: !!this.apnsClient,
      fcmInitialized: !!this.fcmClient,
      totalActiveTokens,
      tokensByPlatform,
    };
  }
}

// Export singleton instance
export const pushNotificationService = new PushNotificationService();