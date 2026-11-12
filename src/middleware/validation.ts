import { createMiddleware } from "hono/factory";
import { z, ZodSchema, ZodError, ZodTypeAny } from "zod";
import { HTTPException } from "hono/http-exception";

/**
 * Centralized Zod Validation Middleware
 *
 * Provides:
 * - Request body validation
 * - Query parameter validation
 * - Path parameter validation
 * - Header validation
 * - Custom validation with detailed error messages
 * - Automatic RFC 7807 Problem Details error responses
 */

// ============================================================================
// Types
// ============================================================================

export interface ValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
  headers?: ZodSchema;
}

export interface ValidationOptions {
  // Whether to strip unknown properties (default: true)
  stripUnknown?: boolean;
  // Whether to coerce types (default: false)
  coerce?: boolean;
  // Custom error handler
  onError?: (error: ZodError, c: any) => Response | void;
  // Target to validate (default: all present in schemas)
  target?: "body" | "query" | "params" | "headers" | "all";
}

// ============================================================================
// Error Formatting
// ============================================================================

/**
 * Format ZodError into RFC 7807 Problem Details format.
 */
export function formatValidationError(error: ZodError): {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  extensions: {
    errors: Array<{
      field: string;
      message: string;
      code: string;
      received?: any;
      expected?: string;
    }>;
  };
} {
  const issues = error.issues.map(issue => ({
    field: issue.path.map(p => String(p)).join("."),
    message: issue.message,
    code: issue.code,
    // Note: 'received' is deprecated in newer Zod versions
    received: (issue as any).received,
    expected: (issue as any).expected,
  }));

  return {
    type: "https://instagram-clone.com/errors/validation-error",
    title: "Validation Failed",
    status: 400,
    detail: `Request validation failed: ${issues.length} error(s)`,
    instance: "", // Will be filled by middleware
    extensions: { errors: issues },
  };
}

/**
 * Create a validation error response.
 */
export function createValidationErrorResponse(c: any, error: ZodError): Response {
  const formatted = formatValidationError(error);
  formatted.instance = c.req.path;

  return c.json(formatted, 400, {
    "Content-Type": "application/problem+json",
  });
}

// ============================================================================
// Validation Middleware Factory
// ============================================================================

/**
 * Create a validation middleware for the given schemas.
 *
 * Usage:
 * ```typescript
 * const validateCreatePost = validate({
 *   body: z.object({
 *     caption: z.string().max(2200).optional(),
 *     locationId: z.string().uuid().optional(),
 *     audience: z.enum(["public", "followers", "close_friends"]).default("public"),
 *   }),
 *   query: z.object({
 *     test: z.boolean().optional(),
 *   }),
 * });
 *
 * app.post("/v1/posts", validateCreatePost, handler);
 * ```
 */
