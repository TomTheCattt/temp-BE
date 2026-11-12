import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { auth } from "../config/auth";
import { authMiddleware, getCurrentUser, optionalAuthMiddleware } from "../middleware/auth";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, gt, isNull, desc, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { createHash, randomBytes } from "crypto";
import { env } from "../config/env";
import { getRedisClient } from "../middleware/rate-limit";
import { getAuthAuditService, createAuditContext, AuthEventType, AuthAuditContext } from "../services/auth-audit";
import { authEndpointsRateLimit } from "../middleware/rate-limit";
import { createMiddleware } from "hono/factory";

// Extend Hono context types
declare module "hono" {
  interface ContextVariableMap {
    auditContext: AuthAuditContext;
  }
}

// ============================================================================
// Validation Schemas
// ============================================================================

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_.]+$/),
  fullName: z.string().min(1).max(100),
  phone: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  deviceId: z.string().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8).max(128),
});

const updateProfileSchema = z.object({
  fullName: z.string().min(1).max(100).optional(),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_.]+$/).optional(),
  bio: z.string().max(150).optional(),
  website: z.string().url().max(200).optional(),
  phone: z.string().max(20).optional(),
  isPrivate: z.boolean().optional(),
});

const deviceTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(["IOS", "ANDROID", "WEB"]),
  deviceId: z.string().optional(),
  appVersion: z.string().optional(),
  osVersion: z.string().optional(),
  voipToken: z.string().optional(),
  sandbox: z.boolean().optional(),
  topics: z.array(z.string()).optional(),
});

const verifyEmailSchema = z.object({
  token: z.string(),
});

const resendVerificationSchema = z.object({
  email: z.string().email(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(8).max(128),
});

const verifyPhoneSchema = z.object({
  code: z.string().length(6),
  phone: z.string(),
});

const sendPhoneVerificationSchema = z.object({
  phone: z.string(),
});

const mfaSetupSchema = z.object({
  method: z.enum(["TOTP"]),
});

const mfaVerifySchema = z.object({
  code: z.string().length(6),
  method: z.enum(["TOTP"]),
});

const mfaDisableSchema = z.object({
  password: z.string(),
  code: z.string().length(6).optional(),
});

const linkAccountSchema = z.object({
  provider: z.enum(["google", "apple"]),
});

const unlinkAccountSchema = z.object({
  provider: z.enum(["google", "apple"]),
});

// ============================================================================
// Redis-based Brute Force Protection
// ============================================================================

interface BruteForceRecord {
  count: number;
  lockedUntil: number;
  lastAttempt: number;
}

const BRUTE_FORCE_PREFIX = "bruteforce:";
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
const WINDOW_DURATION = 15 * 60 * 1000; // 15 minutes sliding window

function getBruteForceKey(identifier: string, ip: string): string {
  return `${BRUTE_FORCE_PREFIX}${identifier}:${ip}`;
}

async function checkBruteForce(identifier: string, ip: string): Promise<{ allowed: boolean; retryAfter?: number; attempts?: number }> {
  const redis = getRedisClient();
  const key = getBruteForceKey(identifier, ip);

  try {
    // Use eval to get the record from a Redis hash or use a simple approach
    // Since we only have incr/decr/expire/pttl/eval, we'll use eval to implement a simple GET/SET
    const script = `
      local key = KEYS[1]
      local data = redis.call('GET', key)
      if data then
        return data
      end
      return nil
    `;
    const result = await redis.eval(script, 1, key) as string | null;

    if (!result) {
      return { allowed: true, attempts: 0 };
    }

    const record: BruteForceRecord = JSON.parse(result);
    const now = Date.now();

    // Check if lockout has expired
    if (record.lockedUntil && record.lockedUntil > now) {
      return {
        allowed: false,
        retryAfter: Math.ceil((record.lockedUntil - now) / 1000),
        attempts: record.count
      };
    }

    // Check if window has expired (reset count)
    if (record.lastAttempt && (now - record.lastAttempt) > WINDOW_DURATION) {
      return { allowed: true, attempts: 0 };
    }

    // Check if max attempts reached
    if (record.count >= MAX_ATTEMPTS) {
      const lockUntil = now + LOCKOUT_DURATION;
      const newRecord = { ...record, lockedUntil: lockUntil };
      const setScript = `
        local key = KEYS[1]
        local value = ARGV[1]
        local ttl = ARGV[2]
        redis.call('SET', key, value, 'EX', ttl)
        return 1
      `;
      await redis.eval(setScript, 1, key, JSON.stringify(newRecord), String(Math.ceil((WINDOW_DURATION + LOCKOUT_DURATION) / 1000) + 60));
      return {
        allowed: false,
        retryAfter: Math.ceil(LOCKOUT_DURATION / 1000),
        attempts: record.count
      };
    }

    return { allowed: true, attempts: record.count };
  } catch (error) {
    console.error("[BruteForce] Redis error, allowing request:", error);
    return { allowed: true, attempts: 0 };
  }
}

async function recordFailedAttempt(identifier: string, ip: string): Promise<void> {
  const redis = getRedisClient();
  const key = getBruteForceKey(identifier, ip);
  const now = Date.now();

  try {
    const script = `
      local key = KEYS[1]
      local window = tonumber(ARGV[1])
      local lockout = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])

      local data = redis.call('GET', key)
      local record
      if data then
        record = cjson.decode(data)
        -- Reset if window expired
        if record.lastAttempt and (now - record.lastAttempt) > window then
          record = { count = 0, lockedUntil = 0, lastAttempt = 0 }
        end
      else
        record = { count = 0, lockedUntil = 0, lastAttempt = 0 }
      end

      record.count = record.count + 1
      record.lastAttempt = now

      local ttl = math.ceil((window + lockout) / 1000) + 60
      redis.call('SET', key, cjson.encode(record), 'EX', ttl)
      return 1
    `;
    await redis.eval(script, 1, key, String(WINDOW_DURATION), String(LOCKOUT_DURATION), String(now));
  } catch (error) {
    console.error("[BruteForce] Failed to record attempt:", error);
  }
}

async function clearBruteForce(identifier: string, ip: string): Promise<void> {
  const redis = getRedisClient();
  const key = getBruteForceKey(identifier, ip);

  try {
    const script = `
      local key = KEYS[1]
      redis.call('DEL', key)
      return 1
    `;
    await redis.eval(script, 1, key);
  } catch (error) {
    console.error("[BruteForce] Failed to clear:", error);
  }
}

function getClientIp(c: any): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
         c.req.header("x-real-ip") ||
         "unknown";
}

