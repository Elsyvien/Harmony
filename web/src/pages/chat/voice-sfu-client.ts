import { Device, type types as mediasoupTypes } from 'mediasoup-client';
import type { VoiceSfuEventPayload, VoiceSfuRequestAction } from '../../hooks/use-chat-socket';
import { getVoiceReconnectDelayMs } from './utils/voice-reconnect';

type VoiceSfuRequest = <TData = unknown>(
  action: VoiceSfuRequestAction,
  data?: unknown,
  timeoutMs?: number,
) => Promise<TData>;

type VoiceSfuProducerInfo = {
  producerId: string;
  userId: string;
  kind: 'audio' | 'video';
  appData?: Record<string, unknown>;
};

type VoiceSfuConsumerInfo = {
  consumerId: string;
  producerId: string;
  kind: 'audio' | 'video';
  rtpParameters: mediasoupTypes.RtpParameters;
};

type VoiceSfuTransportStats = {
  transportId: string;
  direction: string;
  iceState: string;
  dtlsState: string;
};

type VoiceSfuCallbacks = {
  onRemoteAudio: (userId: string, stream: MediaStream) => void;
  onRemoteAudioRemoved: (userId: string) => void;
  onStateChange?: (state: mediasoupTypes.ConnectionState) => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
};

export class VoiceSfuClient {
  private readonly selfUserId: string;
  private readonly request: VoiceSfuRequest;
  private readonly callbacks: VoiceSfuCallbacks;

  private device: Device | null = null;
  private sendTransport: mediasoupTypes.Transport | null = null;
  private recvTransport: mediasoupTypes.Transport | null = null;
  private audioProducer: mediasoupTypes.Producer | null = null;
  private closed = false;

  private readonly consumerByProducerId = new Map<string, mediasoupTypes.Consumer>();
  private readonly producerOwnerById = new Map<string, string>();
  private readonly remoteStreamByUserId = new Map<string, MediaStream>();

  /** Pending local audio track while reconnecting */
  private pendingLocalAudioTrack: MediaStreamTrack | null = null;
  private reconnecting = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  /** Track whether ICE restart is already in progress for a transport */
  private iceRestartInProgress = new Set<string>();

  private static readonly REQUEST_TIMEOUT_MS = 15_000;
  private static readonly RETRYABLE_ERROR_PATTERNS = ['timed out', 'connection is not active'];
  private static readonly MAX_RECONNECT_ATTEMPTS = 8;
  private static readonly KEEPALIVE_INTERVAL_MS = 10_000;

  constructor(params: {
    selfUserId: string;
    request: VoiceSfuRequest;
    callbacks: VoiceSfuCallbacks;
  }) {
    this.selfUserId = params.selfUserId;
    this.request = params.request;
    this.callbacks = params.callbacks;
  }

  async start(localAudioTrack: MediaStreamTrack | null): Promise<void> {
    this.closed = false;
    this.reconnecting = false;
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    this.clearKeepaliveTimer();

    const capabilitiesResponse = await this.requestWithRetry<{
      rtpCapabilities?: mediasoupTypes.RtpCapabilities;
    }>('get-rtp-capabilities');
    if (!capabilitiesResponse?.rtpCapabilities) {
      throw new Error('Missing SFU RTP capabilities');
    }

    const device = new Device();
    await device.load({ routerRtpCapabilities: capabilitiesResponse.rtpCapabilities });
    this.device = device;

    this.sendTransport = await this.createTransport('send');
    this.recvTransport = await this.createTransport('recv');

    if (localAudioTrack && device.canProduce('audio')) {
      this.audioProducer = await this.sendTransport.produce({
        track: localAudioTrack,
        codecOptions: {
          opusStereo: false,
          opusDtx: true,
          opusFec: true,
          opusMaxPlaybackRate: 48000,
        },
        appData: { type: 'voice-audio' },
      });
      this.audioProducer.on('transportclose', () => {
        this.audioProducer = null;
      });
    }

    await this.syncProducers();
    this.startKeepalive();
  }

