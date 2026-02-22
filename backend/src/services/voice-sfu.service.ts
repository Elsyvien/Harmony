import mediasoup, { type types as mediasoupTypes } from 'mediasoup';
import { EventEmitter } from 'node:events';
import { AppError } from '../utils/app-error.js';

// ─── Mediasoup Type Aliases ──────────────────────────────────────────

type Consumer = mediasoupTypes.Consumer;
type DtlsParameters = mediasoupTypes.DtlsParameters;
type IceParameters = mediasoupTypes.IceParameters;
type Producer = mediasoupTypes.Producer;
type Router = mediasoupTypes.Router;
type RtpCapabilities = mediasoupTypes.RtpCapabilities;
type RtpParameters = mediasoupTypes.RtpParameters;
type WebRtcTransport = mediasoupTypes.WebRtcTransport;
type Worker = mediasoupTypes.Worker;

// ─── Public Types ────────────────────────────────────────────────────

export type VoiceSfuTransportDirection = 'send' | 'recv';

export interface VoiceSfuConfig {
  enabled: boolean;
  audioOnly: boolean;
  listenIp: string;
  announcedIp: string | null;
  minPort: number;
  maxPort: number;
  enableUdp: boolean;
  enableTcp: boolean;
  preferTcp: boolean;
  /** Max transports per peer (send + recv). Default: 4 */
  maxTransportsPerPeer?: number;
  /** Max producers per peer. Default: 4 (1 audio + 1 camera + 1 screen + 1 spare) */
  maxProducersPerPeer?: number;
  /** Number of mediasoup workers. Default: 1 */
  numWorkers?: number;
}

export interface VoiceSfuTransportOptions {
  id: string;
  iceParameters: WebRtcTransport['iceParameters'];
  iceCandidates: WebRtcTransport['iceCandidates'];
  dtlsParameters: WebRtcTransport['dtlsParameters'];
  sctpParameters: mediasoupTypes.SctpParameters | undefined;
}

export interface VoiceSfuIceRestartResult {
  iceParameters: IceParameters;
}

export interface VoiceSfuProducerInfo {
  producerId: string;
  userId: string;
  kind: Producer['kind'];
  appData: Record<string, unknown>;
}

export interface VoiceSfuConsumerOptions {
  consumerId: string;
  producerId: string;
  kind: Consumer['kind'];
  rtpParameters: Consumer['rtpParameters'];
  type: Consumer['type'];
  producerPaused: boolean;
  appData: Record<string, unknown>;
}

export interface VoiceSfuTransportStats {
  transportId: string;
  direction: string;
  iceState: string;
  dtlsState: string;
  sctpState: string | undefined;
  producerCount: number;
  consumerCount: number;
}

export type VoiceSfuEvent =
  | { type: 'producer-close'; channelId: string; userId: string; producerId: string }
  | { type: 'consumer-close'; channelId: string; userId: string; consumerId: string; producerId: string }
  | { type: 'transport-close'; channelId: string; userId: string; transportId: string; direction: string }
  | { type: 'room-close'; channelId: string }
  | { type: 'worker-died'; workerIndex: number };

// ─── Internal Types ──────────────────────────────────────────────────

interface SfuPeer {
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
}

interface SfuRoom {
  channelId: string;
  router: Router;
  workerIndex: number;
  peers: Map<string, SfuPeer>;
  createdAt: number;
}

// ─── Audio & Video Codecs ────────────────────────────────────────────

const AUDIO_CODECS: mediasoupTypes.RouterRtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
];

const VIDEO_CODECS: mediasoupTypes.RouterRtpCodecCapability[] = [
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: { 'x-google-start-bitrate': 1200 },
  },
  {
    kind: 'video',
    mimeType: 'video/H264',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1,
    },
  },
];

// ─── Service ─────────────────────────────────────────────────────────

export class VoiceSfuService extends EventEmitter {
  private readonly config: VoiceSfuConfig;
  private readonly workers: Worker[] = [];
  private readonly rooms = new Map<string, SfuRoom>();
  private nextWorkerIndex = 0;
  private initialized = false;

  // Resolved limits
  private readonly maxTransportsPerPeer: number;
  private readonly maxProducersPerPeer: number;
  private readonly numWorkers: number;

  constructor(config: VoiceSfuConfig) {
    super();
    this.config = config;
    this.maxTransportsPerPeer = config.maxTransportsPerPeer ?? 4;
    this.maxProducersPerPeer = config.maxProducersPerPeer ?? 4;
    this.numWorkers = config.numWorkers ?? 1;
  }

  // ─── Getters ─────────────────────────────────────────────────────

  get enabled(): boolean {
    return this.config.enabled;
  }

  get audioOnly(): boolean {
    return this.config.audioOnly;
  }

