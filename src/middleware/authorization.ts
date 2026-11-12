import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { getPolicyService, createUserContext, createResourceData, AuthorizationResult } from "../services/policy-service";
import { getCurrentUser, getCurrentSession } from "../middleware/auth";
import * as schema from "../db/schema";
import { db } from "../db/client";
import { eq, and } from "drizzle-orm";

/**
 * Authorization Middleware
 *
 * Integrates the policy engine with Hono middleware to provide
 * fine-grained authorization for API endpoints.
 *
 * Usage:
 * - authorize("posts", "read") - Check if user can read posts
 * - authorize("posts", "create") - Check if user can create posts
 * - authorize("messages", "update", { via: "sender_id" }) - Check with custom ownership
 * - authorizeResource("posts", "read", async (c) => getPost(c.req.param("id"))) - Check on specific resource
 */

// ============================================================================
// Types
// ============================================================================

export type ResourceType =
  | "users"
  | "posts"
  | "reels"
  | "stories"
  | "comments"
  | "likes"
  | "conversations"
  | "messages"
  | "notifications"
  | "follows"
  | "blocks"
  | "restrictions"
  | "close_friends"
  | "collections"
  | "saved_items"
  | "device_tokens"
  | "calls"
  | "call_participants"
  | "live_videos"
  | "reports";

export type ActionType = "read" | "create" | "update" | "delete" | "list";

export interface AuthorizationMiddlewareOptions {
  resource: ResourceType;
  action: ActionType;
  // Optional: Custom function to fetch resource data for policy evaluation
  getResourceData?: (c: any) => Promise<any> | any;
  // Optional: Override the default ownership field
  ownershipField?: string;
  // Optional: Allow if user has any of these roles (bypass policy)
  bypassRoles?: string[];
  // Optional: Custom error message
  errorMessage?: string;
  // Optional: Whether to throw on failure or just set context
  throwOnFailure?: boolean;
}

declare module "hono" {
  interface ContextVariableMap {
    authzResult?: AuthorizationResult;
    resourceData?: any;
  }
}

// ============================================================================
// Helper: Fetch resource data from database
// ============================================================================

async function fetchResourceData(
  resourceType: ResourceType,
  id: string
): Promise<any> {
  switch (resourceType) {
    case "posts":
      return db.query.posts.findFirst({ where: eq(schema.posts.id, id) });
    case "reels":
      return db.query.reels.findFirst({ where: eq(schema.reels.id, id) });
    case "stories":
      return db.query.stories.findFirst({ where: eq(schema.stories.id, id) });
    case "comments":
      return db.query.comments.findFirst({ where: eq(schema.comments.id, id) });
    case "conversations":
      return db.query.conversations.findFirst({ where: eq(schema.conversations.id, id) });
    case "messages":
      return db.query.messages.findFirst({ where: eq(schema.messages.id, id) });
    case "users":
      return db.query.users.findFirst({ where: eq(schema.users.id, id) });
    case "follows":
      return db.query.follows.findFirst({ where: eq(schema.follows.id, id) });
    case "blocks":
      return db.query.blocks.findFirst({ where: eq(schema.blocks.id, id) });
    case "restrictions":
      return db.query.restrictions.findFirst({ where: eq(schema.restrictions.id, id) });
    case "close_friends":
      return db.query.closeFriends.findFirst({ where: eq(schema.closeFriends.id, id) });
    case "collections":
      return db.query.collections.findFirst({ where: eq(schema.collections.id, id) });
    case "saved_items":
      return db.query.savedItems.findFirst({ where: eq(schema.savedItems.id, id) });
    case "device_tokens":
      return db.query.deviceTokens.findFirst({ where: eq(schema.deviceTokens.id, id) });
    case "calls":
      return db.query.calls.findFirst({ where: eq(schema.calls.id, id) });
    case "call_participants":
      return db.query.callParticipants.findFirst({ where: eq(schema.callParticipants.id, id) });
    case "live_videos":
      return db.query.liveVideos.findFirst({ where: eq(schema.liveVideos.id, id) });
    case "reports":
      return db.query.reports.findFirst({ where: eq(schema.reports.id, id) });
    case "notifications":
      return db.query.notifications.findFirst({ where: eq(schema.notifications.id, id) });
    case "likes":
      return db.query.likes.findFirst({ where: eq(schema.likes.id, id) });
    default:
      return null;
  }
}

// ============================================================================
// Main Authorization Middleware Factory
// ============================================================================

/**
 * Create authorization middleware for a specific resource and action
 *
 * @param options - Authorization options
 * @returns Hono middleware
 *
 * @example
 * ```typescript
 * // Basic usage - check policy on resource from URL param
 * app.get("/posts/:id", authorize({ resource: "posts", action: "read" }), handler);
 *
 * // With custom resource fetch
 * app.get("/posts/:id", authorize({
 *   resource: "posts",
 *   action: "read",
 *   getResourceData: async (c) => {
 *     const post = await getPost(c.req.param("id"));
 *     return post;
 *   }
 * }), handler);
 *
 * // For create actions (no resource ID yet)
 * app.post("/posts", authorize({ resource: "posts", action: "create" }), handler);
 * ```
 */
