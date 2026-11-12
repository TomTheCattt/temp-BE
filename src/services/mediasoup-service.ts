/**
 * mediasoup Service - Worker, Router, Transport Management
 *
 * Implements: BE-138 (mediasoup Worker/Router setup), BE-139 (WebRTC transport),
 * BE-140 (Producer/Consumer management), BE-141 (Simulcast/SVC support),
 * BE-142 (Data channels), BE-143 (Recording), BE-144 (Multi-party mesh)
 *
 * This service manages the mediasoup Worker, creates Routers per call room,
 * and handles WebRTC transports for producing/consuming media.
 */

import * as mediasoup from "mediasoup";
import { EventEmitter } from "events";
import { db } from "../db/client";
import { eq, and, isNull } from "drizzle-orm";
import * as schema from "../db/schema";
import { randomUUID } from "crypto";

// mediasoup AppData type
type AppData = { [key: string]: unknown };

// Type aliases for mediasoup types
type Worker<AppDataT extends AppData = AppData> = mediasoup.types.Worker<AppDataT>;
type Router<AppDataT extends AppData = AppData> = mediasoup.types.Router<AppDataT>;
type WebRtcTransport<AppDataT extends AppData = AppData> = mediasoup.types.WebRtcTransport<AppDataT>;
type Producer<AppDataT extends AppData = AppData> = mediasoup.types.Producer<AppDataT>;
type Consumer<AppDataT extends AppData = AppData> = mediasoup.types.Consumer<AppDataT>;
type DataProducer<AppDataT extends AppData = AppData> = mediasoup.types.DataProducer<AppDataT>;
type DataConsumer<AppDataT extends AppData = AppData> = mediasoup.types.DataConsumer<AppDataT>;
type RtpCapabilities = mediasoup.types.RtpCapabilities;
type WorkerSettings = mediasoup.types.WorkerSettings<AppData>;
type RouterOptions = mediasoup.types.RouterOptions<AppData>;
type WebRtcTransportOptions = mediasoup.types.WebRtcTransportOptions<{ participantId: string; roomId: string }>;
type ProducerOptions = mediasoup.types.ProducerOptions<{ type: "simple" | "simulcast" | "svc" }>;
type ConsumerOptions = mediasoup.types.ConsumerOptions;
type DataProducerOptions = mediasoup.types.DataProducerOptions;
type DataConsumerOptions = mediasoup.types.DataConsumerOptions;
type TransportListenInfo = mediasoup.types.TransportListenInfo;
type TransportProtocol = mediasoup.types.TransportProtocol;
type IceParameters = mediasoup.types.IceParameters;
type IceCandidate = mediasoup.types.IceCandidate;
type DtlsParameters = mediasoup.types.DtlsParameters;
type RouterRtpCodecCapability = mediasoup.types.RouterRtpCodecCapability;
type RtpEncodingParameters = mediasoup.types.RtpEncodingParameters;
type RtpParameters = mediasoup.types.RtpParameters;
type ConsumerType = mediasoup.types.ConsumerType;
type RouterDump = mediasoup.types.RouterDump;

// ============================================================
// TYPES & INTERFACES
// ============================================================

/**
 * Media codecs supported by the router
 */
export const MEDIA_CODECS: RouterRtpCodecCapability[] = [
  // Video codecs
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {},
  },
  {
    kind: "video",
    mimeType: "video/VP9",
    clockRate: 90000,
    parameters: {
      "profile-id": 2,
    },
  },
  {
    kind: "video",
    mimeType: "video/H264",
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "42e01f",
      "level-asymmetry-allowed": 1,
    },
  },
  {
    kind: "video",
    mimeType: "video/H264",
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "42001f",
      "level-asymmetry-allowed": 1,
    },
  },
  // Audio codecs
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
    parameters: {
      useinbandfec: 1,
    },
  },
  {
    kind: "audio",
    mimeType: "audio/PCMU",
    clockRate: 8000,
    channels: 1,
    parameters: {},
  },
  {
    kind: "audio",
    mimeType: "audio/PCMA",
    clockRate: 8000,
    channels: 1,
    parameters: {},
  },
];