  async replaceLocalAudioTrack(track: MediaStreamTrack | null): Promise<void> {
    // If reconnecting, store the track for later use
    if (this.reconnecting) {
      this.pendingLocalAudioTrack = track;
      return;
    }
    if (this.closed || !this.sendTransport || !this.device) {
      return;
    }
    if (!track) {
      if (this.audioProducer) {
        const producerId = this.audioProducer.id;
        this.audioProducer.close();
        this.audioProducer = null;
        void this.request('close-producer', { producerId }).catch(() => {});
      }
      return;
    }
    if (!this.device.canProduce('audio')) {
      return;
    }
    if (this.audioProducer) {
      await this.audioProducer.replaceTrack({ track });
      return;
    }
    this.audioProducer = await this.sendTransport.produce({
      track,
      codecOptions: {
        opusStereo: false,
        opusDtx: true,
        opusFec: true,
        opusMaxPlaybackRate: 48000,
      },
      appData: { type: 'voice-audio' },
    });
  }

  async syncProducers(): Promise<void> {
    if (this.closed || this.reconnecting) {
      return;
    }
    const response = await this.requestWithRetry<{
      producers?: VoiceSfuProducerInfo[];
    }>('list-producers');
    const producers = response?.producers ?? [];
    const activeProducerIds = new Set<string>();

    for (const producer of producers) {
      if (producer.userId === this.selfUserId || producer.kind !== 'audio') {
        continue;
      }
      activeProducerIds.add(producer.producerId);
      this.producerOwnerById.set(producer.producerId, producer.userId);
      try {
        await this.consumeProducer(producer.producerId, producer.userId);
      } catch {
        // Continue consuming other producers; a transient failure should not block all remote audio.
      }
    }

    for (const producerId of Array.from(this.consumerByProducerId.keys())) {
      if (activeProducerIds.has(producerId)) {
        continue;
      }
      this.removeConsumerByProducerId(producerId);
    }
  }

  async handleSfuEvent(payload: VoiceSfuEventPayload): Promise<void> {
    if (this.closed || this.reconnecting) {
      return;
    }
    if (payload.event === 'producer-added') {
      if (payload.producer.userId === this.selfUserId || payload.producer.kind !== 'audio') {
        return;
      }
      this.producerOwnerById.set(payload.producer.producerId, payload.producer.userId);
      await this.consumeProducer(payload.producer.producerId, payload.producer.userId);
      return;
    }
    this.removeConsumerByProducerId(payload.producerId);
  }

  /**
   * Get the underlying RTCPeerConnection objects for stats collection.
   */
  getTransportPeerConnections(): Array<{
    direction: 'send' | 'recv';
    pc: RTCPeerConnection | null;
  }> {
    const results: Array<{ direction: 'send' | 'recv'; pc: RTCPeerConnection | null }> = [];
    const extractPc = (transport: mediasoupTypes.Transport | null): RTCPeerConnection | null => {
      if (!transport) return null;
      try {
        // mediasoup-client exposes _handler._pc (unofficial but stable across versions)
        const handler = (transport as unknown as { _handler?: { _pc?: RTCPeerConnection } })._handler;
        return handler?._pc ?? null;
      } catch {
        return null;
      }
    };
    results.push({ direction: 'send', pc: extractPc(this.sendTransport) });
    results.push({ direction: 'recv', pc: extractPc(this.recvTransport) });
    return results;
  }

  /**
   * Get server-side transport stats for diagnostics.
   */
  async getServerTransportStats(): Promise<VoiceSfuTransportStats[]> {
    if (this.closed) return [];
    try {
      const response = await this.request<{ transports?: VoiceSfuTransportStats[] }>(
        'get-transport-stats',
        undefined,
        5000,
      );
      return response?.transports ?? [];
    } catch {
      return [];
    }
  }

  get isReconnecting(): boolean {
    return this.reconnecting;
  }

  stop() {
    this.closed = true;
    this.reconnecting = false;
    this.clearReconnectTimer();
    this.clearKeepaliveTimer();
    this.iceRestartInProgress.clear();
    if (this.audioProducer) {
      const producerId = this.audioProducer.id;
      this.audioProducer.close();
      this.audioProducer = null;
      void this.request('close-producer', { producerId }).catch(() => {});
    }
    for (const producerId of Array.from(this.consumerByProducerId.keys())) {
      this.removeConsumerByProducerId(producerId);
    }
    this.consumerByProducerId.clear();
    this.producerOwnerById.clear();
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
    this.pendingLocalAudioTrack = null;
  }

