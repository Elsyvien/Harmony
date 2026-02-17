import mediasoup, { type types as mediasoupTypes } from 'mediasoup';
import { AppError } from '../utils/app-error.js';

type VoiceSfuTransportDirection = 'send' | 'recv';
type Consumer = mediasoupTypes.Consumer;
type DtlsParameters = mediasoupTypes.DtlsParameters;
type IceParameters = mediasoupTypes.IceParameters;
type Producer = mediasoupTypes.Producer;
type Router = mediasoupTypes.Router;
type RouterRtpCodecCapability = mediasoupTypes.RouterRtpCodecCapability;
type RtpCapabilities = mediasoupTypes.RtpCapabilities;
type RtpParameters = mediasoupTypes.RtpParameters;
type SctpParameters = mediasoupTypes.SctpParameters;
type WebRtcTransport = mediasoupTypes.WebRtcTransport;
type Worker = mediasoupTypes.Worker;

type VoiceSfuConfig = {
  enabled: boolean;
  audioOnly: boolean;
  listenIp: string;
  announcedIp: string | null;
  minPort: number;
  maxPort: number;
  enableUdp: boolean;
  enableTcp: boolean;
  preferTcp: boolean;
};

type VoiceSfuPeer = {
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
};

type VoiceSfuRoom = {
  router: Router;
  peers: Map<string, VoiceSfuPeer>;
};

export type VoiceSfuTransportOptions = {
  id: string;
  iceParameters: WebRtcTransport['iceParameters'];
  iceCandidates: WebRtcTransport['iceCandidates'];
  dtlsParameters: WebRtcTransport['dtlsParameters'];
  sctpParameters: SctpParameters | undefined;
};

export type VoiceSfuIceRestartResult = {
  iceParameters: IceParameters;
};

export type VoiceSfuProducerInfo = {
  producerId: string;
  userId: string;
  kind: Producer['kind'];
  appData: Producer['appData'];
};

export type VoiceSfuConsumerOptions = {
  consumerId: string;
  producerId: string;
  kind: Consumer['kind'];
  rtpParameters: Consumer['rtpParameters'];
  type: Consumer['type'];
  producerPaused: boolean;
};

export class VoiceSfuService {
  private readonly config: VoiceSfuConfig;
  private worker: Worker | null = null;
  private readonly rooms = new Map<string, VoiceSfuRoom>();

  constructor(config: VoiceSfuConfig) {
    this.config = config;
  }

  get enabled() {
    return this.config.enabled;
  }

  get audioOnly() {
    return this.config.audioOnly;
  }

  async init() {
    if (!this.config.enabled || this.worker) {
      return;
    }
    this.worker = await mediasoup.createWorker({
      rtcMinPort: this.config.minPort,
      rtcMaxPort: this.config.maxPort,
      logLevel: 'warn',
    });
    this.worker.on('died', () => {
      this.worker = null;
      this.rooms.clear();
    });
  }

  async close() {
    for (const [channelId] of this.rooms) {
      this.closeRoom(channelId);
    }
    await this.worker?.close();
    this.worker = null;
  }

  async getRouterRtpCapabilities(channelId: string): Promise<RtpCapabilities> {
    const room = await this.ensureRoom(channelId);
    return room.router.rtpCapabilities;
  }

