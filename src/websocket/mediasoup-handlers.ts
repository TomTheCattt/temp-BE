/**
 * Mediasoup WebSocket Handlers - WebRTC Transport Signaling
 *
 * Implements: BE-139 (WebRTC transport produce/consume), BE-140 (Producer/Consumer management),
 * BE-141 (Simulcast/SVC), BE-142 (Data channels), BE-143 (Recording), BE-144 (Multi-party mesh)
 *
 * Handles the WebRTC signaling protocol over WebSocket:
 * - Get router RTP capabilities
 * - Create WebRTC transports (send/recv)
 * - Connect transports with DTLS parameters
 * - Produce audio/video/screen
 * - Consume audio/video/screen
 * - Data channel producer/consumer
 * - Call recording controls
 * - Participant media state (mute/unmute, video on/off, screen share)
 */

import { AuthenticatedSocket, MessageEnvelope } from "./connection-manager";
import { ConnectionManager } from "./connection-manager";
import { mediasoupService, ProducerInfo, ConsumerInfo, TransportInfo, RoomState } from "../services/mediasoup-service";
import { db } from "../db/client";
import { eq, and, isNull } from "drizzle-orm";
import * as schema from "../db/schema";

// ============================================================
// MESSAGE TYPES
// ============================================================

// Client -> Server messages
export interface GetRouterRtpCapabilitiesMessage {
  type: "mediasoup.getRouterRtpCapabilities";
  payload: { roomId: string; callId: string };
}

export interface CreateWebRtcTransportMessage {
  type: "mediasoup.createTransport";
  payload: {
    roomId: string;
    callId: string;
    participantId: string;
    direction: "send" | "recv";
    producing?: boolean; // for send transport
    consuming?: boolean; // for recv transport
  };
}

export interface ConnectTransportMessage {
  type: "mediasoup.connectTransport";
  payload: {
    roomId: string;
    transportId: string;
    dtlsParameters: any;
  };
}

export interface ProduceMessage {
  type: "mediasoup.produce";
  payload: {
    roomId: string;
    transportId: string;
    kind: "audio" | "video";
    rtpParameters: any;
    rtpEncodingParameters?: any[];
    appData?: any;
  };
}

export interface ConsumeMessage {
  type: "mediasoup.consume";
  payload: {
    roomId: string;
    transportId: string;
    producerId: string;
    rtpCapabilities: any;
    paused?: boolean;
    preferredLayers?: { spatialLayer: number; temporalLayer: number };
    appData?: any;
  };
}

export interface ResumeConsumerMessage {
  type: "mediasoup.resumeConsumer";
  payload: { roomId: string; consumerId: string };
}

export interface PauseConsumerMessage {
  type: "mediasoup.pauseConsumer";
  payload: { roomId: string; consumerId: string };
}

export interface SetConsumerPreferredLayersMessage {
  type: "mediasoup.setConsumerPreferredLayers";
  payload: {
    roomId: string;
    consumerId: string;
    spatialLayer: number;
    temporalLayer: number;
  };
}

export interface CloseProducerMessage {
  type: "mediasoup.closeProducer";
  payload: { roomId: string; producerId: string };
}

export interface CloseConsumerMessage {
  type: "mediasoup.closeConsumer";
  payload: { roomId: string; consumerId: string };
}

export interface ProduceDataMessage {
  type: "mediasoup.produceData";
  payload: {
    roomId: string;
    transportId: string;
    label: string;
    protocol?: string;
    appData?: any;
  };
}

export interface ConsumeDataMessage {
  type: "mediasoup.consumeData";
  payload: {
    roomId: string;
    transportId: string;
    dataProducerId: string;
    appData?: any;
  };
}

export interface StartRecordingMessage {
  type: "mediasoup.startRecording";
  payload: {
    callId: string;
    roomId: string;
    outputPath: string;
    videoCodec?: string;
    audioCodec?: string;
  };
}

export interface StopRecordingMessage {
  type: "mediasoup.stopRecording";
  payload: { recordingId: string };
}

export interface UpdateMediaStateMessage {
  type: "mediasoup.updateMediaState";
  payload: {
    roomId: string;
    participantId: string;
    isMuted?: boolean;
    isVideoOff?: boolean;
    isScreenSharing?: boolean;
  };
}

export interface RequestKeyframeMessage {
  type: "mediasoup.requestKeyframe";
  payload: { roomId: string; producerId: string };
}

