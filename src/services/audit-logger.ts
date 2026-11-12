import { db } from "../db/client";
import { auditLogs } from "../db/schema";
import { v4 as uuidv4 } from "uuid";
import { logger, createModuleLogger } from "./logger";
import { getRequestId, getTraceInfo } from "../middleware/telemetry";

/**
 * Audit Logger Service
 *
 * Writes immutable audit logs for all mutating operations.
 * Stores in partitioned audit_logs table for 7-year retention.
 *
 * Audit Events Covered:
 * - Authentication: login, logout, register, password reset, MFA changes
 * - User Management: profile updates, settings changes, account deletion
 * - Social: follow, unfollow, block, restrict, close friends
 * - Content: posts, stories, reels create/update/delete/archive
 * - Engagement: likes, comments, saves, shares, reactions
 * - Messaging: conversations, messages, reactions, read receipts
 * - Media: uploads, processing, deletions
 * - Admin: moderation actions, user management, reports
 * - Security: password changes, device management, session revocation
 */

// ============================================================================
// Types
// ============================================================================

export interface AuditLogEntry {
  action: string;
  actorId?: string;
  actorIp?: string;
  actorUserAgent?: string;
  resourceType?: string;
  resourceId?: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  correlationId?: string;
  sessionId?: string;
  requestId?: string;
  metadata?: Record<string, any>;
}

export interface AuditLogOptions {
  /** Skip database write (for testing or high-throughput paths) */
  skipDb?: boolean;
  /** Async write (fire and forget) */
  async?: boolean;
}

// ============================================================================
// Action Constants
// ============================================================================

