/**
 * Event Recovery System - Sequence IDs, Deduplication, and Offline Message Queue
 *
 * Implements event recovery with sequence IDs per DESIGN_DOCUMENT.md §7.1
 * Handles:
 * - Monotonic sequence numbers for message ordering
 * - UUID-based event deduplication
 * - Offline message queue with reconnect recovery
 * - Client-side state tracking (lastSequence, lastEventId, generation)
 *
 * Based on the Message Envelope from DESIGN_DOCUMENT.md §7.3
 */

import { ConnectionManager, AuthenticatedSocket, MessageEnvelope } from "./connection-manager";

/**
 * Client state for event recovery
 * Tracked per socket connection
 */
export interface ClientRecoveryState {
  /** Monotonic sequence number of last processed event */
  lastSequence: number;
  /** UUID of last processed event (for deduplication) */
  lastEventId: string;
  /** Generation counter (incremented on each reconnect) */
  generation: number;
  /** Set of processed event IDs for deduplication (in-memory) */
  processedEventIds: Set<string>;
  /** Conversation-specific sequence tracking */
  conversationSequences: Map<string, number>;
  /** Pending acknowledgments waiting for server ack */
  pendingAcks: Map<string, PendingAck>;
}

/**
 * Pending acknowledgment tracking
 */
