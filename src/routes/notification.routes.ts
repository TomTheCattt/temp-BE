import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware, getCurrentUser } from "../middleware/auth";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, desc, count, sql, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { notificationDeliveryJob } from "../jobs/notification-delivery.job.js";
import { pushNotificationService } from "../services/push-notification-service.js";
import { notificationTypeEnum } from "../db/schema.js";

type NotificationType = (typeof notificationTypeEnum.enumValues)[number];

function getPagination(c: any) {
  const page = Number(c.req.query("page")) || 1;
  const perPage = Math.min(Number(c.req.query("perPage")) || 20, 50);
  return { page, perPage, offset: (page - 1) * perPage };
}

// Validation schemas
const markReadSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

const preferencesSchema = z.object({
  // Global push settings
  pushEnabled: z.boolean().optional(),
  // Per-type preferences
  like: z.boolean().optional(),
  comment: z.boolean().optional(),
  follow: z.boolean().optional(),
  followRequest: z.boolean().optional(),
  followAccept: z.boolean().optional(),
  mention: z.boolean().optional(),
  taggedInPost: z.boolean().optional(),
  taggedInComment: z.boolean().optional(),
  taggedInStory: z.boolean().optional(),
  storyMention: z.boolean().optional(),
  storyReply: z.boolean().optional(),
  reelLike: z.boolean().optional(),
  reelComment: z.boolean().optional(),
  liveVideo: z.boolean().optional(),
  liveJoin: z.boolean().optional(),
  dmMessage: z.boolean().optional(),
  dmReaction: z.boolean().optional(),
  postReminder: z.boolean().optional(),
  achievement: z.boolean().optional(),
  securityAlert: z.boolean().optional(),
  featureAnnouncement: z.boolean().optional(),
  // Per-conversation preferences (conversationId -> muted)
  conversationMutes: z.record(z.string(), z.boolean()).optional(),
  // Digest preferences
  dailyDigest: z.boolean().optional(),
  weeklyDigest: z.boolean().optional(),
  // Quiet hours
  quietHoursEnabled: z.boolean().optional(),
  quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(), // HH:MM
  quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  // Critical alerts (always on, but can configure channels)
  criticalAlertsPush: z.boolean().optional(),
  criticalAlertsEmail: z.boolean().optional(),
});

const deviceTokenSchema = z.object({
  token: z.string().min(1).max(500),
  platform: z.enum(["IOS", "ANDROID", "WEB"]),
  deviceId: z.string().max(200).optional(),
  appVersion: z.string().max(20).optional(),
  osVersion: z.string().max(20).optional(),
  voipToken: z.string().max(500).optional(),
  sandbox: z.boolean().optional(),
  topics: z.array(z.string()).optional(),
});

const updateDeviceTokenSchema = z.object({
  token: z.string().min(1).max(500).optional(),
  isActive: z.boolean().optional(),
  topics: z.array(z.string()).optional(),
  lastUsedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
}).transform(data => ({
  ...data,
  lastUsedAt: data.lastUsedAt ? new Date(data.lastUsedAt) : undefined,
  expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
}));

const notificationRouter = new Hono();
notificationRouter.use("*", authMiddleware);