export const AuditActions = {
  // Authentication
  AUTH_LOGIN: "auth.login",
  AUTH_LOGOUT: "auth.logout",
  AUTH_REGISTER: "auth.register",
  AUTH_PASSWORD_RESET_REQUEST: "auth.password_reset_request",
  AUTH_PASSWORD_RESET_COMPLETE: "auth.password_reset_complete",
  AUTH_EMAIL_VERIFY: "auth.email_verify",
  AUTH_PHONE_VERIFY: "auth.phone_verify",
  AUTH_MFA_ENABLE: "auth.mfa_enable",
  AUTH_MFA_DISABLE: "auth.mfa_disable",
  AUTH_TOKEN_REFRESH: "auth.token_refresh",
  AUTH_SESSION_REVOKE: "auth.session_revoke",
  AUTH_DEVICE_ADD: "auth.device_add",
  AUTH_DEVICE_REMOVE: "auth.device_remove",
  AUTH_OAUTH_LINK: "auth.oauth_link",
  AUTH_OAUTH_UNLINK: "auth.oauth_unlink",

  // User Management
  USER_PROFILE_UPDATE: "user.profile_update",
  USER_SETTINGS_UPDATE: "user.settings_update",
  USER_PRIVACY_UPDATE: "user.privacy_update",
  USER_NOTIFICATION_SETTINGS_UPDATE: "user.notification_settings_update",
  USER_ACCOUNT_DELETE: "user.account_delete",
  USER_USERNAME_CHANGE: "user.username_change",
  USER_AVATAR_UPDATE: "user.avatar_update",

  // Social
  FOLLOW_CREATE: "follow.create",
  FOLLOW_DELETE: "follow.delete",
  FOLLOW_ACCEPT: "follow.accept",
  FOLLOW_REJECT: "follow.reject",
  BLOCK_CREATE: "block.create",
  BLOCK_DELETE: "block.delete",
  RESTRICT_CREATE: "restrict.create",
  RESTRICT_DELETE: "restrict.delete",
  CLOSE_FRIENDS_ADD: "close_friends.add",
  CLOSE_FRIENDS_REMOVE: "close_friends.remove",

  // Posts
  POST_CREATE: "post.create",
  POST_UPDATE: "post.update",
  POST_DELETE: "post.delete",
  POST_ARCHIVE: "post.archive",
  POST_UNARCHIVE: "post.unarchive",
  POST_LIKE: "post.like",
  POST_UNLIKE: "post.unlike",
  POST_SAVE: "post.save",
  POST_UNSAVE: "post.unsave",
  POST_SHARE: "post.share",
  POST_REPORT: "post.report",

  // Reels
  REEL_CREATE: "reel.create",
  REEL_UPDATE: "reel.update",
  REEL_DELETE: "reel.delete",
  REEL_LIKE: "reel.like",
  REEL_UNLIKE: "reel.unlike",
  REEL_SAVE: "reel.save",
  REEL_UNSAVE: "reel.unsave",
  REEL_SHARE: "reel.share",
  REEL_REMIX: "reel.remix",
  REEL_REPORT: "reel.report",

  // Stories
  STORY_CREATE: "story.create",
  STORY_DELETE: "story.delete",
  STORY_VIEW: "story.view",
  STORY_REPLY: "story.reply",
  STORY_HIGHLIGHT_CREATE: "story.highlight_create",
  STORY_HIGHLIGHT_UPDATE: "story.highlight_update",
  STORY_HIGHLIGHT_DELETE: "story.highlight_delete",

  // Comments
  COMMENT_CREATE: "comment.create",
  COMMENT_UPDATE: "comment.update",
  COMMENT_DELETE: "comment.delete",
  COMMENT_LIKE: "comment.like",
  COMMENT_UNLIKE: "comment.unlike",
  COMMENT_REPORT: "comment.report",
  COMMENT_HIDE: "comment.hide",
  COMMENT_UNHIDE: "comment.unhide",

  // Direct Messages
  CONVERSATION_CREATE: "conversation.create",
  CONVERSATION_UPDATE: "conversation.update",
  CONVERSATION_DELETE: "conversation.delete",
  CONVERSATION_MUTE: "conversation.mute",
  CONVERSATION_UNMUTE: "conversation.unmute",
  CONVERSATION_LEAVE: "conversation.leave",
  CONVERSATION_BLOCK: "conversation.block",
  CONVERSATION_REPORT: "conversation.report",
  MESSAGE_SEND: "message.send",
  MESSAGE_EDIT: "message.edit",
  MESSAGE_UNSEND: "message.unsend",
  MESSAGE_REACTION_ADD: "message.reaction_add",
  MESSAGE_REACTION_REMOVE: "message.reaction_remove",
  MESSAGE_READ: "message.read",

  // Notifications
  NOTIFICATION_READ: "notification.read",
  NOTIFICATION_READ_ALL: "notification.read_all",
  NOTIFICATION_DISMISS: "notification.dismiss",

  // Media
  MEDIA_UPLOAD: "media.upload",
  MEDIA_PROCESS: "media.process",
  MEDIA_DELETE: "media.delete",
  MEDIA_TUS_CREATE: "media.tus_create",
  MEDIA_TUS_COMPLETE: "media.tus_complete",

  // Calls
  CALL_INITIATE: "call.initiate",
  CALL_JOIN: "call.join",
  CALL_LEAVE: "call.leave",
  CALL_END: "call.end",
  CALL_INVITE: "call.invite",
  CALL_KICK: "call.kick",
  CALL_TRANSFER_HOST: "call.transfer_host",

  // Search
  SEARCH_QUERY: "search.query",
  SEARCH_HISTORY_CLEAR: "search.history_clear",

  // Admin/Moderation
  ADMIN_REPORT_RESOLVE: "admin.report_resolve",
  ADMIN_USER_ACTION: "admin.user_action",
  ADMIN_CONTENT_REMOVE: "admin.content_remove",
  ADMIN_ACCOUNT_SUSPEND: "admin.account_suspend",
  ADMIN_ACCOUNT_BAN: "admin.account_ban",
  ADMIN_SHADOWBAN: "admin.shadowban",
  ADMIN_FEATURE_RESTRICT: "admin.feature_restrict",

  // Security
  SECURITY_PASSWORD_CHANGE: "security.password_change",
  SECURITY_LOGIN_ALERT: "security.login_alert",
  SECURITY_SUSPICIOUS_ACTIVITY: "security.suspicious_activity",
  SECURITY_RATE_LIMIT_EXCEEDED: "security.rate_limit_exceeded",
} as const;

export type AuditAction = typeof AuditActions[keyof typeof AuditActions];

// ============================================================================
// Resource Types
// ============================================================================

