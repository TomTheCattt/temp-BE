import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { env } from "../config/env";
import { getRequestId, getTraceInfo } from "./telemetry";
import { ZodError } from "zod";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Error Handling Middleware with RFC 7807 Problem Details
 *
 * Provides:
 * - Standardized error responses per RFC 7807
 * - Automatic error logging with trace context
 * - Sentry integration (optional)
 * - Error categorization and user-friendly messages
 * - Development vs production error details
 */

// ============================================================================
// Types
// ============================================================================

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  extensions?: Record<string, any>;
}

export interface ErrorContext {
  requestId: string;
  traceId?: string;
  spanId?: string;
  path: string;
  method: string;
  userId?: string;
  userAgent?: string;
  timestamp: string;
}

export type ErrorCode =
  // Validation
  | "VALIDATION_ERROR"
  | "INVALID_JSON"
  | "INVALID_CONTENT_TYPE"
  // Authentication
  | "UNAUTHORIZED"
  | "INVALID_TOKEN"
  | "TOKEN_EXPIRED"
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_LOCKED"
  | "EMAIL_NOT_VERIFIED"
  | "MFA_REQUIRED"
  // Authorization
  | "FORBIDDEN"
  | "INSUFFICIENT_PERMISSIONS"
  | "RESOURCE_OWNERSHIP_REQUIRED"
  | "BLOCKED_BY_USER"
  // Not Found
  | "NOT_FOUND"
  | "USER_NOT_FOUND"
  | "POST_NOT_FOUND"
  | "CONVERSATION_NOT_FOUND"
  // Conflict
  | "CONFLICT"
  | "DUPLICATE_RESOURCE"
  | "USERNAME_TAKEN"
  | "EMAIL_TAKEN"
  | "ALREADY_FOLLOWING"
  | "ALREADY_LIKED"
  | "IDEMPOTENCY_CONFLICT"
  // Rate Limit
  | "RATE_LIMIT_EXCEEDED"
  // Server Errors
  | "INTERNAL_ERROR"
  | "DATABASE_ERROR"
  | "EXTERNAL_SERVICE_ERROR"
  | "STORAGE_ERROR"
  | "PROCESSING_ERROR"
  // Bad Request
  | "BAD_REQUEST"
  | "MISSING_PARAMETER"
  | "INVALID_PARAMETER"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  // WebSocket
  | "WS_AUTHENTICATION_FAILED"
  | "WS_CONNECTION_FAILED"
  | "WS_MESSAGE_TOO_LARGE"
  // Custom
  | string;

// ============================================================================
// Error Definitions
// ============================================================================

