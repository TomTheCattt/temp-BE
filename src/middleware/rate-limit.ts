import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { env } from "../config/env";

interface UpstashResponse<T = any> {
  result?: T;
  error?: string;
}

/**
 * Tiered Rate Limiting Middleware (Redis/Upstash)
 *
 * Implements sliding window rate limiting with tiered limits based on:
 * - Anonymous users (IP-based)
 * - Authenticated users (user-based)
 * - Specific endpoint categories (auth, upload, search, etc.)
 *
 * Returns standard rate limit headers:
 * - X-RateLimit-Limit: Maximum requests allowed in window
 * - X-RateLimit-Remaining: Remaining requests in current window
 * - X-RateLimit-Reset: Unix timestamp when window resets
 * - Retry-After: Seconds until next request allowed (on 429)
 */

// ============================================================================
// Types
// ============================================================================

export interface RateLimitTier {
  name: string;
  limit: number;           // Max requests per window
  windowMs: number;        // Window size in milliseconds
  burstMultiplier?: number; // Burst allowance (e.g., 2x for 30s burst)
}

export interface RateLimitConfig {
  // Tier definitions
  tiers: {
    anonymous: RateLimitTier;
    authenticated: RateLimitTier;
    authEndpoints: RateLimitTier;
    uploadEndpoints: RateLimitTier;
    searchEndpoints: RateLimitTier;
    websocket: RateLimitTier;
    admin: RateLimitTier;
  };
  // Key generators for different tiers
  keyGenerators: {
    anonymous: (c: any) => string;
    authenticated: (c: any) => string;
  };
  // Standard headers
  standardHeaders: boolean;
  // Handler for rate limit exceeded
  handler?: (c: any, retryAfter: number) => Response;
}

// ============================================================================
// Default Configuration (from DESIGN_DOCUMENT.md §4.4)
// ============================================================================

const DEFAULT_TIERS = {
  anonymous: { name: "anonymous", limit: 60, windowMs: 60 * 1000, burstMultiplier: 2 },      // 60 req/min, 2x burst
  authenticated: { name: "authenticated", limit: 300, windowMs: 60 * 1000, burstMultiplier: 2 }, // 300 req/min, 2x burst
  authEndpoints: { name: "authEndpoints", limit: 10, windowMs: 15 * 60 * 1000, burstMultiplier: 1 }, // 10 req/15min (production)
  uploadEndpoints: { name: "uploadEndpoints", limit: 50, windowMs: 60 * 60 * 1000, burstMultiplier: 1 }, // 50 req/hour
  searchEndpoints: { name: "searchEndpoints", limit: 30, windowMs: 60 * 1000, burstMultiplier: 2 }, // 30 req/min
  websocket: { name: "websocket", limit: 100, windowMs: 60 * 1000, burstMultiplier: 2 }, // 100 msg/min
  admin: { name: "admin", limit: 1000, windowMs: 60 * 1000, burstMultiplier: 5 }, // 1000 req/min
};

const DEFAULT_KEY_GENERATORS = {
  anonymous: (c: any) => {
    // Use IP address for anonymous users
    const forwarded = c.req.header("x-forwarded-for");
    const realIp = c.req.header("x-real-ip");
    const ip = forwarded?.split(",")[0]?.trim() || realIp || "unknown";
    return `ip:${ip}`;
  },
  authenticated: (c: any) => {
    // Use user ID for authenticated users
    const user = c.get("user");
    return user ? `user:${user.id}` : `ip:${c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"}`;
  },
};

// ============================================================================
// Redis/Upstash Client
// ============================================================================

interface RedisClient {
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  pttl(key: string): Promise<number>;
  eval(script: string, numKeys: number, ...keys: string[]): Promise<any>;
}

let redisClient: RedisClient | null = null;

/**
 * Initialize Redis/Upstash client.
 * Uses Upstash REST API if credentials are available, otherwise falls back to in-memory (dev only).
 */
