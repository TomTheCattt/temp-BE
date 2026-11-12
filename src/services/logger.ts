import pino from "pino";
import { env } from "../config/env";

/**
 * Structured JSON Logger Service
 *
 * Uses Pino for high-performance structured logging with:
 * - JSON output for log aggregation (Neon Logs/Loki)
 * - Request/response logging with trace context
 * - Error logging with stack traces
 * - Audit logging for mutating operations
 * - Multiple log levels (trace, debug, info, warn, error, fatal)
 */

// ============================================================================
// Types
// ============================================================================

export interface LogContext {
  requestId?: string;
  traceId?: string;
  spanId?: string;
  userId?: string;
  sessionId?: string;
  module?: string;
  operation?: string;
  [key: string]: any;
}

export interface RequestLogData {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  userAgent?: string;
  ip?: string;
  userId?: string;
  requestId: string;
  traceId?: string;
  spanId?: string;
  requestSize?: number;
  responseSize?: number;
}

export interface AuditLogData {
  action: string;
  userId?: string;
  resourceType?: string;
  resourceId?: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  metadata?: Record<string, any>;
  requestId?: string;
  traceId?: string;
  ip?: string;
  userAgent?: string;
}

export interface ErrorLogData {
  error: Error;
  context?: LogContext;
  severity?: "low" | "medium" | "high" | "critical";
}

// ============================================================================
// Logger Configuration
// ============================================================================

const isDevelopment = env.NODE_ENV === "development";
const logLevel = env.LOG_LEVEL || (isDevelopment ? "debug" : "info");

// Base logger configuration
const baseConfig: pino.LoggerOptions = {
  level: logLevel,
  formatters: {
    level: (label) => {
      return { level: label };
    },
    bindings: (bindings) => {
      return {
        service: "instagram-clone-api",
        version: process.env.npm_package_version || "0.1.0",
        environment: env.NODE_ENV || "development",
        hostname: bindings.hostname,
        pid: bindings.pid,
      };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "*.password*",
      "*.secret*",
      "*.token*",
      "*.authorization*",
      "*.cookie*",
      "*.refreshToken*",
      "*.accessToken*",
      "*.apiKey*",
      "*.creditCard*",
      "*.ssn*",
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers.x-api-key",
    ],
    censor: "[REDACTED]",
  },
};

// Development pretty print
if (isDevelopment) {
  baseConfig.transport = {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
    },
  };
}

// Create base logger
const baseLogger = pino(baseConfig);

// ============================================================================
// Child Logger Factory
// ============================================================================

/**
 * Create a child logger with additional context
 */
export function createChildLogger(context: LogContext): pino.Logger {
  return baseLogger.child(context);
}

/**
 * Create a request-scoped logger with trace context
 */
export function createRequestLogger(requestId: string, traceId?: string, spanId?: string): pino.Logger {
  return baseLogger.child({
    requestId,
    traceId,
    spanId,
    module: "http",
  });
}

/**
 * Create a module-scoped logger
 */
export function createModuleLogger(module: string): pino.Logger {
  return baseLogger.child({ module });
}

// ============================================================================
// Specialized Logging Functions
// ============================================================================

/**
 * Log HTTP request/response
 */
export function logRequest(logger: pino.Logger, data: RequestLogData): void {
  const { statusCode, durationMs, ...rest } = data;

  if (statusCode >= 500) {
    logger.error({ ...rest, statusCode, durationMs }, "HTTP request completed with server error");
  } else if (statusCode >= 400) {
    logger.warn({ ...rest, statusCode, durationMs }, "HTTP request completed with client error");
  } else {
    logger.info({ ...rest, statusCode, durationMs }, "HTTP request completed");
  }
}

/**
 * Log audit event for mutating operations
 */
