import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { HTTPException } from "hono/http-exception";
import { rateLimiter } from "hono-rate-limiter";
import { secureHeaders } from "hono/secure-headers";
import { and, eq, lt, isNotNull } from "drizzle-orm";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

// Load environment variables FIRST (before any other config)
import "./config/env";

// Import database client
import { db, pool } from "./db/client";

// Import schema
import * as schema from "./db/schema";

// Import routes
import { authRouter } from "./routes/auth.routes";
import { userRouter } from "./routes/user.routes";
import { postRouter } from "./routes/post.routes";
import { reelRouter } from "./routes/reel.routes";
import { storyRouter } from "./routes/story.routes";
import { conversationRouter } from "./routes/conversation.routes";
import { notificationRouter } from "./routes/notification.routes";
import { uploadRouter } from "./routes/upload.routes";

// Use validated env
import { env } from "./config/env";
const CORS_ORIGIN = env.CORS_ORIGIN.split(",").map((o) => o.trim());

// Create Hono app
const app = new Hono();

// Security headers middleware
app.use("*", secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https:"],
    fontSrc: ["'self'"],
    connectSrc: ["'self'", "wss:", "https:"],
    frameAncestors: ["'none'"],
  },
  xFrameOptions: "DENY",
  xContentTypeOptions: "nosniff",
  referrerPolicy: "strict-origin-when-cross-origin",
  crossOriginEmbedderPolicy: "require-corp",
  crossOriginOpenerPolicy: "same-origin",
  crossOriginResourcePolicy: "same-origin",
}));

// Global middleware
app.use("*", logger());
app.use("*", prettyJSON());
app.use(
  "*",
  cors({
    origin: CORS_ORIGIN,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    credentials: true,
  })
);

// Rate limiting middleware
// Auth endpoints: stricter limits
app.use(
  "/v1/auth/*",
  rateLimiter({
    windowMs: 60 * 1000, // 1 minute
    limit: 100, // 100 requests per minute (increased for development)
    standardHeaders: true,
    keyGenerator: (c) => c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "anonymous",
    handler: (c) =>
      c.json(
        { success: false, error: "RATE_LIMIT_EXCEEDED", message: "Too many authentication requests, please try again later" },
        429
      ),
  })
);

// Upload endpoints: moderate limits
app.use(
  "/v1/upload/*",
  rateLimiter({
    windowMs: 60 * 1000, // 1 minute
    limit: 30, // 30 requests per minute
    standardHeaders: true,
    keyGenerator: (c) => {
      const user = c.get("user");
      return user ? user.id : c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "anonymous";
    },
    handler: (c) =>
      c.json(
        { success: false, error: "RATE_LIMIT_EXCEEDED", message: "Too many upload requests, please slow down" },
        429
      ),
  })
);

// API endpoints: generous limits for authenticated users
app.use(
  "/v1/*",
  rateLimiter({
    windowMs: 60 * 1000, // 1 minute
    limit: 100, // 100 requests per minute
    standardHeaders: true,
    keyGenerator: (c) => {
      const user = c.get("user");
      return user ? user.id : c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "anonymous";
    },
    handler: (c) =>
      c.json(
        { success: false, error: "RATE_LIMIT_EXCEEDED", message: "Too many requests, please slow down" },
        429
      ),
  })
);

// Health check endpoint
app.get("/health", (c) => {
  return c.json({
    success: true,
    data: {
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "instagram-clone-api",
    },
  });
});

// Internal cleanup endpoints (called by Neon Functions cron triggers)
// These are protected by a shared secret
const INTERNAL_SECRET = process.env.INTERNAL_CRON_SECRET || "dev-secret-change-in-production";

function verifyInternalSecret(c: any) {
  const auth = c.req.header("Authorization");
  if (!auth || auth !== `Bearer ${INTERNAL_SECRET}`) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
}

// S3 client for cleanup (lazy initialization)
let s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: "auto",
      endpoint: process.env.NEON_STORAGE_ENDPOINT || "https://storage.neon.tech",
      credentials: {
        accessKeyId: process.env.NEON_STORAGE_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.NEON_STORAGE_SECRET_ACCESS_KEY || "",
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

// Mount Better Auth handler at root level for standard auth endpoints
// This must be before the /v1/* rate limiter
import { auth } from "./config/auth";
app.on(["POST", "GET"], "/api/auth/*", async (c) => {
  return auth.handler(c.req.raw);
});

// Mount API routes
app.route("/v1/auth", authRouter);
app.route("/v1/user", userRouter);
app.route("/v1/posts", postRouter);
app.route("/v1/reels", reelRouter);
app.route("/v1/stories", storyRouter);
app.route("/v1/conversations", conversationRouter);
app.route("/v1/notifications", notificationRouter);
app.route("/v1/upload", uploadRouter);

// Error handler
app.onError((err, c) => {
  console.error(`[Error] ${err.message}`, err);

  if (err instanceof HTTPException) {
    return c.json(
      {
        success: false,
        error: err.message,
        message: err.message,
      },
      err.status
    );
  }

  return c.json(
    {
      success: false,
      error: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    },
    500
  );
});

// Not found handler
app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: "NOT_FOUND",
      message: `Route ${c.req.method} ${c.req.path} not found`,
    },
    404
  );
});

export default app;
export { pool };