/**
 * Call State Machine - Manages call lifecycle and state transitions
 *
 * Implements the state machine from DESIGN_DOCUMENT.md §7.4
 * States: NEW → RINGING → CONNECTING → ACTIVE → ENDED
 * With additional states for failure scenarios: MISSED, DECLINED, FAILED
 */

import { callStatusEnum, callParticipantStatusEnum } from "../db/schema";

/**
 * Call states based on database enum
 */
export enum CallState {
  INITIATED = "INITIATED",
  RINGING = "RINGING",
  CONNECTING = "CONNECTING",
  ACTIVE = "ACTIVE",
  ENDED = "ENDED",
  MISSED = "MISSED",
  DECLINED = "DECLINED",
  FAILED = "FAILED",
}

/**
 * Participant states
 */
export enum ParticipantState {
  INVITED = "INVITED",
  RINGING = "RINGING",
  JOINING = "JOINING",
  CONNECTED = "CONNECTED",
  RECONNECTING = "RECONNECTING",
  LEFT = "LEFT",
  DECLINED = "DECLINED",
  FAILED = "FAILED",
}

/**
 * Valid state transitions for calls
 * Key: current state, Value: allowed next states
 */
const CALL_STATE_TRANSITIONS: Record<CallState, CallState[]> = {
  [CallState.INITIATED]: [CallState.RINGING, CallState.DECLINED, CallState.FAILED],
  [CallState.RINGING]: [CallState.CONNECTING, CallState.DECLINED, CallState.MISSED, CallState.FAILED],
  [CallState.CONNECTING]: [CallState.ACTIVE, CallState.ENDED, CallState.FAILED],
  [CallState.ACTIVE]: [CallState.ENDED, CallState.FAILED],
  [CallState.ENDED]: [],
  [CallState.MISSED]: [],
  [CallState.DECLINED]: [],
  [CallState.FAILED]: [],
};

/**
 * Valid state transitions for participants
 */
const PARTICIPANT_STATE_TRANSITIONS: Record<ParticipantState, ParticipantState[]> = {
  [ParticipantState.INVITED]: [ParticipantState.RINGING, ParticipantState.DECLINED, ParticipantState.FAILED],
  [ParticipantState.RINGING]: [ParticipantState.JOINING, ParticipantState.DECLINED, ParticipantState.FAILED],
  [ParticipantState.JOINING]: [ParticipantState.CONNECTED, ParticipantState.LEFT, ParticipantState.FAILED],
  [ParticipantState.CONNECTED]: [ParticipantState.RECONNECTING, ParticipantState.LEFT],
  [ParticipantState.RECONNECTING]: [ParticipantState.CONNECTED, ParticipantState.LEFT, ParticipantState.FAILED],
  [ParticipantState.LEFT]: [],
  [ParticipantState.DECLINED]: [],
  [ParticipantState.FAILED]: [],
};

/**
 * State machine events that trigger transitions
 */
export enum CallEvent {
  INITIATE = "INITIATE",
  START_RINGING = "START_RINGING",
  ANSWER = "ANSWER",
  DECLINE = "DECLINE",
  MISSED = "MISSED",
  START_CONNECTING = "START_CONNECTING",
  CONNECTED = "CONNECTED",
  END = "END",
  FAIL = "FAIL",
  PARTICIPANT_JOIN = "PARTICIPANT_JOIN",
  PARTICIPANT_LEAVE = "PARTICIPANT_LEAVE",
  PARTICIPANT_RECONNECT = "PARTICIPANT_RECONNECT",
}

/**
 * Context for state machine operations
 */
export interface CallContext {
  callId: string;
  currentState: CallState;
  participants: Map<string, ParticipantContext>;
  initiatorId: string;
  maxParticipants: number;
  startedAt?: Date;
  endedAt?: Date;
  endReason?: string;
  metadata: Record<string, any>;
}

/**
 * Participant context
 */
export interface ParticipantContext {
  userId: string;
  participantId: string;
  state: ParticipantState;
  joinedAt?: Date;
  leftAt?: Date;
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  connectionQuality?: string;
  metadata: Record<string, any>;
}