export function logAudit(logger: pino.Logger, data: AuditLogData): void {
  logger.info(
    {
      audit: true,
      action: data.action,
      userId: data.userId,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      oldValues: data.oldValues,
      newValues: data.newValues,
      metadata: data.metadata,
      requestId: data.requestId,
      traceId: data.traceId,
      ip: data.ip,
      userAgent: data.userAgent,
    },
    `Audit: ${data.action}`
  );
}

/**
 * Log error with context
 */
export function logError(logger: pino.Logger, data: ErrorLogData): void {
  const { error, context, severity = "medium" } = data;

  logger.error(
    {
      err: {
        message: error.message,
        name: error.name,
        stack: error.stack,
        ...(error as any),
      },
      severity,
      ...context,
    },
    `Error: ${error.message}`
  );
}

/**
 * Log database query
 */
export function logDatabaseQuery(
  logger: pino.Logger,
  query: string,
  durationMs: number,
  params?: any[],
  error?: Error
): void {
  if (error) {
    logger.error(
      {
        db: true,
        query: query.substring(0, 500),
        params: params?.map((p) => (typeof p === "string" && p.length > 100 ? p.substring(0, 100) + "..." : p)),
        durationMs,
        error: error.message,
      },
      "Database query failed"
    );
  } else if (durationMs > 100) {
    logger.warn(
      {
        db: true,
        query: query.substring(0, 500),
        durationMs,
      },
      "Slow database query"
    );
  } else if (env.LOG_LEVEL === "debug" || env.LOG_LEVEL === "trace") {
    logger.debug(
      {
        db: true,
        query: query.substring(0, 500),
        durationMs,
      },
      "Database query executed"
    );
  }
}

/**
 * Log WebSocket event
 */
export function logWebSocketEvent(
  logger: pino.Logger,
  event: string,
  data: Record<string, any>
): void {
  logger.info(
    {
      ws: true,
      event,
      ...data,
    },
    `WebSocket: ${event}`
  );
}

/**
 * Log background job
 */
export function logJobEvent(
  logger: pino.Logger,
  jobName: string,
  status: "started" | "completed" | "failed" | "progress",
  data: Record<string, any> = {}
): void {
  const logData = {
    job: true,
    jobName,
    status,
    ...data,
  };

  if (status === "failed") {
    logger.error(logData, `Job ${jobName} failed`);
  } else if (status === "completed") {
    logger.info(logData, `Job ${jobName} completed`);
  } else {
    logger.info(logData, `Job ${jobName} ${status}`);
  }
}

/**
 * Log authentication event
 */
export function logAuthEvent(
  logger: pino.Logger,
  event: string,
  userId?: string,
  success = true,
  metadata?: Record<string, any>
): void {
  const logData = {
    auth: true,
    event,
    userId,
    success,
    ...metadata,
  };

  if (success) {
    logger.info(logData, `Auth: ${event}`);
  } else {
    logger.warn(logData, `Auth: ${event} failed`);
  }
}

/**
 * Log security event
 */
export function logSecurityEvent(
  logger: pino.Logger,
  event: string,
  severity: "low" | "medium" | "high" | "critical",
  data: Record<string, any>
): void {
  const logData = {
    security: true,
    event,
    severity,
    ...data,
  };

  if (severity === "critical" || severity === "high") {
    logger.error(logData, `Security: ${event}`);
  } else {
    logger.warn(logData, `Security: ${event}`);
  }
}

/**
 * Log business metric event
 */
export function logBusinessEvent(
  logger: pino.Logger,
  event: string,
  data: Record<string, any>
): void {
  logger.info(
    {
      business: true,
      event,
      ...data,
    },
    `Business: ${event}`
  );
}

// ============================================================================
// Export Base Logger
// ============================================================================

export { baseLogger as logger };

// ============================================================================
// Default Export
// ============================================================================

export default {
  logger: baseLogger,
  createChildLogger,
  createRequestLogger,
  createModuleLogger,
  logRequest,
  logAudit,
  logError,
  logDatabaseQuery,
  logWebSocketEvent,
  logJobEvent,
  logAuthEvent,
  logSecurityEvent,
  logBusinessEvent,
};