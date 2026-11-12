/**
 * Authentication Helpers for WebSocket
 *
 * Contains token verification and authentication utilities
 */

import { db } from "../db/client";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";

/**
 * Verify Better Auth session token
 * Better Auth uses opaque session tokens - look up in database
 */
export async function verifyBetterAuthToken(token: string): Promise<string | null> {
  try {
    // Look up session in database
    const session = await db.query.sessions.findFirst({
      where: eq(schema.sessions.token, token),
      with: { user: true },
    });

    if (!session || session.expiresAt < new Date()) {
      return null;
    }

    // Update session activity (sliding window)
    await db
      .update(schema.sessions)
      .set({ updatedAt: new Date() })
      .where(eq(schema.sessions.id, session.id));

    return session.userId;
  } catch (error) {
    console.error("[AuthHelpers] Token verification failed:", error);
    return null;
  }
}

/**
 * Verify token and return full session info
 */
export async function verifyTokenWithSession(token: string): Promise<{
  userId: string;
  sessionId: string;
  expiresAt: Date;
} | null> {
  try {
    const session = await db.query.sessions.findFirst({
      where: eq(schema.sessions.token, token),
      with: { user: true },
    });

    if (!session || session.expiresAt < new Date()) {
      return null;
    }

    // Update session activity (sliding window)
    await db
      .update(schema.sessions)
      .set({ updatedAt: new Date() })
      .where(eq(schema.sessions.id, session.id));

    return {
      userId: session.userId,
      sessionId: session.id,
      expiresAt: session.expiresAt,
    };
  } catch (error) {
    console.error("[AuthHelpers] Token verification failed:", error);
    return null;
  }
}

/**
 * Revoke a session (logout)
 */
export async function revokeSession(token: string): Promise<boolean> {
  try {
    const result = await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.token, token))
      .returning({ id: schema.sessions.id });
    return result.length > 0;
  } catch (error) {
    console.error("[AuthHelpers] Failed to revoke session:", error);
    return false;
  }
}

/**
 * Revoke all sessions for a user
 */
export async function revokeAllUserSessions(userId: string): Promise<number> {
  try {
    const result = await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.userId, userId))
      .returning({ id: schema.sessions.id });
    return result.length;
  } catch (error) {
    console.error("[AuthHelpers] Failed to revoke all sessions:", error);
    return 0;
  }
}

/**
 * Create a new session for a user
 */
export async function createSession(
  userId: string,
  token: string,
  expiresAt: Date,
  ipAddress?: string,
  userAgent?: string
): Promise<any> {
  const [result] = await db
    .insert(schema.sessions)
    .values({
      userId,
      token,
      expiresAt,
      ipAddress,
      userAgent,
    })
    .returning();
  return result;
}

/**
 * Get active sessions for a user
 */
export async function getUserSessions(userId: string): Promise<any[]> {
  return db.query.sessions.findMany({
    where: eq(schema.sessions.userId, userId),
    orderBy: (sessions, { desc }) => [desc(sessions.createdAt)],
  });
}