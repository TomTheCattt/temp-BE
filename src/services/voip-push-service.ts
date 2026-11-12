import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, inArray, lt, isNotNull, sql } from "drizzle-orm";
import { buildCallKitPayload, CallKitPayloadData, VoIPPushPayload } from "./callkit-payload";

/**
 * VoIP Push Service
 * Dedicated service for handling VoIP push notifications via APNs for iOS CallKit integration
 * Handles incoming call notifications, missed call handling, and background call lifecycle
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
}

// Batch send result
export interface BatchPushResult {
  total: number;
  successful: number;
  failed: number;
  results: PushSendResult[];
  invalidTokens: string[]; // Tokens that should be removed
}

// CallKit call lifecycle events
export type CallKitEventType =
  | "incoming_call"     // New incoming call
  | "call_accepted"     // Call accepted by callee
  | "call_declined"     // Call declined by callee
  | "call_missed"       // Call missed (timeout)
  | "call_ended"        // Call ended normally
  | "call_failed";      // Call failed

export interface CallKitEvent {
  type: CallKitEventType;
  callId: string;
  roomId?: string;
  calleeId: string;
  callerId: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

class VoIPPushService {
  private apnsConfig: APNsConfig | null = null;
  private apnsClient: any = null;
  private initialized = false;

  /**
   * Initialize the VoIP push service
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

    this.initialized = true;
    console.log("[VoIPPushService] Initialized");
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

      console.log("[VoIPPushService] APNs initialized for VoIP");
    } catch (error) {
      console.error("[VoIPPushService] Failed to initialize APNs:", error);
      this.apnsClient = null;
    }
  }

  /**
   * Register a VoIP push token for a user
   */
  async registerVoIPToken(
    userId: string,
    token: string,
    voipToken: string,
    platform: "IOS" | "ANDROID" | "WEB" = "IOS",
    options: {
      deviceId?: string;
      appVersion?: string;
      osVersion?: string;
      sandbox?: boolean;
      topics?: string[];
    } = {}
  ): Promise<DeviceToken> {
    // Check if token already exists
    const existing = await db.query.deviceTokens.findFirst({
      where: eq(schema.deviceTokens.token, token),
    });

    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days

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
          voipToken,
          sandbox: options.sandbox ?? false,
          topics: options.topics ?? [],
          lastUsedAt: new Date(),
          expiresAt,
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
        voipToken,
        sandbox: options.sandbox ?? false,
        topics: options.topics ?? [],
        lastUsedAt: new Date(),
        expiresAt,
        isActive: true,
      })
      .returning();

    return this.mapToDeviceToken(created[0]);
  }

  /**
   * Update VoIP token (e.g., when token rotates)
   */
  async updateVoIPToken(token: string, voipToken: string): Promise<DeviceToken | null> {
    const result = await db
      .update(schema.deviceTokens)
      .set({ voipToken, lastUsedAt: new Date() })
      .where(eq(schema.deviceTokens.token, token))
      .returning();

    if (result.length === 0) return null;
    return this.mapToDeviceToken(result[0]);
  }

  /**
   * Get active VoIP tokens for a user (for CallKit incoming calls)
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
   * Get all active device tokens for a user (including VoIP)
   */
  async getUserDeviceTokens(userId: string, platform?: "IOS" | "ANDROID" | "WEB"): Promise<DeviceToken[]> {
    const conditions = [
      eq(schema.deviceTokens.userId, userId),
      eq(schema.deviceTokens.isActive, true),
    ];

    if (platform) {
      conditions.push(eq(schema.deviceTokens.platform, platform));
    }

    const tokens = await db
      .select()
      .from(schema.deviceTokens)
      .where(and(...conditions));

    const now = new Date();
    return tokens
      .filter(t => !t.expiresAt || t.expiresAt > now)
      .map(this.mapToDeviceToken);
  }

  /**
   * Send incoming call VoIP push (CallKit)
   * This is the primary method for initiating CallKit incoming call UI
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
      console.log(`[VoIPPushService] No VoIP tokens for user ${calleeId}`);
      return {
        total: 0,
        successful: 0,
        failed: 0,
        results: [],
        invalidTokens: [],
      };
    }

    // Build CallKit payload
    const payloadData: CallKitPayloadData = {
      callId: callData.callId,
      roomId: callData.roomId,
      callerId: callData.callerId,
      callerName: callData.callerName,
      callerUsername: callData.callerUsername,
      callerAvatarUrl: callData.callerAvatarUrl,
      hasVideo: callData.hasVideo,
      isGroupCall: callData.isGroupCall,
      iceServers: callData.iceServers,
    };

    const voipPayload = buildCallKitPayload(payloadData);

    return await this.sendToTokens(voipTokens, voipPayload);
  }

  /**
   * Send call update VoIP push (for call state changes like accepted, declined, ended)
   * Used for CallKit background updates
   */
  async sendCallUpdatePush(
    calleeId: string,
    event: CallKitEvent
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

    // Build payload based on event type
    let payload: VoIPPushPayload;

    switch (event.type) {
      case "call_accepted":
        payload = this.buildCallAcceptedPayload(event);
        break;
      case "call_declined":
        payload = this.buildCallDeclinedPayload(event);
        break;
      case "call_missed":
        payload = this.buildCallMissedPayload(event);
        break;
      case "call_ended":
        payload = this.buildCallEndedPayload(event);
        break;
      case "call_failed":
        payload = this.buildCallFailedPayload(event);
        break;
      default:
        return {
          total: 0,
          successful: 0,
          failed: 0,
          results: [],
          invalidTokens: [],
        };
    }

    return await this.sendToTokens(voipTokens, payload);
  }

  /**
   * Send VoIP push to multiple tokens
   */
  async sendToTokens(
    tokens: DeviceToken[],
    payload: VoIPPushPayload
  ): Promise<BatchPushResult> {
    if (!this.apnsClient) {
      console.error("[VoIPPushService] APNs client not initialized");
      return {
        total: tokens.length,
        successful: 0,
        failed: tokens.length,
        results: tokens.map(t => ({
          success: false,
          token: t.token,
          platform: t.platform,
          error: "APNs not initialized",
        })),
        invalidTokens: [],
      };
    }

    const results: PushSendResult[] = [];
    const invalidTokens: string[] = [];

    // Send in parallel with concurrency limit
    const concurrency = 10;
    for (let i = 0; i < tokens.length; i += concurrency) {
      const batch = tokens.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(token => this.sendToToken(token, payload))
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
   * Send VoIP push to a single token
   */
  private async sendToToken(token: DeviceToken, payload: VoIPPushPayload): Promise<PushSendResult> {
    if (!this.apnsClient) {
      return { success: false, token: token.token, platform: "IOS", error: "APNs not initialized" };
    }

    try {
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

      // Set the full CallKit payload
      notification.payload = payload;

      const result = await this.apnsClient.send(notification, token.voipToken!);

      if (result.failed.length > 0) {
        const failure = result.failed[0];
        const shouldRemove = failure.response?.statusCode === 410 || // Unregistered
                           failure.response?.statusCode === 400;     // Bad device token

        return {
          success: false,
          token: token.token,
          platform: "IOS",
          error: failure.response?.reason || "VoIP push failed",
          apnsId: failure.device,
        };
      }

      // Update last used timestamp
      await this.updateLastUsed(token.token);

      return {
        success: true,
        token: token.token,
        platform: "IOS",
        apnsId: result.sent[0]?.device,
      };
    } catch (error) {
      return {
        success: false,
        token: token.token,
        platform: "IOS",
        error: error instanceof Error ? error.message : "VoIP send error",
      };
    }
  }

  /**
   * Build CallKit payload for call accepted event
   */
  private buildCallAcceptedPayload(event: CallKitEvent): VoIPPushPayload {
    return {
      aps: {
        "content-available": 1,
        "mutable-content": 1,
      },
      callkit: {
        uuid: event.callId,
        handle: event.callerId,
        handleType: "generic",
        hasVideo: false,
        isGroupCall: false,
        callId: event.callId,
        roomId: event.roomId || "",
        action: "accepted",
        timestamp: event.timestamp.toISOString(),
      },
    };
  }

  /**
   * Build CallKit payload for call declined event
   */
  private buildCallDeclinedPayload(event: CallKitEvent): VoIPPushPayload {
    return {
      aps: {
        "content-available": 1,
        "mutable-content": 1,
      },
      callkit: {
        uuid: event.callId,
        handle: event.callerId,
        handleType: "generic",
        hasVideo: false,
        isGroupCall: false,
        callId: event.callId,
        roomId: event.roomId || "",
        action: "declined",
        timestamp: event.timestamp.toISOString(),
      },
    };
  }

  /**
   * Build CallKit payload for missed call event
   */
  private buildCallMissedPayload(event: CallKitEvent): VoIPPushPayload {
    return {
      aps: {
        alert: {
          title: "Missed Call",
          body: "You missed a call",
        },
        "content-available": 1,
        "mutable-content": 1,
        sound: "default",
      },
      callkit: {
        uuid: event.callId,
        handle: event.callerId,
        handleType: "generic",
        hasVideo: false,
        isGroupCall: false,
        callId: event.callId,
        roomId: event.roomId || "",
        action: "missed",
        timestamp: event.timestamp.toISOString(),
      },
    };
  }

  /**
   * Build CallKit payload for call ended event
   */
  private buildCallEndedPayload(event: CallKitEvent): VoIPPushPayload {
    return {
      aps: {
        "content-available": 1,
        "mutable-content": 1,
      },
      callkit: {
        uuid: event.callId,
        handle: event.callerId,
        handleType: "generic",
        hasVideo: false,
        isGroupCall: false,
        callId: event.callId,
        roomId: event.roomId || "",
        action: "ended",
        timestamp: event.timestamp.toISOString(),
        duration: event.metadata?.duration,
      },
    };
  }

  /**
   * Build CallKit payload for call failed event
   */
  private buildCallFailedPayload(event: CallKitEvent): VoIPPushPayload {
    return {
      aps: {
        alert: {
          title: "Call Failed",
          body: "The call could not be connected",
        },
        "content-available": 1,
        "mutable-content": 1,
        sound: "default",
      },
      callkit: {
        uuid: event.callId,
        handle: event.callerId,
        handleType: "generic",
        hasVideo: false,
        isGroupCall: false,
        callId: event.callId,
        roomId: event.roomId || "",
        action: "failed",
        timestamp: event.timestamp.toISOString(),
        error: event.metadata?.error,
      },
    };
  }

  /**
   * Update last used timestamp for a token
   */
  private async updateLastUsed(token: string): Promise<void> {
    await db
      .update(schema.deviceTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.deviceTokens.token, token));
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
   * Get VoIP push service stats
   */
  async getStats(): Promise<{
    apnsInitialized: boolean;
    totalActiveVoIPTokens: number;
    tokensBySandbox: Record<string, number>;
  }> {
    const tokens = await db
      .select({
        sandbox: schema.deviceTokens.sandbox,
        count: sql<number>`count(*)`,
      })
      .from(schema.deviceTokens)
      .where(and(
        eq(schema.deviceTokens.isActive, true),
        eq(schema.deviceTokens.platform, "IOS"),
        isNotNull(schema.deviceTokens.voipToken)
      ))
      .groupBy(schema.deviceTokens.sandbox);

    const tokensBySandbox: Record<string, number> = {};
    let totalActiveVoIPTokens = 0;
    for (const t of tokens) {
      tokensBySandbox[t.sandbox ? "sandbox" : "production"] = t.count;
      totalActiveVoIPTokens += t.count;
    }

    return {
      apnsInitialized: !!this.apnsClient,
      totalActiveVoIPTokens,
      tokensBySandbox,
    };
  }

  /**
   * Test VoIP push (for development/testing)
   */
  async testVoIPPush(
    userId: string,
    testData: Partial<CallKitPayloadData> = {}
  ): Promise<BatchPushResult> {
    const defaultData: CallKitPayloadData = {
      callId: crypto.randomUUID(),
      roomId: "test-room-" + Date.now(),
      callerId: "test-caller",
      callerName: "Test Caller",
      callerUsername: "testcaller",
      callerAvatarUrl: "",
      hasVideo: testData.hasVideo ?? true,
      isGroupCall: testData.isGroupCall ?? false,
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
      ...testData,
    };

    const voipPayload = buildCallKitPayload(defaultData);
    const voipTokens = await this.getUserVoIPTokens(userId);

    return await this.sendToTokens(voipTokens, voipPayload);
  }
}

// Export singleton instance
export const voipPushService = new VoIPPushService();