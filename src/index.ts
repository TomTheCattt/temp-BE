import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { HTTPException } from "hono/http-exception";
import { randomUUID } from "crypto";

// Sentry for error tracking (optional - requires SENTRY_DSN)
let sentryInit: (() => void) | null = null;

// Extend Hono's ContextVariableMap for custom context variables
declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
    user: typeof import("./db/schema").users.$inferSelect;
    session: { userId: string; sessionId: string };
    traceInfo: import("./middleware/telemetry").RequestTraceInfo;
    otelSpan: any;
    logger: ReturnType<typeof import("./services/logger").createChildLogger>;
    validatedBody: any;
    validatedQuery: any;
    validatedParams: any;
    validatedHeaders: any;
    rateLimit: any;
  }
}

// Load environment variables FIRST (before any other config)
import "./config/env";

// Import database client
import { db, pool } from "./db/client";

// Import schema
import * as schema from "./db/schema";
import { sql } from "drizzle-orm";

// Import routes
import { authRouter } from "./routes/auth.routes";
import { userRouter } from "./routes/user.routes";
import { postRouter } from "./routes/post.routes";
import { reelRouter } from "./routes/reel.routes";
import { storyRouter } from "./routes/story.routes";
import { conversationRouter } from "./routes/conversation.routes";
import { callRouter } from "./routes/call.routes";
import { callkitRouter } from "./routes/callkit.routes";
import { notificationRouter } from "./routes/notification.routes";
import { uploadRouter } from "./routes/upload.routes";
import { tusRouter } from "./routes/tus.routes";
import { reportRouter } from "./routes/report.routes";
import { mediaRouter } from "./routes/media.routes";
import { searchRoutes } from "./routes/search.routes";
import { adminRouter } from "./routes/admin.routes";
import { healthRouter } from "./routes/health.routes";

// Import services
import { pushNotificationService } from "./services/push-notification-service";
import { voipPushService } from "./services/voip-push-service";

// Import jobs
import { startFeedRefreshJob, stopFeedRefreshJob } from "./jobs/feed-refresh-job";
import { startStoryExpirationJob, stopStoryExpirationJob } from "./jobs/story-expiration-job";
import {
  startMediaTranscodingJob,
  stopMediaTranscodingJob,
  startThumbnailGenerationJob,
  stopThumbnailGenerationJob,
  startMediaCleanupJob,
  stopMediaCleanupJob,
} from "./jobs";
import { startTusProcessingJob, stopTusProcessingJob } from "./jobs/tus-processing-job";
import { notificationDeliveryJob } from "./jobs/notification-delivery.job";
import { startAnalyticsAggregationJob, stopAnalyticsAggregationJob } from "./jobs";

// Import middleware
import { telemetry } from "./middleware/telemetry";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import {
  anonymousRateLimit,
  authenticatedRateLimit,
  authEndpointsRateLimit,
  uploadEndpointsRateLimit,
  searchEndpointsRateLimit,
  adminRateLimit
} from "./middleware/rate-limit";
import { authMiddleware, optionalAuthMiddleware } from "./middleware/auth";
import {
  validateBody,
  validateQuery,
  validateParams,
  paginationQuerySchema,
  idParamSchema,
  usernameParamSchema,
  searchQuerySchema,
  commonHeadersSchema
} from "./middleware/validation";
import { idempotencyMiddleware } from "./middleware/idempotency";
import { authorize, checkAuthz, authzMiddleware } from "./middleware/policy-engine";

// Use validated env
import { env } from "./config/env";
const CORS_ORIGIN = env.CORS_ORIGIN.split(",").map((o) => o.trim());

// Initialize Sentry if DSN is provided
if (env.SENTRY_DSN) {
  try {
    const Sentry = require("@sentry/node");
    sentryInit = Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV || "development",
      tracesSampleRate: 0.1,
    });
  } catch {
    console.warn("Sentry not installed, skipping error tracking");
  }
}

// Create Hono app
const app = new Hono();