export const ResourceTypes = {
  USER: "user",
  POST: "post",
  REEL: "reel",
  STORY: "story",
  STORY_ITEM: "story_item",
  COMMENT: "comment",
  LIKE: "like",
  SAVE: "save",
  COLLECTION: "collection",
  CONVERSATION: "conversation",
  MESSAGE: "message",
  MESSAGE_REACTION: "message_reaction",
  NOTIFICATION: "notification",
  FOLLOW: "follow",
  BLOCK: "block",
  RESTRICTION: "restriction",
  CLOSE_FRIEND: "close_friend",
  MEDIA_ITEM: "media_item",
  TUS_UPLOAD: "tus_upload",
  CALL: "call",
  CALL_PARTICIPANT: "call_participant",
  REPORT: "report",
  MODERATION_ACTION: "moderation_action",
  DEVICE_TOKEN: "device_token",
  SESSION: "session",
  HASHTAG: "hashtag",
  LOCATION: "location",
  AUDIO_TRACK: "audio_track",
  SEARCH_HISTORY: "search_history",
} as const;

// ============================================================================
// Module Logger
// ============================================================================

const moduleLogger = createModuleLogger("audit-logger");

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Write an audit log entry
 */
export async function writeAuditLog(
  entry: AuditLogEntry,
  options: AuditLogOptions = {}
): Promise<string> {
  const eventId = uuidv4();
  const traceInfo = getTraceInfo ? getTraceInfo(null) : null;

  // Enrich with request context if available
  const enrichedEntry: typeof auditLogs.$inferInsert = {
    id: eventId,
    actorId: entry.actorId,
    actorIp: entry.actorIp,
    actorUserAgent: entry.actorUserAgent,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    oldValues: entry.oldValues,
    newValues: entry.newValues,
    correlationId: entry.correlationId,
    sessionId: entry.sessionId,
    requestId: entry.requestId || getRequestId?.({ get: () => undefined } as any), // Will be populated by middleware
    metadata: {
      ...entry.metadata,
      traceId: traceInfo?.traceId,
      spanId: traceInfo?.spanId,
    },
    createdAt: new Date(),
  };

  // Log to structured logger
  moduleLogger.info(
    {
      audit: true,
      eventId,
      ...enrichedEntry,
    },
    `Audit: ${entry.action}`
  );

  // Write to database
  if (!options.skipDb) {
    try {
      if (options.async) {
        // Fire and forget
        db.insert(auditLogs).values(enrichedEntry).catch((err) => {
          moduleLogger.error({ err, eventId }, "Failed to write audit log (async)");
        });
      } else {
        await db.insert(auditLogs).values(enrichedEntry);
      }
    } catch (error) {
      moduleLogger.error({ err: error, eventId }, "Failed to write audit log");
      // Don't throw - audit logging should not break the main operation
    }
  }

  return eventId;
}

/**
 * Write multiple audit log entries in a batch
 */
export async function writeAuditLogBatch(
  entries: AuditLogEntry[],
  options: AuditLogOptions = {}
): Promise<string[]> {
  const eventIds = entries.map(() => uuidv4());
  const traceInfo = getTraceInfo ? getTraceInfo(null) : null;

  const enrichedEntries = entries.map((entry, index) => ({
    id: eventIds[index],
    actorId: entry.actorId,
    actorIp: entry.actorIp,
    actorUserAgent: entry.actorUserAgent,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    oldValues: entry.oldValues,
    newValues: entry.newValues,
    correlationId: entry.correlationId,
    sessionId: entry.sessionId,
    requestId: entry.requestId,
    metadata: {
      ...entry.metadata,
      traceId: traceInfo?.traceId,
      spanId: traceInfo?.spanId,
    },
    createdAt: new Date(),
  }));

  // Log to structured logger
  for (const enriched of enrichedEntries) {
    moduleLogger.info(
      {
        audit: true,
        batch: true,
        eventId: enriched.id,
        action: enriched.action,
        actorId: enriched.actorId,
        resourceType: enriched.resourceType,
        resourceId: enriched.resourceId,
      },
      `Audit: ${enriched.action}`
    );
  }

  // Write to database
  if (!options.skipDb && enrichedEntries.length > 0) {
    try {
      if (options.async) {
        db.insert(auditLogs).values(enrichedEntries).catch((err) => {
          moduleLogger.error({ err, count: enrichedEntries.length }, "Failed to write audit log batch (async)");
        });
      } else {
        await db.insert(auditLogs).values(enrichedEntries);
      }
    } catch (error) {
      moduleLogger.error({ err: error, count: enrichedEntries.length }, "Failed to write audit log batch");
    }
  }

  return eventIds;
}