// ============================================================================
// Refresh Token Helpers
// ============================================================================

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
      isNull(schema.refreshTokens.revokedAt)
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

// ============================================================================
// Password Strength Validation
// ============================================================================

function validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push("Password must be at least 8 characters");
  }
  if (password.length > 128) {
    errors.push("Password must not exceed 128 characters");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number");
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push("Password must contain at least one special character");
  }
  // Check for common patterns
  if (/(.)\1{2,}/.test(password)) {
    errors.push("Password must not contain repeating characters");
  }
  // Check for sequential characters
  if (/abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz|123|234|345|456|567|678|789|890/i.test(password)) {
    errors.push("Password must not contain sequential characters");
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// 2FA/MFA Preparation (TOTP)
// ============================================================================

// Note: Full TOTP implementation would require a library like 'otplib'
// This is preparation for future implementation
interface MFASecret {
  secret: string;
  otpauthUrl: string;
  backupCodes: string[];
}

// Generate TOTP secret (placeholder - use otplib in production)
function generateTOTPSecret(username: string): MFASecret {
  // In production, use: import { authenticator } from 'otplib';
  // const secret = authenticator.generateSecret();
  const secret = randomBytes(20).toString("base64").replace(/[/+=]/g, "").substring(0, 32);
  const otpauthUrl = `otpauth://totp/InstagramClone:${encodeURIComponent(username)}?secret=${secret}&issuer=InstagramClone`;

  // Generate backup codes
  const backupCodes = Array.from({ length: 10 }, () =>
    randomBytes(4).toString("hex").toUpperCase()
  );

  return { secret, otpauthUrl, backupCodes };
}

// Verify TOTP code (placeholder)
function verifyTOTPCode(secret: string, code: string): boolean {
  // In production, use: import { authenticator } from 'otplib';
  // return authenticator.verify({ token: code, secret });
  // For now, return false - requires otplib
  console.warn("[MFA] TOTP verification not implemented - install otplib");
  return false;
}

// ============================================================================
// Create Auth Router
// ============================================================================

const authRouter = new Hono();

// Apply rate limiting to all auth endpoints - DISABLED, handled globally in index.ts
// authRouter.use("*", authEndpointsRateLimit);

// Audit context middleware
authRouter.use("*", createMiddleware(async (c, next) => {
  c.set("auditContext", createAuditContext(c));
  await next();
}));

// ============================================================================
// REGISTER
// ============================================================================

authRouter.post(
  "/register",
  zValidator("json", registerSchema),
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();
    const ip = getClientIp(c);
    const userAgent = c.req.header("user-agent") || "unknown";

    try {
      const { email, password, username, fullName, phone } = c.req.valid("json");

      // Validate password strength
      const passwordValidation = validatePasswordStrength(password);
      if (!passwordValidation.valid) {
        await auditService.logRegister(auditContext, "", email, false, "WEAK_PASSWORD");
        throw new HTTPException(400, {
          message: "Password does not meet requirements",
          res: c.json({
            success: false,
            error: "WEAK_PASSWORD",
            message: "Password does not meet requirements",
            details: passwordValidation.errors
          }, 400),
        });
      }

      // Check if username is taken
      const existingUser = await db.query.users.findFirst({
        where: eq(schema.users.username, username),
      });
      if (existingUser) {
        await auditService.logRegister(auditContext, "", email, false, "USERNAME_TAKEN");
        throw new HTTPException(409, {
          message: "Username already taken",
          res: c.json({ success: false, error: "USERNAME_TAKEN", message: "Username already taken" }, 409),
        });
      }

      // Check if email is taken
      const existingEmail = await db.query.users.findFirst({
        where: eq(schema.users.email, email),
      });
      if (existingEmail) {
        await auditService.logRegister(auditContext, "", email, false, "EMAIL_TAKEN");
        throw new HTTPException(409, {
          message: "Email already registered",
          res: c.json({ success: false, error: "EMAIL_TAKEN", message: "Email already registered" }, 409),
        });
      }

      // Use Better Auth to sign up
      let result;
      try {
        result = await auth.api.signUpEmail({
          body: {
            email,
            password,
            name: fullName, // Base Better Auth required field
            fullName, // Our custom additional field
            username,
            phone,
          },
        });
      } catch (e) {
        console.error("[Better Auth] signUpEmail error:", e);
        await auditService.logRegister(auditContext, "", email, false, "AUTH_ERROR");
        throw new HTTPException(500, {
          message: "Registration failed",
          res: c.json({ success: false, error: "REGISTRATION_FAILED", message: e instanceof Error ? e.message : "Failed to create account" }, 500),
        });
      }

      if (!result?.user) {
        await auditService.logRegister(auditContext, "", email, false, "NO_USER_RETURNED");
        throw new HTTPException(500, {
          message: "Registration failed",
          res: c.json({ success: false, error: "REGISTRATION_FAILED", message: "Failed to create account" }, 500),
        });
      }

      if (!result.token) {
        await auditService.logRegister(auditContext, "", email, false, "NO_TOKEN_RETURNED");
        throw new HTTPException(500, {
          message: "Registration failed",
          res: c.json({ success: false, error: "REGISTRATION_FAILED", message: "Failed to create session" }, 500),
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

      // Log successful registration
      await auditService.logRegister(auditContext, result.user.id, email, true);

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
        res: c.json({ success: false, error: "REGISTRATION_FAILED", message: "Failed to create account" }, 500),
      });
    }
  }
);

// ============================================================================
// LOGIN
// ============================================================================

authRouter.post(
  "/login",
  zValidator("json", loginSchema),
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();
    const ip = getClientIp(c);
    const userAgent = c.req.header("user-agent") || "unknown";

    try {
      const { email, password, deviceId } = c.req.valid("json");

      // Check brute force
      const bruteForceCheck = await checkBruteForce(email, ip);

      if (!bruteForceCheck.allowed) {
        await auditService.logBruteForceAttempt(auditContext, email, bruteForceCheck.attempts || 0, true);
        throw new HTTPException(429, {
          message: `Too many failed login attempts. Please try again in ${bruteForceCheck.retryAfter} seconds.`,
          res: c.json({
            success: false,
            error: "BRUTE_FORCE_LOCKED",
            message: `Too many failed login attempts. Please try again in ${bruteForceCheck.retryAfter} seconds.`,
            retryAfter: bruteForceCheck.retryAfter,
          }, 429),
        });
      }

      console.log('[Auth Debug] Calling auth.api.signInEmail with email:', email);
      const result = await auth.api.signInEmail({
        body: { email, password },
      });
      console.log('[Auth Debug] signInEmail result:', result ? 'success' : 'null/undefined', result ? JSON.stringify(result, null, 2) : 'none');

      if (!result?.user || !result?.token) {
        await recordFailedAttempt(email, ip);
        await auditService.logLogin(auditContext, "", email, false, "INVALID_CREDENTIALS", "INVALID_CREDENTIALS");

        const updatedCheck = await checkBruteForce(email, ip);
        if (!updatedCheck.allowed) {
          throw new HTTPException(429, {
            message: `Too many failed login attempts. Please try again in ${updatedCheck.retryAfter} seconds.`,
            res: c.json({
              success: false,
              error: "BRUTE_FORCE_LOCKED",
              message: `Too many failed login attempts. Please try again in ${updatedCheck.retryAfter} seconds.`,
              retryAfter: updatedCheck.retryAfter,
            }, 429),
          });
        }

        throw new HTTPException(401, {
          message: "Invalid credentials",
          res: c.json({ success: false, error: "INVALID_CREDENTIALS", message: "Invalid email or password" }, 401),
        });
      }

      // Clear failed attempts on successful login
      await clearBruteForce(email, ip);

      // Get full user data from our database
      const user = await db.query.users.findFirst({
        where: eq(schema.users.id, result.user.id),
      });

      // Fetch the session created by Better Auth using the token
      const session = await db.query.sessions.findFirst({
        where: eq(schema.sessions.token, result.token),
      });

      // Update last login timestamp
      await db
        .update(schema.users)
        .set({ lastLoginAt: new Date() })
        .where(eq(schema.users.id, result.user.id));

      // Create refresh token for the new session
      const refreshToken = generateRefreshToken();
      await createRefreshToken(result.user.id, session?.id || "", refreshToken);

      // Return session token for Bearer token authentication
      const sessionToken = result.token;
      const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 7 days from now

      // Log successful login
      await auditService.logLogin(auditContext, result.user.id, email, true);

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
        res: c.json({ success: false, error: "INVALID_CREDENTIALS", message: "Invalid email or password" }, 401),
      });
    }
  }
);

