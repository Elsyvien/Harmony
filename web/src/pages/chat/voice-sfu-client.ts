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
  onRemoteVideo?: (userId: string, stream: MediaStream, source: 'screen' | 'camera') => void;
  onRemoteVideoRemoved?: (userId: string) => void;
  onStateChange?: (state: mediasoupTypes.ConnectionState) => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
};

export interface VoiceSfuClientLike {
  start(localAudioTrack: MediaStreamTrack | null): Promise<void>;
  isConnected(): boolean;
  getDetailedStats(): Promise<any[]>;
  replaceLocalAudioTrack(track: MediaStreamTrack | null): Promise<void>;
  replaceLocalVideoTrack(track: MediaStreamTrack | null, source: 'screen' | 'camera' | null): Promise<void>;
  syncProducers(): Promise<void>;
  handleSfuEvent(payload: VoiceSfuEventPayload): Promise<void>;
  stop(): void;
}

export class VoiceSfuClient implements VoiceSfuClientLike {
  private readonly selfUserId: string;
  private readonly request: VoiceSfuRequest;
  private readonly callbacks: VoiceSfuCallbacks;

  private device: Device | null = null;
  private sendTransport: mediasoupTypes.Transport | null = null;
  private recvTransport: mediasoupTypes.Transport | null = null;
  private sendTransportState: mediasoupTypes.ConnectionState = 'new';
  private audioProducer: mediasoupTypes.Producer | null = null;
  private videoProducer: mediasoupTypes.Producer | null = null;
  private closed = false;
  private readonly previousRtpSnapshots = new Map<string, { bytes: number; timestamp: number }>();

  private readonly consumerByProducerId = new Map<string, mediasoupTypes.Consumer>();
  private readonly producerOwnerById = new Map<string, string>();
  private readonly remoteAudioStreamByUserId = new Map<string, MediaStream>();
  private readonly remoteVideoStreamByUserId = new Map<string, MediaStream>();

  /** Pending local audio track while reconnecting */
  private pendingLocalAudioTrack: MediaStreamTrack | null = null;
  private pendingLocalVideoTrack: MediaStreamTrack | null = null;
  private pendingLocalVideoTrackSource: 'screen' | 'camera' | null = null;
  private reconnecting = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  /** Track whether ICE restart is already in progress for a transport */
  private iceRestartInProgress = new Set<string>();

  private static readonly REQUEST_TIMEOUT_MS = 15_000;
  private static readonly RETRYABLE_ERROR_PATTERNS = ['timed out', 'connection is not active', 'connection closed', 'not active'];
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
    this.sendTransportState = 'new';
    this.previousRtpSnapshots.clear();
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

  isConnected(): boolean {
    return !this.closed && this.sendTransportState === 'connected';
  }