/**
 * Simulcast encoding layers for adaptive bitrate
 * Note: These are passed in RtpParameters.encodings when producing
 */
export const SIMULCAST_ENCODINGS: RtpEncodingParameters[] = [
  { rid: "h", maxBitrate: 1500000 },   // High: 1080p/720p
  { rid: "m", maxBitrate: 600000 },    // Medium: 480p
  { rid: "l", maxBitrate: 150000 },    // Low: 240p
];

/**
 * SVC (Scalable Video Coding) layers for VP9/AV1
 */
export const SVC_LAYERS = {
  spatialLayers: 3,
  temporalLayers: 3,
};

/**
 * Transport info returned to clients
 */
export interface TransportInfo {
  id: string;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: DtlsParameters;
  sctpParameters?: mediasoup.types.SctpParameters;
}

/**
 * Producer info returned to clients
 */
export interface ProducerInfo {
  id: string;
  kind: "audio" | "video";
  rtpParameters: RtpParameters;
  type: "simple" | "simulcast" | "svc";
  appData: any;
}

/**
 * Consumer info returned to clients
 */
export interface ConsumerInfo {
  id: string;
  producerId: string;
  kind: "audio" | "video";
  rtpParameters: RtpParameters;
  type: "simple" | "simulcast" | "svc";
  producerPaused: boolean;
  appData: any;
}

/**
 * Room (call) state
 */
export interface RoomState {
  roomId: string;
  callId: string;
  router: Router;
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
  dataProducers: Map<string, DataProducer>;
  dataConsumers: Map<string, DataConsumer>;
  participants: Map<string, ParticipantState>;
  createdAt: Date;
  recording?: RecordingState;
}

/**
 * Participant state in a room
 */
export interface ParticipantState {
  userId: string;
  participantId: string;
  displayName: string;
  transports: Map<string, WebRtcTransport>; // send/recv transports
  producers: Map<string, Producer>; // audio, video, screen
  consumers: Map<string, Consumer>;
  dataProducers: Map<string, DataProducer>;
  dataConsumers: Map<string, DataConsumer>;
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  joinedAt: Date;
}

/**
 * Recording state
 */
export interface RecordingState {
  recordingId: string;
  callId: string;
  roomId: string;
  startedAt: Date;
  status: "recording" | "stopping" | "stopped" | "failed";
  outputPath?: string;
  error?: string;
}

// ============================================================
// MEDIASOUP SERVICE CLASS
// ============================================================

export class MediasoupService extends EventEmitter {
  private worker: Worker | null = null;
  private rooms: Map<string, RoomState> = new Map();
  private readonly workerOptions: WorkerSettings;
  private readonly routerOptions: RouterOptions;
  private readonly webRtcTransportListenIps: TransportListenInfo[];

