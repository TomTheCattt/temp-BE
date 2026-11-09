import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { auth } from "../config/auth";
import { authMiddleware, getCurrentUser } from "../middleware/auth";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, gt, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { createHash, randomBytes } from "crypto";
import { env } from "../config/env";

// Simple audit logging (use proper logging service in production)
interface AuditLogEntry {
  event: string;
  userId?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
  success: boolean;
}

function auditLog(entry: AuditLogEntry) {
  const logEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };
  // In production, send to structured logging service (Datadog, Splunk, etc.)
  console.log(`[AUDIT] ${JSON.stringify(logEntry)}`);
}

// Simple in-memory brute force tracking (use Redis in production)
const failedAttempts = new Map<string, { count: number; lockedUntil: number }>();

function getClientKey(c: any, email: string): string {
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
  return `${email}:${ip}`;
}

function checkBruteForce(key: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = failedAttempts.get(key);

  if (!record) {
    return { allowed: true };
  }

  // Clean up expired locks
  if (record.lockedUntil && record.lockedUntil < now) {
    failedAttempts.delete(key);
    return { allowed: true };
  }

  // Check if locked
  if (record.lockedUntil && record.lockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((record.lockedUntil - now) / 1000) };
  }

  // Check if too many attempts (5 attempts = lock for 15 minutes)
  if (record.count >= 5) {
    const lockUntil = now + 15 * 60 * 1000;
    failedAttempts.set(key, { count: record.count, lockedUntil: lockUntil });
    return { allowed: false, retryAfter: 15 * 60 };
  }

  return { allowed: true };
}

function recordFailedAttempt(key: string) {
  const now = Date.now();
  const record = failedAttempts.get(key);

  if (!record) {
    failedAttempts.set(key, { count: 1, lockedUntil: 0 });
  } else {
    failedAttempts.set(key, { count: record.count + 1, lockedUntil: record.lockedUntil });
  }
}

function clearFailedAttempts(key: string) {
  failedAttempts.delete(key);
}

// Validation schemas
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_.]+$/),
  fullName: z.string().min(1).max(100),
  phone: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8).max(128),
});

// Helper functions for refresh token handling
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateRefreshToken(): string {
  return randomBytes(32).toString("hex");
}

async function createRefreshToken(userId: string, sessionId: string, token: string) {
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 60 * 60 * 24 * 30 * 1000); // 30 days
  await db.insert(schema.refreshTokens).values({
    userId,
    tokenHash,
    sessionId,
    expiresAt,
  });
}

async function verifyAndRotateRefreshToken(refreshToken: string) {
  const tokenHash = hashToken(refreshToken);

  const storedToken = await db.query.refreshTokens.findFirst({
    where: and(
      eq(schema.refreshTokens.tokenHash, tokenHash),
      gt(schema.refreshTokens.expiresAt, new Date()),
      isNull(schema.refreshTokens.revokedAt) // Not revoked
    ),
    with: { session: true },
  });

  if (!storedToken) {
    return null;
  }

  // Revoke the used refresh token
  await db
    .update(schema.refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(schema.refreshTokens.id, storedToken.id));

  return storedToken;
}

// Create auth router
const authRouter = new Hono();