// GET /v1/notifications - List notifications (grouped)
notificationRouter.get("/", async (c) => {
  const user = getCurrentUser(c);
  const { page, perPage, offset } = getPagination(c);

  // Get grouped notifications (latest per group)
  const notificationsList = await db
    .select({
      id: schema.notifications.id,
      recipientId: schema.notifications.recipientId,
      actorId: schema.notifications.actorId,
      type: schema.notifications.type,
      referenceType: schema.notifications.referenceType,
      referenceId: schema.notifications.referenceId,
      previewText: schema.notifications.previewText,
      thumbnailUrl: schema.notifications.thumbnailUrl,
      deepLink: schema.notifications.deepLink,
      groupKey: schema.notifications.groupKey,
      groupCount: schema.notifications.groupCount,
      isRead: schema.notifications.isRead,
      readAt: schema.notifications.readAt,
      createdAt: schema.notifications.createdAt,
      actor: {
        id: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        avatarUrl: schema.users.avatarUrl,
        isVerified: schema.users.isVerified,
      },
    })
    .from(schema.notifications)
    .innerJoin(schema.users, eq(schema.users.id, schema.notifications.actorId))
    .where(eq(schema.notifications.recipientId, user.id))
    .limit(perPage)
    .offset(offset)
    .orderBy(desc(schema.notifications.createdAt));

  const totalResult = await db
    .select({ count: count() })
    .from(schema.notifications)
    .where(eq(schema.notifications.recipientId, user.id));

  return c.json({
    success: true,
    data: {
      items: notificationsList,
      page,
      perPage,
      total: totalResult[0]?.count || 0,
      hasMore: page * perPage < (totalResult[0]?.count || 0),
    },
  });
});

// GET /v1/notifications/unread-count - Get unread count
notificationRouter.get("/unread-count", async (c) => {
  const user = getCurrentUser(c);

  const result = await db
    .select({ count: count() })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.recipientId, user.id), eq(schema.notifications.isRead, false)));

  return c.json({
    success: true,
    data: { count: result[0]?.count || 0 },
  });
});

// POST /v1/notifications/read-all - Mark all as read
notificationRouter.post("/read-all", async (c) => {
  const user = getCurrentUser(c);

  await db
    .update(schema.notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(schema.notifications.recipientId, user.id), eq(schema.notifications.isRead, false)));

  return c.status(204);
});

// POST /v1/notifications/mark-read - Mark multiple as read
notificationRouter.post("/mark-read", zValidator("json", markReadSchema), async (c) => {
  const user = getCurrentUser(c);
  const { ids } = c.req.valid("json");

  await db
    .update(schema.notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(
      eq(schema.notifications.recipientId, user.id),
      inArray(schema.notifications.id, ids)
    ));

  return c.status(204);
});

