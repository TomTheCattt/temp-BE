/**
 * Call Signaling - WebSocket handlers for WebRTC signaling
 *
 * Handles:
 * - Offer/Answer exchange
 * - ICE candidate exchange
 * - Renegotiation
 * - Media state updates
 * - Participant join/leave notifications
 *
 * Message flow:
 * 1. Caller creates offer -> sends to callee via call:{callId} channel
 * 2. Callee receives offer -> creates answer -> sends back
 * 3. Both parties exchange ICE candidates
 * 4. Renegotiation for screen share, mute, etc.
 */

import { connectionManager } from "./connection-manager";
import { getCallChannel } from "./channel-auth";
import { CallEvent } from "../services/call-state-machine";
import { callService } from "../services/call-service";
import { callStateMachine } from "../services/call-state-machine";

// Message types
export enum SignalingMessageType {
  // Session description
  OFFER = "offer",
  ANSWER = "answer",

  // ICE candidates
  ICE_CANDIDATE = "ice_candidate",
  ICE_CANDIDATES = "ice_candidates",

  // Renegotiation
  RENEGOTIATE = "renegotiate",
  RENEGOTIATE_NEEDED = "renegotiate_needed",

  // Media state
  MUTE = "mute",
  UNMUTE = "unmute",
  VIDEO_OFF = "video_off",
  VIDEO_ON = "video_on",
  SCREEN_SHARE_START = "screen_share_start",
  SCREEN_SHARE_STOP = "screen_share_stop",

  // Participant events
  PARTICIPANT_JOINED = "participant_joined",
  PARTICIPANT_LEFT = "participant_left",
  PARTICIPANT_UPDATED = "participant_updated",

  // Call state
  CALL_STATE_CHANGED = "call_state_changed",
  CALL_ENDED = "call_ended",

  // Quality metrics
  QUALITY_METRICS = "quality_metrics",

  // Errors
  ERROR = "error",
}

// Incoming message payload types
export interface OfferPayload {
  callId: string;
  sdp: string;
  type: "offer";
  from: string; // participantId
  to?: string; // target participantId (for selective forwarding)
  mid?: string;
}

export interface AnswerPayload {
  callId: string;
  sdp: string;
  type: "answer";
  from: string;
  to?: string;
  mid?: string;
}

export interface IceCandidatePayload {
  callId: string;
  candidate: string;
  sdpMid: string;
  sdpMLineIndex: number;
  from: string;
  to?: string;
}

export interface RenegotiatePayload {
  callId: string;
  from: string;
  reason: "screen_share" | "add_track" | "remove_track" | "codec_change" | "simulcast";
}

export interface MediaStatePayload {
  callId: string;
  from: string;
  isMuted?: boolean;
  isVideoOff?: boolean;
  isScreenSharing?: boolean;
}

export interface QualityMetricsPayload {
  callId: string;
  participantId: string;
  bitrate: number;
  packetLoss: number;
  latency: number;
  jitter: number;
  fps?: number;
  resolution?: { width: number; height: number };
}

// Outgoing message wrapper
export interface SignalingMessage {
  type: SignalingMessageType;
  payload: any;
  sequenceId?: number;
  timestamp: number;
}

/**
 * Handle incoming signaling message
 */
export async function handleSignalingMessage(
  userId: string,
  message: SignalingMessage
): Promise<void> {
  const { type, payload } = message;

  try {
    switch (type) {
      case SignalingMessageType.OFFER:
        await handleOffer(userId, payload);
        break;
      case SignalingMessageType.ANSWER:
        await handleAnswer(userId, payload);
        break;
      case SignalingMessageType.ICE_CANDIDATE:
        await handleIceCandidate(userId, payload);
        break;
      case SignalingMessageType.ICE_CANDIDATES:
        await handleIceCandidates(userId, payload);
        break;
      case SignalingMessageType.RENEGOTIATE:
        await handleRenegotiate(userId, payload);
        break;
      case SignalingMessageType.MUTE:
      case SignalingMessageType.UNMUTE:
      case SignalingMessageType.VIDEO_OFF:
      case SignalingMessageType.VIDEO_ON:
      case SignalingMessageType.SCREEN_SHARE_START:
      case SignalingMessageType.SCREEN_SHARE_STOP:
        await handleMediaStateChange(userId, type, payload);
        break;
      case SignalingMessageType.QUALITY_METRICS:
        await handleQualityMetrics(userId, payload);
        break;
      default:
        console.warn(`[CallSignaling] Unknown message type: ${type}`);
    }
  } catch (error) {
    console.error(`[CallSignaling] Error handling ${type}:`, error);
    throw error;
  }
}

/**
 * Handle offer message
 * Forward to target participant or broadcast to all
 */
