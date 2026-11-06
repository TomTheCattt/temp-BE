import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { auth } from "../config/auth";
import { authMiddleware, getCurrentUser } from "../middleware/auth";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, gt } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

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

// Create auth router
const authRouter = new Hono();

// Custom register endpoint that adds username
authRouter.post(
  "/register",
  zValidator("json", registerSchema),
  async (c) => {
    try {
      const { email, password, username, fullName, phone } = c.req.valid("json");

      // Check if username is taken
      const existingUser = await db.query.users.findFirst({
        where: eq(schema.users.username, username),
      });
      if (existingUser) {
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
        throw new HTTPException(500, {
          message: "Registration failed",
          res: c.json({ success: false, error: "REGISTRATION_FAILED", message: e instanceof Error ? e.message : "Failed to create account" }),
        });
      }

      if (!result?.user) {
        console.error("[Auth] No user returned from Better Auth:", result);
        throw new HTTPException(500, {
          message: "Registration failed",
          res: c.json({ success: false, error: "REGISTRATION_FAILED", message: "Failed to create account" }),
        });
      }

      // Get full user data from our database
      const user = await db.query.users.findFirst({
        where: eq(schema.users.id, result.user.id),
      });

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
          refreshToken: result.token,
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
    try {
      const { email, password } = c.req.valid("json");

      const result = await auth.api.signInEmail({
        body: { email, password },
      });

      if (!result?.user || !result?.token) {
        throw new HTTPException(401, {
          message: "Invalid credentials",
          res: c.json({ success: false, error: "INVALID_CREDENTIALS", message: "Invalid email or password" }),
        });
      }

      // Get full user data from our database
      const user = await db.query.users.findFirst({
        where: eq(schema.users.id, result.user.id),
      });

      // Return session token for Bearer token authentication
      // For mobile: return accessToken (sessionToken), refreshToken (same), expiresAt
      const sessionToken = result.token;
      const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 7 days from now

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
          refreshToken: sessionToken,
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
      await auth.api.signOut({
        headers: c.req.raw.headers,
      });
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
      // revokeSessions doesn't take a body, just uses the current session from headers
      await auth.api.revokeSessions({
        headers: c.req.raw.headers,
      });
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

      await auth.api.changePassword({
        body: {
          currentPassword,
          newPassword,
          revokeOtherSessions: true,
        },
        headers: c.req.raw.headers,
      });

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
      await auth.api.requestPasswordReset({
        body: { email, redirectTo: `${process.env.CORS_ORIGIN}/reset-password` },
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
      await auth.api.verifyEmail({ query: { token } });
      return c.json({ success: true, data: { message: "Email verified successfully" } });
    } catch (error) {
      console.error("[Auth] Verify email error:", error);
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
    try {
      const { email } = c.req.valid("json");
      await auth.api.sendVerificationEmail({ body: { email } });
      return c.json({ success: true, data: { message: "Verification email sent" } });
    } catch (error) {
      console.error("[Auth] Resend verification error:", error);
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
    try {
      // Try to get refresh token from Authorization header (Bearer token)
      const authHeader = c.req.header("Authorization");
      let refreshToken = "";

      if (authHeader && authHeader.startsWith("Bearer ")) {
        refreshToken = authHeader.slice(7);
      }

      // If no Bearer token, try to get from cookies (for web)
      if (!refreshToken) {
        const session = await auth.api.getSession({
          headers: c.req.raw.headers,
        });
        if (session) {
          // Extend session expiry in database
          await db
            .update(schema.sessions)
            .set({
              expiresAt: new Date(Date.now() + 60 * 60 * 24 * 7 * 1000), // Extend 7 days
              updatedAt: new Date(),
            })
            .where(eq(schema.sessions.token, session.session.id));

          const newExpiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
          return c.json({
            success: true,
            data: {
              accessToken: session.session.token,
              refreshToken: session.session.token,
              expiresAt: newExpiresAt,
            },
          });
        }
        throw new HTTPException(401, {
          message: "No valid session",
          res: c.json({ success: false, error: "NO_SESSION", message: "No valid session" }),
        });
      }

      // Validate refresh token (Bearer token) against sessions table
      const sessionRecord = await db.query.sessions.findFirst({
        where: and(
          eq(schema.sessions.token, refreshToken),
          gt(schema.sessions.expiresAt, new Date()) // Not expired
        ),
      });

      if (!sessionRecord) {
        throw new HTTPException(401, {
          message: "Invalid or expired refresh token",
          res: c.json({ success: false, error: "INVALID_REFRESH_TOKEN", message: "Invalid or expired refresh token" }),
        });
      }

      // Extend session expiry in database (sliding window)
      const newExpiresAt = new Date(Date.now() + 60 * 60 * 24 * 7 * 1000); // 7 days from now
      await db
        .update(schema.sessions)
        .set({
          expiresAt: newExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.sessions.id, sessionRecord.id));

      const expiresAtUnix = Math.floor(newExpiresAt.getTime() / 1000);

      return c.json({
        success: true,
        data: {
          accessToken: sessionRecord.token,
          refreshToken: sessionRecord.token,
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