export function getRedisClient(): RedisClient {
  if (redisClient) return redisClient;

  const restUrl = env.UPSTASH_REDIS_REST_URL;
  const restToken = env.UPSTASH_REDIS_REST_TOKEN;

  if (restUrl && restToken) {
    // Upstash REST client
    redisClient = {
      async incr(key: string): Promise<number> {
        const res = await fetch(`${restUrl}/incr/${encodeURIComponent(key)}`, {
          headers: { Authorization: `Bearer ${restToken}` },
        });
        const data = await res.json() as UpstashResponse<number>;
        return data.result ?? 0;
      },
      async decr(key: string): Promise<number> {
        const res = await fetch(`${restUrl}/decr/${encodeURIComponent(key)}`, {
          headers: { Authorization: `Bearer ${restToken}` },
        });
        const data = await res.json() as UpstashResponse<number>;
        return data.result ?? 0;
      },
      async expire(key: string, seconds: number): Promise<number> {
        const res = await fetch(`${restUrl}/expire/${encodeURIComponent(key)}/${seconds}`, {
          headers: { Authorization: `Bearer ${restToken}` },
          method: "POST",
        });
        const data = await res.json() as UpstashResponse<number>;
        return data.result ?? 0;
      },
      async pttl(key: string): Promise<number> {
        const res = await fetch(`${restUrl}/pttl/${encodeURIComponent(key)}`, {
          headers: { Authorization: `Bearer ${restToken}` },
        });
        const data = await res.json() as UpstashResponse<number>;
        return data.result ?? 0;
      },
      async eval(script: string, numKeys: number, ...keys: string[]): Promise<any> {
        const res = await fetch(`${restUrl}/eval`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${restToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ script, numKeys, keys, args: [] }),
        });
        const data = await res.json() as UpstashResponse<any>;
        return data.result;
      },
    };
  } else {
    // In-memory fallback for development (NOT for production!)
    const store = new Map<string, { count: number; expiresAt: number }>();

    redisClient = {
      async incr(key: string) {
        const now = Date.now();
        const entry = store.get(key);

        if (!entry || entry.expiresAt < now) {
          // New window
          store.set(key, { count: 1, expiresAt: now + 60000 }); // Default 1 min window
          return 1;
        }

        entry.count++;
        return entry.count;
      },
      async decr(key: string) {
        const entry = store.get(key);
        if (entry) {
          entry.count = Math.max(0, entry.count - 1);
          return entry.count;
        }
        return 0;
      },
      async expire(key: string, seconds: number) {
        const entry = store.get(key);
        if (entry) {
          entry.expiresAt = Date.now() + seconds * 1000;
          return 1;
        }
        return 0;
      },
      async pttl(key: string) {
        const entry = store.get(key);
        if (entry) {
          const remaining = entry.expiresAt - Date.now();
          return Math.max(0, remaining);
        }
        return -2; // Key doesn't exist
      },
      async eval(script: string, numKeys: number, ...keys: string[]) {
        // Simplified eval for sliding window - not fully implemented in memory
        // This is a fallback only
        const key = keys[0];
        const limit = parseInt(keys[1] || "100");
        const windowMs = parseInt(keys[2] || "60000");

        const entry = store.get(key);
        const now = Date.now();

        if (!entry || entry.expiresAt < now) {
          store.set(key, { count: 1, expiresAt: now + windowMs });
          return [1, limit - 1, windowMs, 1];
        }

        entry.count++;
        const remaining = Math.max(0, limit - entry.count);
        const ttl = entry.expiresAt - now;

        return [entry.count, remaining, ttl, entry.count > limit ? 1 : 0];
      },
    };

    console.warn("[RateLimit] Using in-memory store - NOT suitable for production!");
  }

  return redisClient;
}

// ============================================================================
// Sliding Window Rate Limiter (using Redis sorted sets for accuracy)
// ============================================================================

const SLIDING_WINDOW_SCRIPT = `
-- Sliding window rate limiting using Redis sorted sets
-- KEYS[1] = rate limit key
-- ARGV[1] = current timestamp (ms)
-- ARGV[2] = window size (ms)
-- ARGV[3] = limit
-- ARGV[4] = burst limit (optional, defaults to limit)

local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local burstLimit = tonumber(ARGV[4]) or limit

-- Remove expired entries
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

-- Count current requests
local count = redis.call('ZCARD', key)

-- Check if limit exceeded
if count >= burstLimit then
  local ttl = redis.call('PTTL', key)
  if ttl < 0 then ttl = window end
  return {count, 0, ttl, 1}
end

-- Add current request
local score = now .. "." .. math.random()
redis.call('ZADD', key, score, score)

-- Set expiry
redis.call('PEXPIRE', key, window)

local remaining = burstLimit - count - 1
local ttl = window

return {count + 1, remaining, ttl, 0}
`;

/**
 * Check rate limit using sliding window algorithm.
 */