// POST /v1/notifications/:id/read - Mark one as read
notificationRouter.post("/:id/read", async (c) => {
  const user = getCurrentUser(c);
  const notificationId = c.req.param("id");

  const notification = await db.query.notifications.findFirst({
    where: eq(schema.notifications.id, notificationId),
  });

  if (!notification) {
    throw new HTTPException(404, { message: "Notification not found" });
  }

  if (notification.recipientId !== user.id) {
    throw new HTTPException(403, { message: "Not authorized" });
  }

  await db
    .update(schema.notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(eq(schema.notifications.id, notificationId));

  return c.status(204);
});

// DELETE /v1/notifications/:id - Dismiss notification
notificationRouter.delete("/:id", async (c) => {
  const user = getCurrentUser(c);
  const notificationId = c.req.param("id");

  const notification = await db.query.notifications.findFirst({
    where: eq(schema.notifications.id, notificationId),
  });

  if (!notification) {
    throw new HTTPException(404, { message: "Notification not found" });
  }

  if (notification.recipientId !== user.id) {
    throw new HTTPException(403, { message: "Not authorized" });
  }

  await db
    .delete(schema.notifications)
    .where(eq(schema.notifications.id, notificationId));

  return c.status(204);
});

// ============================================================
// NOTIFICATION PREFERENCES
// ============================================================

// GET /v1/notifications/preferences - Get notification preferences
notificationRouter.get("/preferences", async (c) => {
  const user = getCurrentUser(c);

  // Get preferences from user settings JSONB
  const userSettings = await db.query.users.findFirst({
    where: eq(schema.users.id, user.id),
    columns: { settings: true },
  });

  const settings = (userSettings?.settings as Record<string, any>) || {};
  const notificationPrefs = (settings.notifications as Record<string, any>) || {};

  // Default preferences
  const defaults = {
    pushEnabled: true,
    like: true,
    comment: true,
    follow: true,
    followRequest: true,
    followAccept: true,
    mention: true,
    taggedInPost: true,
    taggedInComment: true,
    taggedInStory: true,
    storyMention: true,
    storyReply: true,
    reelLike: true,
    reelComment: true,
    liveVideo: true,
    liveJoin: true,
    dmMessage: true,
    dmReaction: true,
    postReminder: false,
    achievement: true,
    securityAlert: true,
    featureAnnouncement: true,
    conversationMutes: {},
    dailyDigest: false,
    weeklyDigest: false,
    quietHoursEnabled: false,
    quietHoursStart: "22:00",
    quietHoursEnd: "08:00",
    criticalAlertsPush: true,
    criticalAlertsEmail: true,
  };

  return c.json({
    success: true,
    data: { ...defaults, ...notificationPrefs },
  });
});

// PATCH /v1/notifications/preferences - Update notification preferences
notificationRouter.patch("/preferences", zValidator("json", preferencesSchema), async (c) => {
  const user = getCurrentUser(c);
  const prefs = c.req.valid("json");

  // Get current settings
  const userSettings = await db.query.users.findFirst({
    where: eq(schema.users.id, user.id),
    columns: { settings: true },
  });

  const settings = (userSettings?.settings as Record<string, any>) || {};
  const currentPrefs = (settings.notifications as Record<string, any>) || {};

  // Merge preferences
  const mergedPrefs = { ...currentPrefs, ...prefs };

  // Update user settings
  await db
    .update(schema.users)
    .set({
      settings: {
        ...settings,
        notifications: mergedPrefs,
      },
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, user.id));

  return c.json({
    success: true,
    data: mergedPrefs,
  });
});

// GET /v1/notifications/preferences/:conversationId - Get conversation-specific preferences
notificationRouter.get("/preferences/:conversationId", async (c) => {
  const user = getCurrentUser(c);
  const conversationId = c.req.param("conversationId");

  // Verify user is member of conversation
  const membership = await db.query.conversationMembers.findFirst({
    where: and(
      eq(schema.conversationMembers.conversationId, conversationId),
      eq(schema.conversationMembers.userId, user.id)
    ),
  });

  if (!membership) {
    throw new HTTPException(403, { message: "Not a member of this conversation" });
  }

  return c.json({
    success: true,
    data: {
      isMuted: membership.isMuted,
      lastReadAt: membership.lastReadAt,
      lastDeliveredAt: membership.lastDeliveredAt,
    },
  });
});

// PATCH /v1/notifications/preferences/:conversationId - Update conversation preferences
notificationRouter.patch("/preferences/:conversationId", zValidator("json", z.object({
  isMuted: z.boolean().optional(),
})), async (c) => {
  const user = getCurrentUser(c);
  const conversationId = c.req.param("conversationId");
  const { isMuted } = c.req.valid("json");

  // Verify user is member of conversation
  const membership = await db.query.conversationMembers.findFirst({
    where: and(
      eq(schema.conversationMembers.conversationId, conversationId),
      eq(schema.conversationMembers.userId, user.id)
    ),
  });

  if (!membership) {
    throw new HTTPException(403, { message: "Not a member of this conversation" });
  }

  if (isMuted !== undefined) {
    await db
      .update(schema.conversationMembers)
      .set({ isMuted })
      .where(eq(schema.conversationMembers.id, membership.id));
  }

  return c.json({
    success: true,
    data: { isMuted: isMuted ?? membership.isMuted },
  });
});

// ============================================================
// DEVICE TOKEN MANAGEMENT
// ============================================================

// POST /v1/notifications/device-tokens - Register device token
notificationRouter.post("/device-tokens", zValidator("json", deviceTokenSchema), async (c) => {
  const user = getCurrentUser(c);
  const data = c.req.valid("json");

  const token = await pushNotificationService.registerDeviceToken(user.id, data.token, data.platform, {
    deviceId: data.deviceId,
    appVersion: data.appVersion,
    osVersion: data.osVersion,
    voipToken: data.voipToken,
    sandbox: data.sandbox,
    topics: data.topics,
  });

  return c.json({
    success: true,
    data: token,
  });
});

// GET /v1/notifications/device-tokens - List user's device tokens
notificationRouter.get("/device-tokens", async (c) => {
  const user = getCurrentUser(c);

  const tokens = await pushNotificationService.getUserDeviceTokens(user.id);

  // Don't return actual tokens for security
  const safeTokens = tokens.map(t => ({
    id: t.id,
    platform: t.platform,
    deviceId: t.deviceId,
    appVersion: t.appVersion,
    osVersion: t.osVersion,
    sandbox: t.sandbox,
    topics: t.topics,
    lastUsedAt: t.lastUsedAt,
    expiresAt: t.expiresAt,
    isActive: t.isActive,
    createdAt: t.createdAt,
  }));

  return c.json({
    success: true,
    data: { items: safeTokens },
  });
});

// PATCH /v1/notifications/device-tokens/:token - Update device token
notificationRouter.patch("/device-tokens/:token", zValidator("json", updateDeviceTokenSchema), async (c) => {
  const user = getCurrentUser(c);
  const token = c.req.param("token");
  const updates = c.req.valid("json");

  // Verify token belongs to user
  const existing = await db.query.deviceTokens.findFirst({
    where: and(
      eq(schema.deviceTokens.token, token),
      eq(schema.deviceTokens.userId, user.id)
    ),
  });

  if (!existing) {
    throw new HTTPException(404, { message: "Device token not found" });
  }

  const updated = await pushNotificationService.updateDeviceToken(token, updates);

  if (!updated) {
    throw new HTTPException(404, { message: "Device token not found" });
  }

  // Don't return actual token
  const { token: _, ...safeToken } = updated;
  return c.json({
    success: true,
    data: safeToken,
  });
});

// DELETE /v1/notifications/device-tokens/:token - Remove device token
notificationRouter.delete("/device-tokens/:token", async (c) => {
  const user = getCurrentUser(c);
  const token = c.req.param("token");

  const existing = await db.query.deviceTokens.findFirst({
    where: and(
      eq(schema.deviceTokens.token, token),
      eq(schema.deviceTokens.userId, user.id)
    ),
  });

  if (!existing) {
    throw new HTTPException(404, { message: "Device token not found" });
  }

  await pushNotificationService.updateDeviceToken(token, { isActive: false });

  return c.status(204);
});

// ============================================================
// TEST ENDPOINTS (Development only)
// ============================================================

// POST /v1/notifications/test - Send test notification
notificationRouter.post("/test", zValidator("json", z.object({
  type: z.enum(notificationTypeEnum.enumValues).default("LIKE"),
  title: z.string().optional(),
  body: z.string().optional(),
})), async (c) => {
  const user = getCurrentUser(c);
  const { type, title, body } = c.req.valid("json");

  // Only allow in development
  if (process.env.NODE_ENV === "production") {
    throw new HTTPException(403, { message: "Not available in production" });
  }

  const jobId = await notificationDeliveryJob.queueNotification({
    notificationId: `test-${Date.now()}`,
    recipientId: user.id,
    actorId: user.id,
    type,
    referenceType: "test",
    referenceId: `test-${Date.now()}`,
    actorName: user.fullName || user.username,
    actorUsername: user.username,
    actorAvatarUrl: user.avatarUrl ?? undefined,
    actorIsVerified: user.isVerified,
    alertDetails: body,
  });

  return c.json({
    success: true,
    data: { jobId, message: "Test notification queued" },
  });
});

// GET /v1/notifications/stats - Get notification stats (admin)
notificationRouter.get("/stats", async (c) => {
  const user = getCurrentUser(c);

  // Check if admin (in real app, use proper admin check)
  const settings = (user.settings as Record<string, any>) || {};
  const isAdmin = settings.isAdmin === true;
  if (!isAdmin) {
    throw new HTTPException(403, { message: "Admin access required" });
  }

  const pushStats = await pushNotificationService.getStats();
  const jobStatuses = notificationDeliveryJob.getAllJobStatuses();

  return c.json({
    success: true,
    data: {
      push: pushStats,
      jobs: jobStatuses.slice(0, 10),
    },
  });
});

export { notificationRouter };