export interface GetRoomStatsMessage {
  type: "mediasoup.getRoomStats";
  payload: { roomId: string };
}

// Server -> Client responses
export interface RouterRtpCapabilitiesResponse {
  type: "mediasoup.routerRtpCapabilities";
  payload: { rtpCapabilities: any };
}

export interface TransportCreatedResponse {
  type: "mediasoup.transportCreated";
  payload: TransportInfo & { direction: "send" | "recv" };
}

export interface TransportConnectedResponse {
  type: "mediasoup.transportConnected";
  payload: { transportId: string };
}

export interface ProducedResponse {
  type: "mediasoup.produced";
  payload: ProducerInfo;
}

export interface ConsumedResponse {
  type: "mediasoup.consumed";
  payload: ConsumerInfo;
}

export interface ConsumerResumedResponse {
  type: "mediasoup.consumerResumed";
  payload: { consumerId: string };
}

export interface ConsumerPausedResponse {
  type: "mediasoup.consumerPaused";
  payload: { consumerId: string };
}

export interface ConsumerLayersChangedResponse {
  type: "mediasoup.consumerLayersChanged";
  payload: { consumerId: string; spatialLayer: number; temporalLayer: number };
}

export interface ProducerClosedResponse {
  type: "mediasoup.producerClosed";
  payload: { producerId: string; reason?: string };
}

export interface ConsumerClosedResponse {
  type: "mediasoup.consumerClosed";
  payload: { consumerId: string; reason?: string };
}

export interface DataProducerCreatedResponse {
  type: "mediasoup.dataProducerCreated";
  payload: { dataProducerId: string; label: string; protocol?: string };
}

export interface DataConsumerCreatedResponse {
  type: "mediasoup.dataConsumerCreated";
  payload: { dataConsumerId: string; dataProducerId: string };
}

export interface RecordingStartedResponse {
  type: "mediasoup.recordingStarted";
  payload: { recordingId: string; callId: string; roomId: string; startedAt: string; outputPath: string };
}

export interface RecordingStoppedResponse {
  type: "mediasoup.recordingStopped";
  payload: { recordingId: string; status: string };
}

export interface MediaStateUpdatedResponse {
  type: "mediasoup.mediaStateUpdated";
  payload: { participantId: string; isMuted?: boolean; isVideoOff?: boolean; isScreenSharing?: boolean };
}

export interface NewProducerNotification {
  type: "mediasoup.newProducer";
  payload: ProducerInfo & { participantId: string; userId: string };
}

export interface ProducerClosedNotification {
  type: "mediasoup.producerClosed";
  payload: { producerId: string; participantId: string; reason?: string };
}

export interface NewConsumerNotification {
  type: "mediasoup.newConsumer";
  payload: ConsumerInfo & { participantId: string; userId: string };
}

export interface ConsumerClosedNotification {
  type: "mediasoup.consumerClosed";
  payload: { consumerId: string; participantId: string; reason?: string };
}

export interface ParticipantJoinedNotification {
  type: "mediasoup.participantJoined";
  payload: { participantId: string; userId: string; displayName: string };
}

export interface ParticipantLeftNotification {
  type: "mediasoup.participantLeft";
  payload: { participantId: string; userId: string };
}

export interface ParticipantMediaStateNotification {
  type: "mediasoup.participantMediaState";
  payload: { participantId: string; userId: string; isMuted: boolean; isVideoOff: boolean; isScreenSharing: boolean };
}

export interface RoomStatsResponse {
  type: "mediasoup.roomStats";
  payload: any;
}

export interface ErrorResponse {
  type: "error";
  payload: { code: string; message: string; requestType?: string };
}

type ClientMessage =
  | GetRouterRtpCapabilitiesMessage
  | CreateWebRtcTransportMessage
  | ConnectTransportMessage
  | ProduceMessage
  | ConsumeMessage
  | ResumeConsumerMessage
  | PauseConsumerMessage
  | SetConsumerPreferredLayersMessage
  | CloseProducerMessage
  | CloseConsumerMessage
  | ProduceDataMessage
  | ConsumeDataMessage
  | StartRecordingMessage
  | StopRecordingMessage
  | UpdateMediaStateMessage
  | RequestKeyframeMessage
  | GetRoomStatsMessage;