export function validate(schemas: ValidationSchemas, options: ValidationOptions = {}) {
  const {
    stripUnknown = true,
    coerce = false,
    onError,
    target = "all",
  } = options;

  return createMiddleware(async (c, next) => {
    const errors: ZodError[] = [];

    // Validate body
    if ((target === "all" || target === "body") && schemas.body) {
      try {
        const contentType = c.req.header("content-type") || "";
        let body: any;

        if (contentType.includes("application/json")) {
          body = await c.req.json();
        } else if (contentType.includes("multipart/form-data")) {
          const formData = await c.req.formData();
          body = Object.fromEntries(formData.entries());
        } else if (contentType.includes("application/x-www-form-urlencoded")) {
          const text = await c.req.text();
          body = new URLSearchParams(text);
          body = Object.fromEntries(body.entries());
        } else {
          body = {};
        }

        const parsed = stripUnknown
          ? schemas.body.safeParse(body)
          : schemas.body.safeParse(body);

        if (!parsed.success) {
          errors.push(parsed.error);
        } else {
          // Store validated data
          c.set("validatedBody", parsed.data);
          // Also make available on request
          (c.req as any).validatedBody = parsed.data;
        }
      } catch (e) {
        if (e instanceof SyntaxError) {
          throw new HTTPException(400, {
            message: "Invalid JSON body",
            res: c.json({
              type: "https://instagram-clone.com/errors/invalid-json",
              title: "Invalid JSON",
              status: 400,
              detail: "Request body must be valid JSON",
              instance: c.req.path,
            }, 400),
          });
        }
        throw e;
      }
    }

    // Validate query
    if ((target === "all" || target === "query") && schemas.query) {
      const query = c.req.query();
      const parsed = stripUnknown
        ? schemas.query.safeParse(query)
        : schemas.query.safeParse(query);

      if (!parsed.success) {
        errors.push(parsed.error);
      } else {
        c.set("validatedQuery", parsed.data);
        (c.req as any).validatedQuery = parsed.data;
      }
    }

    // Validate params
    if ((target === "all" || target === "params") && schemas.params) {
      const params = c.req.param();
      const parsed = stripUnknown
        ? schemas.params.safeParse(params)
        : schemas.params.safeParse(params);

      if (!parsed.success) {
        errors.push(parsed.error);
      } else {
        c.set("validatedParams", parsed.data);
        (c.req as any).validatedParams = parsed.data;
      }
    }

    // Validate headers
    if ((target === "all" || target === "headers") && schemas.headers) {
      const headers: Record<string, string> = {};
      for (const [key, value] of c.req.raw.headers.entries()) {
        headers[key.toLowerCase()] = value;
      }
      const parsed = stripUnknown
        ? schemas.headers.safeParse(headers)
        : schemas.headers.safeParse(headers);

      if (!parsed.success) {
        errors.push(parsed.error);
      } else {
        c.set("validatedHeaders", parsed.data);
        (c.req as any).validatedHeaders = parsed.data;
      }
    }

    // Handle validation errors
    if (errors.length > 0) {
      // Combine all errors
      const combinedError = new ZodError(
        errors.flatMap(e => e.issues)
      );

      if (onError) {
        const result = onError(combinedError, c);
        if (result instanceof Response) return result;
      }

      return createValidationErrorResponse(c, combinedError);
    }

    await next();
  });
}

// ============================================================================
// Convenience Middlewares for Common Patterns
// ============================================================================

/**
 * Validate request body only.
 */
export function validateBody<T extends ZodTypeAny>(schema: T, options?: Omit<ValidationOptions, "target">) {
  return validate({ body: schema }, { ...options, target: "body" });
}

/**
 * Validate query parameters only.
 */
export function validateQuery<T extends ZodTypeAny>(schema: T, options?: Omit<ValidationOptions, "target">) {
  return validate({ query: schema }, { ...options, target: "query" });
}

/**
 * Validate path parameters only.
 */
export function validateParams<T extends ZodTypeAny>(schema: T, options?: Omit<ValidationOptions, "target">) {
  return validate({ params: schema }, { ...options, target: "params" });
}

/**
 * Validate headers only.
 */
export function validateHeaders<T extends ZodTypeAny>(schema: T, options?: Omit<ValidationOptions, "target">) {
  return validate({ headers: schema }, { ...options, target: "headers" });
}

// ============================================================================
// Common Validation Schemas (Reusable)
// ============================================================================

/**
 * Pagination query parameters (cursor-based).
 */
export const paginationQuerySchema = z.object({
  cursor: z.string().optional().describe("Opaque cursor for pagination"),
  limit: z.coerce.number().int().min(1).max(100).default(20).describe("Number of items per page"),
});

/**
 * UUID parameter validation.
 */
export const uuidParamSchema = z.object({
  id: z.string().uuid("Invalid ID format"),
});

/**
 * Username parameter validation.
 */
export const usernameParamSchema = z.object({
  username: z.string().min(1).max(30).regex(/^[a-zA-Z0-9._]+$/, "Invalid username format"),
});

/**
 * Common ID parameter (UUID).
 */
export const idParamSchema = z.object({
  id: z.string().uuid("Invalid ID format"),
});

/**
 * Multiple IDs parameter (comma-separated).
 */
export const idsQuerySchema = z.object({
  ids: z.string().transform(s => s.split(",").map(id => id.trim())).refine(
    ids => ids.every(id => z.string().uuid().safeParse(id).success),
    "All IDs must be valid UUIDs"
  ),
});

