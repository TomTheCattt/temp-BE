import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { HTTPException } from "hono/http-exception";
import { rateLimiter } from "hono-rate-limiter";

// Load environment variables FIRST (before any other config)
import "./config/env";

// Import database client
import { db, pool } from "./db/client";

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
const CORS_ORIGIN = env.CORS_ORIGIN;

// Create Hono app
const app = new Hono();

// Global middleware
app.use("*", logger());
app.use("*", prettyJSON());
app.use(
  "*",
  cors({
    origin: CORS_ORIGIN === "*" ? "*" : CORS_ORIGIN.split(","),
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