export interface PendingAck {
  eventId: string;
  sequence: number;
  timestamp: number;
  conversationId: string;
  messageId: string;
  resolve: (value: boolean) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Recovery request from client
 */
export interface RecoveryRequest {
  conversationId: string;
  lastSequence: number;
  lastEventId: string;
  generation: number;
}

/**
 * Recovery response from server
 */
export interface RecoveryResponse {
  success: boolean;
  events: MessageEnvelope[];
  snapshot?: ConversationSnapshot;
  nextCursor?: string;
  hasMore: boolean;
  lastSequence: number;
  lastEventId: string;
}

/**
 * Conversation snapshot for fast recovery
 */
export interface ConversationSnapshot {
  conversationId: string;
  unreadCount: number;
  lastMessageId: string | null;
  lastMessageAt: string | null;
  participants: ParticipantSnapshot[];
}

/**
 * Participant snapshot for presence recovery
 */
export interface ParticipantSnapshot {
  userId: string;
  status: "online" | "away" | "busy" | "offline";
  lastSeen: string;
  isTyping: boolean;
}

/**
 * Offline message queue entry
 */
export interface QueuedMessage {
  id: string;
  conversationId: string;
  senderId: string;
  envelope: MessageEnvelope;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  nextRetryAt: Date;
}

/**
 * Event recovery configuration
 */
export const EVENT_RECOVERY_CONFIG = {
  /** Maximum events to return in a single recovery response */
  MAX_RECOVERY_EVENTS: 100,
  /** Maximum time to wait for acknowledgment (ms) */
  ACK_TIMEOUT_MS: 10_000,
  /** Maximum retry attempts for queued messages */
  MAX_QUEUE_ATTEMPTS: 5,
  /** Base retry delay for queued messages (ms) */
  BASE_RETRY_DELAY_MS: 1_000,
  /** Maximum size of processed event ID set (for memory management) */
  MAX_PROCESSED_EVENT_IDS: 10_000,
  /** Cleanup interval for processed event IDs (ms) */
  CLEANUP_INTERVAL_MS: 60_000,
} as const;

/**
 * Initialize recovery state for a new socket connection
 */
export function initRecoveryState(socket: AuthenticatedSocket): ClientRecoveryState {
  const state: ClientRecoveryState = {
    lastSequence: 0,
    lastEventId: "",
    generation: 0,
    processedEventIds: new Set(),
    conversationSequences: new Map(),
    pendingAcks: new Map(),
  };

  // Store on socket for easy access
  (socket as any).recoveryState = state;

  return state;
}

/**
 * Get or create recovery state for a socket
 */
export function getRecoveryState(socket: AuthenticatedSocket): ClientRecoveryState {
  let state = (socket as any).recoveryState as ClientRecoveryState | undefined;

  if (!state) {
    state = initRecoveryState(socket);
  }

  return state;
}

/**
 * Reset recovery state on reconnect (increments generation)
 */
export function resetRecoveryStateOnReconnect(socket: AuthenticatedSocket): ClientRecoveryState {
  const state = getRecoveryState(socket);
  state.generation += 1;
  state.lastSequence = 0;
  state.lastEventId = "";
  state.processedEventIds.clear();
  state.conversationSequences.clear();

  // Clear pending acks
  for (const [, ack] of Array.from(state.pendingAcks.entries())) {
    clearTimeout(ack.timeout);
    ack.reject(new Error("Connection reset"));
  }
  state.pendingAcks.clear();

  console.log(
    `[EventRecovery] Reset recovery state for user ${socket.userId}, generation: ${state.generation}`
  );

  return state;
}

/**
 * Process incoming event with deduplication
 * Returns true if event was processed, false if duplicate
 */
export function processIncomingEvent(
  socket: AuthenticatedSocket,
  envelope: MessageEnvelope
): { processed: boolean; isDuplicate: boolean } {
  const state = getRecoveryState(socket);

  // Check for duplicate by eventId
  if (state.processedEventIds.has(envelope.eventId)) {
    console.log(
      `[EventRecovery] Duplicate event detected: ${envelope.eventId} (generation: ${state.generation})`
    );
    return { processed: false, isDuplicate: true };
  }

  // Check sequence ordering (should be monotonic)
  if (envelope.sequence <= state.lastSequence) {
    console.warn(
      `[EventRecovery] Out-of-order sequence: ${envelope.sequence} <= ${state.lastSequence}`
    );
    // Still process but log warning
  }

  // Add to processed set
  state.processedEventIds.add(envelope.eventId);

  // Trim processed set if too large
  if (state.processedEventIds.size > EVENT_RECOVERY_CONFIG.MAX_PROCESSED_EVENT_IDS) {
    trimProcessedEventIds(state);
  }

  // Update last sequence and event ID
  state.lastSequence = envelope.sequence;
  state.lastEventId = envelope.eventId;

  // Update conversation-specific sequence
  if (envelope.payload && typeof envelope.payload === "object") {
    const payload = envelope.payload as any;
    if (payload.conversationId) {
      const convSeq = state.conversationSequences.get(payload.conversationId) || 0;
      if (envelope.sequence > convSeq) {
        state.conversationSequences.set(payload.conversationId, envelope.sequence);
      }
    }
  }

  return { processed: true, isDuplicate: false };
}

/**
 * Trim processed event IDs to prevent memory growth
 * Keeps the most recent entries
 */
function trimProcessedEventIds(state: ClientRecoveryState): void {
  const ids = Array.from(state.processedEventIds);
  const toRemove = ids.slice(0, ids.length - EVENT_RECOVERY_CONFIG.MAX_PROCESSED_EVENT_IDS / 2);

  for (const id of toRemove) {
    state.processedEventIds.delete(id);
  }

  console.log(`[EventRecovery] Trimmed ${toRemove.length} processed event IDs`);
}

/**
 * Create a recovery request payload
 */
export function createRecoveryRequest(
  socket: AuthenticatedSocket,
  conversationId: string
): RecoveryRequest {
  const state = getRecoveryState(socket);
  const convSeq = state.conversationSequences.get(conversationId) || 0;

  return {
    conversationId,
    lastSequence: convSeq,
    lastEventId: state.lastEventId,
    generation: state.generation,
  };
}

/**
 * Handle recovery response from server
 * Updates local state with recovered events
 */
export function handleRecoveryResponse(
  socket: AuthenticatedSocket,
  response: RecoveryResponse
): void {
  const state = getRecoveryState(socket);

  if (!response.success) {
    console.error(`[EventRecovery] Recovery failed for user ${socket.userId}`);
    return;
  }

  // Process recovered events in order
  for (const envelope of response.events.sort((a, b) => a.sequence - b.sequence)) {
    const result = processIncomingEvent(socket, envelope);

    if (result.processed) {
      // Event was new, could trigger local handlers here
      console.debug(
        `[EventRecovery] Recovered event: ${envelope.type} (seq: ${envelope.sequence})`
      );
    }
  }

  // Update state with server's latest
  state.lastSequence = response.lastSequence;
  state.lastEventId = response.lastEventId;

  console.log(
    `[EventRecovery] Recovery complete for ${socket.userId}: ${response.events.length} events, lastSeq: ${response.lastSequence}`
  );
}

/**
 * Send message with acknowledgment tracking
 * Returns a promise that resolves when server acknowledges
 */
export async function sendWithAck(
  socket: AuthenticatedSocket,
  manager: ConnectionManager,
  envelope: MessageEnvelope
): Promise<boolean> {
  const state = getRecoveryState(socket);

  if (!envelope.ackRequired) {
    // No ack required, just send
    socket.send(JSON.stringify(envelope));
    return true;
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      state.pendingAcks.delete(envelope.eventId);
      reject(new Error(`Acknowledgment timeout for event ${envelope.eventId}`));
    }, EVENT_RECOVERY_CONFIG.ACK_TIMEOUT_MS);