/**
 * Date range query.
 */
export const dateRangeQuerySchema = z.object({
  since: z.string().datetime().optional().describe("ISO 8601 datetime"),
  until: z.string().datetime().optional().describe("ISO 8601 datetime"),
});

/**
 * Search query.
 */
export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200).describe("Search query"),
  type: z.enum(["users", "posts", "reels", "audio", "hashtags", "locations"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

/**
 * File upload validation (for multipart).
 */
export const fileUploadSchema = z.object({
  file: z.any().refine(
    (file) => file && typeof file === "object" && "size" in file,
    "File is required"
  ),
  // Additional fields can be added
});

/**
 * Idempotency key header.
 */
export const idempotencyKeyHeaderSchema = z.object({
  "idempotency-key": z.string().uuid("Idempotency key must be a valid UUID").optional(),
});

/**
 * Common headers schema.
 */
export const commonHeadersSchema = z.object({
  authorization: z.string().optional(),
  "content-type": z.string().optional(),
  "accept": z.string().optional(),
  "user-agent": z.string().optional(),
  "x-request-id": z.string().uuid().optional(),
  "idempotency-key": z.string().uuid().optional(),
}).passthrough(); // Allow other headers

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get validated body from context.
 */
export function getValidatedBody<T>(c: any): T {
  return c.get("validatedBody") as T;
}

/**
 * Get validated query from context.
 */
export function getValidatedQuery<T>(c: any): T {
  return c.get("validatedQuery") as T;
}

/**
 * Get validated params from context.
 */
export function getValidatedParams<T>(c: any): T {
  return c.get("validatedParams") as T;
}

/**
 * Get validated headers from context.
 */
export function getValidatedHeaders<T>(c: any): T {
  return c.get("validatedHeaders") as T;
}

/**
 * Create a schema that validates an array of items with the given schema.
 */
export function arrayOf<T extends ZodTypeAny>(itemSchema: T, options?: { min?: number; max?: number }) {
  let schema = z.array(itemSchema);
  if (options?.min !== undefined) schema = schema.min(options.min);
  if (options?.max !== undefined) schema = schema.max(options.max);
  return schema;
}

/**
 * Create a schema for a paginated response.
 */
export function paginatedResponseSchema<T extends ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });
}

// ============================================================================
// Pre-built Validation Middlewares for Common Endpoints
// ============================================================================

// Auth endpoints
export const validateRegister = validateBody(z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(8).max(128),
  username: z.string().min(1).max(30).regex(/^[a-zA-Z0-9._]+$/),
  fullName: z.string().min(1).max(100),
  phone: z.string().optional(),
}));

export const validateLogin = validateBody(z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceId: z.string().optional(),
}));

export const validateRefreshToken = validateBody(z.object({
  refreshToken: z.string().min(1),
  deviceId: z.string().optional(),
}));

export const validateForgotPassword = validateBody(z.object({
  email: z.string().email(),
}));

export const validateResetPassword = validateBody(z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
}));

export const validateVerifyEmail = validateBody(z.object({
  code: z.string().length(6),
}));

// Posts
export const validateCreatePost = validateBody(z.object({
  caption: z.string().max(2200).optional(),
  locationId: z.string().uuid().optional(),
  locationName: z.string().max(200).optional(),
  locationLat: z.number().min(-90).max(90).optional(),
  locationLng: z.number().min(-180).max(180).optional(),
  audience: z.enum(["public", "followers", "close_friends"]).default("public"),
  closeFriendsOnly: z.boolean().default(false),
  mediaIds: z.array(z.string().uuid()).min(1).max(10),
}));

export const validateUpdatePost = validateBody(z.object({
  caption: z.string().max(2200).optional(),
  locationName: z.string().max(200).optional(),
  locationLat: z.number().min(-90).max(90).optional(),
  locationLng: z.number().min(-180).max(180).optional(),
  audience: z.enum(["public", "followers", "close_friends"]).optional(),
  closeFriendsOnly: z.boolean().optional(),
}));