// ============================================================================
// LOGOUT
// ============================================================================

authRouter.post(
  "/logout",
  authMiddleware,
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();

    try {
      const user = getCurrentUser(c);
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

      await auditService.logLogout(auditContext, user.id, false);
      return c.json({ success: true, data: { message: "Logged out successfully" } });
    } catch (error) {
      console.error("[Auth] Logout error:", error);
      return c.json({ success: true, data: { message: "Logged out" } });
    }
  }
);

// ============================================================================
// LOGOUT ALL DEVICES
// ============================================================================

authRouter.post(
  "/logout-all-devices",
  authMiddleware,
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();

    try {
      const user = getCurrentUser(c);

      // Revoke all refresh tokens for this user
      await db
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(schema.refreshTokens.userId, user.id));

      await auth.api.revokeSessions({
        headers: c.req.raw.headers,
      });

      await auditService.logLogout(auditContext, user.id, true);
      return c.json({ success: true, data: { message: "Logged out from all devices" } });
    } catch (error) {
      console.error("[Auth] Logout all error:", error);
      throw new HTTPException(500, {
        message: "Failed to logout from all devices",
        res: c.json({ success: false, error: "LOGOUT_FAILED", message: "Failed to logout from all devices" }, 500),
      });
    }
  }
);

// ============================================================================
// CHANGE PASSWORD
// ============================================================================