type ServerResponse =
  | RouterRtpCapabilitiesResponse
  | TransportCreatedResponse
  | TransportConnectedResponse
  | ProducedResponse
  | ConsumedResponse
  | ConsumerResumedResponse
  | ConsumerPausedResponse
  | ConsumerLayersChangedResponse
  | ProducerClosedResponse
  | ConsumerClosedResponse
  | DataProducerCreatedResponse
  | DataConsumerCreatedResponse
  | RecordingStartedResponse
  | RecordingStoppedResponse
  | MediaStateUpdatedResponse
  | NewProducerNotification
  | ProducerClosedNotification
  | NewConsumerNotification
  | ConsumerClosedNotification
  | ParticipantJoinedNotification
  | ParticipantLeftNotification
  | ParticipantMediaStateNotification
  | RoomStatsResponse
  | ErrorResponse;

// ============================================================
// HANDLER FUNCTIONS
// ============================================================

/**
 * Route mediasoup signaling messages
 */
export async function routeMediasoupMessage(
  socket: AuthenticatedSocket,
  message: ClientMessage,
  connectionManager: ConnectionManager
): Promise<void> {
  try {
    switch (message.type) {
      case "mediasoup.getRouterRtpCapabilities":
        await handleGetRouterRtpCapabilities(socket, message);
        break;

      case "mediasoup.createTransport":
        await handleCreateTransport(socket, message, connectionManager);
        break;

      case "mediasoup.connectTransport":
        await handleConnectTransport(socket, message);
        break;

      case "mediasoup.produce":
        await handleProduce(socket, message, connectionManager);
        break;

      case "mediasoup.consume":
        await handleConsume(socket, message, connectionManager);
        break;

      case "mediasoup.resumeConsumer":
        await handleResumeConsumer(socket, message);
        break;

      case "mediasoup.pauseConsumer":
        await handlePauseConsumer(socket, message);
        break;

      case "mediasoup.setConsumerPreferredLayers":
        await handleSetConsumerPreferredLayers(socket, message);
        break;

      case "mediasoup.closeProducer":
        await handleCloseProducer(socket, message, connectionManager);
        break;

      case "mediasoup.closeConsumer":
        await handleCloseConsumer(socket, message);
        break;

      case "mediasoup.produceData":
        await handleProduceData(socket, message, connectionManager);
        break;

      case "mediasoup.consumeData":
        await handleConsumeData(socket, message, connectionManager);
        break;

      case "mediasoup.startRecording":
        await handleStartRecording(socket, message);
        break;

      case "mediasoup.stopRecording":
        await handleStopRecording(socket, message);
        break;

      case "mediasoup.updateMediaState":
        await handleUpdateMediaState(socket, message, connectionManager);
        break;

      case "mediasoup.requestKeyframe":
        // Request keyframe - not implemented yet (requires RTCP PLI support)
        // await handleRequestKeyframe(socket, message);
        break;

      case "mediasoup.getRoomStats":
        await handleGetRoomStats(socket, message);
        break;

      default:
        // message is narrowed to never here, but we need the type for error
        const unknownType = (message as any).type;
        sendError(socket, unknownType, "UNKNOWN_MEDIASOUP_MESSAGE", "Unknown mediasoup message type");
    }
  } catch (error) {
    console.error(`[MediasoupHandlers] Error handling ${message.type}:`, error);
    sendError(socket, message.type, "INTERNAL_ERROR", error instanceof Error ? error.message : "Internal error");
  }
}

// ============================================================
// INDIVIDUAL HANDLERS
// ============================================================

async function handleGetRouterRtpCapabilities(
  socket: AuthenticatedSocket,
  message: GetRouterRtpCapabilitiesMessage
): Promise<void> {
  const { roomId, callId } = message.payload;

  // Verify user is participant in this call
  if (!(await isCallParticipant(callId, socket.userId))) {
    sendError(socket, message.type, "NOT_IN_CALL", "User is not a participant in this call");
    return;
  }

  let room = mediasoupService.getRoom(roomId);
  if (!room) {
    // Create room if it doesn't exist (lazy initialization)
    room = await mediasoupService.createRoom(callId, roomId);
  }

  const rtpCapabilities = mediasoupService.getRouterRtpCapabilities(roomId);

  socket.send(JSON.stringify({
    type: "mediasoup.routerRtpCapabilities",
    payload: { rtpCapabilities },
  } as RouterRtpCapabilitiesResponse));
}

