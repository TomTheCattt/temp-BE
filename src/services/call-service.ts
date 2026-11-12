/**
 * Call Service - Business logic for call management
 *
 * Handles:
 * - Call initiation, joining, leaving, ending
 * - Participant management
 * - Call permissions and privacy settings
 * - Call history and logs
 * - Integration with media server (SFU)
 */

import { db } from "../db/client";
import * as schema from "../db/schema";
import { eq, and, or, desc, asc, count, sql, inArray, lt, gt, isNull, isNotNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { callStateMachine, CallState, ParticipantState, CallEvent, CallSideEffect } from "./call-state-machine";
import { canSubscribe } from "../websocket/channel-auth";
import { connectionManager } from "../websocket/connection-manager";

// Type helpers
type CallType = typeof schema.calls.$inferInsert["type"];
type CallStatus = typeof schema.calls.$inferInsert["status"];
type CallParticipantStatus = typeof schema.callParticipants.$inferInsert["status"];

/**
 * Type-safe helper to check if a status is in a list of allowed statuses
 */
function isStatusIn<T extends string>(status: string | undefined, allowed: readonly T[]): status is T {
  return status !== undefined && allowed.includes(status as T);
}

export interface CreateCallInput {
  type: CallType;
  participantIds: string[];
  conversationId?: string;
  maxParticipants?: number;
  isRecording?: boolean;
  metadata?: Record<string, any>;
}

export interface CallDetails {
  id: string;
  type: CallType;
  status: CallStatus;
  initiatorId: string;
  conversationId: string | null;
  maxParticipants: number;
  isRecording: boolean;
  recordingUrl: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number;
  mediaServerId: string | null;
  roomId: string | null;
  participants: CallParticipantDetails[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CallParticipantDetails {
  id: string;
  callId: string;
  userId: string;
  status: CallParticipantStatus;
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenShare: boolean;
  connectionQuality: string | null;
  deviceType: string | null;
  appVersion: string | null;
  joinedAt: Date | null;
  leftAt: Date | null;
  user: {
    id: string;
    username: string;
    fullName: string | null;
    avatarUrl: string | null;
    isVerified: boolean;
  };
}

export interface JoinCallInput {
  callId: string;
  userId: string;
  deviceType?: string;
  appVersion?: string;
}

export interface LeaveCallInput {
  callId: string;
  userId: string;
  reason?: string;
}

export interface EndCallInput {
  callId: string;
  userId: string;
  reason?: string;
}

export interface InviteParticipantsInput {
  callId: string;
  userId: string;
  participantIds: string[];
}

export interface KickParticipantInput {
  callId: string;
  userId: string;
  targetUserId: string;
  reason?: string;
}

export interface UpdateParticipantInput {
  callId: string;
  userId: string;
  targetUserId: string;
  isMuted?: boolean;
  isVideoOff?: boolean;
  isScreenShare?: boolean;
}

export interface TransferHostInput {
  callId: string;
  userId: string;
  newHostId: string;
}

export interface CallHistoryOptions {
  userId: string;
  page: number;
  perPage: number;
  type?: CallType;
  status?: CallStatus;
}

export interface CallQualityMetricsInput {
  callId: string;
  participantId: string;
  bitrate: number;
  packetLoss: number;
  latency: number;
  jitter: number;
  fps?: number;
  resolution?: { width: number; height: number };
}

/**
 * Call Service - Main business logic for calls
 */
export class CallService {
  private mediaServerAdapter: MediaServerAdapter | null = null;

  /**
   * Set media server adapter (for SFU integration)
   */
  setMediaServerAdapter(adapter: MediaServerAdapter): void {
    this.mediaServerAdapter = adapter;
  }

  /**
   * Create a new call
   */
  async createCall(input: CreateCallInput, creatorId: string): Promise<CallDetails> {
    const { type, participantIds, conversationId, maxParticipants = 2, isRecording = false, metadata = {} } = input;

    // Validate participants exist and are not blocked
    const participants = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.id, participantIds));

    if (participants.length !== participantIds.length) {
      throw new HTTPException(400, { message: "One or more participants not found" });
    }

    // Prevent adding self as participant (initiator is automatically added)
    if (participantIds.includes(creatorId)) {
      throw new HTTPException(400, { message: "Cannot add yourself as participant" });
    }

    // Check blocks
    for (const participantId of participantIds) {
      if (await this.isBlocked(creatorId, participantId) || await this.isBlocked(participantId, creatorId)) {
        throw new HTTPException(403, { message: "Cannot call this user" });
      }
    }

    // For group calls, require mutual follow with all participants
    if (type === "GROUP_AUDIO" || type === "GROUP_VIDEO") {
      if (!conversationId) {
        throw new HTTPException(400, { message: "Group calls require a conversation ID" });
      }
      // Verify all participants are members of the conversation
      const members = await db
        .select({ userId: schema.conversationMembers.userId })
        .from(schema.conversationMembers)
        .where(and(
          eq(schema.conversationMembers.conversationId, conversationId),
          inArray(schema.conversationMembers.userId, participantIds),
          isNull(schema.conversationMembers.leftAt)
        ));

      if (members.length !== participantIds.length) {
        throw new HTTPException(400, { message: "All participants must be members of the conversation" });
      }
    } else {
      // For 1:1 calls, check mutual follow
      for (const participantId of participantIds) {
        const mutualFollow = await db
          .select({ id: schema.follows.id })
          .from(schema.follows)
          .where(
            or(
              and(eq(schema.follows.followerId, creatorId), eq(schema.follows.followingId, participantId)),
              and(eq(schema.follows.followerId, participantId), eq(schema.follows.followingId, creatorId))
            )
          )
          .limit(1);

        if (mutualFollow.length === 0) {
          throw new HTTPException(403, {
            message: `Cannot call user ${participantId}: mutual follow required`,
          });
        }
      }
    }

    // Create call record
    const roomId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const mediaServerId = this.mediaServerAdapter?.getServerId() || "default";

    const [call] = await db
      .insert(schema.calls)
      .values({
        type,
        status: "INITIATED",
        initiatorId: creatorId,
        conversationId: conversationId || null,
        maxParticipants: Math.max(maxParticipants, participantIds.length + 1),
        isRecording,
        mediaServerId,
        roomId,
      })
      .returning();

    // Add participants
    const allParticipantIds = [...new Set([creatorId, ...participantIds])];
    await db.insert(schema.callParticipants).values(
      allParticipantIds.map((userId) => ({
        callId: call.id,
        userId,
        status: userId === creatorId ? ("JOINING" as CallParticipantStatus) : ("INVITED" as CallParticipantStatus),
        deviceType: null,
        appVersion: null,
      }))
    );

    // Initialize state machine
    callStateMachine.initializeCall(call.id, creatorId, call.maxParticipants, {
      isRecording,
      conversationId,
      mediaServerId,
      roomId,
      ...metadata,
    });

    // Add initiator to state machine
    callStateMachine.addParticipant(call.id, creatorId, creatorId);

    // Add other participants to state machine
    for (const participantId of participantIds) {
      callStateMachine.addParticipant(call.id, participantId, participantId);
    }

    // Create media server room
    if (this.mediaServerAdapter) {
      try {
        await this.mediaServerAdapter.createRoom(call.id, roomId, {
          maxParticipants: call.maxParticipants,
          isRecording,
        });
      } catch (error) {
        console.error("[CallService] Failed to create media room:", error);
        // Continue - room might be created lazily
      }
    }

    // Start ringing for invitees
    const result = callStateMachine.transitionCall(call.id, CallEvent.START_RINGING);
    await this.processSideEffects(result.sideEffects || []);

    // Get full call details
    return this.getCallById(call.id);
  }

  /**
   * Get call by ID
   */
  async getCallById(callId: string): Promise<CallDetails> {
    const call = await db.query.calls.findFirst({
      where: eq(schema.calls.id, callId),
    });

    if (!call) {
      throw new HTTPException(404, { message: "Call not found" });
    }

    // Get participants
    const participants = await db.query.callParticipants.findMany({
      where: eq(schema.callParticipants.callId, callId),
      with: { user: true },
    });

    return {
      ...call,
      participants: participants.map((p) => ({
        ...p,
        user: {
          id: p.user.id,
          username: p.user.username,
          fullName: p.user.fullName,
          avatarUrl: p.user.avatarUrl,
          isVerified: p.user.isVerified,
        },
      })),
    };
  }

  /**
   * Join a call
   */
  async joinCall(input: JoinCallInput): Promise<CallDetails> {
    const { callId, userId, deviceType, appVersion } = input;

    const call = await this.getCallById(callId);

    // Verify user is a participant
    const participant = call.participants.find((p) => p.userId === userId);
    if (!participant) {
      throw new HTTPException(403, { message: "Not a participant in this call" });
    }

    // Check if call is in a joinable state
    const callStatus = call.status as CallStatus;
    if (!isStatusIn(callStatus, ["INITIATED", "RINGING", "CONNECTING", "ACTIVE"] as const)) {
      throw new HTTPException(400, { message: `Cannot join call in state ${callStatus}` });
    }

    // Check if already joined
    const participantStatus = participant.status as CallParticipantStatus;
    if (isStatusIn(participantStatus, ["JOINING", "CONNECTED", "RECONNECTING"] as const)) {
      throw new HTTPException(400, { message: "Already joined this call" });
    }

    // Update participant status
    await db
      .update(schema.callParticipants)
      .set({
        status: "JOINING" as CallParticipantStatus,
        deviceType,
        appVersion,
        joinedAt: new Date(),
      })
      .where(and(
        eq(schema.callParticipants.callId, callId),
        eq(schema.callParticipants.userId, userId)
      ));

    // Update state machine
    const participantContext = callStateMachine.getParticipantByUserId(callId, userId);
    if (participantContext) {
      callStateMachine.transitionParticipant(callId, participantContext.participantId, CallEvent.PARTICIPANT_JOIN);
    }

    // If this was the last participant to join and call was ringing, start connecting
    if (callStatus === "RINGING") {
      const activeParticipants = call.participants.filter((p) =>
        isStatusIn(p.status, ["JOINING", "CONNECTED", "RECONNECTING"] as const)
      );

      if (activeParticipants.length >= 2) {
        const result = callStateMachine.transitionCall(callId, CallEvent.START_CONNECTING);
        await this.processSideEffects(result.sideEffects || []);
      }
    }

    // Create media transport
    if (this.mediaServerAdapter) {
      try {
        await this.mediaServerAdapter.createTransport(callId, userId, {
          direction: "sendrecv",
        });
      } catch (error) {
        console.error("[CallService] Failed to create transport:", error);
      }
    }

    return this.getCallById(callId);
  }

  /**
   * Leave a call
   */
  async leaveCall(input: LeaveCallInput): Promise<void> {
    const { callId, userId, reason } = input;

    const call = await this.getCallById(callId);
    const participant = call.participants.find((p) => p.userId === userId);

    if (!participant) {
      throw new HTTPException(403, { message: "Not a participant in this call" });
    }

    // Update participant status
    await db
      .update(schema.callParticipants)
      .set({
        status: "LEFT",
        leftAt: new Date(),
      })
      .where(and(
        eq(schema.callParticipants.callId, callId),
        eq(schema.callParticipants.userId, userId)
      ));

    // Update state machine
    const participantContext = callStateMachine.getParticipantByUserId(callId, userId);
    if (participantContext) {
      const result = callStateMachine.transitionParticipant(
        callId,
        participantContext.participantId,
        CallEvent.PARTICIPANT_LEAVE,
        { reason }
      );
      await this.processSideEffects(result.sideEffects || []);
    }

    // Remove media transport
    if (this.mediaServerAdapter) {
      try {
        await this.mediaServerAdapter.removeTransport(callId, userId);
      } catch (error) {
        console.error("[CallService] Failed to remove transport:", error);
      }
    }

    // Check if call should end
    const updatedCall = await this.getCallById(callId);
    const activeParticipants = updatedCall.participants.filter((p) =>
      isStatusIn(p.status, ["JOINING", "CONNECTED", "RECONNECTING"] as const)
    );

    if (activeParticipants.length === 0 && isStatusIn(updatedCall.status, ["CONNECTING", "ACTIVE"] as const)) {
      await this.endCall({ callId, userId, reason: "NO_PARTICIPANTS" });
    }
  }

  /**
   * End a call
   */
  async endCall(input: EndCallInput): Promise<void> {
    const { callId, userId, reason } = input;

    const call = await this.getCallById(callId);

    // Only initiator or host can end the call
    if (call.initiatorId !== userId) {
      const participant = call.participants.find((p) => p.userId === userId);
      if (!participant || participant.status !== "CONNECTED") {
        throw new HTTPException(403, { message: "Not authorized to end this call" });
      }
    }

    // Check if already ended
    if (isStatusIn(call.status, ["ENDED", "MISSED", "DECLINED", "FAILED"] as const)) {
      throw new HTTPException(400, { message: `Call already in terminal state ${call.status}` });
    }

    // Update call status
    await db
      .update(schema.calls)
      .set({
        status: "ENDED" as CallStatus,
        endedAt: new Date(),
        durationSeconds: call.startedAt
          ? Math.floor((new Date().getTime() - call.startedAt.getTime()) / 1000)
          : 0,
      })
      .where(eq(schema.calls.id, callId));

    // Update all active participants
    await db
      .update(schema.callParticipants)
      .set({
        status: "LEFT" as CallParticipantStatus,
        leftAt: new Date(),
      })
      .where(and(
        eq(schema.callParticipants.callId, callId),
        inArray(schema.callParticipants.status, ["JOINING", "CONNECTED", "RECONNECTING"] as const)
      ));

    // Update state machine
    const result = callStateMachine.transitionCall(callId, CallEvent.END, { reason });
    await this.processSideEffects(result.sideEffects || []);

    // Cleanup media server
    if (this.mediaServerAdapter) {
      try {
        await this.mediaServerAdapter.deleteRoom(callId);
      } catch (error) {
        console.error("[CallService] Failed to delete media room:", error);
      }
    }

    // Cleanup state machine
    callStateMachine.removeContext(callId);
  }

  /**
   * Invite additional participants to a call
   */
  async inviteParticipants(input: InviteParticipantsInput): Promise<void> {
    const { callId, userId, participantIds } = input;

    const call = await this.getCallById(callId);

    // Verify user is a participant
    const inviter = call.participants.find((p) => p.userId === userId);
    if (!inviter) {
      throw new HTTPException(403, { message: "Not a participant in this call" });
    }

    // Check if call is active
    if (!isStatusIn(call.status, ["RINGING", "CONNECTING", "ACTIVE"] as const)) {
      throw new HTTPException(400, { message: "Cannot invite to call in current state" });
    }

    // Validate participants
    const participants = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.id, participantIds));

    if (participants.length !== participantIds.length) {
      throw new HTTPException(400, { message: "One or more participants not found" });
    }

    // Check blocks
    for (const participantId of participantIds) {
      if (await this.isBlocked(userId, participantId) || await this.isBlocked(participantId, userId)) {
        throw new HTTPException(403, { message: `Cannot invite user ${participantId}` });
      }
    }

    // Check max participants
    const currentParticipants = call.participants.filter((p) =>
      !isStatusIn(p.status, ["LEFT", "DECLINED", "FAILED"] as const)
    );

    if (currentParticipants.length + participantIds.length > call.maxParticipants) {
      throw new HTTPException(400, { message: "Maximum participants reached" });
    }

    // Add participants
    await db.insert(schema.callParticipants).values(
      participantIds.map((id) => ({
        callId,
        userId: id,
        status: "INVITED" as CallParticipantStatus,
      }))
    ).onConflictDoNothing();

    // Add to state machine
    for (const participantId of participantIds) {
      callStateMachine.addParticipant(callId, participantId, participantId);
    }

    // Trigger ringing for new invitees
    const result = callStateMachine.transitionCall(callId, CallEvent.START_RINGING);
    await this.processSideEffects(result.sideEffects || []);
  }

  /**
   * Kick a participant from the call
   */
  async kickParticipant(input: KickParticipantInput): Promise<void> {
    const { callId, userId, targetUserId, reason } = input;

    const call = await this.getCallById(callId);

    // Verify user is host/initiator
    if (call.initiatorId !== userId) {
      throw new HTTPException(403, { message: "Only host can kick participants" });
    }

    const target = call.participants.find((p) => p.userId === targetUserId);
    if (!target) {
      throw new HTTPException(404, { message: "Participant not found" });
    }

    if (target.userId === userId) {
      throw new HTTPException(400, { message: "Cannot kick yourself" });
    }

    // Update participant status
    await db
      .update(schema.callParticipants)
      .set({
        status: "LEFT",
        leftAt: new Date(),
      })
      .where(and(
        eq(schema.callParticipants.callId, callId),
        eq(schema.callParticipants.userId, targetUserId)
      ));

    // Update state machine
    const participantContext = callStateMachine.getParticipantByUserId(callId, targetUserId);
    if (participantContext) {
      const result = callStateMachine.transitionParticipant(
        callId,
        participantContext.participantId,
        CallEvent.PARTICIPANT_LEAVE,
        { reason: reason || "KICKED" }
      );
      await this.processSideEffects(result.sideEffects || []);
    }

    // Remove media transport
    if (this.mediaServerAdapter) {
      try {
        await this.mediaServerAdapter.removeTransport(callId, targetUserId);
      } catch (error) {
        console.error("[CallService] Failed to remove transport:", error);
      }
    }
  }

  /**
   * Update participant media state (mute, video, screen share)
   */
  async updateParticipant(input: UpdateParticipantInput): Promise<void> {
    const { callId, userId, targetUserId, isMuted, isVideoOff, isScreenShare } = input;

    const call = await this.getCallById(callId);

    // Users can only update themselves, host can update anyone
    const isHost = call.initiatorId === userId;
    if (!isHost && userId !== targetUserId) {
      throw new HTTPException(403, { message: "Not authorized to update this participant" });
    }

    const participant = call.participants.find((p) => p.userId === targetUserId);
    if (!participant) {
      throw new HTTPException(404, { message: "Participant not found" });
    }

    const updates: any = {};
    if (isMuted !== undefined) updates.isMuted = isMuted;
    if (isVideoOff !== undefined) updates.isVideoOff = isVideoOff;
    if (isScreenShare !== undefined) updates.isScreenShare = isScreenShare;

    if (Object.keys(updates).length > 0) {
      await db
        .update(schema.callParticipants)
        .set(updates)
        .where(and(
          eq(schema.callParticipants.callId, callId),
          eq(schema.callParticipants.userId, targetUserId)
        ));

      // Update state machine
      const participantContext = callStateMachine.getParticipantByUserId(callId, targetUserId);
      if (participantContext) {
        callStateMachine.updateParticipantMedia(callId, participantContext.participantId, updates);
      }
    }
  }

  /**
   * Transfer host to another participant
   */
  async transferHost(input: TransferHostInput): Promise<void> {
    const { callId, userId, newHostId } = input;

    const call = await this.getCallById(callId);

    // Only current host can transfer
    if (call.initiatorId !== userId) {
      throw new HTTPException(403, { message: "Only host can transfer ownership" });
    }

    const newHost = call.participants.find((p) => p.userId === newHostId);
    if (!newHost) {
      throw new HTTPException(404, { message: "New host not found in call" });
    }

    if (!isStatusIn(newHost.status, ["JOINING", "CONNECTED", "RECONNECTING"] as const)) {
      throw new HTTPException(400, { message: "New host must be connected to the call" });
    }

    // Update call initiator
    await db
      .update(schema.calls)
      .set({ initiatorId: newHostId })
      .where(eq(schema.calls.id, callId));

    // Notify via WebSocket
    const channel = `call:${callId}`;
    await connectionManager.broadcast(channel, {
      type: "call.host_transferred",
      payload: { callId, newHost: newHostId },
    });
  }

  /**
   * Get call history for a user
   */
  async getCallHistory(options: CallHistoryOptions): Promise<any> {
    const { userId, page, perPage, type, status } = options;
    const offset = (page - 1) * perPage;

    // Get calls where user is initiator or participant
    const whereConditions = [
      or(
        eq(schema.calls.initiatorId, userId),
        sql`EXISTS (
          SELECT 1 FROM call_participants cp
          WHERE cp.call_id = calls.id AND cp.user_id = ${userId}
        )`
      ),
    ];

    if (type) whereConditions.push(eq(schema.calls.type, type));
    if (status) whereConditions.push(eq(schema.calls.status, status));

    const calls = await db
      .select({
        id: schema.calls.id,
        type: schema.calls.type,
        status: schema.calls.status,
        initiatorId: schema.calls.initiatorId,
        conversationId: schema.calls.conversationId,
        maxParticipants: schema.calls.maxParticipants,
        isRecording: schema.calls.isRecording,
        recordingUrl: schema.calls.recordingUrl,
        startedAt: schema.calls.startedAt,
        endedAt: schema.calls.endedAt,
        durationSeconds: schema.calls.durationSeconds,
        createdAt: schema.calls.createdAt,
      })
      .from(schema.calls)
      .where(and(...whereConditions))
      .orderBy(desc(schema.calls.createdAt))
      .limit(perPage)
      .offset(offset);

    const totalResult = await db
      .select({ count: count() })
      .from(schema.calls)
      .where(and(...whereConditions));

    const total = totalResult[0]?.count || 0;

    // Get participant count for each call
    const callsWithCounts = await Promise.all(
      calls.map(async (call) => {
        const participantResult = await db
          .select({ count: count() })
          .from(schema.callParticipants)
          .where(eq(schema.callParticipants.callId, call.id));

        const participantCount = participantResult[0]?.count || 0;

        // Get other participants for display
        const participants = await db.query.callParticipants.findMany({
          where: eq(schema.callParticipants.callId, call.id),
          with: { user: true },
          limit: 5,
        });

        return {
          ...call,
          participantCount,
          participants: participants.map((p) => ({
            userId: p.userId,
            status: p.status,
            user: {
              id: p.user.id,
              username: p.user.username,
              fullName: p.user.fullName,
              avatarUrl: p.user.avatarUrl,
              isVerified: p.user.isVerified,
            },
          })),
        };
      })
    );

    return {
      items: callsWithCounts,
      page,
      perPage,
      total,
      hasMore: page * perPage < total,
    };
  }

  /**
   * Get call recording
   */
  async getCallRecording(callId: string, userId: string): Promise<{ recordingUrl: string } | null> {
    const call = await db.query.calls.findFirst({
      where: eq(schema.calls.id, callId),
    });

    if (!call) {
      throw new HTTPException(404, { message: "Call not found" });
    }

    // Verify user was a participant
    const participant = await db.query.callParticipants.findFirst({
      where: and(
        eq(schema.callParticipants.callId, callId),
        eq(schema.callParticipants.userId, userId)
      ),
    });

    if (!participant) {
      throw new HTTPException(403, { message: "Not a participant in this call" });
    }

    if (!call.isRecording || !call.recordingUrl) {
      return null;
    }

    return { recordingUrl: call.recordingUrl };
  }

  /**
   * Record call quality metrics
   */
  async recordQualityMetrics(input: CallQualityMetricsInput): Promise<void> {
    const { callId, participantId, bitrate, packetLoss, latency, jitter, fps, resolution } = input;

    // Store in call_signaling_logs or a dedicated metrics table
    await db.insert(schema.callSignalingLogs).values({
      callId,
      participantId,
      direction: "RECEIVED",
      messageType: "quality_metrics",
      payload: {
        bitrate,
        packetLoss,
        latency,
        jitter,
        fps,
        resolution,
      },
    });
  }

  /**
   * Get call quality metrics
   */
  async getCallQualityMetrics(callId: string): Promise<any[]> {
    const metrics = await db.query.callSignalingLogs.findMany({
      where: and(
        eq(schema.callSignalingLogs.callId, callId),
        eq(schema.callSignalingLogs.messageType, "quality_metrics")
      ),
      orderBy: desc(schema.callSignalingLogs.createdAt),
    });

    return metrics.map((m) => m.payload);
  }

  /**
   * Check if user is blocked by another user
   */
  private async isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    const result = await db
      .select({ id: schema.blocks.id })
      .from(schema.blocks)
      .where(and(
        eq(schema.blocks.blockerId, blockerId),
        eq(schema.blocks.blockedId, blockedId)
      ))
      .limit(1);
    return result.length > 0;
  }

  /**
   * Process side effects from state machine
   */
  private async processSideEffects(effects: CallSideEffect[]): Promise<void> {
    for (const effect of effects) {
      try {
        switch (effect.type) {
          case "UPDATE_DATABASE":
            await this.applyDatabaseUpdate(effect.payload);
            break;
          case "NOTIFY_PARTICIPANTS":
            await this.notifyParticipants(effect.payload);
            break;
          case "SEND_WEBHOOK":
            await this.sendWebhook(effect.payload);
            break;
          case "LOG_EVENT":
            await this.logEvent(effect.payload);
            break;
          case "START_TIMER":
            // Handled by state machine timers
            break;
          case "CANCEL_TIMER":
            // Handled by state machine timers
            break;
          case "RECORDING_START":
            // Handled by media server
            break;
          case "RECORDING_STOP":
            // Handled by media server
            break;
        }
      } catch (error) {
        console.error("[CallService] Side effect failed:", effect.type, error);
      }
    }
  }

  /**
   * Apply database updates from side effects
   */
  private async applyDatabaseUpdate(payload: any): Promise<void> {
    const { callId, status, participantId, ...updates } = payload;

    if (participantId) {
      // Participant update
      await db
        .update(schema.callParticipants)
        .set(updates)
        .where(and(
          eq(schema.callParticipants.callId, callId),
          eq(schema.callParticipants.id, participantId)
        ));
    } else if (callId) {
      // Call update
      await db
        .update(schema.calls)
        .set({ status, ...updates, updatedAt: new Date() })
        .where(eq(schema.calls.id, callId));
    }
  }

  /**
   * Notify participants via WebSocket
   */
  private async notifyParticipants(payload: any): Promise<void> {
    const { callId, event, ...data } = payload;
    const channel = `call:${callId}`;

    // Broadcast to call channel
    await connectionManager.broadcast(channel, {
      type: event,
      payload: data,
    });
  }

  /**
   * Send webhook for external integrations
   */
  private async sendWebhook(payload: any): Promise<void> {
    // TODO: Implement webhook delivery
    console.log("[CallService] Webhook:", payload);
  }

  /**
   * Log event for audit/analytics
   */
  private async logEvent(payload: any): Promise<void> {
    await db.insert(schema.auditLogs).values({
      action: `call.${payload.event || "state_change"}`,
      resourceType: "call",
      resourceId: payload.callId,
      newValues: payload,
      metadata: { source: "call_state_machine" },
    });
  }
}

/**
 * Media Server Adapter Interface
 * Implement this for your SFU (mediasoup, LiveKit, Agora, etc.)
 */
export interface MediaServerAdapter {
  getServerId(): string;
  createRoom(callId: string, roomId: string, options: { maxParticipants: number; isRecording: boolean }): Promise<void>;
  deleteRoom(callId: string): Promise<void>;
  createTransport(callId: string, userId: string, options: { direction: "sendrecv" | "sendonly" | "recvonly" }): Promise<any>;
  removeTransport(callId: string, userId: string): Promise<void>;
  produce(callId: string, userId: string, kind: "audio" | "video", rtpParameters: any): Promise<any>;
  consume(callId: string, userId: string, producerId: string, rtpCapabilities: any): Promise<any>;
  setSimulcastLayers(callId: string, userId: string, layer: "high" | "medium" | "low"): Promise<void>;
}

export const callService = new CallService();