// Custom register endpoint that adds username
authRouter.post(
  "/register",
  zValidator("json", registerSchema),
  async (c) => {
    const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
    const userAgent = c.req.header("user-agent") || "unknown";

    try {
      const { email, password, username, fullName, phone } = c.req.valid("json");

      // Check if username is taken
      const existingUser = await db.query.users.findFirst({
        where: eq(schema.users.username, username),
      });
      if (existingUser) {
        auditLog({ event: "REGISTER_FAILED", ip, userAgent, metadata: { email, reason: "username_taken" }, success: false });
        throw new HTTPException(409, {
          message: "Username already taken",
          res: c.json({ success: false, error: "USERNAME_TAKEN", message: "Username already taken" }),
        });
      }

      // Use Better Auth to sign up
      // Additional fields (username, fullName, phone) are passed in the body
      // They are stored in the user's data field in Better Auth
      let result;
      try {
        result = await auth.api.signUpEmail({
          body: {
            email,
            password,
            name: fullName,
            fullName,
            username,
            phone,
          },
        });
      } catch (e) {
        console.error("[Better Auth] signUpEmail error:", e);
        auditLog({ event: "REGISTER_FAILED", ip, userAgent, metadata: { email, reason: "auth_error" }, success: false });
        throw new HTTPException(500, {
          message: "Registration failed",
          res: c.json({ success: false, error: "REGISTRATION_FAILED", message: e instanceof Error ? e.message : "Failed to create account" }),
        });
      }

      if (!result?.user) {
        console.error("[Auth] No user returned from Better Auth:", result);
        auditLog({ event: "REGISTER_FAILED", ip, userAgent, metadata: { email, reason: "no_user" }, success: false });
        throw new HTTPException(500, {
          message: "Registration failed",
          res: c.json({ success: false, error: "REGISTRATION_FAILED", message: "Failed to create account" }),
        });
      }

      if (!result.token) {
        console.error("[Auth] No token returned from Better Auth:", result);
        auditLog({ event: "REGISTER_FAILED", ip, userAgent, metadata: { email, reason: "no_token" }, success: false });
        throw new HTTPException(500, {
          message: "Registration failed",
          res: c.json({ success: false, error: "REGISTRATION_FAILED", message: "Failed to create session" }),
        });
      }

      // Get full user data from our database
      const user = await db.query.users.findFirst({
        where: eq(schema.users.id, result.user.id),
      });

      // Fetch the session created by Better Auth using the token
      const session = await db.query.sessions.findFirst({
        where: eq(schema.sessions.token, result.token),
      });

      // Create refresh token for the new session
      const refreshToken = generateRefreshToken();
      await createRefreshToken(result.user.id, session?.id || "", refreshToken);

      auditLog({ event: "REGISTER_SUCCESS", userId: result.user.id, ip, userAgent, metadata: { email, username }, success: true });

      return c.json({
        success: true,
        data: {
          user: user ? {
            id: user.id,
            username: user.username,
            fullName: user.fullName,
            email: user.email,
            phone: user.phone,
            avatarUrl: user.avatarUrl,
            bio: user.bio,
            website: user.website,
            isVerified: user.isVerified,
            isPrivate: user.isPrivate,
            postsCount: user.postsCount,
            followersCount: user.followersCount,
            followingCount: user.followingCount,
            createdAt: user.createdAt,
          } : {
            id: result.user.id,
            username,
            fullName,
            email: result.user.email,
            phone,
            avatarUrl: result.user.image,
            bio: null,
            website: null,
            isVerified: result.user.emailVerified,
            isPrivate: false,
            postsCount: 0,
            followersCount: 0,
            followingCount: 0,
            createdAt: result.user.createdAt,
          },
          accessToken: result.token,
          refreshToken,
          expiresAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 days
        },
      }, 201);
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      console.error("[Auth] Register error:", error);
      throw new HTTPException(500, {
        message: "Registration failed",
        res: c.json({ success: false, error: "REGISTRATION_FAILED", message: "Failed to create account" }),
      });
    }
  }
);