  getRtpCapabilities(): RtpCapabilities | null {
    if (!this.initialized || this.workers.length === 0) return null;
    // Return capabilities from first worker's router-supported codecs.
    // All workers use identical codec config so this is safe.
    return null; // Caller should use getRouterRtpCapabilities(channelId) instead
  }

  // ─── Lifecycle ───────────────────────────────────────────────────

  async init(): Promise<void> {
    if (!this.config.enabled || this.initialized) return;

    const portRange = this.config.maxPort - this.config.minPort + 1;
    const portsPerWorker = Math.floor(portRange / this.numWorkers);

    for (let i = 0; i < this.numWorkers; i++) {
      const workerMinPort = this.config.minPort + i * portsPerWorker;
      const workerMaxPort =
        i === this.numWorkers - 1
          ? this.config.maxPort
          : workerMinPort + portsPerWorker - 1;

      const worker = await mediasoup.createWorker({
        rtcMinPort: workerMinPort,
        rtcMaxPort: workerMaxPort,
        logLevel: 'warn',
      });

      worker.on('died', () => {
        this.emitEvent({ type: 'worker-died', workerIndex: i });
        // Remove dead worker reference
        const idx = this.workers.indexOf(worker);
        if (idx >= 0) this.workers.splice(idx, 1);
        // Close rooms that used this worker
        for (const [channelId, room] of this.rooms) {
          if (room.workerIndex === i) {
            this.closeRoom(channelId);
          }
        }
      });

      this.workers.push(worker);
    }

    this.initialized = true;
  }

  async close(): Promise<void> {
    for (const [channelId] of this.rooms) {
      this.closeRoom(channelId);
    }
    for (const worker of this.workers) {
      await worker.close();
    }
    this.workers.length = 0;
    this.initialized = false;
  }

  // ─── Room Management ─────────────────────────────────────────────

  async getRouterRtpCapabilities(channelId: string): Promise<RtpCapabilities> {
    const room = await this.ensureRoom(channelId);
    return room.router.rtpCapabilities;
  }

  getRoom(channelId: string): SfuRoom | undefined {
    return this.rooms.get(channelId);
  }

  getRoomStats(): Array<{ channelId: string; peerCount: number; createdAt: number }> {
    return Array.from(this.rooms.values()).map((room) => ({
      channelId: room.channelId,
      peerCount: room.peers.size,
      createdAt: room.createdAt,
    }));
  }

  // ─── Transport ───────────────────────────────────────────────────

