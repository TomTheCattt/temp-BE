import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { db, pool } from "../db/client";
import { sql } from "drizzle-orm";
import { telemetry, generatePrometheusMetrics, recordDbQuery, updateDbPoolMetrics } from "../middleware/telemetry";
import { logger, createModuleLogger } from "../services/logger";

/**
 * Enhanced Health Check Routes
 *
 * Provides:
 * - /health - Basic liveness probe (always returns 200 if process is alive)
 * - /ready - Readiness probe (checks dependencies: DB, Redis, external services)
 * - /metrics - Prometheus metrics endpoint
 * - /health/details - Detailed health information for debugging
 */

const healthRouter = new Hono();
const moduleLogger = createModuleLogger("health");

// Apply telemetry middleware
healthRouter.use("*", telemetry);

// ============================================================================
// Types
// ============================================================================

interface HealthCheck {
  name: string;
  status: "healthy" | "degraded" | "unhealthy";
  latencyMs?: number;
  details?: Record<string, any>;
  error?: string;
}

interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  service: string;
  version: string;
  uptimeSeconds: number;
  checks: HealthCheck[];
}

interface ReadinessResponse {
  ready: boolean;
  timestamp: string;
  service: string;
  checks: HealthCheck[];
}

// ============================================================================
// Health Check Functions
// ============================================================================

/**
 * Check database connectivity and performance
 */
async function checkDatabase(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    const latencyMs = Date.now() - start;

    // Get pool stats
    const poolStats = {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    };

    updateDbPoolMetrics(poolStats.totalCount - poolStats.idleCount, poolStats.idleCount, poolStats.waitingCount);

    const status = latencyMs > 100 ? "degraded" : "healthy";

    return {
      name: "database",
      status,
      latencyMs,
      details: {
        ...poolStats,
        latencyCategory: latencyMs > 100 ? "slow" : latencyMs > 50 ? "moderate" : "fast",
      },
    };
  } catch (error) {
    return {
      name: "database",
      status: "unhealthy",
      latencyMs: Date.now() - start,
      error: (error as Error).message,
    };
  }
}

/**
 * Check Redis/Upstash connectivity (if configured)
 */
async function checkRedis(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    // If Redis is configured, check it
    // For now, return healthy if not configured
    if (!process.env.UPSTASH_REDIS_REST_URL && !process.env.REDIS_URL) {
      return {
        name: "redis",
        status: "healthy",
        latencyMs: Date.now() - start,
        details: { configured: false },
      };
    }

    // TODO: Implement actual Redis check when configured
    return {
      name: "redis",
      status: "healthy",
      latencyMs: Date.now() - start,
      details: { configured: true },
    };
  } catch (error) {
    return {
      name: "redis",
      status: "unhealthy",
      latencyMs: Date.now() - start,
      error: (error as Error).message,
    };
  }
}

/**
 * Check Neon services (Auth, Functions, Storage, Realtime)
 */
async function checkNeonServices(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    // Check if we can reach Neon API (if configured)
    const neonApiUrl = process.env.NEON_API_URL || "https://console.neon.tech";

    // For now, just verify we have required env vars
    const requiredVars = [
      "DATABASE_URL",
      "NEON_AUTH_CLIENT_ID",
      "NEON_AUTH_CLIENT_SECRET",
    ];

    const missing = requiredVars.filter(v => !process.env[v]);

    return {
      name: "neon_services",
      status: missing.length > 0 ? "degraded" : "healthy",
      latencyMs: Date.now() - start,
      details: {
        missingEnvVars: missing,
        neonApiUrl,
      },
    };
  } catch (error) {
    return {
      name: "neon_services",
      status: "unhealthy",
      latencyMs: Date.now() - start,
      error: (error as Error).message,
    };
  }
}

/**
 * Check external dependencies (S3, Email, SMS, etc.)
 */
async function checkExternalServices(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const services = {
      s3: !!process.env.NEON_STORAGE_ENDPOINT,
      email: !!process.env.SMTP_HOST,
      sms: !!process.env.TWILIO_ACCOUNT_SID,
      apns: !!process.env.APNS_KEY_ID,
      fcm: !!process.env.FCM_SERVER_KEY,
    };

    const configured = Object.values(services).filter(Boolean).length;
    const total = Object.keys(services).length;

    return {
      name: "external_services",
      status: "healthy",
      latencyMs: Date.now() - start,
      details: {
        configured: `${configured}/${total}`,
        services,
      },
    };
  } catch (error) {
    return {
      name: "external_services",
      status: "degraded",
      latencyMs: Date.now() - start,
      error: (error as Error).message,
    };
  }
}

/**
 * Check WebSocket server health
 */
async function checkWebSocket(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    // This would check if WebSocket server is accepting connections
    // For now, return healthy
    return {
      name: "websocket",
      status: "healthy",
      latencyMs: Date.now() - start,
      details: {
        // activeConnections: getActiveWsConnections(), // Would need to import from ws server
      },
    };
  } catch (error) {
    return {
      name: "websocket",
      status: "unhealthy",
      latencyMs: Date.now() - start,
      error: (error as Error).message,
    };
  }
}

/**
 * Run all health checks
 */
async function runHealthChecks(): Promise<HealthCheck[]> {
  const checks = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkNeonServices(),
    checkExternalServices(),
    checkWebSocket(),
  ]);
  return checks;
}

/**
 * Determine overall health status
 */