export function authorize(options: AuthorizationMiddlewareOptions) {
  const {
    resource,
    action,
    getResourceData,
    ownershipField,
    bypassRoles = [],
    errorMessage,
    throwOnFailure = true,
  } = options;

  return createMiddleware(async (c, next) => {
    const policyService = getPolicyService();
    const user = getCurrentUser(c);
    const userContext = createUserContext(user);

    // Check bypass roles
    if (bypassRoles.length > 0 && userContext.roles) {
      const hasBypassRole = bypassRoles.some((role) => userContext.roles!.includes(role));
      if (hasBypassRole) {
        await next();
        return;
      }
    }

    // Get resource data for policy evaluation
    let resourceData: any = null;

    if (getResourceData) {
      // Use custom resource fetcher
      resourceData = await getResourceData(c);
    } else if (action !== "create" && action !== "list") {
      // Try to get resource ID from common parameter names
      const resourceId = c.req.param("id") || c.req.param("resourceId") || c.req.param(`${resource}Id`);

      if (resourceId) {
        resourceData = await fetchResourceData(resource, resourceId);
      }
    }

    // Create resource data object for policy evaluation
    const resourceDataForPolicy = resourceData
      ? createResourceData(resourceData, resource)
      : undefined;

    // Store resource data in context for downstream handlers
    if (resourceData) {
      c.set("resourceData", resourceData);
    }

    // Evaluate policy
    const result = await policyService.authorize({
      user: userContext,
      resource,
      action,
      resourceData: resourceDataForPolicy,
    });

    // Store authorization result in context
    c.set("authzResult", result);

    if (!result.allowed) {
      if (throwOnFailure) {
        throw new HTTPException(403, {
          message: errorMessage || `Access denied: ${result.reason || "Insufficient permissions"}`,
          res: c.json({
            success: false,
            error: "FORBIDDEN",
            message: errorMessage || result.reason || "Insufficient permissions to perform this action",
            policy: result.policy,
          }, 403),
        });
      }
      // If not throwing, still call next but result is in context
    }

    await next();
  });
}

// ============================================================================
// Convenience Middlewares for Common Patterns
// ============================================================================

/**
 * Middleware to check if user can read a specific resource by ID
 * Automatically fetches the resource from the database
 */
export function canRead(resource: ResourceType) {
  return authorize({ resource, action: "read" });
}

/**
 * Middleware to check if user can create a resource
 */
export function canCreate(resource: ResourceType) {
  return authorize({ resource, action: "create" });
}

/**
 * Middleware to check if user can update a specific resource by ID
 */
export function canUpdate(resource: ResourceType) {
  return authorize({ resource, action: "update" });
}

/**
 * Middleware to check if user can delete a specific resource by ID
 */
export function canDelete(resource: ResourceType) {
  return authorize({ resource, action: "delete" });
}

/**
 * Middleware to check if user can list resources
 */
export function canList(resource: ResourceType) {
  return authorize({ resource, action: "list" });
}

// ============================================================================
// Resource-Specific Middlewares (for better type inference)
// ============================================================================

// Posts
export const canReadPost = canRead("posts");
export const canCreatePost = canCreate("posts");
export const canUpdatePost = canUpdate("posts");
export const canDeletePost = canDelete("posts");

// Reels
export const canReadReel = canRead("reels");
export const canCreateReel = canCreate("reels");
export const canUpdateReel = canUpdate("reels");
export const canDeleteReel = canDelete("reels");

// Stories
export const canReadStory = canRead("stories");
export const canCreateStory = canCreate("stories");
export const canUpdateStory = canUpdate("stories");
export const canDeleteStory = canDelete("stories");

// Comments
export const canReadComment = canRead("comments");
export const canCreateComment = canCreate("comments");
export const canUpdateComment = canUpdate("comments");
export const canDeleteComment = canDelete("comments");

// Conversations
export const canReadConversation = canRead("conversations");
export const canCreateConversation = canCreate("conversations");
export const canUpdateConversation = canUpdate("conversations");

// Messages
export const canReadMessage = canRead("messages");
export const canCreateMessage = canCreate("messages");
export const canUpdateMessage = canUpdate("messages");
export const canDeleteMessage = canDelete("messages");

// Users
export const canReadUser = canRead("users");
export const canUpdateUser = canUpdate("users");

// Follows
export const canReadFollow = canRead("follows");
export const canCreateFollow = canCreate("follows");
export const canUpdateFollow = canUpdate("follows");
export const canDeleteFollow = canDelete("follows");

// Blocks
export const canReadBlock = canRead("blocks");
export const canCreateBlock = canCreate("blocks");
export const canDeleteBlock = canDelete("blocks");

// Restrictions
export const canReadRestriction = canRead("restrictions");
export const canCreateRestriction = canCreate("restrictions");
export const canDeleteRestriction = canDelete("restrictions");