async function handleCreateTransport(
  socket: AuthenticatedSocket,
  message: CreateWebRtcTransportMessage,
  connectionManager: ConnectionManager
): Promise<void> {
  const { roomId, callId, participantId, direction, producing, consuming } = message.payload;

  // Verify user owns this participant
  const participant = await getParticipantById(callId, participantId);
  if (!participant || participant.userId !== socket.userId) {
    sendError(socket, message.type, "UNAUTHORIZED", "Not authorized to create transport for this participant");
    return;
  }

  // Get or create room
  let room = mediasoupService.getRoom(roomId);
  if (!room) {
    room = await mediasoupService.createRoom(callId, roomId);
  }

  // Add participant to room if not already there
  if (!room.participants.has(participantId)) {
    mediasoupService.addParticipant(roomId, socket.userId, participantId, participant.displayName || "Unknown");
  }

  // Create WebRTC transport
  const { transport, info } = await mediasoupService.createWebRtcTransport(roomId, participantId);

  // Track transport in participant state
  const p = room.participants.get(participantId);
  if (p) {
    p.transports.set(transport.id, transport);
  }

  socket.send(JSON.stringify({
    type: "mediasoup.transportCreated",
    payload: { ...info, direction },
  } as TransportCreatedResponse));
}

async function handleConnectTransport(
  socket: AuthenticatedSocket,
  message: ConnectTransportMessage
): Promise<void> {
  const { roomId, transportId, dtlsParameters } = message.payload;

  // Verify transport belongs to this user
  if (!(await isTransportOwner(socket.userId, roomId, transportId))) {
    sendError(socket, message.type, "UNAUTHORIZED", "Not authorized to connect this transport");
    return;
  }

  await mediasoupService.connectTransport(roomId, transportId, dtlsParameters);

  socket.send(JSON.stringify({
    type: "mediasoup.transportConnected",
    payload: { transportId },
  } as TransportConnectedResponse));
}

async function handleProduce(
  socket: AuthenticatedSocket,
  message: ProduceMessage,
  connectionManager: ConnectionManager
): Promise<void> {
  const { roomId, transportId, kind, rtpParameters, rtpEncodingParameters, appData } = message.payload;

  // Verify transport belongs to this user
  if (!(await isTransportOwner(socket.userId, roomId, transportId))) {
    sendError(socket, message.type, "UNAUTHORIZED", "Not authorized to produce on this transport");
    return;
  }

  // For screen sharing, use simulcast encodings if not provided
  let encodings = rtpEncodingParameters;
  if (kind === "video" && appData?.source === "screen" && !encodings) {
    // Screen share typically uses single high-quality stream
    encodings = [
      { rid: "h", active: true, maxBitrate: 3000000, scaleResolutionDownBy: 1 },
    ];
  }

  const { producer, info } = await mediasoupService.createProducer(roomId, transportId, {
    kind,
    rtpParameters,
    rtpEncodingParameters: encodings,
    appData: { ...appData, participantId: await getParticipantIdByTransport(socket.userId, roomId, transportId) },
  });

  // Track producer in participant state
  const participantId = await getParticipantIdByTransport(socket.userId, roomId, transportId);
  const room = mediasoupService.getRoom(roomId);
  if (room && participantId) {
    const p = room.participants.get(participantId);
    if (p) {
      p.producers.set(producer.id, producer);
    }
  }

  // Send confirmation to producer
  socket.send(JSON.stringify({
    type: "mediasoup.produced",
    payload: info,
  } as ProducedResponse));

  // Notify other participants about new producer
  broadcastToRoom(roomId, {
    type: "mediasoup.newProducer",
    payload: { ...info, participantId: participantId!, userId: socket.userId },
  } as NewProducerNotification, socket.userId);
}

async function handleConsume(
  socket: AuthenticatedSocket,
  message: ConsumeMessage,
  connectionManager: ConnectionManager
): Promise<void> {
  const { roomId, transportId, producerId, rtpCapabilities, paused, preferredLayers, appData } = message.payload;

  // Verify transport belongs to this user
  if (!(await isTransportOwner(socket.userId, roomId, transportId))) {
    sendError(socket, message.type, "UNAUTHORIZED", "Not authorized to consume on this transport");
    return;
  }

  const { consumer, info } = await mediasoupService.createConsumer(roomId, transportId, {
    producerId,
    rtpCapabilities,
    paused,
    preferredLayers,
    appData: { ...appData, participantId: await getParticipantIdByTransport(socket.userId, roomId, transportId) },
  });

  // Track consumer in participant state
  const participantId = await getParticipantIdByTransport(socket.userId, roomId, transportId);
  const room = mediasoupService.getRoom(roomId);
  if (room && participantId) {
    const p = room.participants.get(participantId);
    if (p) {
      p.consumers.set(consumer.id, consumer);
    }
  }

  // Send confirmation to consumer
  socket.send(JSON.stringify({
    type: "mediasoup.consumed",
    payload: info,
  } as ConsumedResponse));

  // Notify producer's participant about new consumer (optional, for stats)
  broadcastToRoom(roomId, {
    type: "mediasoup.newConsumer",
    payload: { ...info, participantId: participantId!, userId: socket.userId },
  } as NewConsumerNotification, socket.userId);
}