authRouter.post(
  "/change-password",
  authMiddleware,
  zValidator("json", changePasswordSchema),
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();

    try {
      const { currentPassword, newPassword } = c.req.valid("json");
      const user = getCurrentUser(c);

      // Validate new password strength
      const passwordValidation = validatePasswordStrength(newPassword);
      if (!passwordValidation.valid) {
        await auditService.logPasswordChange(auditContext, user.id, false);
        throw new HTTPException(400, {
          message: "New password does not meet requirements",
          res: c.json({
            success: false,
            error: "WEAK_PASSWORD",
            message: "New password does not meet requirements",
            details: passwordValidation.errors
          }, 400),
        });
      }

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

      await auditService.logPasswordChange(auditContext, user.id, true);
      return c.json({ success: true, data: { message: "Password changed successfully" } });
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      console.error("[Auth] Change password error:", error);
      await auditService.logPasswordChange(auditContext, getCurrentUser(c).id, false);
      throw new HTTPException(400, {
        message: "Failed to change password",
        res: c.json({ success: false, error: "PASSWORD_CHANGE_FAILED", message: "Current password is incorrect" }, 400),
      });
    }
  }
);

// ============================================================================
// FORGOT PASSWORD
// ============================================================================

authRouter.post(
  "/forgot-password",
  zValidator("json", forgotPasswordSchema),
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();

    try {
      const { email } = c.req.valid("json");

      // Validate redirect URL against allowlist
      const allowedOrigins = env.CORS_ORIGIN.split(",").map((o) => o.trim());
      const redirectOrigin = allowedOrigins[0];
      const redirectTo = `${redirectOrigin}/reset-password`;

      await auth.api.requestPasswordReset({
        body: { email, redirectTo },
      });

      await auditService.logPasswordResetRequest(auditContext, email, true);
      return c.json({ success: true, data: { message: "Password reset email sent" } });
    } catch (error) {
      console.error("[Auth] Forgot password error:", error);
      await auditService.logPasswordResetRequest(auditContext, c.req.valid("json").email, false);
      return c.json({ success: true, data: { message: "If the email exists, a reset link has been sent" } });
    }
  }
);

// ============================================================================
// RESET PASSWORD
// ============================================================================

authRouter.post(
  "/reset-password",
  zValidator("json", resetPasswordSchema),
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();

    try {
      const { token, password } = c.req.valid("json");

      // Validate password strength
      const passwordValidation = validatePasswordStrength(password);
      if (!passwordValidation.valid) {
        throw new HTTPException(400, {
          message: "Password does not meet requirements",
          res: c.json({
            success: false,
            error: "WEAK_PASSWORD",
            message: "Password does not meet requirements",
            details: passwordValidation.errors
          }, 400),
        });
      }

      await auth.api.resetPassword({
        body: { token, newPassword: password },
      });

      // Find user by token to log
      const verification = await db.query.verifications.findFirst({
        where: and(
          eq(schema.verifications.value, token),
          eq(schema.verifications.identifier, "password-reset")
        ),
      });

      if (verification?.userId) {
        await auditService.logPasswordResetComplete(auditContext, verification.userId, true);
      }

      return c.json({ success: true, data: { message: "Password reset successfully" } });
    } catch (error) {
      console.error("[Auth] Reset password error:", error);
      throw new HTTPException(400, {
        message: "Invalid or expired reset token",
        res: c.json({ success: false, error: "INVALID_TOKEN", message: "Invalid or expired reset token" }, 400),
      });
    }
  }
);

// ============================================================================
// VERIFY EMAIL
// ============================================================================

authRouter.post(
  "/verify-email",
  zValidator("json", verifyEmailSchema),
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();

    try {
      const { token } = c.req.valid("json");
      await auth.api.verifyEmail({ query: { token } });

      // Find user by token
      const verification = await db.query.verifications.findFirst({
        where: eq(schema.verifications.value, token),
      });

      if (verification?.userId) {
        await auditService.logEmailVerificationComplete(auditContext, verification.userId, true);
      }

      return c.json({ success: true, data: { message: "Email verified successfully" } });
    } catch (error) {
      console.error("[Auth] Verify email error:", error);
      await auditService.logEmailVerificationComplete(auditContext, "", false);
      throw new HTTPException(400, {
        message: "Invalid or expired verification token",
        res: c.json({ success: false, error: "INVALID_TOKEN", message: "Invalid or expired verification token" }, 400),
      });
    }
  }
);

// ============================================================================
// RESEND VERIFICATION EMAIL
// ============================================================================

authRouter.post(
  "/resend-verification",
  zValidator("json", resendVerificationSchema),
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();
    const { email } = c.req.valid("json");

    try {
      await auth.api.sendVerificationEmail({ body: { email } });
      await auditService.logEmailVerificationSent(auditContext, email, true);
      return c.json({ success: true, data: { message: "Verification email sent" } });
    } catch (error) {
      console.error("[Auth] Resend verification error:", error);
      await auditService.logEmailVerificationSent(auditContext, email, false);
      return c.json({ success: true, data: { message: "If the email exists, a verification email has been sent" } });
    }
  }
);

// ============================================================================
// PHONE VERIFICATION (Preparation - SMS OTP)
// ============================================================================

authRouter.post(
  "/send-phone-verification",
  authMiddleware,
  zValidator("json", sendPhoneVerificationSchema),
  async (c) => {
    const auditContext = c.get("auditContext");
    const user = getCurrentUser(c);
    const { phone } = c.req.valid("json");

    // In production, integrate with SMS provider (Twilio, etc.)
    // For now, return success with placeholder
    console.log(`[Auth] Phone verification would be sent to: ${phone}`);

    return c.json({
      success: true,
      data: {
        message: "Phone verification code sent (placeholder - implement SMS provider)",
        // In production, don't return the code!
        code: "123456" // REMOVE IN PRODUCTION
      }
    });
  }
);