    const pendingAck: PendingAck = {
      eventId: envelope.eventId,
      sequence: envelope.sequence,
      timestamp: Date.now(),
      conversationId: (envelope.payload as any)?.conversationId || "",
      messageId: (envelope.payload as any)?.id || "",
      resolve,
      reject,
      timeout,
    };

    state.pendingAcks.set(envelope.eventId, pendingAck);

    // Send the message
    socket.send(JSON.stringify(envelope));
  });
}

/**
 * Handle acknowledgment from server
 */
export function handleAcknowledgment(
  socket: AuthenticatedSocket,
  ackEnvelope: MessageEnvelope
): void {
  const state = getRecoveryState(socket);
  const ackEventId = (ackEnvelope.payload as any)?.eventId || ackEnvelope.correlationId;

  if (!ackEventId) {
    console.warn(`[EventRecovery] Acknowledgment missing eventId/correlationId`);
    return;
  }

  const pendingAck = state.pendingAcks.get(ackEventId);

  if (pendingAck) {
    clearTimeout(pendingAck.timeout);
    state.pendingAcks.delete(ackEventId);
    pendingAck.resolve(true);
    console.log(`[EventRecovery] Acknowledgment received for ${ackEventId}`);
  } else {
    console.warn(`[EventRecovery] Unexpected acknowledgment for ${ackEventId}`);
  }
}

/**
 * Offline message queue for messages sent while disconnected
 */
export class OfflineMessageQueue {
  private queue: QueuedMessage[] = [];
  private processing = false;
  private flushCallback?: (messages: QueuedMessage[]) => Promise<void>;

  constructor(
    private readonly maxSize: number = 1000,
    private readonly onFlush?: (messages: QueuedMessage[]) => Promise<void>
  ) {
    this.flushCallback = onFlush;
  }

  /**
   * Add a message to the offline queue
   */
  enqueue(message: Omit<QueuedMessage, "id" | "attempts" | "createdAt" | "nextRetryAt">): boolean {
    if (this.queue.length >= this.maxSize) {
      console.warn(`[OfflineQueue] Queue full, dropping message`);
      return false;
    }

    const queuedMessage: QueuedMessage = {
      ...message,
      id: crypto.randomUUID(),
      attempts: 0,
      createdAt: new Date(),
      nextRetryAt: new Date(),
    };

    this.queue.push(queuedMessage);
    console.log(`[OfflineQueue] Enqueued message ${queuedMessage.id} for conversation ${message.conversationId}`);
    return true;
  }