export const ERROR_DEFINITIONS: Record<ErrorCode, Omit<ProblemDetails, "instance" | "extensions">> = {
  // Validation
  VALIDATION_ERROR: {
    type: "https://instagram-clone.com/errors/validation-error",
    title: "Validation Failed",
    status: 400,
    detail: "The request data failed validation",
  },
  INVALID_JSON: {
    type: "https://instagram-clone.com/errors/invalid-json",
    title: "Invalid JSON",
    status: 400,
    detail: "Request body must be valid JSON",
  },
  INVALID_CONTENT_TYPE: {
    type: "https://instagram-clone.com/errors/invalid-content-type",
    title: "Invalid Content Type",
    status: 415,
    detail: "Unsupported content type",
  },

  // Authentication
  UNAUTHORIZED: {
    type: "https://instagram-clone.com/errors/unauthorized",
    title: "Unauthorized",
    status: 401,
    detail: "Authentication is required to access this resource",
  },
  INVALID_TOKEN: {
    type: "https://instagram-clone.com/errors/invalid-token",
    title: "Invalid Token",
    status: 401,
    detail: "The provided authentication token is invalid",
  },
  TOKEN_EXPIRED: {
    type: "https://instagram-clone.com/errors/token-expired",
    title: "Token Expired",
    status: 401,
    detail: "The authentication token has expired",
  },
  INVALID_CREDENTIALS: {
    type: "https://instagram-clone.com/errors/invalid-credentials",
    title: "Invalid Credentials",
    status: 401,
    detail: "The provided credentials are incorrect",
  },
  ACCOUNT_LOCKED: {
    type: "https://instagram-clone.com/errors/account-locked",
    title: "Account Locked",
    status: 403,
    detail: "This account has been temporarily locked due to too many failed attempts",
  },
  EMAIL_NOT_VERIFIED: {
    type: "https://instagram-clone.com/errors/email-not-verified",
    title: "Email Not Verified",
    status: 403,
    detail: "Please verify your email address before continuing",
  },
  MFA_REQUIRED: {
    type: "https://instagram-clone.com/errors/mfa-required",
    title: "Multi-Factor Authentication Required",
    status: 403,
    detail: "This action requires multi-factor authentication",
  },

  // Authorization
  FORBIDDEN: {
    type: "https://instagram-clone.com/errors/forbidden",
    title: "Forbidden",
    status: 403,
    detail: "You do not have permission to perform this action",
  },
  INSUFFICIENT_PERMISSIONS: {
    type: "https://instagram-clone.com/errors/insufficient-permissions",
    title: "Insufficient Permissions",
    status: 403,
    detail: "Your account does not have the required permissions",
  },
  RESOURCE_OWNERSHIP_REQUIRED: {
    type: "https://instagram-clone.com/errors/resource-ownership-required",
    title: "Resource Ownership Required",
    status: 403,
    detail: "You can only modify resources you own",
  },
  BLOCKED_BY_USER: {
    type: "https://instagram-clone.com/errors/blocked-by-user",
    title: "Blocked",
    status: 403,
    detail: "You have been blocked by this user",
  },

  // Not Found
  NOT_FOUND: {
    type: "https://instagram-clone.com/errors/not-found",
    title: "Not Found",
    status: 404,
    detail: "The requested resource was not found",
  },
  USER_NOT_FOUND: {
    type: "https://instagram-clone.com/errors/user-not-found",
    title: "User Not Found",
    status: 404,
    detail: "The specified user does not exist",
  },
  POST_NOT_FOUND: {
    type: "https://instagram-clone.com/errors/post-not-found",
    title: "Post Not Found",
    status: 404,
    detail: "The specified post does not exist",
  },
  CONVERSATION_NOT_FOUND: {
    type: "https://instagram-clone.com/errors/conversation-not-found",
    title: "Conversation Not Found",
    status: 404,
    detail: "The specified conversation does not exist",
  },

  // Conflict
  CONFLICT: {
    type: "https://instagram-clone.com/errors/conflict",
    title: "Conflict",
    status: 409,
    detail: "The request conflicts with the current state of the resource",
  },
  DUPLICATE_RESOURCE: {
    type: "https://instagram-clone.com/errors/duplicate-resource",
    title: "Duplicate Resource",
    status: 409,
    detail: "A resource with the same identifier already exists",
  },
  USERNAME_TAKEN: {
    type: "https://instagram-clone.com/errors/username-taken",
    title: "Username Taken",
    status: 409,
    detail: "This username is already taken",
  },
  EMAIL_TAKEN: {
    type: "https://instagram-clone.com/errors/email-taken",
    title: "Email Taken",
    status: 409,
    detail: "An account with this email already exists",
  },
  ALREADY_FOLLOWING: {
    type: "https://instagram-clone.com/errors/already-following",
    title: "Already Following",
    status: 409,
    detail: "You are already following this user",
  },
  ALREADY_LIKED: {
    type: "https://instagram-clone.com/errors/already-liked",
    title: "Already Liked",
    status: 409,
    detail: "You have already liked this content",
  },
  IDEMPOTENCY_CONFLICT: {
    type: "https://instagram-clone.com/errors/idempotency-conflict",
    title: "Idempotency Conflict",
    status: 409,
    detail: "Another request with the same idempotency key is being processed",
  },

  // Rate Limit
  RATE_LIMIT_EXCEEDED: {
    type: "https://instagram-clone.com/errors/rate-limit-exceeded",
    title: "Rate Limit Exceeded",
    status: 429,
    detail: "Too many requests. Please slow down.",
  },

  // Server Errors
  INTERNAL_ERROR: {
    type: "https://instagram-clone.com/errors/internal-error",
    title: "Internal Server Error",
    status: 500,
    detail: "An unexpected error occurred. Please try again later.",
  },
  DATABASE_ERROR: {
    type: "https://instagram-clone.com/errors/database-error",
    title: "Database Error",
    status: 500,
    detail: "A database error occurred. Please try again later.",
  },
  EXTERNAL_SERVICE_ERROR: {
    type: "https://instagram-clone.com/errors/external-service-error",
    title: "External Service Error",
    status: 502,
    detail: "An external service is temporarily unavailable",
  },
  STORAGE_ERROR: {
    type: "https://instagram-clone.com/errors/storage-error",
    title: "Storage Error",
    status: 500,
    detail: "A file storage error occurred",
  },
  PROCESSING_ERROR: {
    type: "https://instagram-clone.com/errors/processing-error",
    title: "Processing Error",
    status: 500,
    detail: "Media processing failed",
  },

  // Bad Request
  BAD_REQUEST: {
    type: "https://instagram-clone.com/errors/bad-request",
    title: "Bad Request",
    status: 400,
    detail: "The request is malformed or invalid",
  },
  MISSING_PARAMETER: {
    type: "https://instagram-clone.com/errors/missing-parameter",
    title: "Missing Parameter",
    status: 400,
    detail: "A required parameter is missing",
  },
  INVALID_PARAMETER: {
    type: "https://instagram-clone.com/errors/invalid-parameter",
    title: "Invalid Parameter",
    status: 400,
    detail: "A parameter has an invalid value",
  },
  PAYLOAD_TOO_LARGE: {
    type: "https://instagram-clone.com/errors/payload-too-large",
    title: "Payload Too Large",
    status: 413,
    detail: "The request payload exceeds the maximum allowed size",
  },
  UNSUPPORTED_MEDIA_TYPE: {
    type: "https://instagram-clone.com/errors/unsupported-media-type",
    title: "Unsupported Media Type",
    status: 415,
    detail: "The media type is not supported",
  },

  // WebSocket
  WS_AUTHENTICATION_FAILED: {
    type: "https://instagram-clone.com/errors/ws-authentication-failed",
    title: "WebSocket Authentication Failed",
    status: 401,
    detail: "WebSocket connection authentication failed",
  },
  WS_CONNECTION_FAILED: {
    type: "https://instagram-clone.com/errors/ws-connection-failed",
    title: "WebSocket Connection Failed",
    status: 500,
    detail: "Failed to establish WebSocket connection",
  },
  WS_MESSAGE_TOO_LARGE: {
    type: "https://instagram-clone.com/errors/ws-message-too-large",
    title: "WebSocket Message Too Large",
    status: 413,
    detail: "WebSocket message exceeds maximum size",
  },
};

