import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, gt, sql } from "drizzle-orm";
import { env } from "../config/env";
import type { ContentfulStatusCode } from "hono/utils/http-status";
// ResponseInit is a global Web API type, no import needed

/**
 * Idempotency Key Middleware
 *
 * Provides idempotency for mutating operations (POST, PUT, PATCH, DELETE).
 * Stores response bodies keyed by idempotency key + user + endpoint.
 *
 * Features:
 * - Automatic key extraction from Idempotency-Key header
 * - Response caching with TTL (24 hours default)
 * - Race condition protection using database locks
 * - Works with any HTTP method
 * - Configurable key prefix and TTL
 */

// ============================================================================
// Types
// ============================================================================

export interface IdempotencyOptions {
  // Header name (default: "idempotency-key")
  headerName?: string;
  // TTL in seconds (default: 24 hours)
  ttl?: number;
  // Key prefix for storage (default: "idem")
  keyPrefix?: string;
  // HTTP methods to apply idempotency (default: mutating methods)
  methods?: string[];
  // Whether to require idempotency key for mutating endpoints (default: false)
  required?: boolean;
  // Custom key generator
  keyGenerator?: (c: any) => string | null;
  // Storage backend: "database" | "redis" | "memory" (default: "database")
  storage?: "database" | "redis" | "memory";
  // Error handler
  onError?: (error: Error, c: any) => Response | void;
}

export interface IdempotencyRecord {
  key: string;
  userId: string | null;
  endpoint: string;
  method: string;
  requestHash: string;
  responseStatus: number;
  responseBody: string;
  responseHeaders: Record<string, string>;
  createdAt: Date;
  expiresAt: Date;
  locked: boolean;
  lockedAt: Date | null;
}

interface IdempotencyStorage {
  get(key: string): Promise<IdempotencyRecord | null>;
  set(record: IdempotencyRecord): Promise<void>;
  lock(key: string, owner: string, ttlMs: number): Promise<boolean>;
  unlock(key: string, owner: string): Promise<void>;
  delete(key: string): Promise<void>;
}

// ============================================================================
// In-Memory Storage (Development Only)
// ============================================================================

class MemoryStorage implements IdempotencyStorage {
  private store = new Map<string, IdempotencyRecord & { lockOwner?: string; lockExpiresAt?: number }>();

  async get(key: string): Promise<IdempotencyRecord | null> {
    const record = this.store.get(key);
    if (!record) return null;
    if (record.expiresAt < new Date()) {
      this.store.delete(key);
      return null;
    }
    return record;
  }

  async set(record: IdempotencyRecord): Promise<void> {
    this.store.set(record.key, record);
  }