async function handleOffer(userId: string, payload: OfferPayload): Promise<void> {
  const { callId, sdp, from, to, mid } = payload;

  // Verify user is participant in call
  const call = await callService.getCallById(callId);
  const participant = call.participants.find((p) => p.userId === userId);
  if (!participant) {
    throw new Error("Not a participant in this call");
  }

  // Update state machine
  const participantContext = callStateMachine.getParticipantByUserId(callId, userId);
  if (participantContext) {
    callStateMachine.transitionParticipant(callId, participantContext.participantId, CallEvent.PARTICIPANT_JOIN);
  }

  // Build message
  const message: SignalingMessage = {
    type: SignalingMessageType.OFFER,
    payload: {
      callId,
      sdp,
      from,
      mid,
    },
    timestamp: Date.now(),
  };

  // Send to specific target or broadcast to call channel
  if (to) {
    await connectionManager.broadcastToUser(to, message);
  } else {
    await connectionManager.broadcast(getCallChannel(callId), message);
  }
}

/**
 * Handle answer message
 * Forward to the offerer
 */
async function handleAnswer(userId: string, payload: AnswerPayload): Promise<void> {
  const { callId, sdp, from, to, mid } = payload;

  // Verify user is participant
  const call = await callService.getCallById(callId);
  const participant = call.participants.find((p) => p.userId === userId);
  if (!participant) {
    throw new Error("Not a participant in this call");
  }

  // Build message
  const message: SignalingMessage = {
    type: SignalingMessageType.ANSWER,
    payload: {
      callId,
      sdp,
      from,
      mid,
    },
    timestamp: Date.now(),
  };

  // Send to specific target (the offerer)
  if (to) {
    await connectionManager.broadcastToUser(to, message);
  } else {
    // Broadcast to all except sender
    await connectionManager.broadcast(getCallChannel(callId), message);
  }
}

/**
 * Handle ICE candidate
 */
async function handleIceCandidate(userId: string, payload: IceCandidatePayload): Promise<void> {
  const { callId, candidate, sdpMid, sdpMLineIndex, from, to } = payload;

  // Verify user is participant
  const call = await callService.getCallById(callId);
  const participant = call.participants.find((p) => p.userId === userId);
  if (!participant) {
    throw new Error("Not a participant in this call");
  }

  const message: SignalingMessage = {
    type: SignalingMessageType.ICE_CANDIDATE,
    payload: {
      callId,
      candidate,
      sdpMid,
      sdpMLineIndex,
      from,
    },
    timestamp: Date.now(),
  };

  if (to) {
    await connectionManager.broadcastToUser(to, message);
  } else {
    await connectionManager.broadcast(getCallChannel(callId), message);
  }
}

/**
 * Handle multiple ICE candidates
 */
async function handleIceCandidates(userId: string, payload: { callId: string; candidates: IceCandidatePayload[] }): Promise<void> {
  const { callId, candidates } = payload;

  // Verify user is participant
  const call = await callService.getCallById(callId);
  const participant = call.participants.find((p) => p.userId === userId);
  if (!participant) {
    throw new Error("Not a participant in this call");
  }

  // Send each candidate
  for (const candidate of candidates) {
    const message: SignalingMessage = {
      type: SignalingMessageType.ICE_CANDIDATE,
      payload: {
        callId,
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
        from: candidate.from,
      },
      timestamp: Date.now(),
    };

    if (candidate.to) {
      await connectionManager.broadcastToUser(candidate.to, message);
    } else {
      await connectionManager.broadcast(getCallChannel(callId), message);
    }
  }
}

/**
 * Handle renegotiation request
 */
async function handleRenegotiate(userId: string, payload: RenegotiatePayload): Promise<void> {
  const { callId, from, reason } = payload;

  // Verify user is participant
  const call = await callService.getCallById(callId);
  const participant = call.participants.find((p) => p.userId === userId);
  if (!participant) {
    throw new Error("Not a participant in this call");
  }

  // Notify other participants that renegotiation is needed
  const message: SignalingMessage = {
    type: SignalingMessageType.RENEGOTIATE_NEEDED,
    payload: {
      callId,
      from,
      reason,
    },
    timestamp: Date.now(),
  };

  await connectionManager.broadcast(getCallChannel(callId), message);
}

/**
 * Handle media state changes (mute, video off, screen share)
 */
async function handleMediaStateChange(
  userId: string,
  type: SignalingMessageType,
  payload: MediaStatePayload
): Promise<void> {
  const { callId, from, isMuted, isVideoOff, isScreenSharing } = payload;

  // Verify user is participant
  const call = await callService.getCallById(callId);
  const participant = call.participants.find((p) => p.userId === userId);
  if (!participant) {
    throw new Error("Not a participant in this call");
  }

  // Update state machine
  callStateMachine.updateParticipantMedia(callId, participant.id, {
    isMuted,
    isVideoOff,
    isScreenSharing,
  });

  // Map message type to event
  let eventType: SignalingMessageType;
  switch (type) {
    case SignalingMessageType.MUTE:
      eventType = SignalingMessageType.MUTE;
      break;
    case SignalingMessageType.UNMUTE:
      eventType = SignalingMessageType.UNMUTE;
      break;
    case SignalingMessageType.VIDEO_OFF:
      eventType = SignalingMessageType.VIDEO_OFF;
      break;
    case SignalingMessageType.VIDEO_ON:
      eventType = SignalingMessageType.VIDEO_ON;
      break;
    case SignalingMessageType.SCREEN_SHARE_START:
      eventType = SignalingMessageType.SCREEN_SHARE_START;
      break;
    case SignalingMessageType.SCREEN_SHARE_STOP:
      eventType = SignalingMessageType.SCREEN_SHARE_STOP;
      break;
    default:
      return;
  }

  const message: SignalingMessage = {
    type: eventType,
    payload: {
      callId,
      from,
      isMuted,
      isVideoOff,
      isScreenSharing,
    },
    timestamp: Date.now(),
  };

  // Broadcast to all other participants
  await connectionManager.broadcast(getCallChannel(callId), message);
}

