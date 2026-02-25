import type { types as mediasoupTypes } from 'mediasoup-client';
import type { VoiceSfuEventPayload } from '../../hooks/use-chat-socket';
import { chatApi } from '../../api/chat-api';
import type { VoiceSignalData } from './utils/voice-signaling';
import type { VoiceSfuClientLike } from './voice-sfu-client';

type StreamSource = 'screen' | 'camera';

type CloudflareVoiceSfuCallbacks = {
  onRemoteAudio: (userId: string, stream: MediaStream) => void;
  onRemoteAudioRemoved: (userId: string) => void;
  onRemoteVideo?: (userId: string, stream: MediaStream, source: StreamSource) => void;
  onRemoteVideoRemoved?: (userId: string) => void;
  onStateChange?: (state: mediasoupTypes.ConnectionState) => void;
};

type CloudflareTrackKind = 'audio' | 'video';

type AnnouncedRemoteTrack = {
  fromUserId: string;
  remoteSessionId: string;
  trackName: string;
  mediaKind: CloudflareTrackKind;
  source: StreamSource | null;
};

type SubscribedRemoteTrack = AnnouncedRemoteTrack & {
  mid: string | null;
};

type LocalPublishedTrack = {
  trackName: string;
  mediaKind: CloudflareTrackKind;
  source: StreamSource | null;
  mid: string | null;
};