function getOverallStatus(checks: HealthCheck[]): "healthy" | "degraded" | "unhealthy" {
  if (checks.some(c => c.status === "unhealthy")) return "unhealthy";
  if (checks.some(c => c.status === "degraded")) return "degraded";
  return "healthy";
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /health - Basic liveness probe
 * Returns 200 if the process is alive (no dependency checks)
 * Used by load balancers to know if process should receive traffic
 */
healthRouter.get("/health", (c) => {
  return c.json({
    success: true,
    data: {
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "instagram-clone-api",
      version: process.env.npm_package_version || "0.1.0",
      uptimeSeconds: Math.floor(process.uptime()),
    },
  });
});

/**
 * GET /ready - Readiness probe
 * Checks all dependencies before returning ready
 * Returns 503 if any critical dependency is unavailable
 * Used by orchestrators (K8s, Neon Functions) to route traffic
 */
healthRouter.get("/ready", async (c) => {
  const requestId = c.get("requestId");
  const checks = await runHealthChecks();
  const overallStatus = getOverallStatus(checks);
  const ready = overallStatus !== "unhealthy";

  const response: ReadinessResponse = {
    ready,
    timestamp: new Date().toISOString(),
    service: "instagram-clone-api",
    checks,
  };

  // Log readiness check
  moduleLogger.info(
    { requestId, ready, status: overallStatus, checks: checks.map(c => ({ name: c.name, status: c.status })) },
    "Readiness check completed"
  );

  return c.json(
    {
      success: ready,
      data: response,
    },
    ready ? 200 : 503
  );
});

/**
 * GET /health/details - Detailed health information
 * Includes all checks with full details for debugging
 */
healthRouter.get("/health/details", async (c) => {
  const requestId = c.get("requestId");
  const checks = await runHealthChecks();
  const overallStatus = getOverallStatus(checks);

  // Get additional system info
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();

  const response: HealthResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    service: "instagram-clone-api",
    version: process.env.npm_package_version || "0.1.0",
    uptimeSeconds: Math.floor(process.uptime()),
    checks,
  };

  return c.json({
    success: true,
    data: {
      ...response,
      system: {
        memory: {
          rss: memUsage.rss,
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          external: memUsage.external,
          usagePercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system,
        },
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
      },
      environment: {
        nodeEnv: process.env.NODE_ENV,
        logLevel: process.env.LOG_LEVEL,
        otelEnabled: !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      },
    },
  });
});

/**
 * GET /metrics - Prometheus metrics endpoint
 * Returns metrics in Prometheus text format
 */
healthRouter.get("/metrics", async (c) => {
  const requestId = c.get("requestId");
  const startTime = Date.now();

  try {
    // Run a quick DB check for metrics
    const dbStart = Date.now();
    await db.execute(sql`SELECT 1`);
    const dbLatency = Date.now() - dbStart;

    const metrics = generatePrometheusMetrics();

    // Add DB latency to metrics
    const metricsWithDb = metrics +
      `\n# HELP db_query_latency_ms Database query latency in milliseconds\n` +
      `# TYPE db_query_latency_ms gauge\n` +
      `db_query_latency_ms ${dbLatency}\n`;

    moduleLogger.debug({ requestId, durationMs: Date.now() - startTime }, "Metrics endpoint accessed");

    return c.text(metricsWithDb, 200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });
  } catch (error) {
    moduleLogger.error({ requestId, err: error, durationMs: Date.now() - startTime }, "Metrics endpoint error");

    return c.text("# Metrics unavailable\n", 500, {
      "Content-Type": "text/plain; charset=utf-8",
    });
  }
});

/**
 * GET /health/live - Kubernetes liveness probe alias
 * Same as /health but explicit naming for K8s
 */
healthRouter.get("/health/live", (c) => {
  return c.json({
    success: true,
    data: {
      status: "alive",
      timestamp: new Date().toISOString(),
      service: "instagram-clone-api",
    },
  });
});

/**
 * GET /health/startup - Kubernetes startup probe
 * Used for slow-starting applications
 */
healthRouter.get("/health/startup", async (c) => {
  // Check if DB is accessible (minimum requirement for startup)
  try {
    await db.execute(sql`SELECT 1`);
    return c.json({
      success: true,
      data: {
        status: "started",
        timestamp: new Date().toISOString(),
        service: "instagram-clone-api",
      },
    });
  } catch (error) {
    return c.json({
      success: false,
      data: {
        status: "starting",
        timestamp: new Date().toISOString(),
        service: "instagram-clone-api",
        error: (error as Error).message,
      },
    }, 503);
  }
});

/**
 * GET /health/dependencies - Check specific dependency
 * Query param: ?service=database|redis|neon|websocket|external
 */
healthRouter.get("/health/dependencies", async (c) => {
  const service = c.req.query("service");
  const requestId = c.get("requestId");

  if (!service) {
    return c.json({
      success: false,
      error: "MISSING_PARAMETER",
      message: "Query parameter 'service' is required",
      requestId,
    }, 400);
  }

  let check: HealthCheck;

  switch (service) {
    case "database":
      check = await checkDatabase();
      break;
    case "redis":
      check = await checkRedis();
      break;
    case "neon":
      check = await checkNeonServices();
      break;
    case "websocket":
      check = await checkWebSocket();
      break;
    case "external":
      check = await checkExternalServices();
      break;
    default:
      return c.json({
        success: false,
        error: "INVALID_SERVICE",
        message: `Unknown service: ${service}. Valid: database, redis, neon, websocket, external`,
        requestId,
      }, 400);
  }

  return c.json({
    success: true,
    data: check,
  });
});

export { healthRouter };
export type { HealthCheck, HealthResponse, ReadinessResponse };