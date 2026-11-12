import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware, getCurrentUser } from "../middleware/auth";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, inArray, lt, isNotNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { voipPushService } from "../services/voip-push-service";
import { buildCallKitPayload, CallKitPayloadData, DEFAULT_ICE_SERVERS, getProductionIceServers } from "../services/callkit-payload";

// Validation schemas
const deviceTokenSchema = z.object({
  token: z.string().min(1).max(512),
  platform: z.enum(["IOS", "ANDROID", "WEB"]).default("IOS"),
  deviceId: z.string().max(200).optional(),
  appVersion: z.string().max(20).optional(),
  osVersion: z.string().max(20).optional(),
  voipToken: z.string().max(512).optional(),
  sandbox: z.boolean().default(false),
  topics: z.array(z.string()).optional(),
});

const voipTokenSchema = z.object({
  token: z.string().min(1).max(512),
  voipToken: z.string().min(1).max(512),
});

const unregisterTokenSchema = z.object({
  token: z.string().min(1).max(512),
});

const testPushSchema = z.object({
  callId: z.string().uuid().optional(),
  roomId: z.string().optional(),
  callerName: z.string().optional(),
  callerUsername: z.string().optional(),
  hasVideo: z.boolean().optional(),
  isGroupCall: z.boolean().optional(),
  iceServers: z.array(z.object({
    urls: z.union([z.string(), z.array(z.string())]),
    username: z.string().optional(),
    credential: z.string().optional(),
  })).optional(),
});

const callEventSchema = z.object({
  callId: z.string().uuid(),
  roomId: z.string().optional(),
  calleeId: z.string().uuid(),
  callerId: z.string().uuid(),
  eventType: z.enum(["accepted", "declined", "missed", "ended", "failed"]),
  metadata: z.record(z.any()).optional(),
});

const iceServersSchema = z.object({
  iceServers: z.array(z.object({
    urls: z.union([z.string(), z.array(z.string())]),
    username: z.string().optional(),
    credential: z.string().optional(),
  })),
});

// Create CallKit router
const callkitRouter = new Hono();

// Apply auth middleware to all routes
callkitRouter.use("*", authMiddleware);

// ============================================================================
// VoIP Push Token Management
// ============================================================================

// POST /v1/callkit/device-token - Register device token with VoIP support
callkitRouter.post("/device-token", zValidator("json", deviceTokenSchema), async (c) => {
  const user = getCurrentUser(c);
  const data = c.req.valid("json");

  // Set expiry to 90 days from now
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  const result = await db
    .insert(schema.deviceTokens)
    .values({
      userId: user.id,
      token: data.token,
      platform: data.platform,
      deviceId: data.deviceId,
      appVersion: data.appVersion,
      osVersion: data.osVersion,
      voipToken: data.voipToken,
      sandbox: data.sandbox,
      topics: data.topics ?? [],
      expiresAt,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: schema.deviceTokens.token,
      set: {
        userId: user.id,
        platform: data.platform,
        deviceId: data.deviceId,
        appVersion: data.appVersion,
        osVersion: data.osVersion,
        voipToken: data.voipToken,
        sandbox: data.sandbox,
        topics: data.topics ?? [],
        expiresAt,
        lastUsedAt: new Date(),
        isActive: true,
      },
    })
    .returning();

  const token = result[0];

  return c.json({
    success: true,
    data: {
      deviceToken: {
        id: token.id,
        token: token.token,
        platform: token.platform,
        voipToken: token.voipToken,
        sandbox: token.sandbox,
        topics: token.topics,
        expiresAt: token.expiresAt,
        isActive: token.isActive,
        createdAt: token.createdAt,
      },
    },
  });
});

// POST /v1/callkit/voip-token - Register/update VoIP token for existing device token
callkitRouter.post("/voip-token", zValidator("json", voipTokenSchema), async (c) => {
  const user = getCurrentUser(c);
  const { token, voipToken } = c.req.valid("json");

  // Verify the token belongs to this user
  const existing = await db.query.deviceTokens.findFirst({
    where: and(
      eq(schema.deviceTokens.token, token),
      eq(schema.deviceTokens.userId, user.id)
    ),
  });

  if (!existing) {
    throw new HTTPException(404, { message: "Device token not found" });
  }

  // Update VoIP token
  const updated = await db
    .update(schema.deviceTokens)
    .set({ voipToken, lastUsedAt: new Date() })
    .where(eq(schema.deviceTokens.id, existing.id))
    .returning();

  return c.json({
    success: true,
    data: {
      deviceToken: {
        id: updated[0].id,
        token: updated[0].token,
        platform: updated[0].platform,
        voipToken: updated[0].voipToken,
        sandbox: updated[0].sandbox,
        lastUsedAt: updated[0].lastUsedAt,
      },
    },
  });
});