  constructor() {
    super();

    // Worker configuration - optimized for Neon Functions
    this.workerOptions = {
      logLevel: (process.env.MEDIASOUP_LOG_LEVEL as mediasoup.types.WorkerLogLevel) || "warn",
      logTags: [
        "info",
        "ice",
        "dtls",
        "rtp",
        "srtp",
        "rtcp",
        "rtx",
        "bwe",
        "score",
        "simulcast",
        "svc",
        "sctp",
      ] as mediasoup.types.WorkerLogTag[],
      rtcMinPort: Number(process.env.MEDIASOUP_RTC_MIN_PORT) || 10000,
      rtcMaxPort: Number(process.env.MEDIASOUP_RTC_MAX_PORT) || 20000,
      dtlsCertificateFile: process.env.MEDIASOUP_DTLS_CERT_FILE || undefined,
      dtlsPrivateKeyFile: process.env.MEDIASOUP_DTLS_KEY_FILE || undefined,
    };

    // Router configuration with media codecs
    this.routerOptions = {
      mediaCodecs: MEDIA_CODECS,
    };

    // WebRTC transport listen IPs
    this.webRtcTransportListenIps = [
      {
        protocol: "udp",
        ip: process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0",
        announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || undefined,
        portRange: {
          min: Number(process.env.MEDIASOUP_RTC_MIN_PORT) || 10000,
          max: Number(process.env.MEDIASOUP_RTC_MAX_PORT) || 20000,
        },
      },
      {
        protocol: "tcp",
        ip: process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0",
        announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || undefined,
        portRange: {
          min: Number(process.env.MEDIASOUP_RTC_MIN_PORT) || 10000,
          max: Number(process.env.MEDIASOUP_RTC_MAX_PORT) || 20000,
        },
      },
    ];
  }

  /**
   * Initialize mediasoup Worker
   */
  async initialize(): Promise<void> {
    if (this.worker) {
      console.log("[MediasoupService] Worker already initialized");
      return;
    }

    try {
      this.worker = await mediasoup.createWorker(this.workerOptions);

      this.worker.on("died", (error: Error) => {
        console.error("[MediasoupService] Worker died:", error);
        process.exit(1);
      });

      console.log(`[MediasoupService] Worker initialized (pid: ${this.worker.pid})`);

      // Log worker resource usage periodically
      setInterval(() => this.logWorkerStats(), 30000);
    } catch (error) {
      console.error("[MediasoupService] Failed to create worker:", error);
      throw error;
    }
  }

  /**
   * Get worker stats for monitoring
   */
  private async logWorkerStats(): Promise<void> {
    if (!this.worker) return;

    try {
      const resourceUsage = await this.worker.getResourceUsage();
      console.log("[MediasoupService] Worker stats:", {
        pid: this.worker.pid,
        cpu: resourceUsage.ru_utime + resourceUsage.ru_stime,
        memory: resourceUsage.ru_maxrss,
        rooms: this.rooms.size,
      });
    } catch (error) {
      console.error("[MediasoupService] Failed to get worker stats:", error);
    }
  }

  /**
   * Create a new room (call) with a dedicated router
   */
  async createRoom(callId: string, roomId: string): Promise<RoomState> {
    if (!this.worker) {
      await this.initialize();
    }

    if (this.rooms.has(roomId)) {
      throw new Error(`Room ${roomId} already exists`);
    }

    try {
      const router = await this.worker!.createRouter(this.routerOptions);

      const roomState: RoomState = {
        roomId,
        callId,
        router,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
        dataProducers: new Map(),
        dataConsumers: new Map(),
        participants: new Map(),
        createdAt: new Date(),
      };

      this.rooms.set(roomId, roomState);

      // Update database with media server info
      await this.updateCallMediaServer(callId, roomId, router.id);

      console.log(`[MediasoupService] Room created: ${roomId} (call: ${callId}, router: ${router.id})`);

      this.emit("roomCreated", roomState);

      return roomState;
    } catch (error) {
      console.error(`[MediasoupService] Failed to create room ${roomId}:`, error);
      throw error;
    }
  }

  /**
   * Get room by ID
   */
  getRoom(roomId: string): RoomState | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * Delete a room and clean up all resources
   */
  async deleteRoom(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) {
      console.warn(`[MediasoupService] Room ${roomId} not found for deletion`);
      return;
    }