/**
 * State transition result
 */
export interface TransitionResult {
  success: boolean;
  newState?: CallState | ParticipantState;
  error?: string;
  sideEffects?: CallSideEffect[];
}

/**
 * Side effects that can be triggered by state transitions
 */
export interface CallSideEffect {
  type: "NOTIFY_PARTICIPANTS" | "UPDATE_DATABASE" | "SEND_WEBHOOK" | "LOG_EVENT" | "START_TIMER" | "CANCEL_TIMER" | "RECORDING_START" | "RECORDING_STOP";
  payload: any;
}

/**
 * CallStateMachine - Main state machine class
 */
export class CallStateMachine {
  private contexts = new Map<string, CallContext>();

  /**
   * Initialize a new call context
   */
  initializeCall(
    callId: string,
    initiatorId: string,
    maxParticipants: number = 2,
    metadata: Record<string, any> = {}
  ): CallContext {
    const context: CallContext = {
      callId,
      currentState: CallState.INITIATED,
      participants: new Map(),
      initiatorId,
      maxParticipants,
      metadata,
    };

    this.contexts.set(callId, context);
    return context;
  }

  /**
   * Get call context
   */
  getContext(callId: string): CallContext | undefined {
    return this.contexts.get(callId);
  }

  /**
   * Remove call context (cleanup)
   */
  removeContext(callId: string): void {
    this.contexts.delete(callId);
  }

  /**
   * Transition call state
   */
  transitionCall(callId: string, event: CallEvent, payload: any = {}): TransitionResult {
    const context = this.contexts.get(callId);
    if (!context) {
      return { success: false, error: "Call context not found" };
    }

    const currentState = context.currentState;
    const nextState = this.determineNextCallState(currentState, event);

    if (!nextState) {
      return {
        success: false,
        error: `Invalid transition from ${currentState} with event ${event}`,
      };
    }

    // Validate transition
    const allowedTransitions = CALL_STATE_TRANSITIONS[currentState];
    if (!allowedTransitions.includes(nextState)) {
      return {
        success: false,
        error: `Transition from ${currentState} to ${nextState} not allowed`,
      };
    }

    // Apply transition
    context.currentState = nextState;
    const sideEffects = this.generateCallSideEffects(context, currentState, nextState, event, payload);

    // Handle specific state entry logic
    this.handleCallStateEntry(context, nextState, payload);

    return {
      success: true,
      newState: nextState,
      sideEffects,
    };
  }

  /**
   * Transition participant state
   */
  transitionParticipant(
    callId: string,
    participantId: string,
    event: CallEvent,
    payload: any = {}
  ): TransitionResult {
    const context = this.contexts.get(callId);
    if (!context) {
      return { success: false, error: "Call context not found" };
    }

    const participant = context.participants.get(participantId);
    if (!participant) {
      return { success: false, error: "Participant not found" };
    }

    const currentState = participant.state;
    const nextState = this.determineNextParticipantState(currentState, event);

    if (!nextState) {
      return {
        success: false,
        error: `Invalid transition from ${currentState} with event ${event}`,
      };
    }

    // Validate transition
    const allowedTransitions = PARTICIPANT_STATE_TRANSITIONS[currentState];
    if (!allowedTransitions.includes(nextState)) {
      return {
        success: false,
        error: `Participant transition from ${currentState} to ${nextState} not allowed`,
      };
    }

    // Apply transition
    participant.state = nextState;
    const sideEffects = this.generateParticipantSideEffects(context, participant, currentState, nextState, event, payload);

    // Handle specific state entry logic
    this.handleParticipantStateEntry(context, participant, nextState, payload);

    return {
      success: true,
      newState: nextState,
      sideEffects,
    };
  }