async function handleResumeConsumer(
  socket: AuthenticatedSocket,
  message: ResumeConsumerMessage
): Promise<void> {
  const { roomId, consumerId } = message.payload;

  if (!(await isConsumerOwner(socket.userId, roomId, consumerId))) {
    sendError(socket, message.type, "UNAUTHORIZED", "Not authorized to resume this consumer");
    return;
  }

  await mediasoupService.resumeConsumer(roomId, consumerId);

  socket.send(JSON.stringify({
    type: "mediasoup.consumerResumed",
    payload: { consumerId },
  } as ConsumerResumedResponse));
}

async function handlePauseConsumer(
  socket: AuthenticatedSocket,
  message: PauseConsumerMessage
): Promise<void> {
  const { roomId, consumerId } = message.payload;

  if (!(await isConsumerOwner(socket.userId, roomId, consumerId))) {
    sendError(socket, message.type, "UNAUTHORIZED", "Not authorized to pause this consumer");
    return;
  }

  await mediasoupService.pauseConsumer(roomId, consumerId);

  socket.send(JSON.stringify({
    type: "mediasoup.consumerPaused",
    payload: { consumerId },
  } as ConsumerPausedResponse));
}

async function handleSetConsumerPreferredLayers(
  socket: AuthenticatedSocket,
  message: SetConsumerPreferredLayersMessage
): Promise<void> {
  const { roomId, consumerId, spatialLayer, temporalLayer } = message.payload;

  if (!(await isConsumerOwner(socket.userId, roomId, consumerId))) {
    sendError(socket, message.type, "UNAUTHORIZED", "Not authorized to set layers for this consumer");
    return;
  }

  await mediasoupService.setConsumerPreferredLayers(roomId, consumerId, { spatialLayer, temporalLayer });

  socket.send(JSON.stringify({
    type: "mediasoup.consumerLayersChanged",
    payload: { consumerId, spatialLayer, temporalLayer },
  } as ConsumerLayersChangedResponse));
}

async function handleCloseProducer(
  socket: AuthenticatedSocket,
  message: CloseProducerMessage,
  connectionManager: ConnectionManager
): Promise<void> {
  const { roomId, producerId } = message.payload;

  if (!(await isProducerOwner(socket.userId, roomId, producerId))) {
    sendError(socket, message.type, "UNAUTHORIZED", "Not authorized to close this producer");
    return;
  }

  await mediasoupService.closeProducer(roomId, producerId);

  socket.send(JSON.stringify({
    type: "mediasoup.producerClosed",
    payload: { producerId },
  } as ProducerClosedResponse));

  // Notify other participants
  broadcastToRoom(roomId, {
    type: "mediasoup.producerClosed",
    payload: { producerId, participantId: await getParticipantIdByProducer(socket.userId, roomId, producerId), reason: "closed" },
  } as ProducerClosedNotification, socket.userId);
}

async function handleCloseConsumer(
  socket: AuthenticatedSocket,
  message: CloseConsumerMessage
): Promise<void> {
  const { roomId, consumerId } = message.payload;

  if (!(await isConsumerOwner(socket.userId, roomId, consumerId))) {
    sendError(socket, message.type, "UNAUTHORIZED", "Not authorized to close this consumer");
    return;
  }

  await mediasoupService.closeConsumer(roomId, consumerId);

  socket.send(JSON.stringify({
    type: "mediasoup.consumerClosed",
    payload: { consumerId },
  } as ConsumerClosedResponse));

  broadcastToRoom(roomId, {
    type: "mediasoup.consumerClosed",
    payload: { consumerId, participantId: await getParticipantIdByConsumer(socket.userId, roomId, consumerId), reason: "closed" },
  } as ConsumerClosedNotification, socket.userId);
}