  async getDetailedStats(): Promise<any[]> {
    if (this.closed || !this.sendTransport) return [];

    const createEmptyMediaStats = () => ({
      bitrateKbps: null as number | null,
      packets: null as number | null,
      packetsLost: null as number | null,
      jitterMs: null as number | null,
      framesPerSecond: null as number | null,
      frameWidth: null as number | null,
      frameHeight: null as number | null,
    });
    const accumulateMediaStats = (
      target: ReturnType<typeof createEmptyMediaStats>,
      update: Partial<ReturnType<typeof createEmptyMediaStats>>,
    ) => {
      for (const [key, value] of Object.entries(update)) {
        if (typeof value !== 'number' || Number.isNaN(value)) continue;
        const typedKey = key as keyof ReturnType<typeof createEmptyMediaStats>;
        const prev = target[typedKey];
        target[typedKey] = typeof prev === 'number' ? Math.max(prev, value) : value;
      }
    };
    const computeKbpsFromSnapshot = (key: string, bytes: number, ts: number) => {
      const prev = this.previousRtpSnapshots.get(key);
      this.previousRtpSnapshots.set(key, { bytes, timestamp: ts });
      if (!prev || ts <= prev.timestamp || bytes < prev.bytes) return null;
      const deltaMs = ts - prev.timestamp;
      return deltaMs <= 0 ? null : ((bytes - prev.bytes) * 8) / deltaMs;
    };

    const outboundAudio = createEmptyMediaStats();
    const inboundAudio = createEmptyMediaStats();
    const outboundVideo = createEmptyMediaStats();
    const inboundVideo = createEmptyMediaStats();

    const peerConnections = this.getTransportPeerConnections().filter((entry) => entry.pc);
    const sendPc = peerConnections.find((entry) => entry.direction === 'send')?.pc ?? null;
    const recvPc = peerConnections.find((entry) => entry.direction === 'recv')?.pc ?? null;

    let selectedPair: any = null;
    let selectedLocalCandidate: any = null;
    let selectedRemoteCandidate: any = null;

    for (const entry of peerConnections) {
      const pc = entry.pc;
      if (!pc) continue;

      try {
        const report = await pc.getStats();
        const localCandidates = new Map<string, any>();
        const remoteCandidates = new Map<string, any>();
        let pcSelectedPair: any = null;

        for (const stat of report.values()) {
          if (stat.type === 'local-candidate') {
            localCandidates.set(stat.id, stat);
            continue;
          }
          if (stat.type === 'remote-candidate') {
            remoteCandidates.set(stat.id, stat);
            continue;
          }
          if (stat.type === 'candidate-pair') {
            const pair = stat as any;
            if (pair.nominated || pair.selected || pair.state === 'succeeded') {
              pcSelectedPair = pair;
            }
            continue;
          }
          if (stat.type === 'outbound-rtp') {
            const r = stat as any;
            if (r.isRemote) continue;
            const kind = r.kind ?? r.mediaType ?? 'audio';
            const bitrateKbps = typeof r.bytesSent === 'number'
              ? computeKbpsFromSnapshot(`sfu:${entry.direction}:out:${r.id}`, r.bytesSent, r.timestamp)
              : null;
            accumulateMediaStats(kind === 'video' ? outboundVideo : outboundAudio, {
              bitrateKbps,
              packets: r.packetsSent ?? null,
              framesPerSecond: r.framesPerSecond ?? null,
              frameWidth: r.frameWidth ?? null,
              frameHeight: r.frameHeight ?? null,
            });
            continue;
          }
          if (stat.type === 'inbound-rtp') {
            const r = stat as any;
            const kind = r.kind ?? r.mediaType ?? 'audio';
            const bitrateKbps = typeof r.bytesReceived === 'number'
              ? computeKbpsFromSnapshot(`sfu:${entry.direction}:in:${r.id}`, r.bytesReceived, r.timestamp)
              : null;
            accumulateMediaStats(kind === 'video' ? inboundVideo : inboundAudio, {
              bitrateKbps,
              packets: r.packetsReceived ?? null,
              packetsLost: r.packetsLost ?? null,
              jitterMs: typeof r.jitter === 'number' ? r.jitter * 1000 : null,
              framesPerSecond: r.framesPerSecond ?? null,
              frameWidth: r.frameWidth ?? null,
              frameHeight: r.frameHeight ?? null,
            });
          }
        }

        const isPreferredPair =
          !selectedPair || (entry.direction === 'send' && selectedPair.__direction !== 'send');
        if (pcSelectedPair && isPreferredPair) {
          selectedPair = { ...pcSelectedPair, __direction: entry.direction };
          selectedLocalCandidate = pcSelectedPair.localCandidateId ? localCandidates.get(pcSelectedPair.localCandidateId) : null;
          selectedRemoteCandidate = pcSelectedPair.remoteCandidateId ? remoteCandidates.get(pcSelectedPair.remoteCandidateId) : null;
        }
      } catch {
        // Best-effort diagnostics; one transport failing should not suppress all stats.
      }
    }

    const primaryPc = sendPc ?? recvPc;
    const fallbackConnectionState = this.sendTransportState === 'connected' ? 'connected' : 'connecting';

    return [{
      userId: 'sfu-server',
      username: 'Voice Server (Mediasoup SFU)',
      connectionState: primaryPc?.connectionState ?? fallbackConnectionState,
      iceConnectionState: primaryPc?.iceConnectionState ?? fallbackConnectionState,
      signalingState: primaryPc?.signalingState ?? 'stable',
      currentRttMs: typeof selectedPair?.currentRoundTripTime === 'number' ? selectedPair.currentRoundTripTime * 1000 : null,
      availableOutgoingBitrateKbps: typeof selectedPair?.availableOutgoingBitrate === 'number' ? selectedPair.availableOutgoingBitrate / 1000 : null,
      localCandidateType: selectedLocalCandidate?.candidateType ?? 'sfu',
      remoteCandidateType: selectedRemoteCandidate?.candidateType ?? 'sfu',
      outboundAudio,
      inboundAudio,
      outboundVideo,
      inboundVideo,
    }];
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
        void this.request('close-producer', { producerId }).catch(() => { });
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
    this.audioProducer.on('transportclose', () => {
      this.audioProducer = null;
    });
  }

