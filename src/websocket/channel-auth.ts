/**
 * Channel Authorization - WebSocket Channel Access Control
 *
 * Determines if a user can subscribe to a specific channel
 * Based on the channel naming conventions from DESIGN_DOCUMENT.md §7.1
 */

import { db } from "../db/client";
import { eq, and, or, inArray } from "drizzle-orm";
import * as schema from "../db/schema";

/**
 * Channel types and their authorization rules
 */
export enum ChannelType {
  USER = "user",
  CONVERSATION = "conversation",
  LIVE = "live",
  CALL = "call",
  PRESENCE = "presence",
  GLOBAL = "global",
  UPLOAD = "upload",
}

/**
 * Parsed channel information
 */
export interface ParsedChannel {
  type: ChannelType;
  identifier: string;
  raw: string;
}

/**
 * Authorization result
 */
export interface AuthResult {
  allowed: boolean;
  reason?: string;
  channelType?: ChannelType;
}

/**
 * Parse a channel string into its components
 * Channel format: "type:identifier" (e.g., "user:abc123", "conversation:xyz789")
 */
export function parseChannel(channel: string): ParsedChannel | null {
  const colonIndex = channel.indexOf(":");
  if (colonIndex === -1) {
    // Handle global channels without colon
    if (channel === "global:announcements") {
      return { type: ChannelType.GLOBAL, identifier: "announcements", raw: channel };
    }
    return null;
  }

  const type = channel.slice(0, colonIndex) as ChannelType;
  const identifier = channel.slice(colonIndex + 1);

  // Validate channel type
  if (!Object.values(ChannelType).includes(type)) {
    return null;
  }

  return { type, identifier, raw: channel };
}

/**
 * Check if user can subscribe to a channel
 * This is the main authorization function used by ConnectionManager
 */
export async function canSubscribe(userId: string, channel: string): Promise<AuthResult> {
  const parsed = parseChannel(channel);

  if (!parsed) {
    return { allowed: false, reason: "Invalid channel format" };
  }

  try {
    switch (parsed.type) {
      case ChannelType.USER:
        return await authorizeUserChannel(userId, parsed.identifier);

      case ChannelType.CONVERSATION:
        return await authorizeConversationChannel(userId, parsed.identifier);

      case ChannelType.LIVE:
        return await authorizeLiveChannel(userId, parsed.identifier);

      case ChannelType.CALL:
        return await authorizeCallChannel(userId, parsed.identifier);

      case ChannelType.UPLOAD:
        return await authorizeUploadChannel(userId, parsed.identifier);

      case ChannelType.PRESENCE:
        return await authorizePresenceChannel(userId, parsed.identifier);

      case ChannelType.GLOBAL:
        return await authorizeGlobalChannel(userId, parsed.identifier);

      default:
        return { allowed: false, reason: "Unknown channel type" };
    }
  } catch (error) {
    console.error(`[ChannelAuth] Authorization error for ${channel}:`, error);
    return { allowed: false, reason: "Authorization check failed" };
  }
}

/**
 * Authorize user-scoped channel (user:{userId})
 * Users can only subscribe to their own user channel
 */
async function authorizeUserChannel(userId: string, targetUserId: string): Promise<AuthResult> {
  if (userId === targetUserId) {
    return { allowed: true, channelType: ChannelType.USER };
  }
  return { allowed: false, reason: "Cannot subscribe to another user's channel", channelType: ChannelType.USER };
}

/**
 * Authorize conversation channel (conversation:{conversationId})
 * Users must be a member of the conversation
 */
async function authorizeConversationChannel(userId: string, conversationId: string): Promise<AuthResult> {
  try {
    const result = await db
      .select({ id: schema.conversationMembers.id })
      .from(schema.conversationMembers)
      .where(and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, userId)
      ))
      .limit(1);

    if (result.length > 0) {
      return { allowed: true, channelType: ChannelType.CONVERSATION };
    }

    return { allowed: false, reason: "Not a member of this conversation", channelType: ChannelType.CONVERSATION };
  } catch (error) {
    console.error(`[ChannelAuth] Conversation auth error:`, error);
    return { allowed: false, reason: "Conversation check failed", channelType: ChannelType.CONVERSATION };
  }
}

/**
 * Authorize live stream channel (live:{liveId})
 * Live streams are public - anyone can subscribe
 */
async function authorizeLiveChannel(userId: string, liveId: string): Promise<AuthResult> {
  // TODO: Add checks for private live streams, age restrictions, etc.
  // For now, all live streams are public
  return { allowed: true, channelType: ChannelType.LIVE };
}

/**
 * Authorize call channel (call:{callId})
 * Users must be a participant in the call with an active status
 */
async function authorizeCallChannel(userId: string, callId: string): Promise<AuthResult> {
  try {
    // Check if call exists and user is a participant with active status
    const result = await db
      .select({
        id: schema.callParticipants.id,
        status: schema.callParticipants.status,
        callStatus: schema.calls.status,
      })
      .from(schema.callParticipants)
      .innerJoin(schema.calls, eq(schema.callParticipants.callId, schema.calls.id))
      .where(and(
        eq(schema.callParticipants.callId, callId),
        eq(schema.callParticipants.userId, userId),
        // Only allow participants who haven't left or been declined
        inArray(schema.callParticipants.status, [
          "INVITED",
          "RINGING",
          "JOINING",
          "CONNECTED",
          "RECONNECTING",
        ]),
        // Call must not be in a terminal state
        inArray(schema.calls.status, [
          "INITIATED",
          "RINGING",
          "CONNECTING",
          "ACTIVE",
        ])
      ))
      .limit(1);

    if (result.length > 0) {
      return { allowed: true, channelType: ChannelType.CALL };
    }

    // Check if user was a participant but call is in terminal state
    // Allow access for recent calls (for history/recording access)
    const terminalResult = await db
      .select({ id: schema.callParticipants.id })
      .from(schema.callParticipants)
      .innerJoin(schema.calls, eq(schema.callParticipants.callId, schema.calls.id))
      .where(and(
        eq(schema.callParticipants.callId, callId),
        eq(schema.callParticipants.userId, userId),
        inArray(schema.calls.status, ["ENDED", "MISSED", "DECLINED", "FAILED"])
      ))
      .limit(1);

    if (terminalResult.length > 0) {
      // Allow access to ended calls for a period (e.g., for recordings)
      return { allowed: true, channelType: ChannelType.CALL };
    }

    return { allowed: false, reason: "Not a participant in this call", channelType: ChannelType.CALL };
  } catch (error) {
    console.error(`[ChannelAuth] Call auth error:`, error);
    return { allowed: false, reason: "Call check failed", channelType: ChannelType.CALL };
  }
}