    try {
      // Close all transports
      for (const transport of Array.from(room.transports.values())) {
        transport.close();
      }

      // Close all producers
      for (const producer of Array.from(room.producers.values())) {
        producer.close();
      }

      // Close all consumers
      for (const consumer of Array.from(room.consumers.values())) {
        consumer.close();
      }

      // Close all data producers/consumers
      for (const dp of Array.from(room.dataProducers.values())) {
        dp.close();
      }
      for (const dc of Array.from(room.dataConsumers.values())) {
        dc.close();
      }

      // Close router
      room.router.close();

      // Stop recording if active
      if (room.recording) {
        await this.stopRecording(room.recording.recordingId);
      }

      this.rooms.delete(roomId);

      console.log(`[MediasoupService] Room deleted: ${roomId}`);

      this.emit("roomDeleted", { roomId, callId: room.callId });
    } catch (error) {
      console.error(`[MediasoupService] Error deleting room ${roomId}:`, error);
      throw error;
    }
  }

  /**
   * Get router RTP capabilities for client
   */
  getRouterRtpCapabilities(roomId: string): RtpCapabilities | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return room.router.rtpCapabilities;
  }

  // ============================================================
  // WEBRTC TRANSPORT MANAGEMENT
  // ============================================================

  /**
   * Create a WebRTC transport for a participant
   */
  async createWebRtcTransport(
    roomId: string,
    participantId: string,
    options?: Partial<{
      enableUdp: boolean;
      enableTcp: boolean;
      preferUdp: boolean;
      initialAvailableOutgoingBitrate: number;
    }>
  ): Promise<{ transport: WebRtcTransport; info: TransportInfo }> {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const transportOptions: WebRtcTransportOptions = {
      listenIps: this.webRtcTransportListenIps,
      enableUdp: options?.enableUdp ?? true,
      enableTcp: options?.enableTcp ?? true,
      preferUdp: options?.preferUdp ?? true,
      initialAvailableOutgoingBitrate: options?.initialAvailableOutgoingBitrate ?? 1000000,
      appData: { participantId, roomId },
    };

    const transport = await room.router.createWebRtcTransport(transportOptions);

    const transportId = transport.id;
    room.transports.set(transportId, transport);

    // Set up transport event handlers
    transport.on("@close", () => {
      console.log(`[MediasoupService] Transport ${transportId} closed`);
      room.transports.delete(transportId);
    });

    transport.on("dtlsstatechange", (dtlsState: mediasoup.types.DtlsState) => {
      if (dtlsState === "closed" || dtlsState === "failed") {
        console.log(`[MediasoupService] Transport ${transportId} DTLS state: ${dtlsState}`);
        room.transports.delete(transportId);
      }
    });

    // Prepare transport info for client
    const info: TransportInfo = {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      sctpParameters: transport.sctpParameters,
    };

    console.log(`[MediasoupService] WebRTC transport created: ${transportId} for participant ${participantId} in room ${roomId}`);

    return { transport, info };
  }

  /**
   * Connect a WebRTC transport with DTLS parameters from client
   */
  async connectTransport(
    roomId: string,
    transportId: string,
    dtlsParameters: DtlsParameters
  ): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const transport = room.transports.get(transportId);
    if (!transport) {
      throw new Error(`Transport ${transportId} not found`);
    }

    await transport.connect({ dtlsParameters });
    console.log(`[MediasoupService] Transport ${transportId} connected`);
  }

  /**
   * Get transport info by ID
   */
  getTransport(roomId: string, transportId: string): WebRtcTransport | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    return room.transports.get(transportId);
  }

  // ============================================================
  // PRODUCER MANAGEMENT (audio, video, screen)
  // ============================================================

  /**
   * Create a producer (publish media)
   */
  async createProducer(
    roomId: string,
    transportId: string,
    options: {
      kind: "audio" | "video";
      rtpParameters: RtpParameters;
      rtpEncodingParameters?: RtpEncodingParameters[];
      appData?: any;
    }
  ): Promise<{ producer: Producer; info: ProducerInfo }> {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const transport = room.transports.get(transportId);
    if (!transport) {
      throw new Error(`Transport ${transportId} not found`);
    }

    // Determine producer type based on encodings
    let type: "simple" | "simulcast" | "svc" = "simple";
    if (options.kind === "video" && options.rtpEncodingParameters) {
      if (options.rtpEncodingParameters.length > 1) {
        // Check for SVC (scalabilityMode)
        const hasSvc = options.rtpEncodingParameters.some((enc: any) => enc.scalabilityMode);
        type = hasSvc ? "svc" : "simulcast";
      }
    }

    // Create rtpParameters with encodings
    const rtpParameters: RtpParameters = {
      ...options.rtpParameters,
      encodings: options.rtpEncodingParameters,
    };

    const producer = await transport.produce({
      kind: options.kind,
      rtpParameters,
      appData: { ...options.appData, type },
    });

    const producerId = producer.id;
    room.producers.set(producerId, producer);

    // Set up producer event handlers
    producer.on("@close", () => {
      console.log(`[MediasoupService] Producer ${producerId} closed`);
      room.producers.delete(producerId);
    });

    producer.on("transportclose", () => {
      console.log(`[MediasoupService] Producer ${producerId} transport closed`);
      room.producers.delete(producerId);
      this.emit("producerClosed", { roomId, producerId, reason: "transportclose" });
    });

    const info: ProducerInfo = {
      id: producer.id,
      kind: producer.kind,
      rtpParameters: producer.rtpParameters,
      type,
      appData: producer.appData,
    };

    console.log(`[MediasoupService] Producer created: ${producerId} (${options.kind}, ${type}) in room ${roomId}`);

    this.emit("producerCreated", { roomId, producerId, info });

    return { producer, info };
  }

  /**
   * Close a producer
   */
  async closeProducer(roomId: string, producerId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const producer = room.producers.get(producerId);
    if (producer) {
      producer.close();
      room.producers.delete(producerId);
      console.log(`[MediasoupService] Producer ${producerId} closed in room ${roomId}`);
    }
  }

  /**
   * Pause/resume a producer
   */
  async pauseProducer(roomId: string, producerId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const producer = room.producers.get(producerId);
    if (producer) {
      await producer.pause();
      console.log(`[MediasoupService] Producer ${producerId} paused`);
    }
  }

  async resumeProducer(roomId: string, producerId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const producer = room.producers.get(producerId);
    if (producer) {
      await producer.resume();
      console.log(`[MediasoupService] Producer ${producerId} resumed`);
    }
  }

  // ============================================================
  // CONSUMER MANAGEMENT
  // ============================================================

  /**
   * Create a consumer (subscribe to media)
   */
  async createConsumer(
    roomId: string,
    transportId: string,
    options: {
      producerId: string;
      rtpCapabilities: RtpCapabilities;
      paused?: boolean;
      preferredLayers?: { spatialLayer: number; temporalLayer: number };
      appData?: any;
    }
  ): Promise<{ consumer: Consumer; info: ConsumerInfo }> {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const transport = room.transports.get(transportId);
    if (!transport) {
      throw new Error(`Transport ${transportId} not found`);
    }

    const producer = room.producers.get(options.producerId);
    if (!producer) {
      throw new Error(`Producer ${options.producerId} not found`);
    }

    const consumer = await transport.consume({
      producerId: options.producerId,
      rtpCapabilities: options.rtpCapabilities,
      paused: options.paused ?? false,
      preferredLayers: options.preferredLayers,
      appData: options.appData,
    });

    const consumerId = consumer.id;
    room.consumers.set(consumerId, consumer);

    // Set up consumer event handlers
    consumer.on("@close", () => {
      console.log(`[MediasoupService] Consumer ${consumerId} closed`);
      room.consumers.delete(consumerId);
    });

    consumer.on("transportclose", () => {
      console.log(`[MediasoupService] Consumer ${consumerId} transport closed`);
      room.consumers.delete(consumerId);
    });

    consumer.on("producerclose", () => {
      console.log(`[MediasoupService] Consumer ${consumerId} producer closed`);
      consumer.close();
      room.consumers.delete(consumerId);
      this.emit("consumerClosed", { roomId, consumerId, reason: "producerclose" });
    });

    // Map ConsumerType to our type
    const consumerType = consumer.type as "simple" | "simulcast" | "svc";

    const info: ConsumerInfo = {
      id: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumerType,
      producerPaused: consumer.producerPaused,
      appData: consumer.appData,
    };

    console.log(`[MediasoupService] Consumer created: ${consumerId} for producer ${options.producerId} in room ${roomId}`);

    this.emit("consumerCreated", { roomId, consumerId, info });

    return { consumer, info };
  }

  /**
   * Close a consumer
   */
  async closeConsumer(roomId: string, consumerId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const consumer = room.consumers.get(consumerId);
    if (consumer) {
      consumer.close();
      room.consumers.delete(consumerId);
      console.log(`[MediasoupService] Consumer ${consumerId} closed in room ${roomId}`);
    }
  }

  /**
   * Set preferred layers for simulcast/SVC consumer
   */
  async setConsumerPreferredLayers(
    roomId: string,
    consumerId: string,
    layers: { spatialLayer: number; temporalLayer: number }
  ): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const consumer = room.consumers.get(consumerId);
    if (consumer && (consumer.type === "simulcast" || consumer.type === "svc")) {
      await consumer.setPreferredLayers(layers);
      console.log(`[MediasoupService] Consumer ${consumerId} preferred layers set:`, layers);
    }
  }

  /**
   * Pause/resume consumer
   */
  async pauseConsumer(roomId: string, consumerId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const consumer = room.consumers.get(consumerId);
    if (consumer) {
      await consumer.pause();
    }
  }

  async resumeConsumer(roomId: string, consumerId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const consumer = room.consumers.get(consumerId);
    if (consumer) {
      await consumer.resume();
    }
  }

  // ============================================================
  // DATA CHANNELS (for signaling fallback)
  // ============================================================

  /**
   * Create a data producer (for data channels)
   */
  async createDataProducer(
    roomId: string,
    transportId: string,
    options: {
      label: string;
      protocol?: string;
      appData?: any;
    }
  ): Promise<DataProducer> {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const transport = room.transports.get(transportId);
    if (!transport) {
      throw new Error(`Transport ${transportId} not found`);
    }

    const dataProducer = await transport.produceData({
      label: options.label,
      protocol: options.protocol,
      appData: options.appData,
    });

    const dataProducerId = dataProducer.id;
    room.dataProducers.set(dataProducerId, dataProducer);

    dataProducer.on("@close", () => {
      room.dataProducers.delete(dataProducerId);
    });

    dataProducer.on("transportclose", () => {
      room.dataProducers.delete(dataProducerId);
    });

    console.log(`[MediasoupService] Data producer created: ${dataProducerId} (label: ${options.label}) in room ${roomId}`);

    return dataProducer;
  }

  /**
   * Create a data consumer (subscribe to data channel)
   */
  async createDataConsumer(
    roomId: string,
    transportId: string,
    options: {
      dataProducerId: string;
      appData?: any;
    }
  ): Promise<DataConsumer> {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const transport = room.transports.get(transportId);
    if (!transport) {
      throw new Error(`Transport ${transportId} not found`);
    }

    const dataProducer = room.dataProducers.get(options.dataProducerId);
    if (!dataProducer) {
      throw new Error(`Data producer ${options.dataProducerId} not found`);
    }

    const dataConsumer = await transport.consumeData({
      dataProducerId: options.dataProducerId,
      appData: options.appData,
    });

    const dataConsumerId = dataConsumer.id;
    room.dataConsumers.set(dataConsumerId, dataConsumer);

    dataConsumer.on("@close", () => {
      room.dataConsumers.delete(dataConsumerId);
    });

    dataConsumer.on("transportclose", () => {
      room.dataConsumers.delete(dataConsumerId);
    });

    dataConsumer.on("dataproducerclose", () => {
      dataConsumer.close();
      room.dataConsumers.delete(dataConsumerId);
    });

    console.log(`[MediasoupService] Data consumer created: ${dataConsumerId} for data producer ${options.dataProducerId} in room ${roomId}`);

    return dataConsumer;
  }

  // ============================================================
  // ROOM PARTICIPANT MANAGEMENT
  // ============================================================

  /**
   * Add participant to room
   */
  addParticipant(
    roomId: string,
    userId: string,
    participantId: string,
    displayName: string
  ): ParticipantState {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const participant: ParticipantState = {
      userId,
      participantId,
      displayName,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
      dataProducers: new Map(),
      dataConsumers: new Map(),
      isMuted: false,
      isVideoOff: false,
      isScreenSharing: false,
      joinedAt: new Date(),
    };

    room.participants.set(participantId, participant);

    console.log(`[MediasoupService] Participant ${participantId} (${userId}) joined room ${roomId}`);

    this.emit("participantJoined", { roomId, participant });

    return participant;
  }

  /**
   * Remove participant from room
   */
  removeParticipant(roomId: string, participantId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const participant = room.participants.get(participantId);
    if (!participant) return;

    // Close all participant transports
    for (const transport of Array.from(participant.transports.values())) {
      transport.close();
    }

    // Close all participant producers
    for (const producer of Array.from(participant.producers.values())) {
      producer.close();
    }

    // Close all participant consumers
    for (const consumer of Array.from(participant.consumers.values())) {
      consumer.close();
    }

    // Close data producers/consumers
    for (const dp of Array.from(participant.dataProducers.values())) {
      dp.close();
    }
    for (const dc of Array.from(participant.dataConsumers.values())) {
      dc.close();
    }

    room.participants.delete(participantId);

    console.log(`[MediasoupService] Participant ${participantId} left room ${roomId}`);

    this.emit("participantLeft", { roomId, participantId });
  }

  /**
   * Get participant by ID
   */
  getParticipant(roomId: string, participantId: string): ParticipantState | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    return room.participants.get(participantId);
  }

  /**
   * Get all participants in room
   */
  getParticipants(roomId: string): ParticipantState[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return Array.from(room.participants.values());
  }

  /**
   * Update participant media state
   */
  updateParticipantMediaState(
    roomId: string,
    participantId: string,
    state: Partial<Pick<ParticipantState, "isMuted" | "isVideoOff" | "isScreenSharing">>
  ): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const participant = room.participants.get(participantId);
    if (!participant) return;

    Object.assign(participant, state);
    this.emit("participantMediaStateChanged", { roomId, participantId, state });
  }

  // ============================================================
  // RECORDING (mediasoup recorder integration)
  // ============================================================

  /**
   * Start recording a room
   */
  async startRecording(
    callId: string,
    roomId: string,
    options: {
      outputPath: string;
      videoCodec?: string;
      audioCodec?: string;
    }
  ): Promise<RecordingState> {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    if (room.recording) {
      throw new Error(`Recording already in progress for room ${roomId}`);
    }

    try {
      // In a real implementation, you would use mediasoup-recorder or ffmpeg
      // For now, we'll set up the recording state
      const recordingId = randomUUID();
      const recordingState: RecordingState = {
        recordingId,
        callId,
        roomId,
        startedAt: new Date(),
        status: "recording",
        outputPath: options.outputPath,
      };

      room.recording = recordingState;

      // Update database
      await db
        .update(schema.calls)
        .set({
          isRecording: true,
          recordingUrl: options.outputPath,
        })
        .where(eq(schema.calls.id, callId));

      console.log(`[MediasoupService] Recording started: ${recordingId} for room ${roomId}`);

      this.emit("recordingStarted", recordingState);

      return recordingState;
    } catch (error) {
      console.error(`[MediasoupService] Failed to start recording for room ${roomId}:`, error);
      throw error;
    }
  }

  /**
   * Stop recording
   */
  async stopRecording(recordingId: string): Promise<RecordingState | null> {
    // Find room with this recording
    let targetRoom: RoomState | undefined;
    for (const room of Array.from(this.rooms.values())) {
      if (room.recording?.recordingId === recordingId) {
        targetRoom = room;
        break;
      }
    }

    if (!targetRoom || !targetRoom.recording) {
      console.warn(`[MediasoupService] Recording ${recordingId} not found`);
      return null;
    }

    try {
      targetRoom.recording.status = "stopping";

      // In real implementation, stop ffmpeg/mediasoup-recorder here

      targetRoom.recording.status = "stopped";

      // Update database
      await db
        .update(schema.calls)
        .set({
          isRecording: false,
        })
        .where(eq(schema.calls.id, targetRoom.callId));

      console.log(`[MediasoupService] Recording stopped: ${recordingId} for room ${targetRoom.roomId}`);

      const recordingState = targetRoom.recording;
      targetRoom.recording = undefined;

      this.emit("recordingStopped", recordingState);

      return recordingState;
    } catch (error) {
      console.error(`[MediasoupService] Failed to stop recording ${recordingId}:`, error);
      if (targetRoom.recording) {
        targetRoom.recording.status = "failed";
        targetRoom.recording.error = error instanceof Error ? error.message : "Unknown error";
      }
      throw error;
    }
  }

  // ============================================================
  // STATS & MONITORING
  // ============================================================

  /**
   * Get producer stats
   */
  async getProducerStats(roomId: string, producerId: string): Promise<any> {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const producer = room.producers.get(producerId);
    if (!producer) return null;

    return producer.getStats();
  }

  /**
   * Get consumer stats
   */
  async getConsumerStats(roomId: string, consumerId: string): Promise<any> {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const consumer = room.consumers.get(consumerId);
    if (!consumer) return null;

    return consumer.getStats();
  }

  /**
   * Get room stats
   */
  async getRoomStats(roomId: string): Promise<any> {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const routerStats = await room.router.dump();

    return {
      roomId: room.roomId,
      callId: room.callId,
      router: routerStats,
      participants: room.participants.size,
      transports: room.transports.size,
      producers: room.producers.size,
      consumers: room.consumers.size,
      dataProducers: room.dataProducers.size,
      dataConsumers: room.dataConsumers.size,
      recording: room.recording ? {
        recordingId: room.recording.recordingId,
        status: room.recording.status,
        startedAt: room.recording.startedAt,
      } : null,
    };
  }

  // ============================================================
  // DATABASE HELPERS
  // ============================================================

  /**
   * Update call with media server info
   */
  private async updateCallMediaServer(callId: string, roomId: string, routerId: string): Promise<void> {
    try {
      await db
        .update(schema.calls)
        .set({
          mediaServerId: routerId,
          roomId,
        })
        .where(eq(schema.calls.id, callId));
    } catch (error) {
      console.error(`[MediasoupService] Failed to update call ${callId} media server info:`, error);
    }
  }

  /**
   * Get active room count
   */
  getActiveRoomCount(): number {
    return this.rooms.size;
  }

  /**
   * Get all active rooms
   */
  getAllRooms(): RoomState[] {
    return Array.from(this.rooms.values());
  }

  /**
   * Shutdown service and cleanup all resources
   */
  async shutdown(): Promise<void> {
    console.log("[MediasoupService] Shutting down...");

    // Close all rooms
    for (const roomId of Array.from(this.rooms.keys())) {
      await this.deleteRoom(roomId);
    }

    // Close worker
    if (this.worker) {
      this.worker.close();
      this.worker = null;
    }

    console.log("[MediasoupService] Shutdown complete");
  }
}

// Singleton instance
export const mediasoupService = new MediasoupService();