// Login endpoint - handled by Better Auth handler at /api/auth/sign-in/email
// We'll keep a simple proxy for iOS compatibility
authRouter.post(
  "/login",
  zValidator("json", loginSchema),
  async (c) => {
    const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
    const userAgent = c.req.header("user-agent") || "unknown";

    try {
      const { email, password } = c.req.valid("json");

      // Brute force protection
      const clientKey = getClientKey(c, email);
      const bruteForceCheck = checkBruteForce(clientKey);

      if (!bruteForceCheck.allowed) {
        auditLog({ event: "LOGIN_BLOCKED", ip, userAgent, metadata: { email, reason: "brute_force" }, success: false });
        throw new HTTPException(429, {
          message: `Too many failed login attempts. Please try again in ${bruteForceCheck.retryAfter} seconds.`,
          res: c.json({
            success: false,
            error: "BRUTE_FORCE_LOCKED",
            message: `Too many failed login attempts. Please try again in ${bruteForceCheck.retryAfter} seconds.`
          }),
        });
      }

      const result = await auth.api.signInEmail({
        body: { email, password },
      });

      if (!result?.user || !result?.token) {
        recordFailedAttempt(clientKey);
        auditLog({ event: "LOGIN_FAILED", ip, userAgent, metadata: { email, reason: "invalid_credentials" }, success: false });
        throw new HTTPException(401, {
          message: "Invalid credentials",
          res: c.json({ success: false, error: "INVALID_CREDENTIALS", message: "Invalid email or password" }),
        });
      }

      // Clear failed attempts on successful login
      clearFailedAttempts(clientKey);

      // Get full user data from our database
      const user = await db.query.users.findFirst({
        where: eq(schema.users.id, result.user.id),
      });

      // Fetch the session created by Better Auth using the token
      const session = await db.query.sessions.findFirst({
        where: eq(schema.sessions.token, result.token),
      });

      // Create refresh token for the new session
      const refreshToken = generateRefreshToken();
      await createRefreshToken(result.user.id, session?.id || "", refreshToken);

      // Return session token for Bearer token authentication
      // For mobile: return accessToken (sessionToken), refreshToken (separate), expiresAt
      const sessionToken = result.token;
      const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 7 days from now

      auditLog({ event: "LOGIN_SUCCESS", userId: result.user.id, ip, userAgent, metadata: { email }, success: true });

      return c.json({
        success: true,
        data: {
          user: user ? {
            id: user.id,
            username: user.username,
            fullName: user.fullName,
            email: user.email,
            phone: user.phone,
            avatarUrl: user.avatarUrl,
            bio: user.bio,
            website: user.website,
            isVerified: user.isVerified,
            isPrivate: user.isPrivate,
            postsCount: user.postsCount,
            followersCount: user.followersCount,
            followingCount: user.followingCount,
            createdAt: user.createdAt,
          } : {
            id: result.user.id,
            username: result.user.name,
            fullName: result.user.name,
            email: result.user.email,
            phone: null,
            avatarUrl: result.user.image,
            bio: null,
            website: null,
            isVerified: result.user.emailVerified,
            isPrivate: false,
            postsCount: 0,
            followersCount: 0,
            followingCount: 0,
            createdAt: result.user.createdAt,
          },
          accessToken: sessionToken,
          refreshToken,
          expiresAt,
        },
      });
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      console.error("[Auth] Login error:", error);
      throw new HTTPException(401, {
        message: "Invalid credentials",
        res: c.json({ success: false, error: "INVALID_CREDENTIALS", message: "Invalid email or password" }),
      });
    }
  }
);

// Logout endpoint
authRouter.post(
  "/logout",
  authMiddleware,
  async (c) => {
    try {
      const user = getCurrentUser(c);
      const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
      const userAgent = c.req.header("user-agent") || "unknown";

      // Get the current session from context
      const session = c.get("session");

      // Revoke refresh tokens for this session
      if (session?.sessionId) {
        await db
          .update(schema.refreshTokens)
          .set({ revokedAt: new Date() })
          .where(eq(schema.refreshTokens.sessionId, session.sessionId));
      }

      await auth.api.signOut({
        headers: c.req.raw.headers,
      });
      auditLog({ event: "LOGOUT", userId: user.id, ip, userAgent, success: true });
      return c.json({ success: true, data: { message: "Logged out successfully" } });
    } catch (error) {
      console.error("[Auth] Logout error:", error);
      return c.json({ success: true, data: { message: "Logged out" } });
    }
  }
);