async function handleProduceData(
  socket: AuthenticatedSocket,
  message: ProduceDataMessage,
  connectionManager: ConnectionManager
): Promise<void> {
  const { roomId, transportId, label, protocol, appData } = message.payload;

  if (!(await isTransportOwner(socket.userId, roomId, transportId))) {
    sendError(socket, message.type, "UNAUTHORIZED", "Not authorized to produce data on this transport");
    return;
  }

  const dataProducer = await mediasoupService.createDataProducer(roomId, transportId, {
    label,
    protocol,
    appData: { ...appData, participantId: await getParticipantIdByTransport(socket.userId, roomId, transportId) },
  });

  // Track in participant state
  const participantId = await getParticipantIdByTransport(socket.userId, roomId, transportId);
  const room = mediasoupService.getRoom(roomId);
  if (room && participantId) {
    const p = room.participants.get(participantId);
    if (p) {
      p.dataProducers.set(dataProducer.id, dataProducer);
    }
  }

  socket.send(JSON.stringify({
    type: "mediasoup.dataProducerCreated",
    payload: { dataProducerId: dataProducer.id, label, protocol },
  } as DataProducerCreatedResponse));
}

async function handleConsumeData(
  socket: AuthenticatedSocket,
  message: ConsumeDataMessage,
  connectionManager: ConnectionManager
): Promise<void> {
  const { roomId, transportId, dataProducerId, appData } = message.payload;

  if (!(await isTransportOwner(socket.userId, roomId, transportId))) {
    sendError(socket, message.type, "UNAUTHORIZED", "Not authorized to consume data on this transport");
    return;
  }

  const dataConsumer = await mediasoupService.createDataConsumer(roomId, transportId, {
    dataProducerId,
    appData: { ...appData, participantId: await getParticipantIdByTransport(socket.userId, roomId, transportId) },
  });

  // Track in participant state
  const participantId = await getParticipantIdByTransport(socket.userId, roomId, transportId);
  const room = mediasoupService.getRoom(roomId);
  if (room && participantId) {
    const p = room.participants.get(participantId);
    if (p) {
      p.dataConsumers.set(dataConsumer.id, dataConsumer);
    }
  }

  socket.send(JSON.stringify({
    type: "mediasoup.dataConsumerCreated",
    payload: { dataConsumerId: dataConsumer.id, dataProducerId },
  } as DataConsumerCreatedResponse));
}

async function handleStartRecording(
  socket: AuthenticatedSocket,
  message: StartRecordingMessage
): Promise<void> {
  const { callId, roomId, outputPath, videoCodec, audioCodec } = message.payload;

  // Verify user is call creator or admin
  const call = await getCallById(callId);
  if (!call || call.createdBy !== socket.userId) {
    sendError(socket, message.type, "UNAUTHORIZED", "Only call creator can start recording");
    return;
  }

  const recording = await mediasoupService.startRecording(callId, roomId, {
    outputPath,
    videoCodec,
    audioCodec,
  });

  socket.send(JSON.stringify({
    type: "mediasoup.recordingStarted",
    payload: {
      recordingId: recording.recordingId,
      callId: recording.callId,
      roomId: recording.roomId,
      startedAt: recording.startedAt.toISOString(),
      outputPath: recording.outputPath || "",
    },
  } as RecordingStartedResponse));

  // Notify all participants
  broadcastToRoom(roomId, {
    type: "call.recordingStarted",
    payload: { recordingId: recording.recordingId, callId: recording.callId },
  } as any);
}

async function handleStopRecording(
  socket: AuthenticatedSocket,
  message: StopRecordingMessage
): Promise<void> {
  const { recordingId } = message.payload;

  // Verify user is call creator
  const room = findRoomByRecordingId(recordingId);
  if (!room) {
    sendError(socket, message.type, "NOT_FOUND", "Recording not found");
    return;
  }

  const call = await getCallById(room.callId);
  if (!call || call.createdBy !== socket.userId) {
    sendError(socket, message.type, "UNAUTHORIZED", "Only call creator can stop recording");
    return;
  }

  const recording = await mediasoupService.stopRecording(recordingId);

  if (recording) {
    socket.send(JSON.stringify({
      type: "mediasoup.recordingStopped",
      payload: { recordingId: recording.recordingId, status: recording.status },
    } as RecordingStoppedResponse));

    broadcastToRoom(room.roomId, {
      type: "call.recordingStopped",
      payload: { recordingId: recording.recordingId, callId: recording.callId },
    } as any);
  }
}