/**
 * Create audit log from request context and changes
 */
export function createAuditLog(
  c: any,
  action: string,
  resourceType: string,
  resourceId: string,
  oldValues?: Record<string, any>,
  newValues?: Record<string, any>,
  metadata?: Record<string, any>
): AuditLogEntry {
  const requestId = c.get("requestId");
  const traceInfo = c.get("traceInfo");
  const user = c.get("user");
  const session = c.get("session");

  // Get IP and user agent
  const ip = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || c.req.header("X-Real-IP");
  const userAgent = c.req.header("User-Agent");

  return {
    action,
    actorId: user?.id,
    actorIp: ip,
    actorUserAgent: userAgent,
    resourceType,
    resourceId,
    oldValues,
    newValues,
    correlationId: traceInfo?.traceId,
    sessionId: session?.sessionId,
    requestId,
    metadata: {
      ...metadata,
      method: c.req.method,
      path: c.req.path,
      traceId: traceInfo?.traceId,
      spanId: traceInfo?.spanId,
    },
  };
}

/**
 * Helper to write audit log from request context
 */
export async function auditLog(
  c: any,
  action: string,
  resourceType: string,
  resourceId: string,
  oldValues?: Record<string, any>,
  newValues?: Record<string, any>,
  metadata?: Record<string, any>,
  options: AuditLogOptions = {}
): Promise<string> {
  const entry = createAuditLog(c, action, resourceType, resourceId, oldValues, newValues, metadata);
  return writeAuditLog(entry, options);
}

// ============================================================================
// Convenience Functions for Common Operations
// ============================================================================

// Authentication
export async function auditAuthLogin(c: any, userId: string, provider: string, success: boolean, metadata?: any) {
  return auditLog(c, success ? AuditActions.AUTH_LOGIN : `${AuditActions.AUTH_LOGIN}_failed`, ResourceTypes.USER, userId, undefined, undefined, { provider, success, ...metadata });
}

export async function auditAuthLogout(c: any, userId: string, sessionId: string) {
  return auditLog(c, AuditActions.AUTH_LOGOUT, ResourceTypes.SESSION, sessionId, undefined, undefined, { userId });
}

export async function auditAuthRegister(c: any, userId: string, provider: string) {
  return auditLog(c, AuditActions.AUTH_REGISTER, ResourceTypes.USER, userId, undefined, undefined, { provider });
}

export async function auditPasswordChange(c: any, userId: string, method: "reset" | "change") {
  return auditLog(c, AuditActions.SECURITY_PASSWORD_CHANGE, ResourceTypes.USER, userId, undefined, undefined, { method });
}

export async function auditMfaChange(c: any, userId: string, enabled: boolean) {
  return auditLog(c, enabled ? AuditActions.AUTH_MFA_ENABLE : AuditActions.AUTH_MFA_DISABLE, ResourceTypes.USER, userId, undefined, undefined, { enabled });
}

export async function auditSessionRevoke(c: any, userId: string, sessionId: string, revokedBy: "user" | "admin" | "system") {
  return auditLog(c, AuditActions.AUTH_SESSION_REVOKE, ResourceTypes.SESSION, sessionId, undefined, undefined, { userId, revokedBy });
}

export async function auditDeviceChange(c: any, userId: string, deviceId: string, action: "add" | "remove") {
  return auditLog(c, action === "add" ? AuditActions.AUTH_DEVICE_ADD : AuditActions.AUTH_DEVICE_REMOVE, ResourceTypes.DEVICE_TOKEN, deviceId, undefined, undefined, { userId });
}

// User Management
export async function auditProfileUpdate(c: any, userId: string, oldValues: any, newValues: any) {
  return auditLog(c, AuditActions.USER_PROFILE_UPDATE, ResourceTypes.USER, userId, oldValues, newValues);
}