// Logout all devices
authRouter.post(
  "/logout-all-devices",
  authMiddleware,
  async (c) => {
    try {
      const user = getCurrentUser(c);
      const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
      const userAgent = c.req.header("user-agent") || "unknown";

      // Revoke all refresh tokens for this user
      await db
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(schema.refreshTokens.userId, user.id));

      await auth.api.revokeSessions({
        headers: c.req.raw.headers,
      });
      auditLog({ event: "LOGOUT_ALL_DEVICES", userId: user.id, ip, userAgent, success: true });
      return c.json({ success: true, data: { message: "Logged out from all devices" } });
    } catch (error) {
      console.error("[Auth] Logout all error:", error);
      throw new HTTPException(500, {
        message: "Failed to logout from all devices",
        res: c.json({ success: false, error: "LOGOUT_FAILED", message: "Failed to logout from all devices" }),
      });
    }
  }
);

// Change password
authRouter.post(
  "/change-password",
  authMiddleware,
  zValidator("json", changePasswordSchema),
  async (c) => {
    try {
      const { currentPassword, newPassword } = c.req.valid("json");
      const user = getCurrentUser(c);
      const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
      const userAgent = c.req.header("user-agent") || "unknown";

      await auth.api.changePassword({
        body: {
          currentPassword,
          newPassword,
          revokeOtherSessions: true,
        },
        headers: c.req.raw.headers,
      });

      // Revoke all refresh tokens for this user (password change = token invalidation)
      await db
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(schema.refreshTokens.userId, user.id));

      auditLog({ event: "PASSWORD_CHANGE", userId: user.id, ip, userAgent, success: true });

      return c.json({ success: true, data: { message: "Password changed successfully" } });
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      console.error("[Auth] Change password error:", error);
      throw new HTTPException(400, {
        message: "Failed to change password",
        res: c.json({ success: false, error: "PASSWORD_CHANGE_FAILED", message: "Current password is incorrect" }),
      });
    }
  }
);

// Forgot password
authRouter.post(
  "/forgot-password",
  zValidator("json", z.object({ email: z.string().email() })),
  async (c) => {
    try {
      const { email } = c.req.valid("json");

      // Validate redirect URL against allowlist
      const allowedOrigins = env.CORS_ORIGIN.split(",").map((o) => o.trim());
      const redirectOrigin = allowedOrigins[0]; // Use first allowed origin
      const redirectTo = `${redirectOrigin}/reset-password`;

      await auth.api.requestPasswordReset({
        body: { email, redirectTo },
      });
      return c.json({ success: true, data: { message: "Password reset email sent" } });
    } catch (error) {
      console.error("[Auth] Forgot password error:", error);
      return c.json({ success: true, data: { message: "If the email exists, a reset link has been sent" } });
    }
  }
);

// Verify email
authRouter.post(
  "/verify-email",
  zValidator("json", z.object({ token: z.string() })),
  async (c) => {
    try {
      const { token } = c.req.valid("json");
      const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
      const userAgent = c.req.header("user-agent") || "unknown";
      await auth.api.verifyEmail({ query: { token } });
      auditLog({ event: "EMAIL_VERIFIED", ip, userAgent, success: true });
      return c.json({ success: true, data: { message: "Email verified successfully" } });
    } catch (error) {
      const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
      const userAgent = c.req.header("user-agent") || "unknown";
      console.error("[Auth] Verify email error:", error);
      auditLog({ event: "EMAIL_VERIFY_FAILED", ip, userAgent, metadata: { reason: "invalid_token" }, success: false });
      throw new HTTPException(400, {
        message: "Invalid or expired verification token",
        res: c.json({ success: false, error: "INVALID_TOKEN", message: "Invalid or expired verification token" }),
      });
    }
  }
);

// Resend verification email
authRouter.post(
  "/resend-verification",
  zValidator("json", z.object({ email: z.string().email() })),
  async (c) => {
    const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
    const userAgent = c.req.header("user-agent") || "unknown";
    const { email } = c.req.valid("json");
    try {
      await auth.api.sendVerificationEmail({ body: { email } });
      auditLog({ event: "VERIFICATION_EMAIL_SENT", ip, userAgent, metadata: { email }, success: true });
      return c.json({ success: true, data: { message: "Verification email sent" } });
    } catch (error) {
      console.error("[Auth] Resend verification error:", error);
      auditLog({ event: "VERIFICATION_EMAIL_FAILED", ip, userAgent, metadata: { email }, success: false });
      return c.json({ success: true, data: { message: "If the email exists, a verification email has been sent" } });
    }
  }
);