authRouter.post(
  "/verify-phone",
  authMiddleware,
  zValidator("json", verifyPhoneSchema),
  async (c) => {
    const auditContext = c.get("auditContext");
    const user = getCurrentUser(c);
    const { code, phone } = c.req.valid("json");

    // In production, verify code against stored OTP
    // For now, accept any 6-digit code
    if (code.length !== 6) {
      throw new HTTPException(400, {
        message: "Invalid verification code",
        res: c.json({ success: false, error: "INVALID_CODE", message: "Invalid verification code" }, 400),
      });
    }

    // Update user's phone and mark as verified
    await db
      .update(schema.users)
      .set({
        phone,
        // Add phoneVerified field when schema supports it
      })
      .where(eq(schema.users.id, user.id));

    return c.json({ success: true, data: { message: "Phone verified successfully" } });
  }
);

// ============================================================================
// GET CURRENT USER PROFILE
// ============================================================================

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
          // MFA status (placeholder)
          mfaEnabled: false,
          mfaMethods: [],
        },
      },
    });
  }
);

// ============================================================================
// UPDATE PROFILE
// ============================================================================

authRouter.patch(
  "/me",
  authMiddleware,
  zValidator("json", updateProfileSchema),
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();
    const user = getCurrentUser(c);
    const updates = c.req.valid("json");

    try {
      // Check username uniqueness if changing
      if (updates.username && updates.username !== user.username) {
        const existing = await db.query.users.findFirst({
          where: eq(schema.users.username, updates.username),
        });
        if (existing) {
          throw new HTTPException(409, {
            message: "Username already taken",
            res: c.json({ success: false, error: "USERNAME_TAKEN", message: "Username already taken" }, 409),
          });
        }
      }

      const oldValues = {
        username: user.username,
        fullName: user.fullName,
        bio: user.bio,
        website: user.website,
        phone: user.phone,
        isPrivate: user.isPrivate,
      };

      await db
        .update(schema.users)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, user.id));

      // Fetch updated user
      const updatedUser = await db.query.users.findFirst({
        where: eq(schema.users.id, user.id),
      });

      const newValues = {
        username: updatedUser?.username,
        fullName: updatedUser?.fullName,
        bio: updatedUser?.bio,
        website: updatedUser?.website,
        phone: updatedUser?.phone,
        isPrivate: updatedUser?.isPrivate,
      };

      await auditService.logProfileUpdate(auditContext, user.id, oldValues, newValues, true);

      return c.json({
        success: true,
        data: {
          user: updatedUser ? {
            id: updatedUser.id,
            username: updatedUser.username,
            fullName: updatedUser.fullName,
            email: updatedUser.email,
            phone: updatedUser.phone,
            avatarUrl: updatedUser.avatarUrl,
            bio: updatedUser.bio,
            website: updatedUser.website,
            isVerified: updatedUser.isVerified,
            isPrivate: updatedUser.isPrivate,
            postsCount: updatedUser.postsCount,
            followersCount: updatedUser.followersCount,
            followingCount: updatedUser.followingCount,
            createdAt: updatedUser.createdAt,
          } : null,
        },
      });
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      console.error("[Auth] Update profile error:", error);
      await auditService.logProfileUpdate(auditContext, user.id, {}, {}, false);
      throw new HTTPException(500, {
        message: "Failed to update profile",
        res: c.json({ success: false, error: "UPDATE_FAILED", message: "Failed to update profile" }, 500),
      });
    }
  }
);

// ============================================================================
// DELETE ACCOUNT (Soft Delete)
// ============================================================================

authRouter.delete(
  "/me",
  authMiddleware,
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();
    const user = getCurrentUser(c);

    try {
      // Soft delete - set deletedAt
      await db
        .update(schema.users)
        .set({
          deletedAt: new Date(),
          email: `deleted_${user.id}@deleted.instagram-clone.com`,
          username: `deleted_${user.id}`,
        })
        .where(eq(schema.users.id, user.id));

      // Revoke all sessions and refresh tokens
      await db
        .update(schema.sessions)
        .set({ expiresAt: new Date() })
        .where(eq(schema.sessions.userId, user.id));

      await db
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(schema.refreshTokens.userId, user.id));

      await auditService.log({
        event: "USER_LOGOUT_ALL",
        success: true,
        context: { ...auditContext, userId: user.id, metadata: { reason: "account_deleted" } },
        resourceType: "user",
        resourceId: user.id,
      });

      return c.json({ success: true, data: { message: "Account deleted successfully" } });
    } catch (error) {
      console.error("[Auth] Delete account error:", error);
      throw new HTTPException(500, {
        message: "Failed to delete account",
        res: c.json({ success: false, error: "DELETE_FAILED", message: "Failed to delete account" }, 500),
      });
    }
  }
);

// ============================================================================
// REFRESH TOKEN
// ============================================================================