export async function auditSettingsUpdate(c: any, userId: string, oldValues: any, newValues: any) {
  return auditLog(c, AuditActions.USER_SETTINGS_UPDATE, ResourceTypes.USER, userId, oldValues, newValues);
}

export async function auditPrivacyUpdate(c: any, userId: string, oldValues: any, newValues: any) {
  return auditLog(c, AuditActions.USER_PRIVACY_UPDATE, ResourceTypes.USER, userId, oldValues, newValues);
}

export async function auditAccountDelete(c: any, userId: string) {
  return auditLog(c, AuditActions.USER_ACCOUNT_DELETE, ResourceTypes.USER, userId);
}

// Social
export async function auditFollow(c: any, followerId: string, followingId: string, status: "create" | "accept" | "reject" | "delete") {
  const actionMap = {
    create: AuditActions.FOLLOW_CREATE,
    accept: AuditActions.FOLLOW_ACCEPT,
    reject: AuditActions.FOLLOW_REJECT,
    delete: AuditActions.FOLLOW_DELETE,
  };
  return auditLog(c, actionMap[status], ResourceTypes.FOLLOW, followingId, undefined, undefined, { followerId, followingId, status });
}

export async function auditBlock(c: any, blockerId: string, blockedId: string, action: "create" | "delete") {
  return auditLog(c, action === "create" ? AuditActions.BLOCK_CREATE : AuditActions.BLOCK_DELETE, ResourceTypes.BLOCK, blockedId, undefined, undefined, { blockerId, blockedId });
}

export async function auditRestrict(c: any, restrictorId: string, restrictedId: string, action: "create" | "delete") {
  return auditLog(c, action === "create" ? AuditActions.RESTRICT_CREATE : AuditActions.RESTRICT_DELETE, ResourceTypes.RESTRICTION, restrictedId, undefined, undefined, { restrictorId, restrictedId });
}

export async function auditCloseFriends(c: any, userId: string, friendId: string, action: "add" | "remove") {
  return auditLog(c, action === "add" ? AuditActions.CLOSE_FRIENDS_ADD : AuditActions.CLOSE_FRIENDS_REMOVE, ResourceTypes.CLOSE_FRIEND, friendId, undefined, undefined, { userId, friendId });
}

// Posts
export async function auditPostCreate(c: any, postId: string, authorId: string, data: any) {
  return auditLog(c, AuditActions.POST_CREATE, ResourceTypes.POST, postId, undefined, data, { authorId });
}

export async function auditPostUpdate(c: any, postId: string, oldValues: any, newValues: any) {
  return auditLog(c, AuditActions.POST_UPDATE, ResourceTypes.POST, postId, oldValues, newValues);
}

export async function auditPostDelete(c: any, postId: string, authorId: string, hardDelete = false) {
  return auditLog(c, hardDelete ? `${AuditActions.POST_DELETE}_hard` : AuditActions.POST_DELETE, ResourceTypes.POST, postId, undefined, undefined, { authorId });
}

export async function auditPostArchive(c: any, postId: string, archived: boolean) {
  return auditLog(c, archived ? AuditActions.POST_ARCHIVE : AuditActions.POST_UNARCHIVE, ResourceTypes.POST, postId);
}

export async function auditPostLike(c: any, postId: string, userId: string, action: "like" | "unlike") {
  return auditLog(c, action === "like" ? AuditActions.POST_LIKE : AuditActions.POST_UNLIKE, ResourceTypes.POST, postId, undefined, undefined, { userId });
}

export async function auditPostSave(c: any, postId: string, userId: string, collectionId?: string, action: "save" | "unsave" = "save") {
  return auditLog(c, action === "save" ? AuditActions.POST_SAVE : AuditActions.POST_UNSAVE, ResourceTypes.POST, postId, undefined, undefined, { userId, collectionId });
}

export async function auditPostShare(c: any, postId: string, userId: string, shareType: string) {
  return auditLog(c, AuditActions.POST_SHARE, ResourceTypes.POST, postId, undefined, undefined, { userId, shareType });
}

// Reels
export async function auditReelCreate(c: any, reelId: string, authorId: string, data: any) {
  return auditLog(c, AuditActions.REEL_CREATE, ResourceTypes.REEL, reelId, undefined, data, { authorId });
}