// ============================================================================
// Background Jobs
// ============================================================================
// Start feed refresh job (every 30 seconds)
if (env.NODE_ENV !== 'test') {
  startFeedRefreshJob();
  startStoryExpirationJob();

  // Media Pipeline Jobs (Phase 5)
  startMediaTranscodingJob();
  startThumbnailGenerationJob();
  startMediaCleanupJob();

  // TUS Processing Job (Phase 5 - Resumable Uploads)
  startTusProcessingJob();

  // Initialize Push Notification Service (Phase 8)
  pushNotificationService.initialize().catch(err => {
    console.error('[PushNotificationService] Failed to initialize:', err);
  });

  // Initialize VoIP Push Service (Phase 7 - CallKit)
  voipPushService.initialize().catch(err => {
    console.error('[VoIPPushService] Failed to initialize:', err);
  });

  // Notification Delivery Job (Phase 8 - Notifications)
  notificationDeliveryJob.startCleanupInterval();

  // Analytics Aggregation Job (Phase 10)
  startAnalyticsAggregationJob();

  // Graceful shutdown
  process.on('SIGTERM', () => {
    stopFeedRefreshJob();
    stopStoryExpirationJob();
    stopMediaTranscodingJob();
    stopThumbnailGenerationJob();
    stopMediaCleanupJob();
    stopTusProcessingJob();
    notificationDeliveryJob.stopCleanupInterval();
    stopAnalyticsAggregationJob();
  });
  process.on('SIGINT', () => {
    stopFeedRefreshJob();
    stopStoryExpirationJob();
    stopMediaTranscodingJob();
    stopThumbnailGenerationJob();
    stopMediaCleanupJob();
    stopTusProcessingJob();
    notificationDeliveryJob.stopCleanupInterval();
    stopAnalyticsAggregationJob();
  });
}

// ============================================================================
// Global Middleware (applied in order)
// ============================================================================

// 1. Security headers middleware
app.use("*", async (c, next) => {
  // CSP and security headers
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("X-XSS-Protection", "1; mode=block");
  c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  c.res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (env.NODE_ENV === "production") {
    c.res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
    c.res.headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    c.res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    c.res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  }

  await next();
});

// 2. Telemetry middleware (includes request ID, OpenTelemetry, logging, metrics)
app.use("*", telemetry);

// 3. Global middleware
app.use("*", logger());
app.use("*", prettyJSON());
app.use(
  "*",
  cors({
    origin: CORS_ORIGIN,
    allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Request-ID", "Traceparent", "Tracestate"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    credentials: true,
    maxAge: 86400,
  })
);

// 4. Rate limiting middleware
// Auth endpoints: stricter limits
app.use("/v1/auth/*", authEndpointsRateLimit);

// Upload endpoints: moderate limits
app.use("/v1/upload/*", uploadEndpointsRateLimit);

// Search endpoints
app.use("/v1/search*", searchEndpointsRateLimit);

// Admin endpoints
app.use("/v1/admin/*", adminRateLimit);

// API endpoints: tiered rate limiting based on auth (skip auth endpoints)
app.use("/v1/*", async (c, next) => {
  // Skip rate limiting for auth endpoints (handled by specific middleware)
  if (c.req.path.startsWith("/v1/auth/")) {
    return next();
  }
  const user = c.get("user");
  if (user) {
    return authenticatedRateLimit(c, next);
  } else {
    return anonymousRateLimit(c, next);
  }
});

// 5. Idempotency middleware for mutating endpoints
app.use("/v1/*", idempotencyMiddleware({
  required: false, // Don't require by default, endpoints can opt-in
  methods: ["POST", "PUT", "PATCH", "DELETE"],
}));

// ============================================================================
// Internal Cleanup Endpoints (called by Neon Functions cron triggers)
// ============================================================================

const INTERNAL_SECRET = env.INTERNAL_CRON_SECRET || "dev-secret-change-in-production";

function verifyInternalSecret(c: any) {
  const auth = c.req.header("Authorization");
  if (!auth || auth !== `Bearer ${INTERNAL_SECRET}`) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
}

// S3 client for cleanup (lazy initialization)
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
let s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: "auto",
      endpoint: env.NEON_STORAGE_ENDPOINT || "https://storage.neon.tech",
      credentials: {
        accessKeyId: env.NEON_STORAGE_ACCESS_KEY_ID || "",
        secretAccessKey: env.NEON_STORAGE_SECRET_ACCESS_KEY || "",
      },
    });
  }
  return s3Client;
}