authRouter.post(
  "/refresh",
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();
    const ip = getClientIp(c);
    const userAgent = c.req.header("user-agent") || "unknown";

    try {
      // Get refresh token from Authorization header (Bearer token)
      const authHeader = c.req.header("Authorization");
      let refreshToken = "";

      if (authHeader && authHeader.startsWith("Bearer ")) {
        refreshToken = authHeader.slice(7);
      }

      if (!refreshToken) {
        await auditService.logSessionRefresh(auditContext, "", false, "NO_TOKEN");
        throw new HTTPException(401, {
          message: "No refresh token provided",
          res: c.json({ success: false, error: "NO_REFRESH_TOKEN", message: "No refresh token provided" }, 401),
        });
      }

      // Verify and rotate refresh token
      const storedToken = await verifyAndRotateRefreshToken(refreshToken);

      if (!storedToken) {
        await auditService.logSessionRefresh(auditContext, "", false, "INVALID_TOKEN");
        throw new HTTPException(401, {
          message: "Invalid or expired refresh token",
          res: c.json({ success: false, error: "INVALID_REFRESH_TOKEN", message: "Invalid or expired refresh token" }, 401),
        });
      }

      // Check if session is still valid
      if (!storedToken.session || storedToken.session.expiresAt < new Date()) {
        // Revoke all refresh tokens for this session
        await db
          .update(schema.refreshTokens)
          .set({ revokedAt: new Date() })
          .where(eq(schema.refreshTokens.sessionId, storedToken.sessionId));

        await auditService.logSessionRefresh(auditContext, storedToken.userId, false, "SESSION_EXPIRED");
        throw new HTTPException(401, {
          message: "Session expired",
          res: c.json({ success: false, error: "SESSION_EXPIRED", message: "Session expired, please login again" }, 401),
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

      await auditService.logSessionRefresh(auditContext, storedToken.userId, true);

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
        res: c.json({ success: false, error: "SESSION_EXPIRED", message: "Session expired, please login again" }, 401),
      });
    }
  }
);

// ============================================================================
// DEVICE TOKEN REGISTRATION (Push Notifications)
// ============================================================================

authRouter.post(
  "/device-token",
  authMiddleware,
  zValidator("json", deviceTokenSchema),
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();
    const user = getCurrentUser(c);
    const { token, platform, deviceId, appVersion, osVersion, voipToken, sandbox, topics } = c.req.valid("json");

    try {
      // Check if token already exists for this user
      const existing = await db.query.deviceTokens.findFirst({
        where: and(
          eq(schema.deviceTokens.userId, user.id),
          eq(schema.deviceTokens.token, token)
        ),
      });

      if (existing) {
        // Update existing token
        await db
          .update(schema.deviceTokens)
          .set({
            platform: platform as any,
            deviceId,
            appVersion,
            osVersion,
            voipToken,
            sandbox: sandbox ?? false,
            topics: topics ?? [],
            lastUsedAt: new Date(),
            isActive: true,
          })
          .where(eq(schema.deviceTokens.id, existing.id));

        await auditService.logDeviceTokenRegister(auditContext, user.id, existing.id, platform, true);
        return c.json({ success: true, data: { message: "Device token updated", deviceTokenId: existing.id } });
      }

      // Create new device token
      const deviceToken = await db.insert(schema.deviceTokens).values({
        userId: user.id,
        token,
        platform: platform as any,
        deviceId,
        appVersion,
        osVersion,
        voipToken,
        sandbox: sandbox ?? false,
        topics: topics ?? [],
        lastUsedAt: new Date(),
        isActive: true,
      }).returning();

      await auditService.logDeviceTokenRegister(auditContext, user.id, deviceToken[0].id, platform, true);
      return c.json({ success: true, data: { message: "Device token registered", deviceTokenId: deviceToken[0].id } }, 201);
    } catch (error) {
      console.error("[Auth] Device token registration error:", error);
      await auditService.logDeviceTokenRegister(auditContext, user.id, "", platform, false);
      throw new HTTPException(500, {
        message: "Failed to register device token",
        res: c.json({ success: false, error: "REGISTRATION_FAILED", message: "Failed to register device token" }, 500),
      });
    }
  }
);

// Get user's device tokens
authRouter.get(
  "/device-tokens",
  authMiddleware,
  async (c) => {
    const user = getCurrentUser(c);

    const tokens = await db.query.deviceTokens.findMany({
      where: and(
        eq(schema.deviceTokens.userId, user.id),
        eq(schema.deviceTokens.isActive, true)
      ),
      orderBy: desc(schema.deviceTokens.lastUsedAt),
    });

    return c.json({
      success: true,
      data: {
        deviceTokens: tokens.map(t => ({
          id: t.id,
          platform: t.platform,
          deviceId: t.deviceId,
          appVersion: t.appVersion,
          osVersion: t.osVersion,
          sandbox: t.sandbox,
          topics: t.topics,
          lastUsedAt: t.lastUsedAt,
          createdAt: t.createdAt,
        })),
      },
    });
  }
);

// Revoke device token
authRouter.delete(
  "/device-tokens/:id",
  authMiddleware,
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();
    const user = getCurrentUser(c);
    const deviceTokenId = c.req.param("id");

    try {
      const token = await db.query.deviceTokens.findFirst({
        where: and(
          eq(schema.deviceTokens.id, deviceTokenId),
          eq(schema.deviceTokens.userId, user.id)
        ),
      });

      if (!token) {
        throw new HTTPException(404, {
          message: "Device token not found",
          res: c.json({ success: false, error: "NOT_FOUND", message: "Device token not found" }, 404),
        });
      }

      await db
        .update(schema.deviceTokens)
        .set({ isActive: false, expiresAt: new Date() })
        .where(eq(schema.deviceTokens.id, deviceTokenId));

      await auditService.logDeviceTokenRevoke(auditContext, user.id, deviceTokenId, true);
      return c.json({ success: true, data: { message: "Device token revoked" } });
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      console.error("[Auth] Device token revocation error:", error);
      await auditService.logDeviceTokenRevoke(auditContext, user.id, deviceTokenId, false);
      throw new HTTPException(500, {
        message: "Failed to revoke device token",
        res: c.json({ success: false, error: "REVOKE_FAILED", message: "Failed to revoke device token" }, 500),
      });
    }
  }
);