async function checkRateLimit(
  client: RedisClient,
  key: string,
  limit: number,
  windowMs: number,
  burstLimit?: number
): Promise<{ allowed: boolean; current: number; remaining: number; resetMs: number; retryAfter?: number }> {
  const now = Date.now();
  const burst = burstLimit || limit;

  try {
    // Use sliding window script for accurate limiting
    const result = await client.eval(
      SLIDING_WINDOW_SCRIPT,
      1,
      key,
      now.toString(),
      windowMs.toString(),
      limit.toString(),
      burst.toString()
    ) as [number, number, number, number];

    const [current, remaining, resetMs, exceeded] = result;

    return {
      allowed: exceeded === 0,
      current,
      remaining: Math.max(0, remaining),
      resetMs: now + resetMs,
      retryAfter: exceeded === 1 ? Math.ceil(resetMs / 1000) : undefined,
    };
  } catch (error) {
    // Fallback to simple counter if script fails
    console.error("[RateLimit] Sliding window script failed, using fallback:", error);

    const current = await client.incr(key);

    if (current === 1) {
      // First request in window, set expiry
      await client.expire(key, Math.ceil(windowMs / 1000));
    }

    const ttl = await client.pttl(key);
    const resetMs = now + (ttl > 0 ? ttl : windowMs);
    const remaining = Math.max(0, limit - current);

    return {
      allowed: current <= limit,
      current,
      remaining,
      resetMs,
      retryAfter: current > limit ? Math.ceil((ttl > 0 ? ttl : windowMs) / 1000) : undefined,
    };
  }
}

// ============================================================================
// Middleware Factory
// ============================================================================

export interface RateLimitMiddlewareOptions {
  tier?: keyof typeof DEFAULT_TIERS;
  customTier?: RateLimitTier;
  keyGenerator?: (c: any) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  handler?: (c: any, retryAfter: number) => Response;
}

/**
 * Creates a rate limiting middleware for a specific tier.
 */
export function createRateLimitMiddleware(options: RateLimitMiddlewareOptions = {}) {
  const {
    tier = "authenticated",
    customTier,
    keyGenerator,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    handler,
  } = options;

  const tierConfig = customTier || DEFAULT_TIERS[tier];
  const redis = getRedisClient();

  return createMiddleware(async (c, next) => {
    // Generate key
    const key = keyGenerator
      ? keyGenerator(c)
      : (c.get("user")
          ? DEFAULT_KEY_GENERATORS.authenticated(c)
          : DEFAULT_KEY_GENERATORS.anonymous(c));

    const rateLimitKey = `ratelimit:${tierConfig.name}:${key}`;

    // Check rate limit
    const result = await checkRateLimit(
      redis,
      rateLimitKey,
      tierConfig.limit,
      tierConfig.windowMs,
      tierConfig.burstMultiplier ? tierConfig.limit * tierConfig.burstMultiplier : undefined
    );

    // Set standard headers
    c.res.headers.set("X-RateLimit-Limit", tierConfig.limit.toString());
    c.res.headers.set("X-RateLimit-Remaining", result.remaining.toString());
    c.res.headers.set("X-RateLimit-Reset", Math.ceil(result.resetMs / 1000).toString());

    if (tierConfig.burstMultiplier && tierConfig.burstMultiplier > 1) {
      c.res.headers.set("X-RateLimit-Burst-Limit", (tierConfig.limit * tierConfig.burstMultiplier).toString());
      c.res.headers.set("X-RateLimit-Burst-Multiplier", tierConfig.burstMultiplier.toString());
    }

    if (!result.allowed) {
      if (result.retryAfter) {
        c.res.headers.set("Retry-After", result.retryAfter.toString());
      }

      if (handler) {
        return handler(c, result.retryAfter || Math.ceil(tierConfig.windowMs / 1000));
      }

      throw new HTTPException(429, {
        message: "Rate limit exceeded",
        res: c.json({
          success: false,
          error: "RATE_LIMIT_EXCEEDED",
          message: `Too many requests. Limit: ${tierConfig.limit} per ${tierConfig.windowMs / 1000}s`,
          retryAfter: result.retryAfter,
        }, 429),
      });
    }

    // Store rate limit info for potential use in response
    c.set("rateLimit", result);

    await next();

    // Optionally skip counting successful/failed requests
    if (skipSuccessfulRequests && c.res.status < 400) {
      await redis.decr(rateLimitKey);
    } else if (skipFailedRequests && c.res.status >= 400) {
      await redis.decr(rateLimitKey);
    }
  });
}