  /**
   * Add participant to call
   */
  addParticipant(
    callId: string,
    participantId: string,
    userId: string,
    metadata: Record<string, any> = {}
  ): ParticipantContext | null {
    const context = this.contexts.get(callId);
    if (!context) return null;

    // Check max participants
    if (context.participants.size >= context.maxParticipants) {
      return null;
    }

    const participant: ParticipantContext = {
      userId,
      participantId,
      state: ParticipantState.INVITED,
      isMuted: false,
      isVideoOff: false,
      isScreenSharing: false,
      metadata,
    };

    context.participants.set(participantId, participant);
    return participant;
  }

  /**
   * Remove participant from call
   */
  removeParticipant(callId: string, participantId: string): boolean {
    const context = this.contexts.get(callId);
    if (!context) return false;

    const participant = context.participants.get(participantId);
    if (!participant) return false;

    participant.state = ParticipantState.LEFT;
    participant.leftAt = new Date();
    context.participants.delete(participantId);

    // Check if call should end (no active participants)
    const activeParticipants = Array.from(context.participants.values()).filter(
      (p) => p.state === ParticipantState.CONNECTED || p.state === ParticipantState.JOINING
    );

    if (activeParticipants.length === 0 && context.currentState === CallState.ACTIVE) {
      this.transitionCall(callId, CallEvent.END, { reason: "NO_PARTICIPANTS" });
    }

    return true;
  }

  /**
   * Update participant media state
   */
  updateParticipantMedia(
    callId: string,
    participantId: string,
    updates: { isMuted?: boolean; isVideoOff?: boolean; isScreenSharing?: boolean }
  ): boolean {
    const context = this.contexts.get(callId);
    if (!context) return false;

    const participant = context.participants.get(participantId);
    if (!participant) return false;

    if (updates.isMuted !== undefined) participant.isMuted = updates.isMuted;
    if (updates.isVideoOff !== undefined) participant.isVideoOff = updates.isVideoOff;
    if (updates.isScreenSharing !== undefined) participant.isScreenSharing = updates.isScreenSharing;

    return true;
  }

  /**
   * Get call summary for broadcasting
   */
  getCallSummary(callId: string): any {
    const context = this.contexts.get(callId);
    if (!context) return null;

    return {
      callId: context.callId,
      state: context.currentState,
      initiatorId: context.initiatorId,
      maxParticipants: context.maxParticipants,
      startedAt: context.startedAt,
      endedAt: context.endedAt,
      endReason: context.endReason,
      participants: Array.from(context.participants.values()).map((p) => ({
        participantId: p.participantId,
        userId: p.userId,
        state: p.state,
        isMuted: p.isMuted,
        isVideoOff: p.isVideoOff,
        isScreenSharing: p.isScreenSharing,
        connectionQuality: p.connectionQuality,
        joinedAt: p.joinedAt,
        leftAt: p.leftAt,
      })),
    };
  }

  /**
   * Determine next call state based on event
   */
  private determineNextCallState(currentState: CallState, event: CallEvent): CallState | null {
    switch (event) {
      case CallEvent.INITIATE:
        return currentState === CallState.INITIATED ? CallState.RINGING : null;
      case CallEvent.START_RINGING:
        return currentState === CallState.INITIATED ? CallState.RINGING : null;
      case CallEvent.ANSWER:
        return currentState === CallState.RINGING ? CallState.CONNECTING : null;
      case CallEvent.DECLINE:
        return currentState === CallState.RINGING ? CallState.DECLINED : null;
      case CallEvent.MISSED:
        return currentState === CallState.RINGING ? CallState.MISSED : null;
      case CallEvent.START_CONNECTING:
        return currentState === CallState.RINGING ? CallState.CONNECTING : null;
      case CallEvent.CONNECTED:
        return currentState === CallState.CONNECTING ? CallState.ACTIVE : null;
      case CallEvent.END:
        return [CallState.CONNECTING, CallState.ACTIVE].includes(currentState) ? CallState.ENDED : null;
      case CallEvent.FAIL:
        return [CallState.INITIATED, CallState.RINGING, CallState.CONNECTING, CallState.ACTIVE].includes(currentState)
          ? CallState.FAILED
          : null;
      case CallEvent.PARTICIPANT_LEAVE:
        // Check if last participant left during active call
        return currentState === CallState.ACTIVE ? CallState.ENDED : null;
      default:
        return null;
    }
  }