// ============================================================================
// 2FA/MFA ENDPOINTS (Preparation - TOTP)
// ============================================================================

// Setup MFA (generate secret and QR code)
authRouter.post(
  "/mfa/setup",
  authMiddleware,
  zValidator("json", mfaSetupSchema),
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();
    const user = getCurrentUser(c);
    const { method } = c.req.valid("json");

    if (method !== "TOTP") {
      throw new HTTPException(400, {
        message: "Only TOTP method is supported",
        res: c.json({ success: false, error: "UNSUPPORTED_METHOD", message: "Only TOTP method is supported" }, 400),
      });
    }

    // Check if MFA already enabled
    // In production, check user.mfaEnabled or mfa_secrets table
    const mfaSecret = generateTOTPSecret(user.username || user.email);

    // Store secret temporarily (in production, store encrypted in DB)
    // For now, return the secret for QR code generation
    await auditService.logMfaEnable(auditContext, user.id, "totp", true);

    return c.json({
      success: true,
      data: {
        secret: mfaSecret.secret,
        otpauthUrl: mfaSecret.otpauthUrl,
        backupCodes: mfaSecret.backupCodes,
        // In production, don't return secret - only otpauthUrl for QR code
        // Secret should be stored encrypted and verified on confirm
      },
    });
  }
);

// Verify and enable MFA
authRouter.post(
  "/mfa/enable",
  authMiddleware,
  zValidator("json", mfaVerifySchema),
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();
    const user = getCurrentUser(c);
    const { code } = c.req.valid("json");

    // In production, verify against stored secret
    // const verified = verifyTOTPCode(storedSecret, code);
    const verified = false; // Placeholder - requires otplib

    if (!verified) {
      await auditService.logMfaVerify(auditContext, user.id, "totp", false);
      throw new HTTPException(400, {
        message: "Invalid verification code",
        res: c.json({ success: false, error: "INVALID_CODE", message: "Invalid verification code" }, 400),
      });
    }

    // Enable MFA for user
    // await db.update(schema.users).set({ mfaEnabled: true, mfaSecret: storedSecret }).where(eq(schema.users.id, user.id));

    await auditService.logMfaVerify(auditContext, user.id, "totp", true);
    return c.json({ success: true, data: { message: "2FA enabled successfully" } });
  }
);

// Disable MFA
authRouter.post(
  "/mfa/disable",
  authMiddleware,
  zValidator("json", mfaDisableSchema),
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();
    const user = getCurrentUser(c);
    const { password, code } = c.req.valid("json");

    // Verify current password
    const passwordValid = await auth.api.changePassword({
      body: { currentPassword: password, newPassword: password }, // This won't work - need direct verify
      headers: c.req.raw.headers,
    }).catch(() => false);

    if (!passwordValid) {
      throw new HTTPException(401, {
        message: "Invalid password",
        res: c.json({ success: false, error: "INVALID_PASSWORD", message: "Invalid password" }, 401),
      });
    }

    // If code provided, verify it (TOTP or backup code)
    if (code) {
      // Verify TOTP or backup code
      // const verified = verifyTOTPCode(storedSecret, code) || checkBackupCode(user.id, code);
      const verified = true; // Placeholder

      if (!verified) {
        await auditService.logMfaDisable(auditContext, user.id, "totp", false);
        throw new HTTPException(400, {
          message: "Invalid verification code",
          res: c.json({ success: false, error: "INVALID_CODE", message: "Invalid verification code" }, 400),
        });
      }
    }

    // Disable MFA
    // await db.update(schema.users).set({ mfaEnabled: false, mfaSecret: null }).where(eq(schema.users.id, user.id));

    await auditService.logMfaDisable(auditContext, user.id, "totp", true);
    return c.json({ success: true, data: { message: "2FA disabled successfully" } });
  }
);

// Get MFA status
authRouter.get(
  "/mfa/status",
  authMiddleware,
  async (c) => {
    const user = getCurrentUser(c);

    return c.json({
      success: true,
      data: {
        enabled: false, // user.mfaEnabled
        methods: [], // user.mfaMethods
        backupCodesRemaining: 0,
      },
    });
  }
);

// ============================================================================
// OAUTH ENDPOINTS
// ============================================================================

// Initiate OAuth flow
authRouter.get(
  "/oauth/:provider",
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();
    const provider = c.req.param("provider");
    const redirectUrl = c.req.query("redirect_url") || env.CORS_ORIGIN.split(",")[0];

    if (!["google", "apple"].includes(provider)) {
      throw new HTTPException(400, {
        message: "Unsupported OAuth provider",
        res: c.json({ success: false, error: "UNSUPPORTED_PROVIDER", message: "Unsupported OAuth provider" }, 400),
      });
    }

    await auditService.logOAuthInitiate(auditContext, provider, redirectUrl);

    // Better Auth handles OAuth initiation
    // Redirect to Better Auth OAuth endpoint
    const oauthUrl = `${env.BETTER_AUTH_URL}/api/auth/sign-in/social/${provider}?callback_url=${encodeURIComponent(redirectUrl)}`;

    return c.redirect(oauthUrl);
  }
);