  async lock(key: string, owner: string, ttlMs: number): Promise<boolean> {
    const record = this.store.get(key);
    if (!record) {
      // Create placeholder
      this.store.set(key, {
        key,
        userId: null,
        endpoint: "",
        method: "",
        requestHash: "",
        responseStatus: 0,
        responseBody: "",
        responseHeaders: {},
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + ttlMs),
        locked: true,
        lockedAt: new Date(),
        lockOwner: owner,
        lockExpiresAt: Date.now() + ttlMs,
      });
      return true;
    }
    if (record.locked && record.lockOwner !== owner) {
      if (record.lockExpiresAt && record.lockExpiresAt > Date.now()) {
        return false; // Locked by another request
      }
      // Lock expired, steal it
    }
    record.locked = true;
    record.lockOwner = owner;
    record.lockExpiresAt = Date.now() + ttlMs;
    record.lockedAt = new Date();
    return true;
  }

  async unlock(key: string, owner: string): Promise<void> {
    const record = this.store.get(key);
    if (record && record.lockOwner === owner) {
      record.locked = false;
      record.lockOwner = undefined;
      record.lockExpiresAt = undefined;
    }
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// ============================================================================
// Database Storage (Production)
// ============================================================================

class DatabaseStorage implements IdempotencyStorage {
  private tableName = "idempotency_keys";

  async get(key: string): Promise<IdempotencyRecord | null> {
    try {
      const result = await db.execute(sql`
        SELECT * FROM ${sql.identifier(this.tableName)}
        WHERE key = ${key} AND expires_at > NOW()
        LIMIT 1
      `);

      if (result.rows.length === 0) return null;

      const row = result.rows[0] as any;
      return {
        key: row.key,
        userId: row.user_id,
        endpoint: row.endpoint,
        method: row.method,
        requestHash: row.request_hash,
        responseStatus: row.response_status,
        responseBody: row.response_body,
        responseHeaders: row.response_headers ? JSON.parse(row.response_headers) : {},
        createdAt: new Date(row.created_at),
        expiresAt: new Date(row.expires_at),
        locked: row.locked,
        lockedAt: row.locked_at ? new Date(row.locked_at) : null,
      };
    } catch (error) {
      console.error("[Idempotency] Database get error:", error);
      return null;
    }
  }

  async set(record: IdempotencyRecord): Promise<void> {
    try {
      await db.execute(sql`
        INSERT INTO ${sql.identifier(this.tableName)} (
          key, user_id, endpoint, method, request_hash,
          response_status, response_body, response_headers,
          created_at, expires_at, locked, locked_at
        ) VALUES (
          ${record.key}, ${record.userId}, ${record.endpoint}, ${record.method}, ${record.requestHash},
          ${record.responseStatus}, ${record.responseBody}, ${JSON.stringify(record.responseHeaders)},
          ${record.createdAt}, ${record.expiresAt}, ${record.locked}, ${record.lockedAt}
        )
        ON CONFLICT (key) DO UPDATE SET
          response_status = EXCLUDED.response_status,
          response_body = EXCLUDED.response_body,
          response_headers = EXCLUDED.response_headers,
          locked = EXCLUDED.locked,
          locked_at = EXCLUDED.locked_at,
          expires_at = EXCLUDED.expires_at
      `);
    } catch (error) {
      console.error("[Idempotency] Database set error:", error);
    }
  }

  async lock(key: string, owner: string, ttlMs: number): Promise<boolean> {
    try {
      const result = await db.execute(sql`
        INSERT INTO ${sql.identifier(this.tableName)} (
          key, user_id, endpoint, method, request_hash,
          response_status, response_body, response_headers,
          created_at, expires_at, locked, locked_at, lock_owner
        ) VALUES (
          ${key}, NULL, '', '', '',
          0, '', '{}',
          NOW(), NOW() + ${sql.raw(`INTERVAL '${ttlMs} milliseconds'`)}::interval, true, NOW(), ${owner}
        )
        ON CONFLICT (key) DO UPDATE SET
          locked = CASE
            WHEN ${sql.identifier(this.tableName)}.locked AND ${sql.identifier(this.tableName)}.lock_owner != ${owner}
            AND ${sql.identifier(this.tableName)}.locked_at > NOW() - ${sql.raw(`INTERVAL '${ttlMs} milliseconds'`)}::interval
            THEN true
            ELSE false
          END,
          locked_at = CASE
            WHEN ${sql.identifier(this.tableName)}.locked AND ${sql.identifier(this.tableName)}.lock_owner != ${owner}
            AND ${sql.identifier(this.tableName)}.locked_at > NOW() - ${sql.raw(`INTERVAL '${ttlMs} milliseconds'`)}::interval
            THEN ${sql.identifier(this.tableName)}.locked_at
            ELSE NOW()
          END,
          lock_owner = CASE
            WHEN ${sql.identifier(this.tableName)}.locked AND ${sql.identifier(this.tableName)}.lock_owner != ${owner}
            AND ${sql.identifier(this.tableName)}.locked_at > NOW() - ${sql.raw(`INTERVAL '${ttlMs} milliseconds'`)}::interval
            THEN ${sql.identifier(this.tableName)}.lock_owner
            ELSE ${owner}
          END,
          expires_at = GREATEST(${sql.identifier(this.tableName)}.expires_at, NOW() + ${sql.raw(`INTERVAL '${ttlMs} milliseconds'`)}::interval)
        RETURNING locked, lock_owner
      `);

      if (result.rows.length > 0) {
        const row = result.rows[0] as any;
        return row.locked && row.lock_owner === owner;
      }
      return false;
    } catch (error) {
      console.error("[Idempotency] Database lock error:", error);
      return false;
    }
  }

  async unlock(key: string, owner: string): Promise<void> {
    try {
      await db.execute(sql`
        UPDATE ${sql.identifier(this.tableName)}
        SET locked = false, lock_owner = NULL, locked_at = NULL
        WHERE key = ${key} AND lock_owner = ${owner}
      `);
    } catch (error) {
      console.error("[Idempotency] Database unlock error:", error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await db.execute(sql`DELETE FROM ${sql.identifier(this.tableName)} WHERE key = ${key}`);
    } catch (error) {
      console.error("[Idempotency] Database delete error:", error);
    }
  }
}

// ============================================================================
// Redis/Upstash Storage (High Performance)
// ============================================================================

interface UpstashResponse<T = any> {
  result?: T;
  error?: string;
}

class RedisStorage implements IdempotencyStorage {
  private client: any = null;
  private prefix = "idem:";

  private async getClient() {
    if (this.client) return this.client;

    const restUrl = env.UPSTASH_REDIS_REST_URL;
    const restToken = env.UPSTASH_REDIS_REST_TOKEN;

    if (!restUrl || !restToken) {
      throw new Error("Upstash Redis not configured");
    }

    this.client = {
      async get(key: string): Promise<string | null> {
        const res = await fetch(`${restUrl}/get/${encodeURIComponent(key)}`, {
          headers: { Authorization: `Bearer ${restToken}` },
        });
        const data = await res.json() as UpstashResponse<string>;
        return data.result ?? null;
      },
      async set(key: string, value: string, ex?: number): Promise<boolean> {
        const url = ex
          ? `${restUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/EX/${ex}`
          : `${restUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${restToken}` },
          method: "POST",
        });
        return res.ok;
      },
      async del(key: string): Promise<boolean> {
        const res = await fetch(`${restUrl}/del/${encodeURIComponent(key)}`, {
          headers: { Authorization: `Bearer ${restToken}` },
          method: "POST",
        });
        return res.ok;
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
    return this.client;
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    try {
      const client = await this.getClient();
      const data = await client.get(`${this.prefix}${key}`);
      if (!data) return null;
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async set(record: IdempotencyRecord): Promise<void> {
    try {
      const client = await this.getClient();
      const ttl = Math.ceil((record.expiresAt.getTime() - Date.now()) / 1000);
      await client.set(`${this.prefix}${record.key}`, JSON.stringify(record), ttl > 0 ? ttl : 86400);
    } catch (error) {
      console.error("[Idempotency] Redis set error:", error);
    }
  }

  async lock(key: string, owner: string, ttlMs: number): Promise<boolean> {
    try {
      const client = await this.getClient();
      // Use SET NX EX for atomic lock
      const res = await fetch(`${env.UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(`${this.prefix}lock:${key}`)}/${encodeURIComponent(owner)}/NX/EX/${Math.ceil(ttlMs / 1000)}`, {
        headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` },
        method: "POST",
      });
      const data = await res.json() as UpstashResponse<string>;
      return data.result === "OK";
    } catch {
      return false;
    }
  }

  async unlock(key: string, owner: string): Promise<void> {
    try {
      const client = await this.getClient();
      // Lua script to only delete if owner matches
      await client.eval(`
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        else
          return 0
        end
      `, 1, `${this.prefix}lock:${key}`, owner);
    } catch (error) {
      console.error("[Idempotency] Redis unlock error:", error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const client = await this.getClient();
      await client.del(`${this.prefix}${key}`);
      await client.del(`${this.prefix}lock:${key}`);
    } catch (error) {
      console.error("[Idempotency] Redis delete error:", error);
    }
  }
}

// ============================================================================
// Storage Factory
// ============================================================================

let storageInstance: IdempotencyStorage | null = null;

function getStorage(type: "database" | "redis" | "memory"): IdempotencyStorage {
  if (storageInstance) return storageInstance;

  switch (type) {
    case "redis":
      try {
        storageInstance = new RedisStorage();
        console.log("[Idempotency] Using Redis/Upstash storage");
      } catch {
        console.warn("[Idempotency] Redis not available, falling back to database");
        storageInstance = new DatabaseStorage();
      }
      break;
    case "database":
      storageInstance = new DatabaseStorage();
      console.log("[Idempotency] Using database storage");
      break;
    case "memory":
    default:
      storageInstance = new MemoryStorage();
      console.warn("[Idempotency] Using in-memory storage (NOT for production!)");
      break;
  }

  return storageInstance;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a hash of the request body for deduplication.
 */
async function hashRequest(c: any): Promise<string> {
  const body = await c.req.text();
  const method = c.req.method;
  const path = c.req.path;
  const query = new URL(c.req.url).search;

  // Create a string representation
  const input = `${method}:${path}:${query}:${body}`;

  // Simple hash (in production, use crypto.subtle.digest)
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * Generate the full idempotency key.
 */
function generateFullKey(options: Required<IdempotencyOptions>, userId: string | null, endpoint: string, method: string, requestHash: string): string {
  const userPart = userId || "anonymous";
  return `${options.keyPrefix}:${userPart}:${method}:${endpoint}:${requestHash}`;
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Create idempotency middleware.
 *
 * Usage:
 * ```typescript
 * app.post("/v1/posts", idempotencyMiddleware(), handler);
 * ```
 */
export function idempotencyMiddleware(options: IdempotencyOptions = {}) {
  const {
    headerName = "idempotency-key",
    ttl = 24 * 60 * 60, // 24 hours
    keyPrefix = "idem",
    methods = ["POST", "PUT", "PATCH", "DELETE"],
    required = false,
    keyGenerator,
    storage = "database",
    onError,
  } = options;

  const opts: Required<IdempotencyOptions> = {
    headerName,
    ttl,
    keyPrefix,
    methods,
    required,
    keyGenerator: keyGenerator || (() => null),
    storage,
    onError: onError || (() => {}),
  };

  const storageBackend = getStorage(opts.storage);

  return createMiddleware(async (c, next) => {
    // Only apply to configured methods
    if (!opts.methods.includes(c.req.method)) {
      await next();
      return;
    }

    // Get idempotency key
    let idempotencyKey: string | undefined = c.req.header(opts.headerName) ?? undefined;

    // Allow custom key generator
    if (!idempotencyKey) {
      idempotencyKey = opts.keyGenerator(c) ?? undefined;
    }

    // If required but not provided, reject
    if (opts.required && !idempotencyKey) {
      throw new HTTPException(400, {
        message: `Missing required header: ${opts.headerName}`,
        res: c.json({
          type: "https://instagram-clone.com/errors/idempotency-key-required",
          title: "Idempotency Key Required",
          status: 400,
          detail: `This endpoint requires an ${opts.headerName} header for safe retries`,
          instance: c.req.path,
        }, 400),
      });
    }

    // If no key, skip idempotency
    if (!idempotencyKey) {
      await next();
      return;
    }

    // Validate key format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(idempotencyKey)) {
      throw new HTTPException(400, {
        message: "Invalid idempotency key format (must be UUID)",
        res: c.json({
          type: "https://instagram-clone.com/errors/invalid-idempotency-key",
          title: "Invalid Idempotency Key",
          status: 400,
          detail: "Idempotency key must be a valid UUID",
          instance: c.req.path,
        }, 400),
      });
    }

    // Get user ID if authenticated
    const user = c.get("user");
    const userId = user?.id || null;

    // Hash request for deduplication
    const requestHash = await hashRequest(c);

    // Generate full storage key
    const fullKey = generateFullKey(opts, userId, c.req.path, c.req.method, requestHash);

    // Try to acquire lock
    const lockOwner = `${fullKey}:${Date.now()}:${Math.random().toString(36).substring(7)}`;
    const lockAcquired = await storageBackend.lock(fullKey, lockOwner, 30000); // 30s lock timeout

    if (!lockAcquired) {
      // Another request is processing - wait and check for cached response
      // Wait a bit and retry getting the record
      await new Promise(resolve => setTimeout(resolve, 100));

      const existing = await storageBackend.get(fullKey);
      if (existing && existing.responseStatus > 0) {
        // Return cached response
        c.status(existing.responseStatus as ContentfulStatusCode);
        Object.entries(existing.responseHeaders).forEach(([key, value]) => {
          c.res.headers.set(key, value);
        });
        c.res.headers.set("x-idempotency-replay", "true");
        return c.body(existing.responseBody);
      }

      // No cached response yet, return conflict
      throw new HTTPException(409, {
        message: "Concurrent request with same idempotency key",
        res: c.json({
          type: "https://instagram-clone.com/errors/idempotency-conflict",
          title: "Idempotency Conflict",
          status: 409,
          detail: "Another request with the same idempotency key is being processed",
          instance: c.req.path,
        }, 409 as ContentfulStatusCode),
      });
    }

    try {
      // Check for existing completed request
      const existing = await storageBackend.get(fullKey);
      if (existing && existing.responseStatus > 0) {
        // Return cached response
        c.status(existing.responseStatus as ContentfulStatusCode);
        Object.entries(existing.responseHeaders).forEach(([key, value]) => {
          c.res.headers.set(key, value);
        });
        c.res.headers.set("x-idempotency-replay", "true");
        await storageBackend.unlock(fullKey, lockOwner);
        return c.body(existing.responseBody);
      }

      // Store pending record
      const pendingRecord: IdempotencyRecord = {
        key: fullKey,
        userId,
        endpoint: c.req.path,
        method: c.req.method,
        requestHash,
        responseStatus: 0,
        responseBody: "",
        responseHeaders: {},
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + opts.ttl * 1000),
        locked: true,
        lockedAt: new Date(),
      };
      await storageBackend.set(pendingRecord);

      // Execute handler
      await next();

      // After handler completes, capture response from c.res
      const responseStatus = c.res.status;
      let responseBody = "";
      const responseHeaders: Record<string, string> = {};

      // Get response body - we need to read it from the response
      // Clone the response to read body without consuming it
      const clonedRes = c.res.clone();
      try {
        responseBody = await clonedRes.text();
      } catch {
        responseBody = "";
      }

      // Capture headers
      for (const [key, value] of c.res.headers.entries()) {
        responseHeaders[key.toLowerCase()] = value;
      }

      // Only cache successful responses (2xx) and some client errors (4xx)
      if (responseStatus >= 200 && responseStatus < 500) {
        const completedRecord: IdempotencyRecord = {
          ...pendingRecord,
          responseStatus,
          responseBody,
          responseHeaders,
          locked: false,
          lockedAt: null,
        };
        await storageBackend.set(completedRecord);
      }

      // Release lock
      await storageBackend.unlock(fullKey, lockOwner);

      // Add idempotency header to response
      c.res.headers.set("x-idempotency-key", idempotencyKey);

    } catch (error) {
      // Release lock on error
      await storageBackend.unlock(fullKey, lockOwner);

      if (opts.onError) {
        opts.onError(error as Error, c);
      }
      throw error;
    }
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a response was served from idempotency cache.
 */
export function isIdempotencyReplay(c: any): boolean {
  return c.res.headers.get("x-idempotency-replay") === "true";
}

/**
 * Get the idempotency key from request.
 */
export function getIdempotencyKey(c: any): string | null {
  return c.req.header("idempotency-key") || null;
}

/**
 * Manually store an idempotent response (for use in handlers).
 */
export async function storeIdempotentResponse(
  c: any,
  idempotencyKey: string,
  responseStatus: number,
  responseBody: string,
  responseHeaders: Record<string, string> = {}
): Promise<void> {
  const user = c.get("user");
  const userId = user?.id || null;
  const requestHash = await hashRequest(c);

  const opts: Required<IdempotencyOptions> = {
    headerName: "idempotency-key",
    ttl: 24 * 60 * 60,
    keyPrefix: "idem",
    methods: ["POST", "PUT", "PATCH", "DELETE"],
    required: false,
    keyGenerator: () => null,
    storage: "database",
    onError: () => {},
  };

  const fullKey = generateFullKey(opts, userId, c.req.path, c.req.method, requestHash);
  const storageBackend = getStorage(opts.storage);

  const record: IdempotencyRecord = {
    key: fullKey,
    userId,
    endpoint: c.req.path,
    method: c.req.method,
    requestHash,
    responseStatus,
    responseBody,
    responseHeaders,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + opts.ttl * 1000),
    locked: false,
    lockedAt: null,
  };

  await storageBackend.set(record);
}

/**
 * Delete an idempotency key (for testing or manual cleanup).
 */
export async function deleteIdempotencyKey(c: any, idempotencyKey: string): Promise<void> {
  const user = c.get("user");
  const userId = user?.id || null;
  const requestHash = await hashRequest(c);

  const opts: Required<IdempotencyOptions> = {
    headerName: "idempotency-key",
    ttl: 24 * 60 * 60,
    keyPrefix: "idem",
    methods: ["POST", "PUT", "PATCH", "DELETE"],
    required: false,
    keyGenerator: () => null,
    storage: "database",
    onError: () => {},
  };

  const fullKey = generateFullKey(opts, userId, c.req.path, c.req.method, requestHash);
  const storageBackend = getStorage(opts.storage);

  await storageBackend.delete(fullKey);
}

/**
 * Cleanup expired idempotency keys (run as cron job).
 */
export async function cleanupExpiredIdempotencyKeys(): Promise<number> {
  const storageBackend = getStorage("database");
  // This would need a custom query for database storage
  // For now, rely on TTL expiration
  return 0;
}