// DELETE /v1/callkit/device-token - Unregister device token
callkitRouter.delete("/device-token", zValidator("json", unregisterTokenSchema), async (c) => {
  const user = getCurrentUser(c);
  const { token } = c.req.valid("json");

  await db
    .delete(schema.deviceTokens)
    .where(and(eq(schema.deviceTokens.userId, user.id), eq(schema.deviceTokens.token, token)));

  return c.status(204);
});

// GET /v1/callkit/device-tokens - List user's device tokens (including VoIP)
callkitRouter.get("/device-tokens", async (c) => {
  const user = getCurrentUser(c);

  const tokens = await db
    .select()
    .from(schema.deviceTokens)
    .where(and(
      eq(schema.deviceTokens.userId, user.id),
      eq(schema.deviceTokens.isActive, true)
    ))
    .orderBy(sql`${schema.deviceTokens.createdAt} DESC`);

  return c.json({
    success: true,
    data: {
      items: tokens.map(t => ({
        id: t.id,
        token: t.token,
        platform: t.platform,
        deviceId: t.deviceId,
        appVersion: t.appVersion,
        osVersion: t.osVersion,
        voipToken: t.voipToken,
        sandbox: t.sandbox,
        topics: t.topics,
        lastUsedAt: t.lastUsedAt,
        expiresAt: t.expiresAt,
        isActive: t.isActive,
        createdAt: t.createdAt,
      })),
    },
  });
});

// ============================================================================
// CallKit Test Endpoints (Development/Debugging)
// ============================================================================

// POST /v1/callkit/test-incoming-call - Send test incoming call VoIP push
callkitRouter.post("/test-incoming-call", zValidator("json", testPushSchema), async (c) => {
  const user = getCurrentUser(c);
  const data = c.req.valid("json");

  const callId = data.callId || crypto.randomUUID();
  const roomId = data.roomId || `test-room-${Date.now()}`;
  const callerName = data.callerName || "Test Caller";
  const callerUsername = data.callerUsername || "testcaller";
  const hasVideo = data.hasVideo ?? true;
  const isGroupCall = data.isGroupCall ?? false;
  const iceServers = data.iceServers || getProductionIceServers();

  const payloadData: CallKitPayloadData = {
    callId,
    roomId,
    callerId: "test-caller-id",
    callerName,
    callerUsername,
    callerAvatarUrl: "",
    hasVideo,
    isGroupCall,
    iceServers,
  };

  const result = await voipPushService.testVoIPPush(user.id, payloadData);

  return c.json({
    success: true,
    data: {
      callId,
      roomId,
      result: {
        total: result.total,
        successful: result.successful,
        failed: result.failed,
        invalidTokens: result.invalidTokens.length,
      },
    },
  });
});

// POST /v1/callkit/test-call-event - Send test call event (accepted, declined, missed, ended, failed)
callkitRouter.post("/test-call-event", zValidator("json", callEventSchema), async (c) => {
  const user = getCurrentUser(c);
  const { callId, roomId, calleeId, callerId, eventType, metadata } = c.req.valid("json");

  // Verify callee exists
  const callee = await db.query.users.findFirst({
    where: eq(schema.users.id, calleeId),
    columns: { id: true },
  });

  if (!callee) {
    throw new HTTPException(404, { message: "Callee not found" });
  }

  const event = {
    type: eventType as any,
    callId,
    roomId,
    calleeId,
    callerId,
    timestamp: new Date(),
    metadata,
  };

  const result = await voipPushService.sendCallUpdatePush(calleeId, event);

  return c.json({
    success: true,
    data: {
      eventType,
      callId,
      result: {
        total: result.total,
        successful: result.successful,
        failed: result.failed,
        invalidTokens: result.invalidTokens.length,
      },
    },
  });
});

// GET /v1/callkit/ice-servers - Get ICE servers for WebRTC
callkitRouter.get("/ice-servers", async (c) => {
  const iceServers = getProductionIceServers();

  return c.json({
    success: true,
    data: {
      iceServers,
    },
  });
});

// POST /v1/callkit/ice-servers - Update ICE servers (admin only in production)
callkitRouter.post("/ice-servers", zValidator("json", iceServersSchema), async (c) => {
  // In production, add admin check here
  const { iceServers } = c.req.valid("json");

  // Store in environment or database for production
  // For now, just return the provided servers
  return c.json({
    success: true,
    data: {
      iceServers,
      message: "ICE servers updated (in-memory only, use environment variables for persistence)",
    },
  });
});

// ============================================================================
// CallKit Lifecycle Events (Internal/Service-to-Service)
// ============================================================================