// Close Friends
export const canReadCloseFriend = canRead("close_friends");
export const canCreateCloseFriend = canCreate("close_friends");
export const canDeleteCloseFriend = canDelete("close_friends");

// Collections
export const canReadCollection = canRead("collections");
export const canCreateCollection = canCreate("collections");
export const canUpdateCollection = canUpdate("collections");
export const canDeleteCollection = canDelete("collections");

// Saved Items
export const canReadSavedItem = canRead("saved_items");
export const canCreateSavedItem = canCreate("saved_items");
export const canDeleteSavedItem = canDelete("saved_items");

// Device Tokens
export const canReadDeviceToken = canRead("device_tokens");
export const canCreateDeviceToken = canCreate("device_tokens");
export const canUpdateDeviceToken = canUpdate("device_tokens");
export const canDeleteDeviceToken = canDelete("device_tokens");

// Calls
export const canReadCall = canRead("calls");
export const canCreateCall = canCreate("calls");
export const canUpdateCall = canUpdate("calls");

// Call Participants
export const canReadCallParticipant = canRead("call_participants");
export const canUpdateCallParticipant = canUpdate("call_participants");

// Live Videos
export const canReadLiveVideo = canRead("live_videos");
export const canCreateLiveVideo = canCreate("live_videos");
export const canUpdateLiveVideo = canUpdate("live_videos");

// Reports
export const canReadReport = canRead("reports");
export const canCreateReport = canCreate("reports");
export const canUpdateReport = canUpdate("reports");

// Notifications
export const canReadNotification = canRead("notifications");
export const canUpdateNotification = canUpdate("notifications");

// Likes
export const canReadLike = canRead("likes");
export const canCreateLike = canCreate("likes");
export const canDeleteLike = canDelete("likes");

// ============================================================================
// Advanced Middlewares
// ============================================================================

/**
 * Middleware that allows access if user is the owner OR has admin/moderator role
 * Useful for admin endpoints that also allow owners to manage their own resources
 */
export function ownerOrAdmin(resource: ResourceType, action: ActionType) {
  return authorize({
    resource,
    action,
    bypassRoles: ["admin", "moderator"],
  });
}

/**
 * Middleware for conversation membership checks
 * Allows access if user is a member of the conversation
 */
export function conversationMember(action: ActionType = "read") {
  return authorize({
    resource: "conversations",
    action,
    getResourceData: async (c) => {
      const conversationId = c.req.param("id") || c.req.param("conversationId");
      if (!conversationId) return null;

      const conversation = await db.query.conversations.findFirst({
        where: eq(schema.conversations.id, conversationId),
      });

      if (!conversation) return null;

      // Check membership
      const membership = await db.query.conversationMembers.findFirst({
        where: and(
          eq(schema.conversationMembers.conversationId, conversationId),
          eq(schema.conversationMembers.userId, getCurrentUser(c).id),
          // Not left
        ),
      });

      if (!membership) return null;

      return { ...conversation, membership };
    },
  });
}

/**
 * Middleware for call participant checks
 */
export function callParticipant(action: ActionType = "read") {
  return authorize({
    resource: "calls",
    action,
    getResourceData: async (c) => {
      const callId = c.req.param("id") || c.req.param("callId");
      if (!callId) return null;

      const call = await db.query.calls.findFirst({
        where: eq(schema.calls.id, callId),
      });

      if (!call) return null;

      // Check participation
      const participant = await db.query.callParticipants.findFirst({
        where: and(
          eq(schema.callParticipants.callId, callId),
          eq(schema.callParticipants.userId, getCurrentUser(c).id),
        ),
      });

      if (!participant) return null;

      return { ...call, participant };
    },
  });
}

/**
 * Conditional authorization middleware
 * Runs custom logic to determine if authorization should proceed
 */
export function conditionalAuthorize(
  condition: (c: any) => boolean | Promise<boolean>,
  options: AuthorizationMiddlewareOptions
) {
  const middleware = authorize(options);

  return createMiddleware(async (c, next) => {
    const shouldAuthorize = await condition(c);

    if (!shouldAuthorize) {
      await next();
      return;
    }

    // Run the actual authorization middleware
    return middleware(c, next);
  });
}

/**
 * Get authorization result from context (for use in handlers)
 */
export function getAuthzResult(c: any): AuthorizationResult | undefined {
  return c.get("authzResult");
}

/**
 * Get resource data from context (set by authorization middleware)
 */
export function getResourceData(c: any): any {
  return c.get("resourceData");
}

// ============================================================================
// Helper for extracting resource ID from request
// ============================================================================

export function getResourceId(c: any, resourceType: ResourceType): string | undefined {
  // Try common parameter names
  const paramNames = [
    "id",
    "resourceId",
    `${resourceType}Id`,
    `${resourceType.slice(0, -1)}Id`, // singular form
  ];

  for (const param of paramNames) {
    const value = c.req.param(param);
    if (value) return value;
  }

  return undefined;
}

// Need to import isNull
import { isNull } from "drizzle-orm";