async function handleUpdateMediaState(
  socket: AuthenticatedSocket,
  message: UpdateMediaStateMessage,
  connectionManager: ConnectionManager
): Promise<void> {
  const { roomId, participantId, isMuted, isVideoOff, isScreenSharing } = message.payload;

  // Verify user owns this participant
  const participant = await getParticipantById(
    (await getCallIdByRoomId(roomId)) || "",
    participantId
  );
  if (!participant || participant.userId !== socket.userId) {
    sendError(socket, message.type, "UNAUTHORIZED", "Not authorized to update this participant's media state");
    return;
  }

  mediasoupService.updateParticipantMediaState(roomId, participantId, {
    isMuted,
    isVideoOff,
    isScreenSharing,
  });

  socket.send(JSON.stringify({
    type: "mediasoup.mediaStateUpdated",
    payload: { participantId, isMuted, isVideoOff, isScreenSharing },
  } as MediaStateUpdatedResponse));

  // Broadcast to other participants
  broadcastToRoom(roomId, {
    type: "mediasoup.participantMediaState",
    payload: { participantId, userId: socket.userId, isMuted: isMuted ?? false, isVideoOff: isVideoOff ?? false, isScreenSharing: isScreenSharing ?? false },
  } as ParticipantMediaStateNotification, socket.userId);
}