// POST /v1/callkit/call-initiated - Called when a new call is initiated
// This would typically be called from the calls service
callkitRouter.post("/call-initiated", zValidator("json", z.object({
  callId: z.string().uuid(),
  roomId: z.string(),
  callerId: z.string().uuid(),
  calleeIds: z.array(z.string().uuid()),
  callerName: z.string(),
  callerUsername: z.string(),
  callerAvatarUrl: z.string().optional(),
  hasVideo: z.boolean(),
  isGroupCall: z.boolean(),
})), async (c) => {
  const data = c.req.valid("json");

  // Get ICE servers
  const iceServers = getProductionIceServers();

  // Send VoIP push to all callees
  const results = await Promise.all(
    data.calleeIds.map(calleeId =>
      voipPushService.sendIncomingCallPush(calleeId, {
        callId: data.callId,
        roomId: data.roomId,
        callerId: data.callerId,
        callerName: data.callerName,
        callerUsername: data.callerUsername,
        callerAvatarUrl: data.callerAvatarUrl,
        hasVideo: data.hasVideo,
        isGroupCall: data.isGroupCall,
        iceServers,
      })
    )
  );

  const totalResults = results.reduce((acc, r) => ({
    total: acc.total + r.total,
    successful: acc.successful + r.successful,
    failed: acc.failed + r.failed,
    results: [...acc.results, ...r.results],
    invalidTokens: [...acc.invalidTokens, ...r.invalidTokens],
  }), {
    total: 0,
    successful: 0,
    failed: 0,
    results: [] as any[],
    invalidTokens: [] as string[],
  });

  return c.json({
    success: true,
    data: {
      callId: data.callId,
      calleesCount: data.calleeIds.length,
      result: totalResults,
    },
  });
});

// POST /v1/callkit/call-event - Called when call state changes (accepted, declined, missed, ended, failed)
callkitRouter.post("/call-event", zValidator("json", z.object({
  callId: z.string().uuid(),
  roomId: z.string().optional(),
  calleeId: z.string().uuid(),
  callerId: z.string().uuid(),
  eventType: z.enum(["accepted", "declined", "missed", "ended", "failed"]),
  metadata: z.record(z.any()).optional(),
})), async (c) => {
  const data = c.req.valid("json");

  // Map event type to CallKitEventType format
  const eventTypeMap: Record<string, "incoming_call" | "call_accepted" | "call_declined" | "call_missed" | "call_ended" | "call_failed"> = {
    accepted: "call_accepted",
    declined: "call_declined",
    missed: "call_missed",
    ended: "call_ended",
    failed: "call_failed",
  };

  const event = {
    type: eventTypeMap[data.eventType],
    callId: data.callId,
    roomId: data.roomId,
    calleeId: data.calleeId,
    callerId: data.callerId,
    timestamp: new Date(),
    metadata: data.metadata,
  };

  const result = await voipPushService.sendCallUpdatePush(data.calleeId, event);

  return c.json({
    success: true,
    data: {
      eventType: data.eventType,
      callId: data.callId,
      result: {
        total: result.total,
        successful: result.successful,
        failed: result.failed,
        invalidTokens: result.invalidTokens.length,
      },
    },
  });
});

// ============================================================================
// VoIP Push Service Stats & Management
// ============================================================================

// GET /v1/callkit/stats - Get VoIP push service stats
callkitRouter.get("/stats", async (c) => {
  const user = getCurrentUser(c);

  const stats = await voipPushService.getStats();

  // Also get user-specific stats
  const userTokens = await db
    .select({
      platform: schema.deviceTokens.platform,
      count: sql<number>`count(*)`,
      hasVoip: sql<number>`count(*) filter (where voip_token IS NOT NULL)`,
    })
    .from(schema.deviceTokens)
    .where(and(
      eq(schema.deviceTokens.userId, user.id),
      eq(schema.deviceTokens.isActive, true)
    ))
    .groupBy(schema.deviceTokens.platform);

  return c.json({
    success: true,
    data: {
      service: stats,
      user: {
        tokensByPlatform: userTokens.reduce((acc, t) => {
          acc[t.platform] = { total: t.count, voip: t.hasVoip };
          return acc;
        }, {} as Record<string, { total: number; voip: number }>),
      },
    },
  });
});

// POST /v1/callkit/cleanup - Cleanup expired device tokens (internal cron endpoint)
callkitRouter.post("/cleanup", async (c) => {
  // Verify internal secret for cron job
  const auth = c.req.header("Authorization");
  const internalSecret = process.env.INTERNAL_CRON_SECRET || "dev-secret-change-in-production";

  if (!auth || auth !== `Bearer ${internalSecret}`) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const cleaned = await voipPushService.cleanupDeviceTokens();

  return c.json({
    success: true,
    data: {
      cleanedTokens: cleaned,
    },
  });
});

export { callkitRouter };