  /**
   * Determine next participant state based on event
   */
  private determineNextParticipantState(currentState: ParticipantState, event: CallEvent): ParticipantState | null {
    switch (event) {
      case CallEvent.START_RINGING:
        return currentState === ParticipantState.INVITED ? ParticipantState.RINGING : null;
      case CallEvent.ANSWER:
        return currentState === ParticipantState.RINGING ? ParticipantState.JOINING : null;
      case CallEvent.DECLINE:
        return currentState === ParticipantState.RINGING ? ParticipantState.DECLINED : null;
      case CallEvent.PARTICIPANT_JOIN:
        return currentState === ParticipantState.JOINING ? ParticipantState.CONNECTED : null;
      case CallEvent.PARTICIPANT_LEAVE:
        return [ParticipantState.CONNECTED, ParticipantState.JOINING, ParticipantState.RECONNECTING].includes(currentState)
          ? ParticipantState.LEFT
          : null;
      case CallEvent.PARTICIPANT_RECONNECT:
        return currentState === ParticipantState.RECONNECTING ? ParticipantState.CONNECTED : null;
      case CallEvent.FAIL:
        return [ParticipantState.INVITED, ParticipantState.RINGING, ParticipantState.JOINING, ParticipantState.CONNECTED].includes(currentState)
          ? ParticipantState.FAILED
          : null;
      default:
        return null;
    }
  }

  /**
   * Generate side effects for call state transitions
   */
  private generateCallSideEffects(
    context: CallContext,
    fromState: CallState,
    toState: CallState,
    event: CallEvent,
    payload: any
  ): CallSideEffect[] {
    const effects: CallSideEffect[] = [];

    // Database update
    effects.push({
      type: "UPDATE_DATABASE",
      payload: { callId: context.callId, status: toState, ...payload },
    });

    // Notify all participants
    effects.push({
      type: "NOTIFY_PARTICIPANTS",
      payload: { callId: context.callId, event, newState: toState, ...payload },
    });

    // State-specific effects
    switch (toState) {
      case CallState.RINGING:
        effects.push({ type: "START_TIMER", payload: { callId: context.callId, timer: "RING_TIMEOUT", duration: 30000 } });
        effects.push({ type: "SEND_WEBHOOK", payload: { event: "call.ringing", callId: context.callId } });
        break;
      case CallState.CONNECTING:
        effects.push({ type: "CANCEL_TIMER", payload: { callId: context.callId, timer: "RING_TIMEOUT" } });
        effects.push({ type: "START_TIMER", payload: { callId: context.callId, timer: "CONNECT_TIMEOUT", duration: 20000 } });
        break;
      case CallState.ACTIVE:
        effects.push({ type: "CANCEL_TIMER", payload: { callId: context.callId, timer: "CONNECT_TIMEOUT" } });
        context.startedAt = new Date();
        if (context.metadata.isRecording) {
          effects.push({ type: "RECORDING_START", payload: { callId: context.callId } });
        }
        effects.push({ type: "SEND_WEBHOOK", payload: { event: "call.active", callId: context.callId } });
        break;
      case CallState.ENDED:
      case CallState.MISSED:
      case CallState.DECLINED:
      case CallState.FAILED:
        effects.push({ type: "CANCEL_TIMER", payload: { callId: context.callId, timer: "RING_TIMEOUT" } });
        effects.push({ type: "CANCEL_TIMER", payload: { callId: context.callId, timer: "CONNECT_TIMEOUT" } });
        context.endedAt = new Date();
        context.endReason = payload.reason || "ENDED";
        if (context.metadata.isRecording) {
          effects.push({ type: "RECORDING_STOP", payload: { callId: context.callId } });
        }
        effects.push({ type: "SEND_WEBHOOK", payload: { event: `call.${toState.toLowerCase()}`, callId: context.callId } });
        break;
    }

    return effects;
  }