  async createTransport(
    channelId: string,
    userId: string,
    direction: VoiceSfuTransportDirection,
  ): Promise<VoiceSfuTransportOptions> {
    const room = await this.ensureRoom(channelId);
    const peer = this.getOrCreatePeer(room, userId);
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
      appData: {
        direction,
        channelId,
        userId,
      },
      initialAvailableOutgoingBitrate: 2_000_000,
      iceConsentTimeout: 45,
    });
    peer.transports.set(transport.id, transport);
    transport.on('icestatechange', (iceState: WebRtcTransport['iceState']) => {
      if (iceState === 'disconnected') {
        // Give time for ICE to recover before closing
        setTimeout(() => {
          if (transport.iceState === 'disconnected' || transport.iceState === 'closed') {
            // Transport is still disconnected – leave it for the client to restart
          }
        }, 10_000);
      }
    });
    transport.on('dtlsstatechange', (dtlsState: WebRtcTransport['dtlsState']) => {
      if (dtlsState === 'failed' || dtlsState === 'closed') {
        transport.close();
      }
    });
    transport.observer.on('close', () => {
      peer.transports.delete(transport.id);
      this.cleanupPeerIfIdle(channelId, userId);
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
    const transport = this.getTransport(channelId, userId, transportId);
    await transport.connect({ dtlsParameters });
  }

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
    const transport = this.getTransport(channelId, userId, transportId);
    const peer = this.getPeer(channelId, userId);
    if (!peer) {
      throw new AppError('VOICE_NOT_JOINED', 403, 'Join the voice channel first');
    }
    const producer = await transport.produce({
      kind,
      rtpParameters,
      appData: {
        ...appData,
        channelId,
        userId,
      },
    });
    peer.producers.set(producer.id, producer);
    producer.on('transportclose', () => {
      peer.producers.delete(producer.id);
      this.cleanupPeerIfIdle(channelId, userId);
    });
    return {
      producerId: producer.id,
      userId,
      kind: producer.kind,
      appData: producer.appData,
    };
  }

  async closeProducer(channelId: string, userId: string, producerId: string): Promise<boolean> {
    const peer = this.getPeer(channelId, userId);
    const producer = peer?.producers.get(producerId);
    if (!producer) {
      return false;
    }
    producer.close();
    peer?.producers.delete(producerId);
    this.cleanupPeerIfIdle(channelId, userId);
    return true;
  }

  getProducerInfos(channelId: string, options?: { excludeUserId?: string }): VoiceSfuProducerInfo[] {
    const room = this.rooms.get(channelId);
    if (!room) {
      return [];
    }
    const producers: VoiceSfuProducerInfo[] = [];
    for (const [userId, peer] of room.peers) {
      if (options?.excludeUserId && options.excludeUserId === userId) {
        continue;
      }
      for (const producer of peer.producers.values()) {
        producers.push({
          producerId: producer.id,
          userId,
          kind: producer.kind,
          appData: producer.appData,
        });
      }
    }
    return producers;
  }

  async consume(
    channelId: string,
    userId: string,
    transportId: string,
    producerId: string,
    rtpCapabilities: RtpCapabilities,
  ): Promise<VoiceSfuConsumerOptions> {
    const room = this.rooms.get(channelId);
    if (!room) {
      throw new AppError('VOICE_TARGET_NOT_AVAILABLE', 404, 'No SFU room is available for this channel');
    }
    if (!room.router.canConsume({ producerId, rtpCapabilities })) {
      throw new AppError('SFU_CANNOT_CONSUME', 400, 'Current RTP capabilities cannot consume this producer');
    }
    const transport = this.getTransport(channelId, userId, transportId);
    const peer = this.getOrCreatePeer(room, userId);
    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
    });
    peer.consumers.set(consumer.id, consumer);
    consumer.on('transportclose', () => {
      peer.consumers.delete(consumer.id);
      this.cleanupPeerIfIdle(channelId, userId);
    });
    consumer.on('producerclose', () => {
      peer.consumers.delete(consumer.id);
      this.cleanupPeerIfIdle(channelId, userId);
    });
    return {
      consumerId: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
      producerPaused: consumer.producerPaused,
    };
  }

  async resumeConsumer(channelId: string, userId: string, consumerId: string): Promise<boolean> {
    const peer = this.getPeer(channelId, userId);
    const consumer = peer?.consumers.get(consumerId);
    if (!consumer) {
      return false;
    }
    await consumer.resume();
    return true;
  }

  async restartIce(
    channelId: string,
    userId: string,
    transportId: string,
  ): Promise<VoiceSfuIceRestartResult> {
    const transport = this.getTransport(channelId, userId, transportId);
    const iceParameters = await transport.restartIce();
    return { iceParameters };
  }

  getTransportStats(
    channelId: string,
    userId: string,
  ): Array<{
    transportId: string;
    direction: string;
    iceState: string;
    dtlsState: string;
    sctpState: string | undefined;
    bytesSent: number;
    bytesReceived: number;
    producerCount: number;
    consumerCount: number;
  }> {
    const peer = this.getPeer(channelId, userId);
    if (!peer) {
      return [];
    }
    const result: Array<{
      transportId: string;
      direction: string;
      iceState: string;
      dtlsState: string;
      sctpState: string | undefined;
      bytesSent: number;
      bytesReceived: number;
      producerCount: number;
      consumerCount: number;
    }> = [];
    for (const [transportId, transport] of peer.transports) {
      result.push({
        transportId,
        direction: String(transport.appData.direction ?? 'unknown'),
        iceState: transport.iceState,
        dtlsState: transport.dtlsState,
        sctpState: transport.sctpState ?? undefined,
        bytesSent: (transport as unknown as { bytesReceived?: number; bytesSent?: number }).bytesSent ?? 0,
        bytesReceived: (transport as unknown as { bytesReceived?: number }).bytesReceived ?? 0,
        producerCount: peer.producers.size,
        consumerCount: peer.consumers.size,
      });
    }
    return result;
  }

  getPeerProducerInfos(channelId: string, userId: string): VoiceSfuProducerInfo[] {
    const room = this.rooms.get(channelId);
    const peer = room?.peers.get(userId);
    if (!peer) {
      return [];
    }
    return Array.from(peer.producers.values()).map((producer) => ({
      producerId: producer.id,
      userId,
      kind: producer.kind,
      appData: producer.appData,
    }));
  }

  removePeer(channelId: string, userId: string): VoiceSfuProducerInfo[] {
    const room = this.rooms.get(channelId);
    if (!room) {
      return [];
    }
    const peer = room.peers.get(userId);
    if (!peer) {
      return [];
    }
    const removedProducers = this.getPeerProducerInfos(channelId, userId);
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

  private getSupportedCodecs(): RouterRtpCodecCapability[] {
    if (this.config.audioOnly) {
      return [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
        },
      ];
    }
    return [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1200,
        },
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
  }

  private async ensureRoom(channelId: string): Promise<VoiceSfuRoom> {
    if (!this.config.enabled) {
      throw new AppError('SFU_DISABLED', 400, 'SFU mode is disabled');
    }
    if (!this.worker) {
      throw new AppError('SFU_NOT_READY', 503, 'SFU worker is not ready');
    }
    const existingRoom = this.rooms.get(channelId);
    if (existingRoom) {
      return existingRoom;
    }
    const router = await this.worker.createRouter({
      mediaCodecs: this.getSupportedCodecs(),
    });
    const room: VoiceSfuRoom = {
      router,
      peers: new Map(),
    };
    this.rooms.set(channelId, room);
    return room;
  }

  private getOrCreatePeer(room: VoiceSfuRoom, userId: string): VoiceSfuPeer {
    const existingPeer = room.peers.get(userId);
    if (existingPeer) {
      return existingPeer;
    }
    const peer: VoiceSfuPeer = {
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    };
    room.peers.set(userId, peer);
    return peer;
  }

  private getPeer(channelId: string, userId: string): VoiceSfuPeer | null {
    return this.rooms.get(channelId)?.peers.get(userId) ?? null;
  }

  private getTransport(channelId: string, userId: string, transportId: string): WebRtcTransport {
    const transport = this.getPeer(channelId, userId)?.transports.get(transportId);
    if (!transport) {
      throw new AppError('SFU_TRANSPORT_NOT_FOUND', 404, 'SFU transport was not found');
    }
    return transport;
  }

  private cleanupPeerIfIdle(channelId: string, userId: string) {
    const room = this.rooms.get(channelId);
    if (!room) {
      return;
    }
    const peer = room.peers.get(userId);
    if (!peer) {
      return;
    }
    if (peer.transports.size > 0 || peer.producers.size > 0 || peer.consumers.size > 0) {
      return;
    }
    room.peers.delete(userId);
    if (room.peers.size === 0) {
      this.closeRoom(channelId);
    }
  }

  private closeRoom(channelId: string) {
    const room = this.rooms.get(channelId);
    if (!room) {
      return;
    }
    for (const [peerUserId, peer] of room.peers) {
      for (const transport of peer.transports.values()) {
        transport.close();
      }
      peer.transports.clear();
      peer.producers.clear();
      peer.consumers.clear();
      room.peers.delete(peerUserId);
    }
    room.router.close();
    this.rooms.delete(channelId);
  }
}