async function handleGetRoomStats(
  socket: AuthenticatedSocket,
  message: GetRoomStatsMessage
): Promise<void> {
  const { roomId } = message.payload;

  // Verify user is participant in this room
  const callId = await getCallIdByRoomId(roomId);
  if (!callId || !(await isCallParticipant(callId, socket.userId))) {
    sendError(socket, message.type, "NOT_IN_CALL", "User is not a participant in this call");
    return;
  }

  const stats = await mediasoupService.getRoomStats(roomId);

  socket.send(JSON.stringify({
    type: "mediasoup.roomStats",
    payload: stats,
  } as RoomStatsResponse));
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function sendError(socket: AuthenticatedSocket, requestType: string, code: string, message: string): void {
  socket.send(JSON.stringify({
    type: "error",
    payload: { code, message, requestType },
  } as ErrorResponse));
}

function broadcastToRoom(roomId: string, message: ServerResponse, excludeUserId?: string): void {
  const room = mediasoupService.getRoom(roomId);
  if (!room) return;

  const messageStr = JSON.stringify(message);

  for (const [participantId, participant] of Array.from(room.participants.entries())) {
    if (excludeUserId && participant.userId === excludeUserId) continue;

    // Find socket for this participant and send
    // This would need connectionManager to have a method to send to user
    // For now, we'll emit an event that the connection manager can listen to
  }
}

// Database helper functions
async function isCallParticipant(callId: string, userId: string): Promise<boolean> {
  const result = await db
    .select({ id: schema.callParticipants.id })
    .from(schema.callParticipants)
    .where(and(
      eq(schema.callParticipants.callId, callId),
      eq(schema.callParticipants.userId, userId),
      isNull(schema.callParticipants.leftAt)
    ))
    .limit(1);
  return result.length > 0;
}

async function getParticipantById(callId: string, participantId: string): Promise<any> {
  const result = await db
    .select()
    .from(schema.callParticipants)
    .where(and(
      eq(schema.callParticipants.callId, callId),
      eq(schema.callParticipants.id, participantId)
    ))
    .limit(1);
  return result[0] || null;
}

async function getCallById(callId: string): Promise<any> {
  const result = await db
    .select()
    .from(schema.calls)
    .where(eq(schema.calls.id, callId))
    .limit(1);
  return result[0] || null;
}

async function getCallIdByRoomId(roomId: string): Promise<string | null> {
  const room = mediasoupService.getRoom(roomId);
  return room?.callId || null;
}

async function isTransportOwner(userId: string, roomId: string, transportId: string): Promise<boolean> {
  const room = mediasoupService.getRoom(roomId);
  if (!room) return false;

  for (const participant of Array.from(room.participants.values())) {
    if (participant.userId === userId && participant.transports.has(transportId)) {
      return true;
    }
  }
  return false;
}

async function getParticipantIdByTransport(userId: string, roomId: string, transportId: string): Promise<string | null> {
  const room = mediasoupService.getRoom(roomId);
  if (!room) return null;

  for (const [participantId, participant] of Array.from(room.participants.entries())) {
    if (participant.userId === userId && participant.transports.has(transportId)) {
      return participantId;
    }
  }
  return null;
}

async function isProducerOwner(userId: string, roomId: string, producerId: string): Promise<boolean> {
  const room = mediasoupService.getRoom(roomId);
  if (!room) return false;

  for (const participant of Array.from(room.participants.values())) {
    if (participant.userId === userId && participant.producers.has(producerId)) {
      return true;
    }
  }
  return false;
}

async function getParticipantIdByProducer(userId: string, roomId: string, producerId: string): Promise<string | null> {
  const room = mediasoupService.getRoom(roomId);
  if (!room) return null;

  for (const [participantId, participant] of Array.from(room.participants.entries())) {
    if (participant.userId === userId && participant.producers.has(producerId)) {
      return participantId;
    }
  }
  return null;
}

async function isConsumerOwner(userId: string, roomId: string, consumerId: string): Promise<boolean> {
  const room = mediasoupService.getRoom(roomId);
  if (!room) return false;

  for (const participant of Array.from(room.participants.values())) {
    if (participant.userId === userId && participant.consumers.has(consumerId)) {
      return true;
    }
  }
  return false;
}

async function getParticipantIdByConsumer(userId: string, roomId: string, consumerId: string): Promise<string | null> {
  const room = mediasoupService.getRoom(roomId);
  if (!room) return null;

  for (const [participantId, participant] of Array.from(room.participants.entries())) {
    if (participant.userId === userId && participant.consumers.has(consumerId)) {
      return participantId;
    }
  }
  return null;
}

function findRoomByRecordingId(recordingId: string): RoomState | undefined {
  for (const room of Array.from(mediasoupService.getAllRooms())) {
    if (room.recording?.recordingId === recordingId) {
      return room;
    }
  }
  return undefined;
}

// ============================================================
// EVENT LISTENERS (for broadcasting)
// ============================================================

/**
 * Set up event listeners on mediasoupService to broadcast to WebSocket clients
 * Call this once during WebSocket server initialization
 */
export function setupMediasoupEventListeners(connectionManager: ConnectionManager): void {
  mediasoupService.on("producerCreated", ({ roomId, producerId, info }) => {
    // The producerCreated handler already sends notification
    // This is for any additional listeners
  });

  mediasoupService.on("producerClosed", ({ roomId, producerId, reason }) => {
    // Broadcast to room
    const room = mediasoupService.getRoom(roomId);
    if (!room) return;

    for (const participant of Array.from(room.participants.values())) {
      connectionManager.broadcastToUser(participant.userId, {
        type: "mediasoup.producerClosed",
        payload: { producerId, reason },
      });
    }
  });

  mediasoupService.on("consumerClosed", ({ roomId, consumerId, reason }) => {
    const room = mediasoupService.getRoom(roomId);
    if (!room) return;

    for (const participant of Array.from(room.participants.values())) {
      connectionManager.broadcastToUser(participant.userId, {
        type: "mediasoup.consumerClosed",
        payload: { consumerId, reason },
      });
    }
  });

  mediasoupService.on("participantJoined", ({ roomId, participant }) => {
    const room = mediasoupService.getRoom(roomId);
    if (!room) return;

    for (const p of Array.from(room.participants.values())) {
      if (p.participantId !== participant.participantId) {
        connectionManager.broadcastToUser(p.userId, {
          type: "mediasoup.participantJoined",
          payload: {
            participantId: participant.participantId,
            userId: participant.userId,
            displayName: participant.displayName,
          },
        });
      }
    }
  });

  mediasoupService.on("participantLeft", ({ roomId, participantId }) => {
    const room = mediasoupService.getRoom(roomId);
    if (!room) return;

    for (const participant of Array.from(room.participants.values())) {
      connectionManager.broadcastToUser(participant.userId, {
        type: "mediasoup.participantLeft",
        payload: { participantId },
      });
    }
  });

  mediasoupService.on("roomDeleted", ({ roomId, callId }) => {
    const room = mediasoupService.getRoom(roomId);
    if (!room) return;

    for (const participant of Array.from(room.participants.values())) {
      connectionManager.broadcastToUser(participant.userId, {
        type: "call.ended",
        payload: { callId, reason: "room_deleted" },
      });
    }
  });
}