  private async createTransport(
    direction: 'send' | 'recv',
  ): Promise<mediasoupTypes.Transport> {
    const response = await this.requestWithRetry<{
      transport?: mediasoupTypes.TransportOptions;
    }>('create-transport', { direction });
    if (!response?.transport || !this.device) {
      throw new Error('Missing SFU transport options');
    }

    const transport =
      direction === 'send'
        ? this.device.createSendTransport(response.transport)
        : this.device.createRecvTransport(response.transport);

    transport.on('connect', ({ dtlsParameters }: { dtlsParameters: mediasoupTypes.DtlsParameters }, callback: () => void, errback: (error: Error) => void) => {
      void this.requestWithRetry('connect-transport', {
        transportId: transport.id,
        dtlsParameters,
      })
        .then(() => callback())
        .catch((err) => errback(err instanceof Error ? err : new Error(String(err))));
    });

    transport.on('connectionstatechange', (state: mediasoupTypes.ConnectionState) => {
      this.callbacks.onStateChange?.(state);

      if (state === 'disconnected') {
        // Attempt ICE restart before giving up
        void this.attemptIceRestart(transport);
      } else if (state === 'failed') {
        // Full reconnection needed
        this.scheduleReconnect();
      } else if (state === 'connected') {
        // Reset reconnect attempts on successful connection
        this.reconnectAttempts = 0;
        this.iceRestartInProgress.delete(transport.id);
      }
    });

    transport.on('produce', ({ kind, rtpParameters, appData }: { kind: 'audio' | 'video'; rtpParameters: mediasoupTypes.RtpParameters; appData: mediasoupTypes.AppData }, callback: (args: { id: string }) => void, errback: (error: Error) => void) => {
      void this.requestWithRetry<{ producer?: VoiceSfuProducerInfo }>('produce', {
        transportId: transport.id,
        kind,
        rtpParameters,
        appData,
      })
        .then((produceResponse) => {
          const producerId = produceResponse?.producer?.producerId;
          if (!producerId) {
            throw new Error('Missing producer id');
          }
          callback({ id: producerId });
        })
        .catch((err) => errback(err instanceof Error ? err : new Error(String(err))));
    });

    return transport;
  }

  private async attemptIceRestart(transport: mediasoupTypes.Transport): Promise<void> {
    if (this.closed || this.reconnecting) return;
    if (this.iceRestartInProgress.has(transport.id)) return;
    this.iceRestartInProgress.add(transport.id);

    try {
      const response = await this.request<{ iceParameters?: unknown }>(
        'restart-ice',
        { transportId: transport.id },
        8000,
      );
      if (response?.iceParameters) {
        await transport.restartIce({
          iceParameters: response.iceParameters as mediasoupTypes.IceParameters,
        });
      }
    } catch {
      // ICE restart failed – schedule full reconnect
      this.iceRestartInProgress.delete(transport.id);
      if (!this.closed) {
        this.scheduleReconnect();
      }
      return;
    }
    // Give the ICE restart 8s to work before trying harder recovery
    setTimeout(() => {
      this.iceRestartInProgress.delete(transport.id);
    }, 8000);
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnecting || this.reconnectTimer) return;
    if (this.reconnectAttempts >= VoiceSfuClient.MAX_RECONNECT_ATTEMPTS) {
      this.callbacks.onStateChange?.('failed');
      return;
    }

    this.reconnecting = true;
    this.callbacks.onReconnecting?.();