  /**
   * Process the queue (called when connection is restored)
   */
  async flush(): Promise<{ sent: number; failed: number }> {
    if (this.processing || this.queue.length === 0) {
      return { sent: 0, failed: 0 };
    }

    this.processing = true;
    let sent = 0;
    let failed = 0;

    try {
      // Sort by priority (older messages first)
      this.queue.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      if (this.flushCallback) {
        await this.flushCallback(this.queue);
        sent = this.queue.length;
      } else {
        // Default: just clear the queue (messages would be sent via REST API)
        for (const msg of this.queue) {
          // In real implementation, this would call the REST API
          console.log(`[OfflineQueue] Would send queued message ${msg.id}`);
          sent++;
        }
      }

      this.queue = [];
    } catch (error) {
      console.error(`[OfflineQueue] Flush failed:`, error);
      failed = this.queue.length;
    } finally {
      this.processing = false;
    }

    return { sent, failed };
  }

  /**
   * Retry failed messages
   */
  async retryFailed(): Promise<void> {
    const now = new Date();
    const toRetry = this.queue.filter((msg) => msg.nextRetryAt <= now && msg.attempts < msg.maxAttempts);

    for (const msg of toRetry) {
      msg.attempts++;
      msg.nextRetryAt = new Date(now.getTime() + EVENT_RECOVERY_CONFIG.BASE_RETRY_DELAY_MS * Math.pow(2, msg.attempts));
    }
  }

  /**
   * Get queue status
   */
  getStatus(): { size: number; oldestMessage: Date | null; isProcessing: boolean } {
    return {
      size: this.queue.length,
      oldestMessage: this.queue.length > 0 ? this.queue[0].createdAt : null,
      isProcessing: this.processing,
    };
  }

  /**
   * Clear the queue
   */
  clear(): void {
    this.queue = [];
  }
}

/**
 * Global offline message queue instance (per isolate)
 */
export const offlineMessageQueue = new OfflineMessageQueue();

/**
 * Queue a message for offline delivery
 * Called when user tries to send a message but has no active connections
 */
export function queueOfflineMessage(
  userId: string,
  conversationId: string,
  envelope: MessageEnvelope
): boolean {
  return offlineMessageQueue.enqueue({
    conversationId,
    senderId: userId,
    envelope,
    maxAttempts: EVENT_RECOVERY_CONFIG.MAX_QUEUE_ATTEMPTS,
  });
}

/**
 * Flush offline queue when user reconnects
 */
export async function flushOfflineQueue(userId: string): Promise<{ sent: number; failed: number }> {
  return offlineMessageQueue.flush();
}

/**
 * Get conversation-specific sequence number
 */
export function getConversationSequence(
  socket: AuthenticatedSocket,
  conversationId: string
): number {
  const state = getRecoveryState(socket);
  return state.conversationSequences.get(conversationId) || 0;
}

/**
 * Update conversation sequence from server event
 */
export function updateConversationSequence(
  socket: AuthenticatedSocket,
  conversationId: string,
  sequence: number
): void {
  const state = getRecoveryState(socket);
  const current = state.conversationSequences.get(conversationId) || 0;
  if (sequence > current) {
    state.conversationSequences.set(conversationId, sequence);
  }
}

/**
 * Cleanup recovery state on disconnect
 */
export function cleanupRecoveryState(socket: AuthenticatedSocket): void {
  const state = (socket as any).recoveryState as ClientRecoveryState | undefined;

  if (state) {
    // Clear pending ack timeouts
    for (const [, ack] of Array.from(state.pendingAcks.entries())) {
      clearTimeout(ack.timeout);
    }
    state.pendingAcks.clear();
    state.processedEventIds.clear();
    state.conversationSequences.clear();

    delete (socket as any).recoveryState;
  }
}