// Get current user profile (protected)
authRouter.get(
  "/me",
  authMiddleware,
  async (c) => {
    const user = getCurrentUser(c);
    return c.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
          avatarUrl: user.avatarUrl,
          bio: user.bio,
          website: user.website,
          isVerified: user.isVerified,
          isPrivate: user.isPrivate,
          postsCount: user.postsCount,
          followersCount: user.followersCount,
          followingCount: user.followingCount,
          createdAt: user.createdAt,
        },
      },
    });
  }
);

// Refresh session - accepts Bearer token (refreshToken) for mobile apps
authRouter.post(
  "/refresh",
  async (c) => {
    const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
    const userAgent = c.req.header("user-agent") || "unknown";

    try {
      // Get refresh token from Authorization header (Bearer token)
      const authHeader = c.req.header("Authorization");
      let refreshToken = "";

      if (authHeader && authHeader.startsWith("Bearer ")) {
        refreshToken = authHeader.slice(7);
      }

      if (!refreshToken) {
        auditLog({ event: "TOKEN_REFRESH_FAILED", ip, userAgent, metadata: { reason: "no_token" }, success: false });
        throw new HTTPException(401, {
          message: "No refresh token provided",
          res: c.json({ success: false, error: "NO_REFRESH_TOKEN", message: "No refresh token provided" }),
        });
      }

      // Verify and rotate refresh token
      const storedToken = await verifyAndRotateRefreshToken(refreshToken);

      if (!storedToken) {
        auditLog({ event: "TOKEN_REFRESH_FAILED", ip, userAgent, metadata: { reason: "invalid_token" }, success: false });
        throw new HTTPException(401, {
          message: "Invalid or expired refresh token",
          res: c.json({ success: false, error: "INVALID_REFRESH_TOKEN", message: "Invalid or expired refresh token" }),
        });
      }

      // Check if session is still valid
      if (!storedToken.session || storedToken.session.expiresAt < new Date()) {
        // Revoke all refresh tokens for this session
        await db
          .update(schema.refreshTokens)
          .set({ revokedAt: new Date() })
          .where(eq(schema.refreshTokens.sessionId, storedToken.sessionId));

        auditLog({ event: "TOKEN_REFRESH_FAILED", ip, userAgent, metadata: { reason: "session_expired" }, success: false });
        throw new HTTPException(401, {
          message: "Session expired",
          res: c.json({ success: false, error: "SESSION_EXPIRED", message: "Session expired, please login again" }),
        });
      }

      // Extend session expiry in database (sliding window - max 7 days from now)
      const newExpiresAt = new Date(Date.now() + 60 * 60 * 24 * 7 * 1000);
      await db
        .update(schema.sessions)
        .set({
          expiresAt: newExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.sessions.id, storedToken.sessionId));

      // Create new refresh token
      const newRefreshToken = generateRefreshToken();
      await createRefreshToken(storedToken.userId, storedToken.sessionId, newRefreshToken);

      const expiresAtUnix = Math.floor(newExpiresAt.getTime() / 1000);

      auditLog({ event: "TOKEN_REFRESH_SUCCESS", userId: storedToken.userId, ip, userAgent, success: true });

      return c.json({
        success: true,
        data: {
          accessToken: storedToken.session.token,
          refreshToken: newRefreshToken,
          expiresAt: expiresAtUnix,
        },
      });
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      console.error("[Auth] Refresh error:", error);
      throw new HTTPException(401, {
        message: "Session expired",
        res: c.json({ success: false, error: "SESSION_EXPIRED", message: "Session expired, please login again" }),
      });
    }
  }
);

export { authRouter };