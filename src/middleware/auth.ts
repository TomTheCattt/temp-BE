import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import * as schema from "../db/schema";
import { eq, and, gt } from "drizzle-orm";
import { db } from "../db/client";

// Extend Hono's context with user
declare module "hono" {
  interface ContextVariableMap {
    user: typeof schema.users.$inferSelect;
    session: { userId: string; sessionId: string };
  }
}

/**
 * Authentication middleware for Hono
 * Verifies session token by querying the sessions table directly
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new HTTPException(401, {
      message: "No token provided",
      res: c.json({ success: false, error: "UNAUTHORIZED", message: "No token provided" }),
    });
  }

  const token = authHeader.slice(7); // Remove "Bearer "

  try {
    // Verify session by querying the sessions table directly
    const sessionRecord = await db.query.sessions.findFirst({
      where: and(
        eq(schema.sessions.token, token),
        gt(schema.sessions.expiresAt, new Date()) // Not expired
      ),
    });

    if (!sessionRecord) {
      throw new HTTPException(401, {
        message: "Invalid or expired session",
        res: c.json({ success: false, error: "UNAUTHORIZED", message: "Invalid or expired session" }),
      });
    }

    // Fetch user from database - select all columns to match the expected type
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, sessionRecord.userId),
    });

    if (!user) {
      throw new HTTPException(401, {
        message: "User not found",
        res: c.json({ success: false, error: "UNAUTHORIZED", message: "User not found" }),
      });
    }

    // Set user and session in context
    c.set("user", user);
    c.set("session", { userId: user.id, sessionId: sessionRecord.id });

    await next();
  } catch (error) {
    if (error instanceof HTTPException) throw error;

    console.error("[Auth] Session verification failed:", error);
    throw new HTTPException(401, {
      message: "Invalid or expired token",
      res: c.json({ success: false, error: "UNAUTHORIZED", message: "Invalid or expired token" }),
    });
  }
});

/**
 * Optional authentication middleware
 * Does not throw if no token provided, but sets user if valid token
 */
export const optionalAuthMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    await next();
    return;
  }

  const token = authHeader.slice(7);

  try {
    const sessionRecord = await db.query.sessions.findFirst({
      where: and(
        eq(schema.sessions.token, token),
        gt(schema.sessions.expiresAt, new Date())
      ),
    });

    if (sessionRecord) {
      const user = await db.query.users.findFirst({
        where: eq(schema.users.id, sessionRecord.userId),
      });

      if (user) {
        c.set("user", user);
        c.set("session", { userId: user.id, sessionId: sessionRecord.id });
      }
    }
  } catch {
    // Silently ignore invalid tokens for optional auth
  }

  await next();
});

/**
 * Get current user from context (throws if not authenticated)
 */
export function getCurrentUser(c: any): typeof schema.users.$inferSelect {
  const user = c.get("user");
  if (!user) {
    throw new HTTPException(401, {
      message: "Not authenticated",
      res: c.json({ success: false, error: "UNAUTHORIZED", message: "Not authenticated" }),
    });
  }
  return user;
}

/**
 * Get current session from context
 */
export function getCurrentSession(c: any): { userId: string; sessionId: string } | undefined {
  return c.get("session");
}