import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { JWTPayload, jwtVerify, createRemoteJWKSet } from "jose";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../db/schema";
import { eq } from "drizzle-orm";

// Use process.env directly since parseEnv types don't include function env vars
const DATABASE_URL = process.env.DATABASE_URL!;
const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL!;

// Create a separate pool for middleware (since it runs outside the main app pool)
const middlewarePool = new Pool({
  connectionString: DATABASE_URL,
  max: 3,
});
const middlewareDb = drizzle(middlewarePool, { schema });

// Create JWKS client for Better Auth
// Better Auth exposes JWKS at {baseURL}/.well-known/jwks.json
const jwksUrl = `${BETTER_AUTH_URL}/.well-known/jwks.json`;
const jwks = createRemoteJWKSet(new URL(jwksUrl));

// Extend Hono's context with user
declare module "hono" {
  interface ContextVariableMap {
    user: typeof schema.users.$inferSelect;
    session: { userId: string; sessionId: string };
  }
}

// Custom JWT payload type
interface AuthJWTPayload extends JWTPayload {
  sub: string;
  sessionId: string;
  email: string;
  username?: string;
}

/**
 * Authentication middleware for Hono
 * Verifies JWT token using Better Auth's JWKS
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
    // Verify JWT using Better Auth's JWKS
    const { payload } = await jwtVerify<AuthJWTPayload>(token, jwks, {
      issuer: BETTER_AUTH_URL,
      audience: "instagram-clone", // Match your client ID
    });

    // Check if token is expired (jose does this automatically)
    // Fetch user from database
    const user = await middlewareDb.query.users.findFirst({
      where: eq(schema.users.id, payload.sub),
      columns: {
        id: true,
        firebaseUid: true,
        username: true,
        fullName: true,
        email: true,
        phone: true,
        avatarUrl: true,
        bio: true,
        website: true,
        isVerified: true,
        isPrivate: true,
        postsCount: true,
        followersCount: true,
        followingCount: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new HTTPException(401, {
        message: "User not found",
        res: c.json({ success: false, error: "UNAUTHORIZED", message: "User not found" }),
      });
    }

    // Set user and session in context
    c.set("user", user);
    c.set("session", { userId: user.id, sessionId: payload.sessionId });

    await next();
  } catch (error) {
    if (error instanceof HTTPException) throw error;

    console.error("[Auth] Token verification failed:", error);

    // Check for specific JWT errors
    if (error instanceof Error) {
      if (error.message.includes("expired") || error.message.includes("exp")) {
        throw new HTTPException(401, {
          message: "Token expired",
          res: c.json({ success: false, error: "TOKEN_EXPIRED", message: "Token expired, please login again" }),
        });
      }
      if (error.message.includes("invalid") || error.message.includes("signature")) {
        throw new HTTPException(401, {
          message: "Invalid token",
          res: c.json({ success: false, error: "INVALID_TOKEN", message: "Invalid token signature" }),
        });
      }
    }

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
    const { payload } = await jwtVerify<AuthJWTPayload>(token, jwks, {
      issuer: BETTER_AUTH_URL,
      audience: "instagram-clone",
    });

    const user = await middlewareDb.query.users.findFirst({
      where: eq(schema.users.id, payload.sub),
      columns: {
        id: true,
        firebaseUid: true,
        username: true,
        fullName: true,
        email: true,
        phone: true,
        avatarUrl: true,
        bio: true,
        website: true,
        isVerified: true,
        isPrivate: true,
        postsCount: true,
        followersCount: true,
        followingCount: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (user) {
      c.set("user", user);
      c.set("session", { userId: user.id, sessionId: payload.sessionId });
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