// ============================================================================
// Custom Error Classes
// ============================================================================

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly extensions?: Record<string, any>;
  public readonly isOperational: boolean;

  constructor(code: ErrorCode, message?: string, extensions?: Record<string, any>) {
    const definition = ERROR_DEFINITIONS[code] || ERROR_DEFINITIONS.INTERNAL_ERROR;
    super(message || definition.detail);
    this.name = "AppError";
    this.code = code;
    this.status = definition.status;
    this.extensions = extensions;
    this.isOperational = true;

    Object.setPrototypeOf(this, AppError.prototype);
  }

  toProblemDetails(instance: string): ProblemDetails {
    const definition = ERROR_DEFINITIONS[this.code] || ERROR_DEFINITIONS.INTERNAL_ERROR;
    return {
      type: definition.type,
      title: definition.title,
      status: definition.status,
      detail: this.message,
      instance,
      extensions: this.extensions,
    };
  }
}

export class ValidationError extends AppError {
  constructor(errors: Array<{ field: string; message: string; code: string }>) {
    super("VALIDATION_ERROR", "Validation failed", { errors });
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const code = `${resource.toUpperCase()}_NOT_FOUND` as ErrorCode;
    super(code, `${resource} not found${id ? `: ${id}` : ""}`);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(code: ErrorCode, message: string) {
    super(code, message);
    this.name = "ConflictError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(code: ErrorCode = "UNAUTHORIZED", message?: string) {
    super(code, message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(code: ErrorCode = "FORBIDDEN", message?: string) {
    super(code, message);
    this.name = "ForbiddenError";
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter?: number) {
    super("RATE_LIMIT_EXCEEDED", "Rate limit exceeded", { retryAfter });
    this.name = "RateLimitError";
  }
}

// ============================================================================
// Error Handler Middleware
// ============================================================================

/**
 * Create error handler middleware with RFC 7807 Problem Details.
 */
export function errorHandler() {
  return createMiddleware(async (c, next) => {
    try {
      await next();
    } catch (error) {
      const requestId = getRequestId(c);
      const traceInfo = getTraceInfo(c);
      const path = c.req.path;
      const method = c.req.method;
      const user = c.get("user");
      const userAgent = c.req.header("user-agent");

      const context: ErrorContext = {
        requestId,
        traceId: traceInfo?.traceId,
        spanId: traceInfo?.spanId,
        path,
        method,
        userId: user?.id,
        userAgent,
        timestamp: new Date().toISOString(),
      };

      // Handle different error types
      let problemDetails: ProblemDetails;

      if (error instanceof HTTPException) {
        // Hono HTTPException
        problemDetails = handleHttpException(error, context);
      } else if (error instanceof AppError) {
        // Our custom AppError
        problemDetails = error.toProblemDetails(path);
      } else if (error instanceof ZodError) {
        // Zod validation error
        problemDetails = handleZodError(error, path);
      } else if (error instanceof SyntaxError && "status" in error) {
        // JSON parse error
        problemDetails = {
          ...ERROR_DEFINITIONS.INVALID_JSON,
          instance: path,
        };
      } else {
        // Unknown error
        problemDetails = handleUnknownError(error, context, path);
      }

      // Add request ID to extensions
      problemDetails.extensions = {
        ...problemDetails.extensions,
        requestId,
        timestamp: context.timestamp,
      };

      // Add trace context if available
      if (context.traceId) {
        problemDetails.extensions = {
          ...problemDetails.extensions,
          traceId: context.traceId,
          spanId: context.spanId,
        };
      }

      // Log error
      logError(error, context, problemDetails);

      // Send Sentry event if configured
      if (env.SENTRY_DSN) {
        captureSentryError(error, context, problemDetails);
      }

      // Return problem details response
      return c.json(problemDetails, problemDetails.status as ContentfulStatusCode, {
        "Content-Type": "application/problem+json",
      });
    }
  });
}

/**
 * Handle Hono HTTPException.
 */
function handleHttpException(error: HTTPException, context: ErrorContext): ProblemDetails {
  const status = error.status;
  let code: ErrorCode = "INTERNAL_ERROR";

  // Map status codes to error codes
  switch (status) {
    case 400: code = "BAD_REQUEST"; break;
    case 401: code = "UNAUTHORIZED"; break;
    case 403: code = "FORBIDDEN"; break;
    case 404: code = "NOT_FOUND"; break;
    case 409: code = "CONFLICT"; break;
    case 413: code = "PAYLOAD_TOO_LARGE"; break;
    case 415: code = "UNSUPPORTED_MEDIA_TYPE"; break;
    case 422: code = "VALIDATION_ERROR"; break;
    case 429: code = "RATE_LIMIT_EXCEEDED"; break;
    case 500: code = "INTERNAL_ERROR"; break;
    case 502: code = "EXTERNAL_SERVICE_ERROR"; break;
    case 503: code = "EXTERNAL_SERVICE_ERROR"; break;
  }

  const definition = ERROR_DEFINITIONS[code] || ERROR_DEFINITIONS.INTERNAL_ERROR;

  return {
    ...definition,
    instance: context.path,
    detail: error.message || definition.detail,
    extensions: error.res ? undefined : undefined, // Response is already set
  };
}

/**
 * Handle Zod validation error.
 */
function handleZodError(error: ZodError, path: string): ProblemDetails {
  const issues = error.issues.map(issue => ({
    field: issue.path.map(p => String(p)).join("."),
    message: issue.message,
    code: issue.code,
    // Note: 'received' is deprecated in newer Zod versions
    received: (issue as any).received,
    expected: (issue as any).expected,
  }));

  return {
    ...ERROR_DEFINITIONS.VALIDATION_ERROR,
    instance: path,
    detail: `Validation failed: ${issues.length} error(s)`,
    extensions: { errors: issues },
  };
}

/**
 * Handle unknown errors.
 */
function handleUnknownError(error: unknown, context: ErrorContext, path: string): ProblemDetails {
  const message = error instanceof Error ? error.message : "Unknown error";

  // Check for specific error patterns
  if (error instanceof Error) {
    // Database errors
    if (message.includes("duplicate key") || message.includes("unique constraint")) {
      return { ...ERROR_DEFINITIONS.DUPLICATE_RESOURCE, instance: path, detail: "A resource with this identifier already exists" };
    }
    if (message.includes("foreign key") || message.includes("constraint")) {
      return { ...ERROR_DEFINITIONS.BAD_REQUEST, instance: path, detail: "Referenced resource does not exist" };
    }
    if (message.includes("connection") || message.includes("ECONNREFUSED") || message.includes("ETIMEDOUT")) {
      return { ...ERROR_DEFINITIONS.DATABASE_ERROR, instance: path };
    }
    // JWT errors
    if (message.includes("jwt") || message.includes("JWT") || message.includes("token")) {
      return { ...ERROR_DEFINITIONS.INVALID_TOKEN, instance: path };
    }
  }

  // Default internal error
  return {
    ...ERROR_DEFINITIONS.INTERNAL_ERROR,
    instance: path,
    detail: env.NODE_ENV === "production"
      ? "An unexpected error occurred"
      : message,
    extensions: env.NODE_ENV === "production" ? undefined : { stack: error instanceof Error ? error.stack : String(error) },
  };
}

/**
 * Log error with context.
 */
function logError(error: unknown, context: ErrorContext, problemDetails: ProblemDetails): void {
  const logLevel = problemDetails.status >= 500 ? "error" : "warn";
  const logger = console[logLevel];

  const logData: Record<string, any> = {
    level: logLevel,
    message: error instanceof Error ? error.message : String(error),
    code: problemDetails.type.split("/").pop(),
    status: problemDetails.status,
    ...context,
  };

  if (problemDetails.status >= 500 && error instanceof Error && error.stack) {
    logData.stack = error.stack;
  }

  logger(JSON.stringify(logData));
}

/**
 * Capture error in Sentry.
 */
function captureSentryError(error: unknown, context: ErrorContext, problemDetails: ProblemDetails): void {
  try {
    const Sentry = require("@sentry/node");
    Sentry.withScope((scope: any) => {
      scope.setTag("requestId", context.requestId);
      scope.setTag("path", context.path);
      scope.setTag("method", context.method);
      scope.setTag("errorCode", problemDetails.type.split("/").pop());
      scope.setTag("status", problemDetails.status.toString());

      if (context.userId) {
        scope.setUser({ id: context.userId });
      }

      if (context.traceId) {
        scope.setTag("traceId", context.traceId);
        scope.setTag("spanId", context.spanId || "");
      }

      scope.setContext("request", context);
      scope.setContext("problemDetails", problemDetails);

      if (error instanceof Error) {
        Sentry.captureException(error);
      } else {
        Sentry.captureMessage(String(error), "error");
      }
    });
  } catch {
    // Sentry not available or error capturing failed
  }
}

// ============================================================================
// Not Found Handler
// ============================================================================

/**
 * Create 404 Not Found handler.
 */
export function notFoundHandler() {
  return (c: any) => {
    const requestId = getRequestId(c);
    const traceInfo = getTraceInfo(c);

    const problemDetails: ProblemDetails = {
      ...ERROR_DEFINITIONS.NOT_FOUND,
      instance: c.req.path,
      detail: `Route ${c.req.method} ${c.req.path} not found`,
      extensions: {
        requestId,
        timestamp: new Date().toISOString(),
        traceId: traceInfo?.traceId,
        spanId: traceInfo?.spanId,
      },
    };

    return c.json(problemDetails, 404, {
      "Content-Type": "application/problem+json",
    });
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a problem details response manually.
 */
export function createProblemDetails(
  code: ErrorCode,
  instance: string,
  detail?: string,
  extensions?: Record<string, any>
): ProblemDetails {
  const definition = ERROR_DEFINITIONS[code] || ERROR_DEFINITIONS.INTERNAL_ERROR;
  return {
    type: definition.type,
    title: definition.title,
    status: definition.status,
    detail: detail || definition.detail,
    instance,
    extensions,
  };
}

/**
 * Throw an AppError with the given code.
 */
export function throwError(code: ErrorCode, message?: string, extensions?: Record<string, any>): never {
  throw new AppError(code, message, extensions);
}

/**
 * Check if an error is operational (expected) vs programming error.
 */
export function isOperationalError(error: unknown): boolean {
  return error instanceof AppError && error.isOperational;
}

/**
 * Get error code from any error.
 */
export function getErrorCode(error: unknown): ErrorCode {
  if (error instanceof AppError) return error.code;
  if (error instanceof HTTPException) {
    switch (error.status) {
      case 400: return "BAD_REQUEST";
      case 401: return "UNAUTHORIZED";
      case 403: return "FORBIDDEN";
      case 404: return "NOT_FOUND";
      case 409: return "CONFLICT";
      case 422: return "VALIDATION_ERROR";
      case 429: return "RATE_LIMIT_EXCEEDED";
      default: return "INTERNAL_ERROR";
    }
  }
  if (error instanceof ZodError) return "VALIDATION_ERROR";
  return "INTERNAL_ERROR";
}

/**
 * Get HTTP status from error code.
 */
export function getStatusFromCode(code: ErrorCode): number {
  return ERROR_DEFINITIONS[code]?.status || 500;
}