export async function auditReelUpdate(c: any, reelId: string, oldValues: any, newValues: any) {
  return auditLog(c, AuditActions.REEL_UPDATE, ResourceTypes.REEL, reelId, oldValues, newValues);
}

export async function auditReelDelete(c: any, reelId: string, authorId: string) {
  return auditLog(c, AuditActions.REEL_DELETE, ResourceTypes.REEL, reelId, undefined, undefined, { authorId });
}

export async function auditReelLike(c: any, reelId: string, userId: string, action: "like" | "unlike") {
  return auditLog(c, action === "like" ? AuditActions.REEL_LIKE : AuditActions.REEL_UNLIKE, ResourceTypes.REEL, reelId, undefined, undefined, { userId });
}

// Stories
export async function auditStoryCreate(c: any, storyId: string, authorId: string, data: any) {
  return auditLog(c, AuditActions.STORY_CREATE, ResourceTypes.STORY, storyId, undefined, data, { authorId });
}

export async function auditStoryView(c: any, storyId: string, viewerId: string) {
  return auditLog(c, AuditActions.STORY_VIEW, ResourceTypes.STORY, storyId, undefined, undefined, { viewerId });
}

// Comments
export async function auditCommentCreate(c: any, commentId: string, authorId: string, data: any) {
  return auditLog(c, AuditActions.COMMENT_CREATE, ResourceTypes.COMMENT, commentId, undefined, data, { authorId });
}

export async function auditCommentUpdate(c: any, commentId: string, oldValues: any, newValues: any) {
  return auditLog(c, AuditActions.COMMENT_UPDATE, ResourceTypes.COMMENT, commentId, oldValues, newValues);
}

export async function auditCommentDelete(c: any, commentId: string, authorId: string) {
  return auditLog(c, AuditActions.COMMENT_DELETE, ResourceTypes.COMMENT, commentId, undefined, undefined, { authorId });
}

export async function auditCommentLike(c: any, commentId: string, userId: string, action: "like" | "unlike") {
  return auditLog(c, action === "like" ? AuditActions.COMMENT_LIKE : AuditActions.COMMENT_UNLIKE, ResourceTypes.COMMENT, commentId, undefined, undefined, { userId });
}

// Messages
export async function auditMessageSend(c: any, messageId: string, conversationId: string, senderId: string, contentType: string) {
  return auditLog(c, AuditActions.MESSAGE_SEND, ResourceTypes.MESSAGE, messageId, undefined, undefined, { conversationId, senderId, contentType });
}

export async function auditMessageEdit(c: any, messageId: string, oldText: string, newText: string) {
  return auditLog(c, AuditActions.MESSAGE_EDIT, ResourceTypes.MESSAGE, messageId, { text: oldText }, { text: newText });
}

export async function auditMessageUnsend(c: any, messageId: string, senderId: string, forEveryone: boolean) {
  return auditLog(c, AuditActions.MESSAGE_UNSEND, ResourceTypes.MESSAGE, messageId, undefined, undefined, { senderId, forEveryone });
}

// Admin/Moderation
export async function auditAdminAction(c: any, action: string, targetType: string, targetId: string, moderatorId: string, reason: string, metadata?: any) {
  return auditLog(c, action, targetType, targetId, undefined, undefined, { moderatorId, reason, ...metadata });
}

// Security
export async function auditSecurityEvent(c: any, event: string, userId?: string, metadata?: any) {
  return auditLog(c, event, ResourceTypes.USER, userId || "", undefined, undefined, metadata);
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Query audit logs with filters
 */
export async function queryAuditLogs(filters: {
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  correlationId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}): Promise<any[]> {
  // This would use the db client to query
  // For now, return empty array - implement based on actual query needs
  return [];
}

/**
 * Get audit logs for a specific resource
 */
export async function getAuditTrail(resourceType: string, resourceId: string, limit = 100): Promise<any[]> {
  // Implement query to audit_logs table
  return [];
}

// ============================================================================
// Export
// ============================================================================

export default {
  writeAuditLog,
  writeAuditLogBatch,
  createAuditLog,
  auditLog,
  queryAuditLogs,
  getAuditTrail,
  AuditActions,
  ResourceTypes,
};