  async replaceLocalVideoTrack(track: MediaStreamTrack | null, source: 'screen' | 'camera' | null): Promise<void> {
    if (this.reconnecting) {
      this.pendingLocalVideoTrack = track;
      this.pendingLocalVideoTrackSource = source;
      return;
    }
    if (this.closed || !this.sendTransport || !this.device) {
      return;
    }
    if (!track) {
      if (this.videoProducer) {
        const producerId = this.videoProducer.id;
        this.videoProducer.close();
        this.videoProducer = null;
        void this.request('close-producer', { producerId }).catch(() => { });
      }
      return;
    }
    if (!this.device.canProduce('video')) {
      return;
    }
    if (this.videoProducer) {
      await this.videoProducer.replaceTrack({ track });
      return;
    }
    this.videoProducer = await this.sendTransport.produce({
      track,
      appData: { type: 'voice-video', source },
      encodings: [
        { maxBitrate: 2500000 }
      ]
    } as any);
    this.videoProducer.on('transportclose', () => {
      this.videoProducer = null;
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
      if (producer.userId === this.selfUserId) {
        continue;
      }
      activeProducerIds.add(producer.producerId);
      this.producerOwnerById.set(producer.producerId, producer.userId);
      try {
        await this.consumeProducer(producer.producerId, producer.userId, producer.appData);
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
      if (payload.producer.userId === this.selfUserId) {
        return;
      }
      this.producerOwnerById.set(payload.producer.producerId, payload.producer.userId);
      try {
        await this.consumeProducer(payload.producer.producerId, payload.producer.userId, payload.producer.appData);
      } catch {
        // Reconcile later via sync rather than surfacing an unhandled rejection that can break audio updates.
        void this.syncProducers().catch(() => { });
      }
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
    this.sendTransportState = 'closed';
    this.previousRtpSnapshots.clear();
    this.clearReconnectTimer();
    this.clearKeepaliveTimer();
    this.iceRestartInProgress.clear();
    if (this.audioProducer) {
      const producerId = this.audioProducer.id;
      this.audioProducer.close();
      this.audioProducer = null;
      void this.request('close-producer', { producerId }).catch(() => { });
    }
    if (this.videoProducer) {
      const producerId = this.videoProducer.id;
      this.videoProducer.close();
      this.videoProducer = null;
      void this.request('close-producer', { producerId }).catch(() => { });
    }
    for (const producerId of Array.from(this.consumerByProducerId.keys())) {
      this.removeConsumerByProducerId(producerId);
    }
    this.consumerByProducerId.clear();
    this.producerOwnerById.clear();
    void this.requestCloseTransport(this.sendTransport);
    void this.requestCloseTransport(this.recvTransport);
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
    this.pendingLocalAudioTrack = null;
    this.pendingLocalVideoTrack = null;
    this.pendingLocalVideoTrackSource = null;
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
      if (direction === 'send' && transport === this.sendTransport) {
        this.sendTransportState = state;
      }
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

    const currentVideoTrack =
      this.pendingLocalVideoTrack ??
      this.videoProducer?.track ??
      null;
    const currentVideoTrackSource =
      this.pendingLocalVideoTrackSource ??
      ((this.videoProducer as any)?.appData?.source as 'screen' | 'camera' | null) ??
      null;
    this.pendingLocalVideoTrack = null;
    this.pendingLocalVideoTrackSource = null;

    // Clean up old transports and clear remote state so dead streams do not linger in the UI.
    await this.cleanupTransportsOnly();

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

      // Re-produce video if we had a track
      if (currentVideoTrack && currentVideoTrack.readyState === 'live' && this.device?.canProduce('video')) {
        this.videoProducer = await this.sendTransport.produce({
          track: currentVideoTrack,
          appData: { type: 'voice-video', source: currentVideoTrackSource },
          encodings: [{ maxBitrate: 2500000 }]
        } as any);
        this.videoProducer.on('transportclose', () => {
          this.videoProducer = null;
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

  private async requestCloseTransport(transport: mediasoupTypes.Transport | null): Promise<void> {
    if (!transport) return;
    try {
      await this.request('close-transport', { transportId: transport.id }, 3000);
    } catch {
      // Best effort. Local transport close still happens below.
    }
  }

  private async cleanupTransportsOnly(): Promise<void> {
    const sendTransport = this.sendTransport;
    const recvTransport = this.recvTransport;
    if (this.audioProducer) {
      try { this.audioProducer.close(); } catch { void 0; }
      this.audioProducer = null;
    }
    if (this.videoProducer) {
      try { this.videoProducer.close(); } catch { void 0; }
      this.videoProducer = null;
    }
    for (const consumer of this.consumerByProducerId.values()) {
      try { consumer.close(); } catch { void 0; }
    }
    this.consumerByProducerId.clear();
    this.producerOwnerById.clear();
    for (const userId of this.remoteAudioStreamByUserId.keys()) {
      this.callbacks.onRemoteAudioRemoved(userId);
    }
    for (const userId of this.remoteVideoStreamByUserId.keys()) {
      this.callbacks.onRemoteVideoRemoved?.(userId);
    }
    this.remoteAudioStreamByUserId.clear();
    this.remoteVideoStreamByUserId.clear();
    this.previousRtpSnapshots.clear();
    this.sendTransportState = 'new';
    this.sendTransport = null;
    this.recvTransport = null;
    try { sendTransport?.close(); } catch { void 0; }
    try { recvTransport?.close(); } catch { void 0; }
    await Promise.allSettled([
      this.requestCloseTransport(sendTransport),
      this.requestCloseTransport(recvTransport),
    ]);
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

  private async consumeProducer(producerId: string, userId: string, producerAppData?: Record<string, unknown>): Promise<void> {
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
    if (consumer.track.kind === 'audio') {
      this.remoteAudioStreamByUserId.set(userId, stream);
      this.callbacks.onRemoteAudio(userId, stream);
    } else {
      let source: 'screen' | 'camera' = 'camera';
      if (producerAppData && typeof producerAppData.source === 'string') {
        source = producerAppData.source as 'screen' | 'camera';
      }
      this.remoteVideoStreamByUserId.set(userId, stream);
      this.callbacks.onRemoteVideo?.(userId, stream, source);
    }
  }

  private removeConsumerByProducerId(producerId: string) {
    const consumer = this.consumerByProducerId.get(producerId);
    const kind = consumer?.track.kind;
    if (consumer) {
      consumer.close();
      this.consumerByProducerId.delete(producerId);
    }
    const ownerUserId = this.producerOwnerById.get(producerId);
    if (!ownerUserId) {
      return;
    }
    this.producerOwnerById.delete(producerId);

    const hasRemainingProducerForUserOfSameKind = Array.from(this.producerOwnerById.entries()).some(
      ([id, userId]) => userId === ownerUserId && this.consumerByProducerId.get(id)?.track.kind === kind,
    );
    if (hasRemainingProducerForUserOfSameKind) {
      return;
    }

    if (kind === 'audio') {
      this.remoteAudioStreamByUserId.delete(ownerUserId);
      this.callbacks.onRemoteAudioRemoved(ownerUserId);
    } else if (kind === 'video') {
      this.remoteVideoStreamByUserId.delete(ownerUserId);
      this.callbacks.onRemoteVideoRemoved?.(ownerUserId);
    }
  }

  private async requestWithRetry<TData = unknown>(
    action: VoiceSfuRequestAction,
    data?: unknown,
    timeoutMs = VoiceSfuClient.REQUEST_TIMEOUT_MS,
  ): Promise<TData> {
    const maxRetries = 3;
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.request<TData>(action, data, timeoutMs);
      } catch (error) {
        lastError = error;
        if (this.closed) {
          throw error;
        }
        const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        const isRetryable = VoiceSfuClient.RETRYABLE_ERROR_PATTERNS.some((pattern) =>
          message.includes(pattern),
        );
        if (!isRetryable || attempt >= maxRetries) {
          throw error;
        }
        // Exponential backoff: 500ms, 1500ms, 3500ms
        const delay = 500 * Math.pow(2, attempt) - 500 + 500;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }
}