type CloudflareTrackResponse = {
  trackName?: string;
  sessionId?: string;
  mid?: string;
  transceiverMid?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function getBoolean(value: unknown): boolean {
  return value === true;
}

function extractSessionId(body: Record<string, unknown>): string | null {
  const direct = getString(body.sessionId);
  if (direct) return direct;
  const session = asRecord(body.session);
  return session ? getString(session.id) : null;
}

function extractSessionDescription(body: Record<string, unknown>): RTCSessionDescriptionInit | null {
  const desc = asRecord(body.sessionDescription);
  if (!desc) return null;
  const type = getString(desc.type);
  const sdp = getString(desc.sdp);
  if (!type || !sdp) return null;
  if (type !== 'offer' && type !== 'answer') return null;
  return { type, sdp };
}

function extractTracks(body: Record<string, unknown>): CloudflareTrackResponse[] {
  const tracks = body.tracks;
  if (!Array.isArray(tracks)) return [];
  const parsed: CloudflareTrackResponse[] = [];
  for (const item of tracks) {
    const record = asRecord(item);
    if (!record) continue;
    parsed.push({
      trackName: getString(record.trackName) ?? undefined,
      sessionId: getString(record.sessionId) ?? undefined,
      mid: getString(record.mid) ?? undefined,
      transceiverMid: getString(record.transceiverMid) ?? undefined,
    });
  }
  return parsed;
}

function getTrackKey(remoteSessionId: string, trackName: string): string {
  return `${remoteSessionId}::${trackName}`;
}

function normalizeConnectionState(state: RTCPeerConnectionState): mediasoupTypes.ConnectionState {
  if (
    state === 'new' ||
    state === 'connecting' ||
    state === 'connected' ||
    state === 'disconnected' ||
    state === 'failed' ||
    state === 'closed'
  ) {
    return state;
  }
  return 'new';
}

export class CloudflareVoiceSfuClient implements VoiceSfuClientLike {
  private readonly selfUserId: string;
  private readonly channelId: string;
  private readonly authToken: string;
  private readonly rtcConfiguration: RTCConfiguration;
  private readonly callbacks: CloudflareVoiceSfuCallbacks;
  private readonly sendVoiceSignalToPeer: (targetUserId: string, data: VoiceSignalData) => boolean;
  private readonly getTargetPeerUserIds: () => string[];

  private pc: RTCPeerConnection | null = null;
  private audioTransceiver: RTCRtpTransceiver | null = null;
  private videoTransceiver: RTCRtpTransceiver | null = null;
  private localVideoSource: StreamSource | null = null;
  private sessionId: string | null = null;
  private connected = false;
  private closed = false;
  private operationChain: Promise<void> = Promise.resolve();
  private readonly previousRtpSnapshots = new Map<string, { bytes: number; timestamp: number }>();

  private localAudioPublished: LocalPublishedTrack | null = null;
  private localVideoPublished: LocalPublishedTrack | null = null;

  private readonly remotePeerSessionIdByUserId = new Map<string, string>();
  private readonly announcedRemoteTracksByKey = new Map<string, AnnouncedRemoteTrack>();
  private readonly subscribedRemoteTracksByKey = new Map<string, SubscribedRemoteTrack>();
  private readonly remoteTrackKeyByMid = new Map<string, string>();
  private readonly pendingRemoteTrackKeysByKind: Record<CloudflareTrackKind, string[]> = {
    audio: [],
    video: [],
  };
  private readonly pendingIncomingTrackEventsByMid = new Map<string, RTCTrackEvent>();
  private readonly pendingIncomingTrackEventsByKind: Record<CloudflareTrackKind, RTCTrackEvent[]> = {
    audio: [],
    video: [],
  };
  private readonly lastCloudflareSignalSignatureByPeerScope = new Map<string, { signature: string; at: number }>();
  private readonly remoteAudioStreamByUserId = new Map<string, MediaStream>();
  private readonly remoteVideoStreamByUserId = new Map<string, MediaStream>();

  constructor(params: {
    selfUserId: string;
    channelId: string;
    authToken: string;
    rtcConfiguration: RTCConfiguration;
    callbacks: CloudflareVoiceSfuCallbacks;
    sendVoiceSignalToPeer: (targetUserId: string, data: VoiceSignalData) => boolean;
    getTargetPeerUserIds: () => string[];
  }) {
    this.selfUserId = params.selfUserId;
    this.channelId = params.channelId;
    this.authToken = params.authToken;
    this.rtcConfiguration = params.rtcConfiguration;
    this.callbacks = params.callbacks;
    this.sendVoiceSignalToPeer = params.sendVoiceSignalToPeer;
    this.getTargetPeerUserIds = params.getTargetPeerUserIds;
  }

  async start(localAudioTrack: MediaStreamTrack | null): Promise<void> {
    return this.enqueue(async () => {
      this.closed = false;
      this.connected = false;
      this.stopPeerConnectionOnly();
      this.previousRtpSnapshots.clear();
      this.localVideoSource = null;
      this.sessionId = null;
      this.localAudioPublished = null;
      this.localVideoPublished = null;
      this.remotePeerSessionIdByUserId.clear();
      this.announcedRemoteTracksByKey.clear();
      this.subscribedRemoteTracksByKey.clear();
      this.remoteTrackKeyByMid.clear();
      this.pendingRemoteTrackKeysByKind.audio = [];
      this.pendingRemoteTrackKeysByKind.video = [];
      this.pendingIncomingTrackEventsByMid.clear();
      this.pendingIncomingTrackEventsByKind.audio = [];
      this.pendingIncomingTrackEventsByKind.video = [];
      this.lastCloudflareSignalSignatureByPeerScope.clear();
      this.removeAllRemoteMedia();

      const pc = new RTCPeerConnection(this.rtcConfiguration);
      this.pc = pc;
      this.bindPeerConnectionEvents(pc);

      this.audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
      this.videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });

      await this.audioTransceiver.sender.replaceTrack(localAudioTrack);
      await this.videoTransceiver.sender.replaceTrack(null);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.waitForIceGatheringComplete(pc);

      const createResponse = await chatApi.cloudflareSfuCreateSession(this.authToken, {
        sessionDescription: pc.localDescription,
      });
      const sessionId = extractSessionId(createResponse);
      if (!sessionId) {
        throw new Error('Cloudflare SFU create session response missing sessionId');
      }
      this.sessionId = sessionId;

      await this.applyCloudflareNegotiationResponse(createResponse);
      await this.publishAvailableLocalTracks();
      await this.syncProducersInternal();
    });
  }

  isConnected(): boolean {
    return !this.closed && this.connected;
  }

  async getDetailedStats(): Promise<any[]> {
    const pc = this.pc;
    if (this.closed || !pc) return [];

    const createEmptyMediaStats = () => ({
      bitrateKbps: null as number | null,
      packets: null as number | null,
      packetsLost: null as number | null,
      jitterMs: null as number | null,
      framesPerSecond: null as number | null,
      frameWidth: null as number | null,
      frameHeight: null as number | null,
    });
    const accumulate = (
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
    const computeKbps = (key: string, bytes: number, ts: number) => {
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

    let selectedPair: any = null;
    let localCandidate: any = null;
    let remoteCandidate: any = null;

    try {
      const report = await pc.getStats();
      const localCandidates = new Map<string, any>();
      const remoteCandidates = new Map<string, any>();

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
            selectedPair = pair;
          }
          continue;
        }
        if (stat.type === 'outbound-rtp') {
          const r = stat as any;
          if (r.isRemote) continue;
          const kind = (r.kind ?? r.mediaType ?? 'audio') as CloudflareTrackKind;
          const bitrateKbps = typeof r.bytesSent === 'number'
            ? computeKbps(`cf:out:${r.id}`, r.bytesSent, r.timestamp)
            : null;
          accumulate(kind === 'video' ? outboundVideo : outboundAudio, {
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
          const kind = (r.kind ?? r.mediaType ?? 'audio') as CloudflareTrackKind;
          const bitrateKbps = typeof r.bytesReceived === 'number'
            ? computeKbps(`cf:in:${r.id}`, r.bytesReceived, r.timestamp)
            : null;
          accumulate(kind === 'video' ? inboundVideo : inboundAudio, {
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

      if (selectedPair) {
        localCandidate = selectedPair.localCandidateId ? localCandidates.get(selectedPair.localCandidateId) : null;
        remoteCandidate = selectedPair.remoteCandidateId ? remoteCandidates.get(selectedPair.remoteCandidateId) : null;
      }
    } catch {
      return [];
    }

    return [{
      userId: 'sfu-server',
      username: 'Voice Server (Cloudflare SFU)',
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      signalingState: pc.signalingState,
      currentRttMs: typeof selectedPair?.currentRoundTripTime === 'number' ? selectedPair.currentRoundTripTime * 1000 : null,
      availableOutgoingBitrateKbps: typeof selectedPair?.availableOutgoingBitrate === 'number' ? selectedPair.availableOutgoingBitrate / 1000 : null,
      localCandidateType: localCandidate?.candidateType ?? 'sfu',
      remoteCandidateType: remoteCandidate?.candidateType ?? 'sfu',
      outboundAudio,
      inboundAudio,
      outboundVideo,
      inboundVideo,
    }];
  }

  async replaceLocalAudioTrack(track: MediaStreamTrack | null): Promise<void> {
    return this.enqueue(async () => {
      if (this.closed || !this.pc || !this.audioTransceiver) return;
      await this.audioTransceiver.sender.replaceTrack(track);
      if (track && track.readyState === 'live') {
        await this.ensureLocalTrackPublished('audio', null);
      } else {
        await this.unpublishLocalTrack('audio');
      }
    });
  }

  async replaceLocalVideoTrack(track: MediaStreamTrack | null, source: StreamSource | null): Promise<void> {
    return this.enqueue(async () => {
      this.localVideoSource = source;
      if (this.closed || !this.pc || !this.videoTransceiver) return;
      await this.videoTransceiver.sender.replaceTrack(track);
      if (track && track.readyState === 'live') {
        await this.ensureLocalTrackPublished('video', source);
      } else {
        await this.unpublishLocalTrack('video');
      }
    });
  }

  async syncProducers(): Promise<void> {
    return this.enqueue(async () => {
      if (this.closed) return;
      await this.syncProducersInternal();
    });
  }

  async handleSfuEvent(_payload: VoiceSfuEventPayload): Promise<void> {
    return;
  }

  async handleVoiceSignalData(payload: { channelId: string; fromUserId: string; data: VoiceSignalData }): Promise<void> {
    return this.enqueue(async () => {
      if (this.closed) return;
      if (payload.channelId !== this.channelId) return;
      const { fromUserId, data } = payload;
      if (data.kind === 'cloudflare-sfu-session') {
        const previous = this.remotePeerSessionIdByUserId.get(fromUserId);
        this.remotePeerSessionIdByUserId.set(fromUserId, data.sessionId);
        if (previous && previous !== data.sessionId) {
          await this.removeRemoteTrackStateForUser(fromUserId, previous);
          for (const [key, track] of Array.from(this.announcedRemoteTracksByKey.entries())) {
            if (track.fromUserId === fromUserId && track.remoteSessionId !== data.sessionId) {
              this.announcedRemoteTracksByKey.delete(key);
            }
          }
        }
        await this.reconcileRemoteSubscriptions();
        return;
      }
      if (data.kind !== 'cloudflare-sfu-track') {
        return;
      }

      const key = getTrackKey(data.sessionId, data.trackName);
      if (data.op === 'remove') {
        this.announcedRemoteTracksByKey.delete(key);
        await this.unsubscribeRemoteTrack(key, true);
        return;
      }

      const announced: AnnouncedRemoteTrack = {
        fromUserId,
        remoteSessionId: data.sessionId,
        trackName: data.trackName,
        mediaKind: data.mediaKind,
        source: data.source,
      };
      this.announcedRemoteTracksByKey.set(key, announced);

      const existingStream =
        data.mediaKind === 'audio'
          ? this.remoteAudioStreamByUserId.get(fromUserId)
          : this.remoteVideoStreamByUserId.get(fromUserId);
      if (existingStream && data.mediaKind === 'video') {
        this.callbacks.onRemoteVideo?.(fromUserId, existingStream, data.source ?? 'camera');
      }

      await this.reconcileRemoteSubscriptions();
    });
  }

  stop(): void {
    this.closed = true;
    this.connected = false;
    this.previousRtpSnapshots.clear();
    this.localAudioPublished = null;
    this.localVideoPublished = null;
    this.sessionId = null;
    this.remotePeerSessionIdByUserId.clear();
    this.announcedRemoteTracksByKey.clear();
    this.subscribedRemoteTracksByKey.clear();
    this.remoteTrackKeyByMid.clear();
    this.pendingRemoteTrackKeysByKind.audio = [];
    this.pendingRemoteTrackKeysByKind.video = [];
    this.pendingIncomingTrackEventsByMid.clear();
    this.pendingIncomingTrackEventsByKind.audio = [];
    this.pendingIncomingTrackEventsByKind.video = [];
    this.lastCloudflareSignalSignatureByPeerScope.clear();
    this.stopPeerConnectionOnly();
    this.removeAllRemoteMedia();
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.operationChain.then(task, task);
    this.operationChain = run.catch(() => { });
    return run;
  }

  private bindPeerConnectionEvents(pc: RTCPeerConnection): void {
    pc.addEventListener('connectionstatechange', () => {
      if (this.pc !== pc) return;
      this.connected = pc.connectionState === 'connected';
      this.callbacks.onStateChange?.(normalizeConnectionState(pc.connectionState));
    });
    pc.addEventListener('track', (event) => {
      if (this.pc !== pc || this.closed) return;
      this.handleIncomingTrackEvent(event);
    });
  }

  private handleIncomingTrackEvent(event: RTCTrackEvent): void {
    const track = event.track;
    const kind = track.kind === 'video' ? 'video' : 'audio';
    const mid = event.transceiver?.mid ?? null;
    let key = mid ? this.remoteTrackKeyByMid.get(mid) ?? null : null;
    if (!key) {
      const queue = this.pendingRemoteTrackKeysByKind[kind];
      key = queue.shift() ?? null;
    }
    if (!key) {
      if (mid) {
        this.pendingIncomingTrackEventsByMid.set(mid, event);
      } else {
        this.pendingIncomingTrackEventsByKind[kind].push(event);
      }
      return;
    }

    this.attachIncomingTrackToSubscription(key, event);
  }

  private attachIncomingTrackToSubscription(key: string, event: RTCTrackEvent): void {
    const track = event.track;
    const kind = track.kind === 'video' ? 'video' : 'audio';
    const mid = event.transceiver?.mid ?? null;
    const subscription = this.subscribedRemoteTracksByKey.get(key);
    if (!subscription) {
      return;
    }
    if (mid) {
      this.remoteTrackKeyByMid.set(mid, key);
      subscription.mid = mid;
      this.subscribedRemoteTracksByKey.set(key, subscription);
    }

    const stream = new MediaStream([track]);
    if (kind === 'audio') {
      this.remoteAudioStreamByUserId.set(subscription.fromUserId, stream);
      this.callbacks.onRemoteAudio(subscription.fromUserId, stream);
    } else {
      this.remoteVideoStreamByUserId.set(subscription.fromUserId, stream);
      this.callbacks.onRemoteVideo?.(subscription.fromUserId, stream, subscription.source ?? 'camera');
    }

    track.addEventListener('ended', () => {
      const current = this.subscribedRemoteTracksByKey.get(key);
      if (!current) return;
      this.removeRemoteMediaForUserKind(current.fromUserId, current.mediaKind);
    });
  }

  private async syncProducersInternal(): Promise<void> {
    if (!this.pc || !this.sessionId) return;
    await this.publishAvailableLocalTracks();
    this.broadcastLocalMetadata();
    await this.reconcileRemoteSubscriptions();
  }

  private async publishAvailableLocalTracks(): Promise<void> {
    await this.ensureLocalTrackPublished('audio', null);
    await this.ensureLocalTrackPublished('video', this.localVideoSource);
  }

  private async ensureLocalTrackPublished(kind: CloudflareTrackKind, source: StreamSource | null): Promise<void> {
    if (!this.pc || !this.sessionId) return;
    const transceiver = kind === 'audio' ? this.audioTransceiver : this.videoTransceiver;
    if (!transceiver) return;

    const track = transceiver.sender.track;
    const published = kind === 'audio' ? this.localAudioPublished : this.localVideoPublished;
    const hasLiveTrack = Boolean(track && track.readyState === 'live');
    if (!hasLiveTrack) {
      if (published) {
        await this.unpublishLocalTrack(kind);
      }
      return;
    }

    if (published) {
      if (kind === 'video' && published.source !== source) {
        const next = { ...published, source };
        this.localVideoPublished = next;
        this.broadcastTrackUpsert(next);
      }
      return;
    }

    const mid = transceiver.mid;
    if (!mid) {
      return;
    }
    const requestedTrackName = this.generateTrackName(kind);
    const addResponse = await chatApi.cloudflareSfuAddTracks(this.authToken, this.sessionId, {
      tracks: [
        {
          location: 'local',
          mid,
          trackName: requestedTrackName,
        },
      ],
    });

    const responseTracks = extractTracks(addResponse);
    const matchingTrack =
      responseTracks.find((item) => item.trackName === requestedTrackName) ??
      responseTracks[0];
    const trackName = matchingTrack?.trackName ?? requestedTrackName;
    const localPublished: LocalPublishedTrack = {
      trackName,
      mediaKind: kind,
      source,
      mid: matchingTrack?.mid ?? matchingTrack?.transceiverMid ?? mid,
    };

    if (kind === 'audio') {
      this.localAudioPublished = localPublished;
    } else {
      this.localVideoPublished = localPublished;
    }

    await this.applyCloudflareNegotiationResponse(addResponse);
    this.broadcastLocalSession();
    this.broadcastTrackUpsert(localPublished);
  }

  private async unpublishLocalTrack(kind: CloudflareTrackKind): Promise<void> {
    const published = kind === 'audio' ? this.localAudioPublished : this.localVideoPublished;
    if (!published) return;

    if (kind === 'audio') {
      this.localAudioPublished = null;
    } else {
      this.localVideoPublished = null;
    }

    const sessionId = this.sessionId;
    if (sessionId) {
      try {
        const response = await chatApi.cloudflareSfuCloseTracks(this.authToken, sessionId, {
          tracks: [
            {
              location: 'local',
              trackName: published.trackName,
              mid: published.mid,
            },
          ],
        });
        await this.applyCloudflareNegotiationResponse(response);
      } catch {
        // Best-effort cleanup. Metadata signaling below prevents stale UI state.
      }
    }

    this.broadcastTrackRemove(published);
  }

  private broadcastLocalMetadata(): void {
    this.broadcastLocalSession();
    if (this.localAudioPublished) {
      this.broadcastTrackUpsert(this.localAudioPublished);
    }
    if (this.localVideoPublished) {
      this.broadcastTrackUpsert(this.localVideoPublished);
    }
  }

  private broadcastLocalSession(): void {
    if (!this.sessionId) return;
    this.broadcastToPeers({
      kind: 'cloudflare-sfu-session',
      sessionId: this.sessionId,
    });
  }

  private broadcastTrackUpsert(track: LocalPublishedTrack): void {
    if (!this.sessionId) return;
    this.broadcastToPeers({
      kind: 'cloudflare-sfu-track',
      op: 'upsert',
      sessionId: this.sessionId,
      trackName: track.trackName,
      mediaKind: track.mediaKind,
      source: track.source,
    });
  }

  private broadcastTrackRemove(track: LocalPublishedTrack): void {
    if (!this.sessionId) return;
    this.broadcastToPeers({
      kind: 'cloudflare-sfu-track',
      op: 'remove',
      sessionId: this.sessionId,
      trackName: track.trackName,
      mediaKind: track.mediaKind,
      source: track.source,
    });
  }

  private broadcastToPeers(data: VoiceSignalData): void {
    const targetUserIds = this.getTargetPeerUserIds()
      .filter((userId) => userId && userId !== this.selfUserId);
    this.pruneCloudflareSignalBroadcastCache(targetUserIds);

    const now = Date.now();
    const scopeKey = this.getCloudflareSignalScopeKey(data);
    const signature = this.getCloudflareSignalSignature(data);

    for (const targetUserId of targetUserIds) {
      if (scopeKey && signature) {
        const dedupeKey = `${targetUserId}|${scopeKey}`;
        const previous = this.lastCloudflareSignalSignatureByPeerScope.get(dedupeKey);
        if (previous && previous.signature == signature && now - previous.at < 1200) {
          continue;
        }
        this.lastCloudflareSignalSignatureByPeerScope.set(dedupeKey, { signature, at: now });
      }
      this.sendVoiceSignalToPeer(targetUserId, data);
    }
  }

  private pruneCloudflareSignalBroadcastCache(activePeerUserIds: string[]): void {
    const active = new Set(activePeerUserIds);
    for (const key of Array.from(this.lastCloudflareSignalSignatureByPeerScope.keys())) {
      const separator = key.indexOf('|');
      const userId = separator >= 0 ? key.slice(0, separator) : key;
      if (!active.has(userId)) {
        this.lastCloudflareSignalSignatureByPeerScope.delete(key);
      }
    }
  }

  private getCloudflareSignalScopeKey(data: VoiceSignalData): string | null {
    if (data.kind === 'cloudflare-sfu-session') {
      return 'cf-session';
    }
    if (data.kind === 'cloudflare-sfu-track') {
      return `cf-track:${data.sessionId}:${data.trackName}`;
    }
    return null;
  }

  private getCloudflareSignalSignature(data: VoiceSignalData): string | null {
    if (data.kind === 'cloudflare-sfu-session') {
      return `session:${data.sessionId}`;
    }
    if (data.kind === 'cloudflare-sfu-track') {
      return `track:${data.op}:${data.sessionId}:${data.trackName}:${data.mediaKind}:${data.source ?? 'none'}`;
    }
    return null;
  }

  private async reconcileRemoteSubscriptions(): Promise<void> {
    if (!this.pc || !this.sessionId) return;

    for (const [key, sub] of Array.from(this.subscribedRemoteTracksByKey.entries())) {
      const announced = this.announcedRemoteTracksByKey.get(key);
      const activePeerSessionId = this.remotePeerSessionIdByUserId.get(sub.fromUserId);
      if (!announced || activePeerSessionId !== sub.remoteSessionId) {
        await this.unsubscribeRemoteTrack(key, true);
      }
    }

    for (const [key, announced] of this.announcedRemoteTracksByKey.entries()) {
      const activePeerSessionId = this.remotePeerSessionIdByUserId.get(announced.fromUserId);
      if (activePeerSessionId !== announced.remoteSessionId) {
        continue;
      }
      if (this.subscribedRemoteTracksByKey.has(key)) {
        const existing = this.subscribedRemoteTracksByKey.get(key)!;
        if (existing.source !== announced.source) {
          const updated = { ...existing, source: announced.source };
          this.subscribedRemoteTracksByKey.set(key, updated);
          if (existing.mediaKind === 'video') {
            const stream = this.remoteVideoStreamByUserId.get(existing.fromUserId);
            if (stream) {
              this.callbacks.onRemoteVideo?.(existing.fromUserId, stream, announced.source ?? 'camera');
            }
          }
        }
        continue;
      }
      await this.subscribeRemoteTrack(announced);
    }
  }

  private async subscribeRemoteTrack(announced: AnnouncedRemoteTrack): Promise<void> {
    if (!this.sessionId) return;
    const key = getTrackKey(announced.remoteSessionId, announced.trackName);
    if (this.subscribedRemoteTracksByKey.has(key)) return;

    const knownMidsBefore = this.collectKnownRemoteMids();
    const addResponse = await chatApi.cloudflareSfuAddTracks(this.authToken, this.sessionId, {
      tracks: [
        {
          location: 'remote',
          sessionId: announced.remoteSessionId,
          trackName: announced.trackName,
        },
      ],
    });

    const responseTracks = extractTracks(addResponse);
    const responseTrack =
      responseTracks.find((track) =>
        track.trackName === announced.trackName &&
        (!track.sessionId || track.sessionId === announced.remoteSessionId),
      ) ?? responseTracks[0];
    let mid = responseTrack?.mid ?? responseTrack?.transceiverMid ?? null;

    await this.applyCloudflareNegotiationResponse(addResponse);

    if (!mid) {
      mid = this.findNewRemoteMidForKind(announced.mediaKind, knownMidsBefore);
    }

    this.subscribedRemoteTracksByKey.set(key, { ...announced, mid });
    if (mid) {
      this.remoteTrackKeyByMid.set(mid, key);
    } else {
      this.pendingRemoteTrackKeysByKind[announced.mediaKind].push(key);
    }
    this.flushPendingIncomingTrackForSubscription(key);
  }

  private async unsubscribeRemoteTrack(key: string, notifyCloudflare: boolean): Promise<void> {
    const subscription = this.subscribedRemoteTracksByKey.get(key);
    if (!subscription) return;
    this.subscribedRemoteTracksByKey.delete(key);
    if (subscription.mid) {
      this.remoteTrackKeyByMid.delete(subscription.mid);
    }
    const pendingQueue = this.pendingRemoteTrackKeysByKind[subscription.mediaKind];
    const pendingIndex = pendingQueue.indexOf(key);
    if (pendingIndex >= 0) {
      pendingQueue.splice(pendingIndex, 1);
    }

    if (notifyCloudflare && this.sessionId) {
      try {
        const response = await chatApi.cloudflareSfuCloseTracks(this.authToken, this.sessionId, {
          tracks: [
            {
              location: 'remote',
              sessionId: subscription.remoteSessionId,
              trackName: subscription.trackName,
            },
          ],
        });
        await this.applyCloudflareNegotiationResponse(response);
      } catch {
        // Best effort. Local cleanup below is still applied.
      }
    }

    const hasSameKindForUser = Array.from(this.subscribedRemoteTracksByKey.values()).some(
      (track) =>
        track.fromUserId === subscription.fromUserId &&
        track.mediaKind === subscription.mediaKind,
    );
    if (!hasSameKindForUser) {
      this.removeRemoteMediaForUserKind(subscription.fromUserId, subscription.mediaKind);
    }
  }

  private async removeRemoteTrackStateForUser(userId: string, previousRemoteSessionId: string): Promise<void> {
    for (const [key, track] of Array.from(this.subscribedRemoteTracksByKey.entries())) {
      if (track.fromUserId === userId && track.remoteSessionId === previousRemoteSessionId) {
        await this.unsubscribeRemoteTrack(key, true);
      }
    }
    this.removeRemoteMediaForUserKind(userId, 'audio');
    this.removeRemoteMediaForUserKind(userId, 'video');
  }

  private removeRemoteMediaForUserKind(userId: string, kind: CloudflareTrackKind): void {
    if (kind === 'audio') {
      if (this.remoteAudioStreamByUserId.delete(userId)) {
        this.callbacks.onRemoteAudioRemoved(userId);
      }
      return;
    }
    if (this.remoteVideoStreamByUserId.delete(userId)) {
      this.callbacks.onRemoteVideoRemoved?.(userId);
    }
  }

  private removeAllRemoteMedia(): void {
    for (const userId of this.remoteAudioStreamByUserId.keys()) {
      this.callbacks.onRemoteAudioRemoved(userId);
    }
    for (const userId of this.remoteVideoStreamByUserId.keys()) {
      this.callbacks.onRemoteVideoRemoved?.(userId);
    }
    this.remoteAudioStreamByUserId.clear();
    this.remoteVideoStreamByUserId.clear();
  }

  private stopPeerConnectionOnly(): void {
    try {
      this.pc?.close();
    } catch {
      // Ignore.
    }
    this.pc = null;
    this.audioTransceiver = null;
    this.videoTransceiver = null;
  }

  private collectKnownRemoteMids(): Set<string> {
    const mids = new Set<string>();
    for (const mid of this.remoteTrackKeyByMid.keys()) {
      mids.add(mid);
    }
    const pc = this.pc;
    if (!pc) return mids;
    for (const transceiver of pc.getTransceivers()) {
      const mid = transceiver.mid;
      if (mid) {
        mids.add(mid);
      }
    }
    return mids;
  }

  private findNewRemoteMidForKind(kind: CloudflareTrackKind, knownMidsBefore: Set<string>): string | null {
    const pc = this.pc;
    if (!pc) return null;
    for (const transceiver of pc.getTransceivers()) {
      const mid = transceiver.mid;
      if (!mid || knownMidsBefore.has(mid) || this.remoteTrackKeyByMid.has(mid)) {
        continue;
      }
      const receiverTrackKind = transceiver.receiver.track.kind === 'video' ? 'video' : 'audio';
      if (receiverTrackKind !== kind) {
        continue;
      }
      return mid;
    }
    return null;
  }

  private flushPendingIncomingTrackForSubscription(key: string): void {
    const subscription = this.subscribedRemoteTracksByKey.get(key);
    if (!subscription) return;

    if (subscription.mid) {
      const pendingByMid = this.pendingIncomingTrackEventsByMid.get(subscription.mid);
      if (pendingByMid) {
        this.pendingIncomingTrackEventsByMid.delete(subscription.mid);
        this.attachIncomingTrackToSubscription(key, pendingByMid);
        return;
      }
    }

    const pendingQueue = this.pendingIncomingTrackEventsByKind[subscription.mediaKind];
    if (pendingQueue.length > 0) {
      const pendingEvent = pendingQueue.shift();
      if (pendingEvent) {
        this.attachIncomingTrackToSubscription(key, pendingEvent);
      }
    }
  }

  private async applyCloudflareNegotiationResponse(body: Record<string, unknown>): Promise<void> {
    const pc = this.pc;
    const sessionId = this.sessionId;
    if (!pc || !sessionId || this.closed) return;

    let sessionDescription = extractSessionDescription(body);
    if (!sessionDescription && getBoolean(body.requiresImmediateRenegotiation)) {
      try {
        const sessionResponse = await chatApi.cloudflareSfuGetSession(this.authToken, sessionId);
        sessionDescription = extractSessionDescription(sessionResponse);
      } catch {
        sessionDescription = null;
      }
    }
    if (!sessionDescription) return;

    if (sessionDescription.type === 'answer') {
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(sessionDescription);
      }
      return;
    }

    if (pc.signalingState === 'have-local-offer') {
      try {
        await pc.setLocalDescription({ type: 'rollback' });
      } catch {
        // If rollback fails, best effort continue and let setRemoteDescription throw.
      }
    }

    await pc.setRemoteDescription(sessionDescription);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this.waitForIceGatheringComplete(pc);
    await chatApi.cloudflareSfuRenegotiate(this.authToken, sessionId, {
      sessionDescription: pc.localDescription,
    });
  }

  private async waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') {
      return;
    }
    await new Promise<void>((resolve) => {
      const onChange = () => {
        if (pc.iceGatheringState !== 'complete') {
          return;
        }
        pc.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      };
      pc.addEventListener('icegatheringstatechange', onChange);
      window.setTimeout(() => {
        pc.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      }, 3000);
    });
  }

  private generateTrackName(kind: CloudflareTrackKind): string {
    const nonce = Math.random().toString(36).slice(2, 10);
    return `${this.selfUserId}-${kind}-${nonce}`;
  }
}