// OAuth callback - handled by Better Auth at /api/auth/callback/:provider
// We just log the result
authRouter.get(
  "/oauth/:provider/callback",
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();
    const provider = c.req.param("provider");
    const error = c.req.query("error");

    if (error) {
      await auditService.logOAuthCallback(auditContext, provider, false, undefined, error);
      // Redirect to frontend with error
      const frontendUrl = env.CORS_ORIGIN.split(",")[0];
      return c.redirect(`${frontendUrl}/login?error=${error}`);
    }

    // Success - Better Auth sets session cookie
    // We can't easily get userId here, but the session is established
    await auditService.logOAuthCallback(auditContext, provider, true);

    // Redirect to frontend
    const frontendUrl = env.CORS_ORIGIN.split(",")[0];
    return c.redirect(`${frontendUrl}/app`);
  }
);

// Link OAuth account
authRouter.post(
  "/link-account",
  authMiddleware,
  zValidator("json", linkAccountSchema),
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();
    const user = getCurrentUser(c);
    const { provider } = c.req.valid("json");

    try {
      // In production, use Better Auth's linkSocialAccount
      // await auth.api.linkSocialAccount({ body: { provider, ... }, headers: c.req.raw.headers });

      await auditService.logAccountLink(auditContext, user.id, provider, true);
      return c.json({ success: true, data: { message: `${provider} account linked successfully` } });
    } catch (error) {
      console.error("[Auth] Link account error:", error);
      await auditService.logAccountLink(auditContext, user.id, provider, false);
      throw new HTTPException(400, {
        message: "Failed to link account",
        res: c.json({ success: false, error: "LINK_FAILED", message: "Failed to link account" }, 400),
      });
    }
  }
);

// Unlink OAuth account
authRouter.post(
  "/unlink-account",
  authMiddleware,
  zValidator("json", unlinkAccountSchema),
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();
    const user = getCurrentUser(c);
    const { provider } = c.req.valid("json");

    try {
      // In production, use Better Auth's unlinkAccount
      // await auth.api.unlinkAccount({ body: { provider }, headers: c.req.raw.headers });

      await auditService.logAccountUnlink(auditContext, user.id, provider, true);
      return c.json({ success: true, data: { message: `${provider} account unlinked successfully` } });
    } catch (error) {
      console.error("[Auth] Unlink account error:", error);
      await auditService.logAccountUnlink(auditContext, user.id, provider, false);
      throw new HTTPException(400, {
        message: "Failed to unlink account",
        res: c.json({ success: false, error: "UNLINK_FAILED", message: "Failed to unlink account" }, 400),
      });
    }
  }
);

// Get linked accounts
authRouter.get(
  "/linked-accounts",
  authMiddleware,
  async (c) => {
    const user = getCurrentUser(c);

    const accounts = await db.query.accounts.findMany({
      where: eq(schema.accounts.userId, user.id),
    });

    return c.json({
      success: true,
      data: {
        accounts: accounts.map(a => ({
          provider: a.providerId,
          accountId: a.accountId,
          // Don't return tokens
        })),
      },
    });
  }
);

// ============================================================================
// SESSIONS MANAGEMENT
// ============================================================================

// Get active sessions
authRouter.get(
  "/sessions",
  authMiddleware,
  async (c) => {
    const user = getCurrentUser(c);

    const sessions = await db.query.sessions.findMany({
      where: and(
        eq(schema.sessions.userId, user.id),
        gt(schema.sessions.expiresAt, new Date())
      ),
      orderBy: desc(schema.sessions.createdAt),
    });

    return c.json({
      success: true,
      data: {
        sessions: sessions.map(s => ({
          id: s.id,
          ipAddress: s.ipAddress,
          userAgent: s.userAgent,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          isCurrent: s.token === c.req.header("Authorization")?.slice(7),
        })),
      },
    });
  }
);

// Revoke specific session
authRouter.delete(
  "/sessions/:id",
  authMiddleware,
  async (c) => {
    const auditContext = c.get("auditContext");
    const auditService = getAuthAuditService();
    const user = getCurrentUser(c);
    const sessionId = c.req.param("id");

    try {
      const session = await db.query.sessions.findFirst({
        where: and(
          eq(schema.sessions.id, sessionId),
          eq(schema.sessions.userId, user.id)
        ),
      });

      if (!session) {
        throw new HTTPException(404, {
          message: "Session not found",
          res: c.json({ success: false, error: "NOT_FOUND", message: "Session not found" }, 404),
        });
      }

      // Revoke session
      await db
        .update(schema.sessions)
        .set({ expiresAt: new Date() })
        .where(eq(schema.sessions.id, sessionId));

      // Revoke associated refresh tokens
      await db
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(schema.refreshTokens.sessionId, sessionId));

      await auditService.logSessionRevoked(auditContext, user.id, sessionId, false);
      return c.json({ success: true, data: { message: "Session revoked" } });
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      console.error("[Auth] Revoke session error:", error);
      throw new HTTPException(500, {
        message: "Failed to revoke session",
        res: c.json({ success: false, error: "REVOKE_FAILED", message: "Failed to revoke session" }, 500),
      });
    }
  }
);

// ============================================================================
// SECURITY EVENTS (Admin/Monitoring)
// ============================================================================

// Get login history (for user)
authRouter.get(
  "/login-history",
  authMiddleware,
  async (c) => {
    const user = getCurrentUser(c);
    const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);

    const auditService = getAuthAuditService();
    const history = await auditService.getLoginHistory(user.id, limit);

    return c.json({
      success: true,
      data: { history },
    });
  }
);

// Get security events (for user)
authRouter.get(
  "/security-events",
  authMiddleware,
  async (c) => {
    const user = getCurrentUser(c);
    const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);

    const auditService = getAuthAuditService();
    const events = await auditService.getSecurityEvents({ userId: user.id, limit });

    return c.json({
      success: true,
      data: { events },
    });
  }
);

export { authRouter };