// POST /internal/cleanup/pending-uploads - Clean up unconfirmed pending uploads older than 24h
app.post("/internal/cleanup/pending-uploads", async (c) => {
  verifyInternalSecret(c);

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Find unconfirmed pending uploads older than 24h
  const oldUploads = await db
    .select()
    .from(schema.pendingUploads)
    .where(and(eq(schema.pendingUploads.confirmed, false), lt(schema.pendingUploads.createdAt, cutoff)));

  // Delete from storage
  const client = getS3Client();
  for (const upload of oldUploads) {
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: "uploads",
          Key: upload.storagePath,
        })
      );
    } catch (err) {
      console.error(`[Cleanup] Failed to delete ${upload.storagePath}:`, err);
    }
  }

  // Delete from database
  await db
    .delete(schema.pendingUploads)
    .where(and(eq(schema.pendingUploads.confirmed, false), lt(schema.pendingUploads.createdAt, cutoff)));

  return c.json({ success: true, data: { deletedCount: oldUploads.length } });
});

// POST /internal/cleanup/device-tokens - Clean up expired device tokens
app.post("/internal/cleanup/device-tokens", async (c) => {
  verifyInternalSecret(c);

  const now = new Date();

  const result = await db
    .delete(schema.deviceTokens)
    .where(and(isNotNull(schema.deviceTokens.expiresAt), lt(schema.deviceTokens.expiresAt, now)));

  return c.json({ success: true, data: { deletedCount: result.rowCount || 0 } });
});

// Import missing functions
import { and, eq, lt, isNotNull } from "drizzle-orm";

// ============================================================================
// Mount Better Auth Handler
// ============================================================================

// Mount Better Auth handler at root level for standard auth endpoints
// This must be before the /v1/* rate limiter
import { auth } from "./config/auth";
app.on(["POST", "GET"], "/api/auth/*", async (c) => {
  return auth.handler(c.req.raw);
});

// ============================================================================
// Mount API Routes
// ============================================================================

// Health & Monitoring (no auth, no rate limiting)
app.route("/", healthRouter);

app.route("/v1/auth", authRouter);
app.route("/v1/user", userRouter);
app.route("/v1/posts", postRouter);
app.route("/v1/reels", reelRouter);
app.route("/v1/stories", storyRouter);
app.route("/v1/conversations", conversationRouter);
app.route("/v1/calls", callRouter);
app.route("/v1/callkit", callkitRouter);
app.route("/v1/notifications", notificationRouter);
app.route("/v1/upload", uploadRouter);
app.route("/v1/upload/tus", tusRouter);
app.route("/v1/reports", reportRouter);
app.route("/v1/media", mediaRouter);
app.route("/v1/search", searchRoutes);
app.route("/v1/admin", adminRouter);

// ============================================================================
// Error Handling
// ============================================================================

// Sentry error handler (if configured)
if (env.SENTRY_DSN) {
  try {
    const Sentry = require("@sentry/node");
    app.onError((err, c) => {
      const requestId = c.get("requestId");
      const error = err as Error;
      Sentry.captureException(error, {
        tags: {
          requestId,
          path: c.req.path,
          method: c.req.method,
        },
      });

      console.error(`[Error] ${error.message} [RequestID: ${requestId}]`, error);

      if (error instanceof HTTPException) {
        return c.json(
          {
            success: false,
            error: error.message,
            message: error.message,
            requestId,
          },
          error.status
        );
      }

      return c.json(
        {
          success: false,
          error: "INTERNAL_ERROR",
          message: "An unexpected error occurred",
          requestId,
        },
        500
      );
    });
  } catch {
    // Fallback to standard error handler
  }
} else {
  // Standard error handler with RFC 7807 Problem Details
  app.onError((err, c) => {
    const requestId = c.get("requestId");
    const error = err as Error;
    console.error(`[Error] ${error.message} [RequestID: ${requestId}]`, error);

    if (error instanceof HTTPException) {
      return c.json(
        {
          success: false,
          error: error.message,
          message: error.message,
          requestId,
        },
        error.status
      );
    }

    return c.json(
      {
        success: false,
        error: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        requestId,
      },
      500
    );
  });
}

// Not found handler
app.notFound(notFoundHandler());

export default app;
export { pool };