// Reels
export const validateCreateReel = validateBody(z.object({
  caption: z.string().max(2200).optional(),
  audioId: z.string().uuid().optional(),
  audioName: z.string().max(200).optional(),
  audioArtist: z.string().max(200).optional(),
  isOriginalAudio: z.boolean().default(true),
  duration: z.number().positive().max(90), // Max 90 seconds for reels
  audience: z.enum(["public", "followers"]).default("public"),
  allowRemix: z.boolean().default(true),
  allowDownload: z.boolean().default(false),
  mediaId: z.string().uuid(),
}));

// Stories
export const validateCreateStory = validateBody(z.object({
  audience: z.enum(["followers", "close_friends"]).default("followers"),
  mediaItems: z.array(z.object({
    mediaUrl: z.string().url(),
    type: z.enum(["IMAGE", "VIDEO"]),
    duration: z.number().positive().max(60).default(5),
    stickerType: z.string().optional(),
    stickerData: z.any().optional(),
  })).min(1).max(10),
}));

// Conversations
export const validateCreateConversation = validateBody(z.object({
  isGroup: z.boolean().default(false),
  groupName: z.string().max(100).optional(),
  participantIds: z.array(z.string().uuid()).min(1).max(50),
}));

export const validateSendMessage = validateBody(z.object({
  contentType: z.enum(["TEXT", "IMAGE", "VIDEO", "AUDIO", "FILE", "POST_SHARE", "REEL_SHARE", "STORY_SHARE", "PROFILE_SHARE", "LOCATION", "CONTACT", "VOICE", "REPLY", "SYSTEM"]),
  text: z.string().max(4000).optional(),
  mediaUrl: z.string().url().optional(),
  mediaThumbnail: z.string().url().optional(),
  mediaDuration: z.number().positive().optional(),
  replyToId: z.string().uuid().optional(),
  isEphemeral: z.boolean().default(false),
}));

// Users
export const validateUpdateProfile = validateBody(z.object({
  username: z.string().min(1).max(30).regex(/^[a-zA-Z0-9._]+$/).optional(),
  fullName: z.string().max(100).optional(),
  bio: z.string().max(150).optional(),
  website: z.string().url().max(200).optional(),
  avatarUrl: z.string().url().optional(),
  isPrivate: z.boolean().optional(),
}));

export const validateUpdateSettings = validateBody(z.object({
  language: z.string().length(2).optional(),
  darkMode: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  biometricEnabled: z.boolean().optional(),
  storyControls: z.object({
    allowReplies: z.enum(["followers", "everyone", "none"]).optional(),
    allowSharing: z.boolean().optional(),
  }).optional(),
  commentControls: z.object({
    allowCommentsFrom: z.enum(["everyone", "followers", "none"]).optional(),
    blockKeywords: z.array(z.string()).optional(),
  }).optional(),
  privacy: z.object({
    activityStatus: z.boolean().optional(),
    readReceipts: z.boolean().optional(),
  }).optional(),
}));

// Reports
export const validateReport = validateBody(
  z.object({
    type: z.enum(["POST", "COMMENT", "REEL", "STORY", "USER", "MESSAGE"]),
    reason: z.enum(["SPAM", "INAPPROPRIATE_CONTENT", "HARASSMENT", "HATE_SPEECH", "VIOLENCE", "SEXUAL_CONTENT", "SELF_HARM", "FAKE_ACCOUNT", "INTELLECTUAL_PROPERTY", "OTHER"]),
    description: z.string().max(1000).optional(),
    postId: z.string().uuid().optional(),
    commentId: z.string().uuid().optional(),
    reelId: z.string().uuid().optional(),
    storyId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    messageId: z.string().uuid().optional(),
  }).refine(
    (data) => {
      // Exactly one target ID must be provided
      const targets = [data.postId, data.commentId, data.reelId, data.storyId, data.userId, data.messageId].filter(Boolean);
      return targets.length === 1;
    },
    { message: "Exactly one target ID must be provided" }
  )
);

// Search
export const validateSearch = validateQuery(searchQuerySchema);

// Pagination
export const validatePagination = validateQuery(paginationQuerySchema);

// ID params
export const validateIdParam = validateParams(idParamSchema);
export const validateUsernameParam = validateParams(usernameParamSchema);