  async createTransport(
    channelId: string,
    userId: string,
    direction: VoiceSfuTransportDirection,
  ): Promise<VoiceSfuTransportOptions> {
    const room = await this.ensureRoom(channelId);
    const peer = this.getOrCreatePeer(room, userId);

    // Enforce transport limit
    if (peer.transports.size >= this.maxTransportsPerPeer) {
      throw new AppError(
        'SFU_TRANSPORT_LIMIT',
        400,
        `Maximum of ${this.maxTransportsPerPeer} transports per peer exceeded`,
      );
    }

    const transport = await room.router.createWebRtcTransport({
      listenIps: [
        {
          ip: this.config.listenIp,
          announcedIp: this.config.announcedIp ?? undefined,
        },
      ],
      enableUdp: this.config.enableUdp,
      enableTcp: this.config.enableTcp,
      preferUdp: !this.config.preferTcp,
      preferTcp: this.config.preferTcp,
      initialAvailableOutgoingBitrate: 2_000_000,
      iceConsentTimeout: 45,
      appData: { direction, channelId, userId },
    });

    peer.transports.set(transport.id, transport);

    // DTLS failure = hard close
    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'failed' || dtlsState === 'closed') {
        transport.close();
      }
    });

    // Cleanup on close
    transport.observer.on('close', () => {
      peer.transports.delete(transport.id);
      this.emitEvent({
        type: 'transport-close',
        channelId,
        userId,
        transportId: transport.id,
        direction,
      });
      this.cleanupPeerIfEmpty(channelId, userId);
    });

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      sctpParameters: transport.sctpParameters,
    };
  }

  async connectTransport(
    channelId: string,
    userId: string,
    transportId: string,
    dtlsParameters: DtlsParameters,
  ): Promise<void> {
    const transport = this.getTransportOrThrow(channelId, userId, transportId);
    await transport.connect({ dtlsParameters });
  }

  // ─── Produce ─────────────────────────────────────────────────────

  async produce(
    channelId: string,
    userId: string,
    transportId: string,
    kind: Producer['kind'],
    rtpParameters: RtpParameters,
    appData: Record<string, unknown> = {},
  ): Promise<VoiceSfuProducerInfo> {
    if (this.config.audioOnly && kind !== 'audio') {
      throw new AppError('SFU_AUDIO_ONLY', 400, 'SFU is configured for audio only');
    }

    const peer = this.getPeerOrThrow(channelId, userId);

    // Enforce producer limit
    if (peer.producers.size >= this.maxProducersPerPeer) {
      throw new AppError(
        'SFU_PRODUCER_LIMIT',
        400,
        `Maximum of ${this.maxProducersPerPeer} producers per peer exceeded`,
      );
    }

    const transport = this.getTransportOrThrow(channelId, userId, transportId);

    const producer = await transport.produce({
      kind,
      rtpParameters,
      appData: { ...appData, channelId, userId },
    });

    peer.producers.set(producer.id, producer);

    producer.on('transportclose', () => {
      peer.producers.delete(producer.id);
      this.emitEvent({ type: 'producer-close', channelId, userId, producerId: producer.id });
      this.cleanupPeerIfEmpty(channelId, userId);
    });

    return {
      producerId: producer.id,
      userId,
      kind: producer.kind,
      appData: producer.appData as Record<string, unknown>,
    };
  }

  closeProducer(channelId: string, userId: string, producerId: string): boolean {
    const peer = this.getPeer(channelId, userId);
    const producer = peer?.producers.get(producerId);
    if (!producer) return false;

    producer.close();
    peer!.producers.delete(producerId);
    this.emitEvent({ type: 'producer-close', channelId, userId, producerId });
    this.cleanupPeerIfEmpty(channelId, userId);
    return true;
  }

  getProducerInfos(channelId: string, options?: { excludeUserId?: string }): VoiceSfuProducerInfo[] {
    const room = this.rooms.get(channelId);
    if (!room) return [];

    const results: VoiceSfuProducerInfo[] = [];
    for (const [userId, peer] of room.peers) {
      if (options?.excludeUserId === userId) continue;
      for (const producer of peer.producers.values()) {
        results.push({
          producerId: producer.id,
          userId,
          kind: producer.kind,
          appData: producer.appData as Record<string, unknown>,
        });
      }
    }
    return results;
  }

  // ─── Consume ─────────────────────────────────────────────────────

  async consume(
    channelId: string,
    userId: string,
    transportId: string,
    producerId: string,
    rtpCapabilities: RtpCapabilities,
  ): Promise<VoiceSfuConsumerOptions> {
    const room = this.rooms.get(channelId);
    if (!room) {
      throw new AppError('VOICE_TARGET_NOT_AVAILABLE', 404, 'No SFU room exists for this channel');
    }

    if (!room.router.canConsume({ producerId, rtpCapabilities })) {
      throw new AppError(
        'SFU_CANNOT_CONSUME',
        400,
        'Current RTP capabilities cannot consume this producer',
      );
    }

    const transport = this.getTransportOrThrow(channelId, userId, transportId);
    const peer = this.getOrCreatePeer(room, userId);

    // Find the producer to include its appData
    let producerAppData: Record<string, unknown> = {};
    outer: for (const [, p] of room.peers) {
      for (const prod of p.producers.values()) {
        if (prod.id === producerId) {
          producerAppData = prod.appData as Record<string, unknown>;
          break outer;
        }
      }
    }

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: true, // Client must resume after setup
    });

    peer.consumers.set(consumer.id, consumer);

    consumer.on('transportclose', () => {
      peer.consumers.delete(consumer.id);
      this.emitEvent({
        type: 'consumer-close',
        channelId,
        userId,
        consumerId: consumer.id,
        producerId: consumer.producerId,
      });
      this.cleanupPeerIfEmpty(channelId, userId);
    });

    consumer.on('producerclose', () => {
      peer.consumers.delete(consumer.id);
      this.emitEvent({
        type: 'consumer-close',
        channelId,
        userId,
        consumerId: consumer.id,
        producerId: consumer.producerId,
      });
      this.cleanupPeerIfEmpty(channelId, userId);
    });

    return {
      consumerId: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
      producerPaused: consumer.producerPaused,
      appData: producerAppData,
    };
  }

  async resumeConsumer(channelId: string, userId: string, consumerId: string): Promise<boolean> {
    const consumer = this.getPeer(channelId, userId)?.consumers.get(consumerId);
    if (!consumer) return false;
    await consumer.resume();
    return true;
  }

  // ─── ICE Restart ─────────────────────────────────────────────────

  async restartIce(
    channelId: string,
    userId: string,
    transportId: string,
  ): Promise<VoiceSfuIceRestartResult> {
    const transport = this.getTransportOrThrow(channelId, userId, transportId);
    const iceParameters = await transport.restartIce();
    return { iceParameters };
  }

  // ─── Stats ───────────────────────────────────────────────────────

  getTransportStats(channelId: string, userId: string): VoiceSfuTransportStats[] {
    const peer = this.getPeer(channelId, userId);
    if (!peer) return [];

    return Array.from(peer.transports.entries()).map(([transportId, transport]) => ({
      transportId,
      direction: String(transport.appData.direction ?? 'unknown'),
      iceState: transport.iceState,
      dtlsState: transport.dtlsState,
      sctpState: transport.sctpState ?? undefined,
      producerCount: peer.producers.size,
      consumerCount: peer.consumers.size,
    }));
  }

  // ─── Peer Removal ────────────────────────────────────────────────

  removePeer(channelId: string, userId: string): VoiceSfuProducerInfo[] {
    const room = this.rooms.get(channelId);
    if (!room) return [];

    const peer = room.peers.get(userId);
    if (!peer) return [];

    // Collect producer info before destroying
    const removedProducers: VoiceSfuProducerInfo[] = Array.from(peer.producers.values()).map(
      (producer) => ({
        producerId: producer.id,
        userId,
        kind: producer.kind,
        appData: producer.appData as Record<string, unknown>,
      }),
    );

    // Close all transports (cascades to producers + consumers)
    for (const transport of peer.transports.values()) {
      transport.close();
    }
    peer.transports.clear();
    peer.producers.clear();
    peer.consumers.clear();
    room.peers.delete(userId);

    if (room.peers.size === 0) {
      this.closeRoom(channelId);
    }

    return removedProducers;
  }

  // ─── Private Helpers ─────────────────────────────────────────────

  private getMediaCodecs(): mediasoupTypes.RouterRtpCodecCapability[] {
    return this.config.audioOnly ? [...AUDIO_CODECS] : [...AUDIO_CODECS, ...VIDEO_CODECS];
  }

  private getNextWorker(): { worker: Worker; index: number } {
    if (this.workers.length === 0) {
      throw new AppError('SFU_NOT_READY', 503, 'No mediasoup workers available');
    }
    // Round-robin
    const index = this.nextWorkerIndex % this.workers.length;
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
    return { worker: this.workers[index], index };
  }

  private async ensureRoom(channelId: string): Promise<SfuRoom> {
    if (!this.config.enabled) {
      throw new AppError('SFU_DISABLED', 400, 'SFU mode is disabled');
    }
    if (!this.initialized || this.workers.length === 0) {
      throw new AppError('SFU_NOT_READY', 503, 'SFU worker is not ready');
    }

    const existing = this.rooms.get(channelId);
    if (existing) return existing;

    const { worker, index } = this.getNextWorker();
    const router = await worker.createRouter({
      mediaCodecs: this.getMediaCodecs(),
    });

    const room: SfuRoom = {
      channelId,
      router,
      workerIndex: index,
      peers: new Map(),
      createdAt: Date.now(),
    };

    this.rooms.set(channelId, room);
    return room;
  }

  private getOrCreatePeer(room: SfuRoom, userId: string): SfuPeer {
    const existing = room.peers.get(userId);
    if (existing) return existing;

    const peer: SfuPeer = {
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    };
    room.peers.set(userId, peer);
    return peer;
  }

  private getPeer(channelId: string, userId: string): SfuPeer | null {
    return this.rooms.get(channelId)?.peers.get(userId) ?? null;
  }

  private getPeerOrThrow(channelId: string, userId: string): SfuPeer {
    const peer = this.getPeer(channelId, userId);
    if (!peer) {
      throw new AppError('VOICE_NOT_JOINED', 403, 'Join the voice channel first');
    }
    return peer;
  }

  private getTransportOrThrow(channelId: string, userId: string, transportId: string): WebRtcTransport {
    const transport = this.getPeer(channelId, userId)?.transports.get(transportId);
    if (!transport) {
      throw new AppError('SFU_TRANSPORT_NOT_FOUND', 404, 'SFU transport was not found');
    }
    return transport;
  }

  private cleanupPeerIfEmpty(channelId: string, userId: string): void {
    const room = this.rooms.get(channelId);
    if (!room) return;

    const peer = room.peers.get(userId);
    if (!peer) return;

    if (peer.transports.size > 0 || peer.producers.size > 0 || peer.consumers.size > 0) {
      return;
    }

    room.peers.delete(userId);

    if (room.peers.size === 0) {
      this.closeRoom(channelId);
    }
  }

  private closeRoom(channelId: string): void {
    const room = this.rooms.get(channelId);
    if (!room) return;

    for (const [, peer] of room.peers) {
      for (const transport of peer.transports.values()) {
        transport.close();
      }
      peer.transports.clear();
      peer.producers.clear();
      peer.consumers.clear();
    }
    room.peers.clear();
    room.router.close();
    this.rooms.delete(channelId);
    this.emitEvent({ type: 'room-close', channelId });
  }

  private emitEvent(event: VoiceSfuEvent): void {
    this.emit('sfu-event', event);
  }
}