  /**
   * Generate side effects for participant state transitions
   */
  private generateParticipantSideEffects(
    context: CallContext,
    participant: ParticipantContext,
    fromState: ParticipantState,
    toState: ParticipantState,
    event: CallEvent,
    payload: any
  ): CallSideEffect[] {
    const effects: CallSideEffect[] = [];

    // Database update
    effects.push({
      type: "UPDATE_DATABASE",
      payload: {
        callId: context.callId,
        participantId: participant.participantId,
        status: toState,
        ...payload,
      },
    });

    // Notify other participants
    effects.push({
      type: "NOTIFY_PARTICIPANTS",
      payload: {
        callId: context.callId,
        event: `participant.${event.toLowerCase()}`,
        participantId: participant.participantId,
        userId: participant.userId,
        newState: toState,
        ...payload,
      },
    });

    // State-specific effects
    switch (toState) {
      case ParticipantState.CONNECTED:
        participant.joinedAt = new Date();
        effects.push({ type: "SEND_WEBHOOK", payload: { event: "participant.joined", callId: context.callId, participantId: participant.participantId } });
        break;
      case ParticipantState.LEFT:
        participant.leftAt = new Date();
        effects.push({ type: "SEND_WEBHOOK", payload: { event: "participant.left", callId: context.callId, participantId: participant.participantId } });
        break;
      case ParticipantState.RECONNECTING:
        effects.push({ type: "START_TIMER", payload: { callId: context.callId, timer: `RECONNECT_${participant.participantId}`, duration: 30000 } });
        break;
    }

    return effects;
  }

  /**
   * Handle call state entry logic
   */
  private handleCallStateEntry(context: CallContext, state: CallState, payload: any): void {
    switch (state) {
      case CallState.RINGING:
        // Update all invited participants to RINGING
        for (const [, participant] of context.participants) {
          if (participant.state === ParticipantState.INVITED) {
            participant.state = ParticipantState.RINGING;
          }
        }
        break;
      case CallState.ACTIVE:
        // Update joining participants to CONNECTED
        for (const [, participant] of context.participants) {
          if (participant.state === ParticipantState.JOINING) {
            participant.state = ParticipantState.CONNECTED;
            participant.joinedAt = new Date();
          }
        }
        break;
    }
  }

  /**
   * Handle participant state entry logic
   */
  private handleParticipantStateEntry(
    context: CallContext,
    participant: ParticipantContext,
    state: ParticipantState,
    payload: any
  ): void {
    switch (state) {
      case ParticipantState.CONNECTED:
        participant.joinedAt = new Date();
        break;
      case ParticipantState.LEFT:
        participant.leftAt = new Date();
        break;
    }
  }

  /**
   * Check if call is in terminal state
   */
  isTerminalState(callId: string): boolean {
    const context = this.contexts.get(callId);
    if (!context) return true;

    return [CallState.ENDED, CallState.MISSED, CallState.DECLINED, CallState.FAILED].includes(context.currentState);
  }

  /**
   * Get call duration in seconds
   */
  getCallDuration(callId: string): number {
    const context = this.contexts.get(callId);
    if (!context || !context.startedAt) return 0;

    const endTime = context.endedAt || new Date();
    return Math.floor((endTime.getTime() - context.startedAt.getTime()) / 1000);
  }

  /**
   * Get active participants count
   */
  getActiveParticipantCount(callId: string): number {
    const context = this.contexts.get(callId);
    if (!context) return 0;

    return Array.from(context.participants.values()).filter(
      (p) => p.state === ParticipantState.CONNECTED || p.state === ParticipantState.JOINING
    ).length;
  }

  /**
   * Get participant by user ID
   */
  getParticipantByUserId(callId: string, userId: string): ParticipantContext | undefined {
    const context = this.contexts.get(callId);
    if (!context) return undefined;

    for (const [, participant] of context.participants) {
      if (participant.userId === userId) {
        return participant;
      }
    }
    return undefined;
  }
}

/**
 * Singleton instance
 */
export const callStateMachine = new CallStateMachine();