    const delay = getVoiceReconnectDelayMs(this.reconnectAttempts);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.performReconnect();
    }, delay);
  }

  private async performReconnect(): Promise<void> {
    if (this.closed) return;

    // Save current audio track
    const currentAudioTrack =
      this.pendingLocalAudioTrack ??
      this.audioProducer?.track ??
      null;
    this.pendingLocalAudioTrack = null;

    // Clean up old transports without notifying remote removal
    this.cleanupTransportsOnly();

    try {
      // Re-create transports
      this.sendTransport = await this.createTransport('send');
      this.recvTransport = await this.createTransport('recv');

      // Re-produce audio if we had a track
      if (currentAudioTrack && currentAudioTrack.readyState === 'live' && this.device?.canProduce('audio')) {
        this.audioProducer = await this.sendTransport.produce({
          track: currentAudioTrack,
          codecOptions: {
            opusStereo: false,
            opusDtx: true,
            opusFec: true,
            opusMaxPlaybackRate: 48000,
          },
          appData: { type: 'voice-audio' },
        });
        this.audioProducer.on('transportclose', () => {
          this.audioProducer = null;
        });
      }

      // Re-subscribe to remote producers
      await this.syncProducers();

      this.reconnecting = false;
      this.callbacks.onReconnected?.();
      this.callbacks.onStateChange?.('connected');
    } catch {
      this.reconnecting = false;
      // Schedule another attempt
      this.scheduleReconnect();
    }
  }

  private cleanupTransportsOnly(): void {
    if (this.audioProducer) {
      try { this.audioProducer.close(); } catch { void 0; }
      this.audioProducer = null;
    }
    for (const consumer of this.consumerByProducerId.values()) {
      try { consumer.close(); } catch { void 0; }
    }
    this.consumerByProducerId.clear();
    try { this.sendTransport?.close(); } catch { void 0; }
    try { this.recvTransport?.close(); } catch { void 0; }
    this.sendTransport = null;
    this.recvTransport = null;
  }

  private startKeepalive(): void {
    this.clearKeepaliveTimer();
    this.keepaliveTimer = setInterval(() => {
      if (this.closed || this.reconnecting) return;
      // Light query to keep the WS/SFU session alive and detect stale connections
      void this.request('list-producers', undefined, 5000).catch(() => {
        // If this consistently fails, connectionstatechange will trigger reconnect
      });
    }, VoiceSfuClient.KEEPALIVE_INTERVAL_MS);
  }

  private clearKeepaliveTimer(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async consumeProducer(producerId: string, userId: string): Promise<void> {
    if (this.consumerByProducerId.has(producerId) || this.closed || this.reconnecting) {
      return;
    }
    if (!this.recvTransport || !this.device) {
      return;
    }

    const response = await this.requestWithRetry<{
      consumer?: VoiceSfuConsumerInfo;
    }>('consume', {
      transportId: this.recvTransport.id,
      producerId,
      rtpCapabilities: this.device.rtpCapabilities,
    });
    const consumerInfo = response?.consumer;
    if (!consumerInfo) {
      return;
    }

    const consumer = await this.recvTransport.consume({
      id: consumerInfo.consumerId,
      producerId: consumerInfo.producerId,
      kind: consumerInfo.kind,
      rtpParameters: consumerInfo.rtpParameters,
      appData: {
        userId,
        producerId,
      },
    });

    this.consumerByProducerId.set(producerId, consumer);
    this.producerOwnerById.set(producerId, userId);

    consumer.on('transportclose', () => {
      this.removeConsumerByProducerId(producerId);
    });
    consumer.on('trackended', () => {
      this.removeConsumerByProducerId(producerId);
    });

    await this.requestWithRetry('resume-consumer', {
      consumerId: consumer.id,
    });

    const stream = new MediaStream([consumer.track]);
    this.remoteStreamByUserId.set(userId, stream);
    this.callbacks.onRemoteAudio(userId, stream);
  }

  private removeConsumerByProducerId(producerId: string) {
    const consumer = this.consumerByProducerId.get(producerId);
    if (consumer) {
      consumer.close();
      this.consumerByProducerId.delete(producerId);
    }
    const ownerUserId = this.producerOwnerById.get(producerId);
    if (!ownerUserId) {
      return;
    }
    this.producerOwnerById.delete(producerId);

    const hasRemainingProducerForUser = Array.from(this.producerOwnerById.values()).some(
      (userId) => userId === ownerUserId,
    );
    if (hasRemainingProducerForUser) {
      return;
    }

    this.remoteStreamByUserId.delete(ownerUserId);
    this.callbacks.onRemoteAudioRemoved(ownerUserId);
  }

  private async requestWithRetry<TData = unknown>(
    action: VoiceSfuRequestAction,
    data?: unknown,
    timeoutMs = VoiceSfuClient.REQUEST_TIMEOUT_MS,
  ): Promise<TData> {
    try {
      return await this.request<TData>(action, data, timeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      const isRetryable = VoiceSfuClient.RETRYABLE_ERROR_PATTERNS.some((pattern) =>
        message.includes(pattern),
      );
      if (!isRetryable || this.closed) {
        throw error;
      }
      // Wait a short delay before retry to avoid hammering
      await new Promise((resolve) => setTimeout(resolve, 300));
      return this.request<TData>(action, data, timeoutMs);
    }
  }
}