/**
 * Authorize upload channel (upload:{userId})
 * Users can only subscribe to their own upload progress channel
 */
async function authorizeUploadChannel(userId: string, targetUserId: string): Promise<AuthResult> {
  if (userId === targetUserId) {
    return { allowed: true, channelType: ChannelType.UPLOAD };
  }
  return { allowed: false, reason: "Cannot subscribe to another user's upload channel", channelType: ChannelType.UPLOAD };
}

/**
 * Authorize presence channel (presence:{userId})
 * Users can subscribe to their own presence or friends' presence
 */
async function authorizePresenceChannel(userId: string, targetUserId: string): Promise<AuthResult> {
  // Own presence - always allowed
  if (userId === targetUserId) {
    return { allowed: true, channelType: ChannelType.PRESENCE };
  }

  // Check if users are friends (mutual follow)
  try {
    const result = await db
      .select({ id: schema.follows.id })
      .from(schema.follows)
      .where(and(
        eq(schema.follows.followerId, userId),
        eq(schema.follows.followingId, targetUserId)
      ))
      .limit(1);

    if (result.length > 0) {
      // Check mutual follow
      const mutualResult = await db
        .select({ id: schema.follows.id })
        .from(schema.follows)
        .where(and(
          eq(schema.follows.followerId, targetUserId),
          eq(schema.follows.followingId, userId)
        ))
        .limit(1);

      if (mutualResult.length > 0) {
        return { allowed: true, channelType: ChannelType.PRESENCE };
      }
    }

    return { allowed: false, reason: "Not friends with this user", channelType: ChannelType.PRESENCE };
  } catch (error) {
    console.error(`[ChannelAuth] Presence auth error:`, error);
    return { allowed: false, reason: "Presence check failed", channelType: ChannelType.PRESENCE };
  }
}

/**
 * Authorize global channel (global:announcements)
 * All authenticated users can subscribe
 */
async function authorizeGlobalChannel(userId: string, identifier: string): Promise<AuthResult> {
  if (identifier === "announcements") {
    return { allowed: true, channelType: ChannelType.GLOBAL };
  }
  return { allowed: false, reason: "Unknown global channel", channelType: ChannelType.GLOBAL };
}

/**
 * Check if user is blocked by another user
 * Blocked users cannot subscribe to any channels of the blocker
 */
export async function isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
  try {
    const result = await db
      .select({ id: schema.blocks.id })
      .from(schema.blocks)
      .where(and(
        eq(schema.blocks.blockerId, blockerId),
        eq(schema.blocks.blockedId, blockedId)
      ))
      .limit(1);
    return result.length > 0;
  } catch {
    return false;
  }
}

/**
 * Check if user has blocked another user
 */
export async function hasBlocked(userId: string, targetUserId: string): Promise<boolean> {
  return isBlocked(userId, targetUserId);
}

/**
 * Check if two users are friends (mutual accepted follow)
 */
export async function areFriends(userId: string, targetUserId: string): Promise<boolean> {
  try {
    const [follow1, follow2] = await Promise.all([
      db.select({ id: schema.follows.id })
        .from(schema.follows)
        .where(and(
          eq(schema.follows.followerId, userId),
          eq(schema.follows.followingId, targetUserId)
        ))
        .limit(1),
      db.select({ id: schema.follows.id })
        .from(schema.follows)
        .where(and(
          eq(schema.follows.followerId, targetUserId),
          eq(schema.follows.followingId, userId)
        ))
        .limit(1),
    ]);

    return follow1.length > 0 && follow2.length > 0;
  } catch {
    return false;
  }
}

/**
 * Validate channel name format
 * Returns true if the channel name follows the expected convention
 */
export function isValidChannelName(channel: string): boolean {
  return parseChannel(channel) !== null;
}

/**
 * Get all valid channel types
 */
export function getValidChannelTypes(): string[] {
  return Object.values(ChannelType);
}

/**
 * Generate channel name for a user
 */
export function getUserChannel(userId: string): string {
  return `user:${userId}`;
}

/**
 * Generate channel name for a conversation
 */
export function getConversationChannel(conversationId: string): string {
  return `conversation:${conversationId}`;
}

/**
 * Generate channel name for a live stream
 */
export function getLiveChannel(liveId: string): string {
  return `live:${liveId}`;
}

/**
 * Generate channel name for a call
 */
export function getCallChannel(callId: string): string {
  return `call:${callId}`;
}

/**
 * Generate channel name for presence
 */
export function getPresenceChannel(userId: string): string {
  return `presence:${userId}`;
}

/**
 * Generate channel name for upload progress
 */
export function getUploadChannel(userId: string): string {
  return `upload:${userId}`;
}

/**
 * Get global announcements channel
 */
export function getGlobalAnnouncementsChannel(): string {
  return "global:announcements";
}