// ============================================================================
// Pre-configured Middlewares for Different Tiers
// ============================================================================

/**
 * Anonymous users (IP-based) - 60 req/min with 2x burst
 */
export const anonymousRateLimit = createRateLimitMiddleware({
  tier: "anonymous",
});

/**
 * Authenticated users - 300 req/min with 2x burst
 */
export const authenticatedRateLimit = createRateLimitMiddleware({
  tier: "authenticated",
});

/**
 * Auth endpoints (login, register, etc.) - 10 req/15min strict
 */
export const authEndpointsRateLimit = createRateLimitMiddleware({
  tier: "authEndpoints",
  keyGenerator: (c) => {
    const forwarded = c.req.header("x-forwarded-for");
    const realIp = c.req.header("x-real-ip");
    const ip = forwarded?.split(",")[0]?.trim() || realIp || "unknown";
    return `ip:${ip}`;
  },
});

/**
 * Upload endpoints - 50 req/hour
 */
export const uploadEndpointsRateLimit = createRateLimitMiddleware({
  tier: "uploadEndpoints",
});

/**
 * Search endpoints - 30 req/min with 2x burst
 */
export const searchEndpointsRateLimit = createRateLimitMiddleware({
  tier: "searchEndpoints",
});

/**
 * Admin endpoints - 1000 req/min with 5x burst
 */
export const adminRateLimit = createRateLimitMiddleware({
  tier: "admin",
});

/**
 * WebSocket messages - 100 msg/min with 2x burst
 * Note: This should be used in WebSocket handler, not HTTP middleware
 */
export async function checkWebSocketRateLimit(
  userId: string,
  limit = 100,
  windowMs = 60 * 1000
): Promise<{ allowed: boolean; remaining: number; resetMs: number }> {
  const redis = getRedisClient();
  const key = `ratelimit:websocket:${userId}`;

  const result = await checkRateLimit(redis, key, limit, windowMs, limit * 2);
  return {
    allowed: result.allowed,
    remaining: result.remaining,
    resetMs: result.resetMs,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get current rate limit status for a key (without incrementing).
 */
export async function getRateLimitStatus(
  tier: keyof typeof DEFAULT_TIERS,
  key: string
): Promise<{ current: number; remaining: number; resetMs: number }> {
  const redis = getRedisClient();
  const tierConfig = DEFAULT_TIERS[tier];
  const rateLimitKey = `ratelimit:${tierConfig.name}:${key}`;

  // For sorted set, count entries
  try {
    const now = Date.now();
    const result = await redis.eval(`
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local window = tonumber(ARGV[2])
      redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
      return redis.call('ZCARD', key)
    `, 1, rateLimitKey, now.toString(), tierConfig.windowMs.toString()) as number;

    const current = result;
    const remaining = Math.max(0, tierConfig.limit - current);
    const ttl = await redis.pttl(rateLimitKey);
    const resetMs = Date.now() + (ttl > 0 ? ttl : tierConfig.windowMs);

    return { current, remaining, resetMs };
  } catch {
    // Fallback
    return { current: 0, remaining: tierConfig.limit, resetMs: Date.now() + tierConfig.windowMs };
  }
}

/**
 * Reset rate limit for a specific key (admin use).
 */
export async function resetRateLimit(tier: keyof typeof DEFAULT_TIERS, key: string): Promise<void> {
  const redis = getRedisClient();
  const tierConfig = DEFAULT_TIERS[tier];
  const rateLimitKey = `ratelimit:${tierConfig.name}:${key}`;

  // Delete the key
  await redis.eval(`redis.call('DEL', KEYS[1])`, 1, rateLimitKey);
}

/**
 * Get rate limit headers for manual inclusion in responses.
 */
export function getRateLimitHeaders(result: { limit: number; remaining: number; resetMs: number; burstLimit?: number; burstMultiplier?: number }): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": result.limit.toString(),
    "X-RateLimit-Remaining": result.remaining.toString(),
    "X-RateLimit-Reset": Math.ceil(result.resetMs / 1000).toString(),
  };

  if (result.burstLimit) {
    headers["X-RateLimit-Burst-Limit"] = result.burstLimit.toString();
  }
  if (result.burstMultiplier) {
    headers["X-RateLimit-Burst-Multiplier"] = result.burstMultiplier.toString();
  }

  return headers;
}