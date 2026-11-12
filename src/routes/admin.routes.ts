import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { authMiddleware, getCurrentUser } from "../middleware/auth";
import { requireAdmin, requireModerator, requireSuperAdmin, optionalAdmin, isAdmin, isModerator } from "../middleware/admin";
import { getAdminService } from "../services/admin-service";
import { getModerationService } from "../services/moderation-service";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, desc, count, sql, gte, lt, lte, inArray, isNull, or } from "drizzle-orm";

const adminRouter = new Hono();

// Apply auth middleware to all admin routes
adminRouter.use("*", authMiddleware);

// ============================================================================
// Validation Schemas
// ============================================================================

const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  perPage: z.coerce.number().min(1).max(100).default(20),
});

const userManagementQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  perPage: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.enum(["active", "banned", "shadowbanned", "verified", "unverified"]).optional(),
  sortBy: z.enum(["createdAt", "username", "followersCount", "postsCount", "lastLoginAt"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

const moderationActionSchema = z.object({
  action: z.enum(["warn", "suspend", "ban", "shadowban", "feature_restrict", "restore"]),
  reason: z.string().min(1).max(1000),
  duration: z.string().optional(), // e.g., "7d", "30d", "permanent"
});

const reportActionSchema = z.object({
  action: z.enum(["WARN", "CONTENT_REMOVE", "CONTENT_HIDE", "ACCOUNT_SUSPEND", "ACCOUNT_BAN", "FEATURE_RESTRICT", "SHADOWBAN", "RESTORE"]),
  reason: z.string().min(1).max(1000),
  duration: z.string().optional(),
});

const reportQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  perPage: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(["PENDING", "REVIEWING", "RESOLVED", "DISMISSED"]).optional(),
  type: z.enum(["USER", "POST", "REEL", "STORY", "COMMENT", "MESSAGE", "AUDIO"]).optional(),
  reason: z.enum(["SPAM", "HATE_SPEECH", "HARASSMENT", "VIOLENCE", "NUDITY", "SELF_HARM", "MISINFORMATION", "SCAM", "IMPERSONATION", "COPYRIGHT", "OTHER"]).optional(),
  sortBy: z.enum(["createdAt", "priority"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

const analyticsQuerySchema = z.object({
  metric: z.enum(["dau", "wau", "mau", "retention", "engagement", "content", "growth"]),
  startDate: z.string().transform((val) => new Date(val)),
  endDate: z.string().transform((val) => new Date(val)),
  granularity: z.enum(["hour", "day", "week", "month"]).optional(),
});

const auditLogQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  perPage: z.coerce.number().min(1).max(100).default(20),
  actorId: z.string().uuid().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  startDate: z.string().transform((val) => new Date(val)).optional(),
  endDate: z.string().transform((val) => new Date(val)).optional(),
});

const featureFlagSchema = z.object({
  key: z.string().min(1).max(100),
  enabled: z.boolean(),
  description: z.string().max(500).optional(),
  rolloutPercentage: z.number().min(0).max(100).optional(),
  targetUsers: z.array(z.string().uuid()).optional(),
  targetRoles: z.array(z.string()).optional(),
});

// ============================================================================
// Admin Dashboard - Platform Stats
// ============================================================================

// GET /v1/admin/stats - Platform overview statistics
adminRouter.get("/stats", requireModerator, async (c) => {
  const adminService = getAdminService();
  const stats = await adminService.getPlatformStats();
  return c.json({ success: true, data: stats });
});

// ============================================================================
// User Management
// ============================================================================

// GET /v1/admin/users - List users with filters
adminRouter.get("/users", requireModerator, zValidator("query", userManagementQuerySchema), async (c) => {
  const params = c.req.valid("query");
  const adminService = getAdminService();
  const result = await adminService.getUsers(params);
  return c.json({ success: true, data: result });
});

// GET /v1/admin/users/:id - Get user details
adminRouter.get("/users/:id", requireModerator, async (c) => {
  const userId = c.req.param("id");
  const adminService = getAdminService();
  const user = await adminService.getUserById(userId);

  if (!user) {
    throw new HTTPException(404, { message: "User not found" });
  }

  return c.json({ success: true, data: { user } });
});

// POST /v1/admin/users/:id/action - Apply moderation action on user
adminRouter.post("/users/:id/action", requireModerator, zValidator("json", moderationActionSchema), async (c) => {
  const userId = c.req.param("id");
  const { action, reason, duration } = c.req.valid("json");
  const moderator = getCurrentUser(c);

  const adminService = getAdminService();
  const result = await adminService.applyModerationAction({
    targetUserId: userId,
    action,
    reason,
    duration,
    moderatorId: moderator.id,
  });

  return c.json({ success: true, data: result });
});

// ============================================================================
// Reports & Moderation
// ============================================================================

// GET /v1/admin/reports - Get reports queue
adminRouter.get("/reports", requireModerator, zValidator("query", reportQuerySchema), async (c) => {
  const params = c.req.valid("query");
  const moderationService = getModerationService();
  const result = await moderationService.getReportsQueue(params);
  return c.json({ success: true, data: result });
});

// GET /v1/admin/reports/stats - Get moderation statistics
adminRouter.get("/reports/stats", requireModerator, async (c) => {
  const moderationService = getModerationService();
  const stats = await moderationService.getModerationStats();
  return c.json({ success: true, data: stats });
});

// GET /v1/admin/reports/:id - Get report details
adminRouter.get("/reports/:id", requireModerator, async (c) => {
  const reportId = c.req.param("id");
  const moderationService = getModerationService();
  const report = await moderationService.getReportById(reportId);

  if (!report) {
    throw new HTTPException(404, { message: "Report not found" });
  }

  return c.json({ success: true, data: { report } });
});

// POST /v1/admin/reports/:id/action - Take action on report
adminRouter.post("/reports/:id/action", requireModerator, zValidator("json", reportActionSchema), async (c) => {
  const reportId = c.req.param("id");
  const { action, reason, duration } = c.req.valid("json");
  const moderator = getCurrentUser(c);

  const moderationService = getModerationService();
  const result = await moderationService.takeAction({
    reportId,
    moderatorId: moderator.id,
    action,
    reason,
    duration,
  });

  return c.json({ success: true, data: result });
});

// POST /v1/admin/reports/:id/dismiss - Dismiss report
adminRouter.post("/reports/:id/dismiss", requireModerator, zValidator("json", z.object({ reason: z.string().min(1).max(1000) })), async (c) => {
  const reportId = c.req.param("id");
  const { reason } = c.req.valid("json");
  const moderator = getCurrentUser(c);

  const moderationService = getModerationService();
  await moderationService.dismissReport(reportId, moderator.id, reason);

  return c.json({ success: true, data: { message: "Report dismissed" } });
});

// POST /v1/admin/reports/:id/review - Start reviewing report
adminRouter.post("/reports/:id/review", requireModerator, async (c) => {
  const reportId = c.req.param("id");
  const moderator = getCurrentUser(c);

  const moderationService = getModerationService();
  await moderationService.startReview(reportId, moderator.id);

  return c.json({ success: true, data: { message: "Report marked as reviewing" } });
});

// GET /v1/admin/reports/:id/history - Get moderation history for reported content
adminRouter.get("/reports/:id/history", requireModerator, async (c) => {
  const reportId = c.req.param("id");
  const moderationService = getModerationService();
  const report = await moderationService.getReportById(reportId);

  if (!report) {
    throw new HTTPException(404, { message: "Report not found" });
  }

  const history = await moderationService.getModerationHistory(report.reportedType.toLowerCase(), report.reportedId);
  return c.json({ success: true, data: { history } });
});

// ============================================================================
// Analytics
// ============================================================================

// GET /v1/admin/analytics - Get analytics data
adminRouter.get("/analytics", requireAdmin, zValidator("query", analyticsQuerySchema), async (c) => {
  const params = c.req.valid("query");
  const adminService = getAdminService();
  const data = await adminService.getAnalytics(params);
  return c.json({ success: true, data: { items: data } });
});

// ============================================================================
// Audit Logs
// ============================================================================

// GET /v1/admin/audit-logs - Get audit logs
adminRouter.get("/audit-logs", requireAdmin, zValidator("query", auditLogQuerySchema), async (c) => {
  const params = c.req.valid("query");
  const adminService = getAdminService();
  const result = await adminService.getAuditLogs(params);
  return c.json({ success: true, data: result });
});

// ============================================================================
// Feature Flags / Config Management
// ============================================================================

// Feature flags are stored in a key-value config table
// We'll use a simple in-memory store with database persistence

interface FeatureFlag {
  key: string;
  enabled: boolean;
  description?: string;
  rolloutPercentage?: number;
  targetUsers?: string[];
  targetRoles?: string[];
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

// In-memory cache (in production, use Redis or database)
const featureFlagsCache = new Map<string, FeatureFlag>();

// Initialize cache from database on startup
async function loadFeatureFlags(): Promise<void> {
  // In a real implementation, you'd load from a feature_flags table
  // For now, we'll use some defaults
  const defaults: FeatureFlag[] = [
    {
      key: "reels_enabled",
      enabled: true,
      description: "Enable Reels feature",
      rolloutPercentage: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "system",
    },
    {
      key: "stories_enabled",
      enabled: true,
      description: "Enable Stories feature",
      rolloutPercentage: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "system",
    },
    {
      key: "calls_enabled",
      enabled: true,
      description: "Enable voice/video calls",
      rolloutPercentage: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "system",
    },
    {
      key: "live_streaming_enabled",
      enabled: false,
      description: "Enable live streaming",
      rolloutPercentage: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "system",
    },
    {
      key: "shopping_enabled",
      enabled: false,
      description: "Enable shopping features",
      rolloutPercentage: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "system",
    },
    {
      key: "ai_moderation_enabled",
      enabled: true,
      description: "Enable AI-powered content moderation",
      rolloutPercentage: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "system",
    },
    {
      key: "new_explore_algorithm",
      enabled: false,
      description: "New explore feed algorithm",
      rolloutPercentage: 10,
      targetRoles: ["beta_tester"],
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "system",
    },
  ];

  for (const flag of defaults) {
    featureFlagsCache.set(flag.key, flag);
  }
}

// Load on module initialization
loadFeatureFlags().catch(console.error);

// GET /v1/admin/feature-flags - List all feature flags
adminRouter.get("/feature-flags", requireAdmin, async (c) => {
  const flags = Array.from(featureFlagsCache.values());
  return c.json({ success: true, data: { flags } });
});

// GET /v1/admin/feature-flags/:key - Get single feature flag
adminRouter.get("/feature-flags/:key", requireAdmin, async (c) => {
  const key = c.req.param("key");
  const flag = featureFlagsCache.get(key);

  if (!flag) {
    throw new HTTPException(404, { message: "Feature flag not found" });
  }

  return c.json({ success: true, data: { flag } });
});

// POST /v1/admin/feature-flags - Create/update feature flag
adminRouter.post("/feature-flags", requireAdmin, zValidator("json", featureFlagSchema), async (c) => {
  const { key, enabled, description, rolloutPercentage, targetUsers, targetRoles } = c.req.valid("json");
  const moderator = getCurrentUser(c);

  const now = new Date();
  const existing = featureFlagsCache.get(key);

  const flag: FeatureFlag = {
    key,
    enabled,
    description,
    rolloutPercentage,
    targetUsers,
    targetRoles,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    createdBy: existing?.createdBy || moderator.id,
  };

  featureFlagsCache.set(key, flag);

  // Log audit
  const adminService = getAdminService();
  await adminService.logAudit({
    actorId: moderator.id,
    action: existing ? "feature_flag.update" : "feature_flag.create",
    resourceType: "feature_flag",
    resourceId: key,
    oldValues: existing as Record<string, any> | undefined,
    newValues: flag as Record<string, any>,
  });

  return c.json({ success: true, data: { flag } }, existing ? 200 : 201);
});

// DELETE /v1/admin/feature-flags/:key - Delete feature flag
adminRouter.delete("/feature-flags/:key", requireAdmin, async (c) => {
  const key = c.req.param("key");
  const moderator = getCurrentUser(c);

  const existing = featureFlagsCache.get(key);
  if (!existing) {
    throw new HTTPException(404, { message: "Feature flag not found" });
  }

  featureFlagsCache.delete(key);

  // Log audit
  const adminService = getAdminService();
  await adminService.logAudit({
    actorId: moderator.id,
    action: "feature_flag.delete",
    resourceType: "feature_flag",
    resourceId: key,
    oldValues: existing as Record<string, any> | undefined,
  });

  return c.json({ success: true, data: { message: "Feature flag deleted" } });
});

// POST /v1/admin/feature-flags/:key/toggle - Toggle feature flag
adminRouter.post("/feature-flags/:key/toggle", requireAdmin, async (c) => {
  const key = c.req.param("key");
  const moderator = getCurrentUser(c);

  const existing = featureFlagsCache.get(key);
  if (!existing) {
    throw new HTTPException(404, { message: "Feature flag not found" });
  }

  const updated: FeatureFlag = {
    ...existing,
    enabled: !existing.enabled,
    updatedAt: new Date(),
  };

  featureFlagsCache.set(key, updated);

  // Log audit
  const adminService = getAdminService();
  await adminService.logAudit({
    actorId: moderator.id,
    action: "feature_flag.toggle",
    resourceType: "feature_flag",
    resourceId: key,
    oldValues: existing as Record<string, any> | undefined,
    newValues: updated as Record<string, any>,
  });

  return c.json({ success: true, data: { flag: updated } });
});

// ============================================================================
// System Health & Maintenance
// ============================================================================

// GET /v1/admin/health - System health check (detailed)
adminRouter.get("/health", requireAdmin, async (c) => {
  const now = new Date();
  const dbStart = Date.now();

  try {
    await db.execute(sql`SELECT 1`);
    const dbLatency = Date.now() - dbStart;

    // Check table sizes
    const tableSizes = await db.execute(sql`
      SELECT
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
        pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
      LIMIT 20
    `);

    // Check active connections
    const connections = await db.execute(sql`
      SELECT count(*) as count, state
      FROM pg_stat_activity
      WHERE datname = current_database()
      GROUP BY state
    `);

    // Check replication lag (if replica)
    const replication = await db.execute(sql`
      SELECT * FROM pg_stat_replication
    `).catch(() => ({ rows: [] }));

    return c.json({
      success: true,
      data: {
        status: "healthy",
        timestamp: now.toISOString(),
        database: {
          latency: dbLatency,
          tables: tableSizes.rows,
          connections: connections.rows,
          replication: replication.rows,
        },
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.version,
      },
    });
  } catch (error) {
    return c.json({
      success: false,
      data: {
        status: "unhealthy",
        timestamp: now.toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      },
    }, 503);
  }
});

// POST /v1/admin/maintenance/cleanup - Trigger cleanup jobs
adminRouter.post("/maintenance/cleanup", requireSuperAdmin, zValidator("json", z.object({
  type: z.enum(["expired_stories", "expired_sessions", "old_audit_logs", "pending_uploads", "device_tokens"]),
  olderThanDays: z.number().min(1).optional(),
})), async (c) => {
  const { type, olderThanDays = 30 } = c.req.valid("json");
  const moderator = getCurrentUser(c);
  const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  let deletedCount = 0;

  switch (type) {
    case "expired_stories":
      const storiesResult = await db
        .delete(schema.stories)
        .where(and(lt(schema.stories.expiresAt, new Date()), isNull(schema.stories.deletedAt)));
      deletedCount = storiesResult.rowCount || 0;
      break;

    case "expired_sessions":
      const sessionsResult = await db
        .delete(schema.sessions)
        .where(lt(schema.sessions.expiresAt, new Date()));
      deletedCount = sessionsResult.rowCount || 0;
      break;

    case "old_audit_logs":
      const auditResult = await db
        .delete(schema.auditLogs)
        .where(lt(schema.auditLogs.createdAt, cutoffDate));
      deletedCount = auditResult.rowCount || 0;
      break;

    case "pending_uploads":
      const uploadsResult = await db
        .delete(schema.pendingUploads)
        .where(and(eq(schema.pendingUploads.confirmed, false), lt(schema.pendingUploads.createdAt, cutoffDate)));
      deletedCount = uploadsResult.rowCount || 0;
      break;

    case "device_tokens":
      const tokensResult = await db
        .delete(schema.deviceTokens)
        .where(and(lt(schema.deviceTokens.expiresAt, new Date()), eq(schema.deviceTokens.isActive, false)));
      deletedCount = tokensResult.rowCount || 0;
      break;
  }

  // Log audit
  const adminService = getAdminService();
  await adminService.logAudit({
    actorId: moderator.id,
    action: `maintenance.cleanup.${type}`,
    resourceType: "system",
    newValues: { type, olderThanDays, deletedCount },
  });

  return c.json({ success: true, data: { type, deletedCount, cutoffDate } });
});

// ============================================================================
// Configuration
// ============================================================================

// GET /v1/admin/config - Get system configuration
adminRouter.get("/config", requireSuperAdmin, async (c) => {
  // Return non-sensitive configuration
  const config = {
    environment: process.env.NODE_ENV,
    apiVersion: "v1",
    rateLimits: {
      anonymous: "60/min",
      authenticated: "300/min",
      admin: "1000/min",
      authEndpoints: "10/15min",
      uploadEndpoints: "50/hour",
      searchEndpoints: "30/min",
    },
    features: Object.fromEntries(
      Array.from(featureFlagsCache.entries()).map(([key, flag]) => [key, flag.enabled])
    ),
    limits: {
      maxFileSize: "100MB",
      maxVideoDuration: "60s",
      maxReelDuration: "90s",
      maxStoryDuration: "15s",
      maxCaptionLength: 2200,
      maxBioLength: 150,
      maxUsernameLength: 30,
    },
  };

  return c.json({ success: true, data: { config } });
});

// ============================================================================
// Export
// ============================================================================

export { adminRouter };