/**
 * Handle quality metrics
 */
async function handleQualityMetrics(userId: string, payload: QualityMetricsPayload): Promise<void> {
  const { callId, participantId, ...metrics } = payload;

  // Verify user is participant
  const call = await callService.getCallById(callId);
  const participant = call.participants.find((p) => p.userId === userId);
  if (!participant) {
    throw new Error("Not a participant in this call");
  }

  // Record metrics
  await callService.recordQualityMetrics({
    callId,
    participantId,
    ...metrics,
  });

  // Optionally broadcast to other participants for adaptive bitrate
  // (could be sent to a separate metrics channel for efficiency)
}

/**
 * Notify participant joined
 */
export async function notifyParticipantJoined(
  callId: string,
  participantId: string,
  userId: string,
  metadata: any = {}
): Promise<void> {
  const message: SignalingMessage = {
    type: SignalingMessageType.PARTICIPANT_JOINED,
    payload: {
      callId,
      participantId,
      userId,
      ...metadata,
    },
    timestamp: Date.now(),
  };

  await connectionManager.broadcast(getCallChannel(callId), message);
}

/**
 * Notify participant left
 */
export async function notifyParticipantLeft(
  callId: string,
  participantId: string,
  userId: string,
  reason?: string
): Promise<void> {
  const message: SignalingMessage = {
    type: SignalingMessageType.PARTICIPANT_LEFT,
    payload: {
      callId,
      participantId,
      userId,
      reason,
    },
    timestamp: Date.now(),
  };

  await connectionManager.broadcast(getCallChannel(callId), message);
}

/**
 * Notify participant updated
 */
export async function notifyParticipantUpdated(
  callId: string,
  participantId: string,
  userId: string,
  updates: { isMuted?: boolean; isVideoOff?: boolean; isScreenSharing?: boolean }
): Promise<void> {
  const message: SignalingMessage = {
    type: SignalingMessageType.PARTICIPANT_UPDATED,
    payload: {
      callId,
      participantId,
      userId,
      ...updates,
    },
    timestamp: Date.now(),
  };

  await connectionManager.broadcast(getCallChannel(callId), message);
}

/**
 * Notify call state changed
 */
export async function notifyCallStateChanged(
  callId: string,
  state: string,
  metadata: any = {}
): Promise<void> {
  const message: SignalingMessage = {
    type: SignalingMessageType.CALL_STATE_CHANGED,
    payload: {
      callId,
      state,
      ...metadata,
    },
    timestamp: Date.now(),
  };

  await connectionManager.broadcast(getCallChannel(callId), message);
}

/**
 * Notify call ended
 */
export async function notifyCallEnded(callId: string, reason?: string): Promise<void> {
  const message: SignalingMessage = {
    type: SignalingMessageType.CALL_ENDED,
    payload: {
      callId,
      reason: reason || "ENDED",
    },
    timestamp: Date.now(),
  };

  await connectionManager.broadcast(getCallChannel(callId), message);
}

/**
 * Send error to user
 */
export async function sendSignalingError(
  userId: string,
  callId: string,
  error: string,
  code: string
): Promise<void> {
  const message: SignalingMessage = {
    type: SignalingMessageType.ERROR,
    payload: {
      callId,
      error,
      code,
    },
    timestamp: Date.now(),
  };

  await connectionManager.broadcastToUser(userId, message);
}

/**
 * Get connected participants in a call
 * Note: This requires access to the internal socketSubscriptions map
 * For now, returns empty array - implement properly when ConnectionManager exposes this
 */
export async function getConnectedParticipants(callId: string): Promise<string[]> {
  // TODO: Implement when ConnectionManager exposes channel subscriber information
  // For now, this would require adding a method to ConnectionManager to get users in a channel
  return [];
}

/**
 * Check if user is in call channel
 * Note: This requires access to the internal userSubscriptions map
 * For now, returns false - implement properly when ConnectionManager exposes this
 */
export async function isUserInCallChannel(callId: string, userId: string): Promise<boolean> {
  // TODO: Implement when ConnectionManager exposes channel membership checking
  const userSubs = connectionManager.getUserSubscriptions(userId);
  return userSubs.includes(getCallChannel(callId));
}