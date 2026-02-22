/**
 * useVoiceChannel — Single hook that orchestrates the entire voice system.
 *
 * Absorbs: VoiceSfuClient lifecycle, transport sync effect, screen/camera sharing,
 * remote audio routing (Web Audio API gain nodes), speaking detection, reconnect
 * intent, connection stats, and stream quality management.
 *
 * chat-page.tsx only needs to call this hook and spread the returned values.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VoiceParticipant } from '../../../hooks/use-chat-socket';
import { VoiceSfuClient } from '../voice-sfu-client';
import {
    DEFAULT_STREAM_QUALITY,
    clampCameraPreset,
    getCameraCapturePresetLabels,
    getStreamQualityPreset,
    isValidStreamQualityLabel,
    toVideoTrackConstraints,
} from '../utils/stream-quality';
import { getStaleRemoteScreenShareUserIds } from '../utils/stale-screen-shares';
import { type VoiceSignalData } from '../utils/voice-signaling';
import { getErrorMessage } from '../../../utils/error-message';
import { trackTelemetryError } from '../../../utils/telemetry';

// ─── Types ───────────────────────────────────────────────────────────

type StreamSource = 'screen' | 'camera';

type VoiceDetailedMediaStats = {
    bitrateKbps: number | null;
    packets: number | null;
    packetsLost: number | null;
    jitterMs: number | null;
    framesPerSecond: number | null;
    frameWidth: number | null;
    frameHeight: number | null;
};

export type VoiceDetailedConnectionStats = {
    userId: string;
    username: string;
    connectionState: RTCPeerConnectionState;
    iceConnectionState: RTCIceConnectionState;
    signalingState: RTCSignalingState;
    currentRttMs: number | null;
    availableOutgoingBitrateKbps: number | null;
    localCandidateType: string | null;
    remoteCandidateType: string | null;
    outboundAudio: VoiceDetailedMediaStats;
    inboundAudio: VoiceDetailedMediaStats;
    outboundVideo: VoiceDetailedMediaStats;
    inboundVideo: VoiceDetailedMediaStats;
};

type VoiceReconnectIntent = {
    channelId: string;
    muted: boolean;
    deafened: boolean;
};

export interface UseVoiceChannelParams {
    authUserId: string | undefined;
    authToken: string | null;
    wsConnected: boolean;
    voiceSfuEnabled: boolean;
    activeVoiceChannelId: string | null;
    voiceBusyChannelId: string | null;
    voiceParticipantsByChannel: Record<string, VoiceParticipant[]>;
    joinedVoiceParticipants: VoiceParticipant[];
    isSelfMuted: boolean;
    isSelfDeafened: boolean;
    localAudioReady: boolean;
    preferences: {
        showVoiceActivity: boolean;
        voiceInputSensitivity: number;
        voiceOutputVolume: number;
    };
    // Transport hook refs/methods
    localVoiceStreamRef: React.MutableRefObject<MediaStream | null>;
    localAnalyserRef: React.MutableRefObject<AnalyserNode | null>;
    getLocalVoiceStream: (forceFresh?: boolean) => Promise<MediaStream>;
    teardownLocalVoiceMedia: () => void;
    applyLocalVoiceTrackState: (stream: MediaStream | null) => void;
    // Peer connection manager
    peerConnectionsRef: React.MutableRefObject<Map<string, RTCPeerConnection>>;
    videoSenderByPeerRef: React.MutableRefObject<Map<string, RTCRtpSender>>;
    pendingVideoRenegotiationByPeerRef: React.MutableRefObject<Map<string, boolean>>;
    remoteVideoSourceByPeerRef: React.MutableRefObject<Map<string, string>>;
    remoteVideoStreamByPeerRef: React.MutableRefObject<Map<string, MediaStream>>;
    closePeerConnection: (userId: string) => void;
    ensurePeerConnection: (userId: string, channelId: string) => Promise<void>;
    createOfferForPeer: (userId: string, channelId: string) => Promise<void>;
    sendRequestOffer: (userId: string, channelId: string) => void;
    clearPeerConnections: () => void;
    getOrCreateVideoSender: (connection: RTCPeerConnection) => RTCRtpSender;
    applyVideoBitrateToConnection: (connection: RTCPeerConnection, bitrateKbps: number) => Promise<void>;
    applyAudioBitrateToAllConnections: () => void;
    applyVideoBitrateToAllConnections: () => void;
    activeStreamBitrateKbps: number;
    // SFU request fn
    requestVoiceSfu: <T = unknown>(channelId: string, action: string, data?: unknown, timeoutMs?: number) => Promise<T>;
    // WS send fns
    joinVoice: (channelId: string, opts?: { muted?: boolean; deafened?: boolean }) => boolean;
    leaveVoice: (channelId?: string) => boolean;
    sendVoiceSignal: (channelId: string, targetUserId: string, data: unknown) => boolean;
    // Callbacks
    setError: (error: string | null) => void;
    setActiveVoiceChannelId: (id: string | null) => void;
    setVoiceBusyChannelId: (id: string | null) => void;
    setIsSelfMuted: (muted: boolean) => void;
    channels: Array<{ id: string; isVoice?: boolean }>;
    resetVoiceSignalingState: () => void;
    playVoiceStateSound: (kind: 'join' | 'leave') => void;
    logVoiceDebug: (event: string, details?: Record<string, unknown>) => void;
    // Stable callbacks from peer connection manager
    onRemoteAudioStreamStable: (userId: string, stream: MediaStream | null) => void;
    onRemoteScreenShareStreamStable: (userId: string, stream: MediaStream | null) => void;
    onRemoteAdvertisedVideoSourceStable: (userId: string, source: 'screen' | 'camera' | null) => void;
    autoMuteOnJoin: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function createEmptyMediaStats(): VoiceDetailedMediaStats {
    return { bitrateKbps: null, packets: null, packetsLost: null, jitterMs: null, framesPerSecond: null, frameWidth: null, frameHeight: null };
}

function accumulateMediaStats(target: VoiceDetailedMediaStats, update: Partial<VoiceDetailedMediaStats>) {
    if (typeof update.bitrateKbps === 'number') target.bitrateKbps = (target.bitrateKbps ?? 0) + update.bitrateKbps;
    if (typeof update.packets === 'number') target.packets = (target.packets ?? 0) + update.packets;
    if (typeof update.packetsLost === 'number') target.packetsLost = (target.packetsLost ?? 0) + update.packetsLost;
    if (typeof update.jitterMs === 'number') target.jitterMs = update.jitterMs;
    if (typeof update.framesPerSecond === 'number') target.framesPerSecond = update.framesPerSecond;
    if (typeof update.frameWidth === 'number') target.frameWidth = update.frameWidth;
    if (typeof update.frameHeight === 'number') target.frameHeight = update.frameHeight;
}

function clampMediaElementVolume(value: number) {
    if (!Number.isFinite(value)) return 1;
    return Math.min(1, Math.max(0, value));
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useVoiceChannel(params: UseVoiceChannelParams) {
    const {
        authUserId, authToken, wsConnected, voiceSfuEnabled,
        activeVoiceChannelId, voiceBusyChannelId,
        voiceParticipantsByChannel, joinedVoiceParticipants,
        isSelfMuted, isSelfDeafened, localAudioReady, preferences,
        localVoiceStreamRef, localAnalyserRef,
        getLocalVoiceStream, teardownLocalVoiceMedia, applyLocalVoiceTrackState,
        peerConnectionsRef, videoSenderByPeerRef,
        closePeerConnection, ensurePeerConnection, createOfferForPeer,
        sendRequestOffer, clearPeerConnections, getOrCreateVideoSender,
        applyVideoBitrateToConnection, applyAudioBitrateToAllConnections,
        applyVideoBitrateToAllConnections, activeStreamBitrateKbps,
        requestVoiceSfu, joinVoice, leaveVoice, sendVoiceSignal,
        setError, setActiveVoiceChannelId, setVoiceBusyChannelId, setIsSelfMuted,
        channels, resetVoiceSignalingState, playVoiceStateSound, logVoiceDebug,
        onRemoteAudioStreamStable, onRemoteScreenShareStreamStable, onRemoteAdvertisedVideoSourceStable,
        autoMuteOnJoin,
        remoteVideoSourceByPeerRef,
    } = params;

    // ── Local State ────────────────────────────────────────────────────

    const [remoteAudioStreams, setRemoteAudioStreams] = useState<Record<string, MediaStream>>({});
    const [remoteScreenShares, setRemoteScreenShares] = useState<Record<string, MediaStream>>({});
    const [remoteAdvertisedVideoSourceByPeer, setRemoteAdvertisedVideoSourceByPeer] = useState<Record<string, StreamSource | null>>({});
    const [localScreenShareStream, setLocalScreenShareStream] = useState<MediaStream | null>(null);
    const [localStreamSource, setLocalStreamSource] = useState<StreamSource | null>(null);
    const [streamQualityLabel, setStreamQualityLabel] = useState(DEFAULT_STREAM_QUALITY);
    const [speakingUserIds, setSpeakingUserIds] = useState<string[]>([]);
    const [showDetailedVoiceStats, setShowDetailedVoiceStats] = useState(false);
    const [voiceConnectionStats, setVoiceConnectionStats] = useState<VoiceDetailedConnectionStats[]>([]);
    const [voiceStatsUpdatedAt, setVoiceStatsUpdatedAt] = useState<number | null>(null);
    const [streamStatusBanner, setStreamStatusBanner] = useState<{ type: 'error' | 'info'; message: string } | null>(null);

    // ── Refs ────────────────────────────────────────────────────────────

    const voiceSfuClientRef = useRef<VoiceSfuClient | null>(null);
    const localScreenStreamRef = useRef<MediaStream | null>(null);
    const remoteAudioContextRef = useRef<AudioContext | null>(null);
    const remoteAudioSourceByUserRef = useRef<Map<string, MediaElementAudioSourceNode>>(new Map());
    const remoteAudioGainByUserRef = useRef<Map<string, GainNode>>(new Map());
    const remoteAudioElementByUserRef = useRef<Map<string, HTMLAudioElement>>(new Map());
    const previousRtpSnapshotsRef = useRef<Map<string, { bytes: number; timestamp: number }>>(new Map());
    const activeVoiceChannelIdRef = useRef<string | null>(activeVoiceChannelId);
    const voiceBusyChannelIdRef = useRef<string | null>(voiceBusyChannelId);
    const voiceTransportEpochRef = useRef(0);
    const reconnectVoiceIntentRef = useRef<VoiceReconnectIntent | null>(null);
    const streamStatusBannerTimeoutRef = useRef<number | null>(null);
    const sendVoiceSignalRef = useRef(sendVoiceSignal);
    const leaveVoiceRef = useRef(leaveVoice);
    const createOfferForPeerRef = useRef(createOfferForPeer);

    // Keep refs in sync
    useEffect(() => { activeVoiceChannelIdRef.current = activeVoiceChannelId; }, [activeVoiceChannelId]);
    useEffect(() => { voiceBusyChannelIdRef.current = voiceBusyChannelId; }, [voiceBusyChannelId]);
    useEffect(() => { sendVoiceSignalRef.current = sendVoiceSignal; }, [sendVoiceSignal]);
    useEffect(() => { leaveVoiceRef.current = leaveVoice; }, [leaveVoice]);
    useEffect(() => { createOfferForPeerRef.current = createOfferForPeer; }, [createOfferForPeer]);

    // ── Stream Status Banner ───────────────────────────────────────────

    const showStreamStatusBannerFn = useCallback((type: 'error' | 'info', message: string) => {
        setStreamStatusBanner({ type, message });
        if (streamStatusBannerTimeoutRef.current) window.clearTimeout(streamStatusBannerTimeoutRef.current);
        streamStatusBannerTimeoutRef.current = window.setTimeout(() => {
            setStreamStatusBanner(null);
            streamStatusBannerTimeoutRef.current = null;
        }, 6000);
    }, []);

    useEffect(() => () => {
        if (streamStatusBannerTimeoutRef.current) {
            window.clearTimeout(streamStatusBannerTimeoutRef.current);
        }
    }, []);

    // ── Teardown ───────────────────────────────────────────────────────

    const teardownVoiceTransport = useCallback(() => {
        voiceTransportEpochRef.current += 1;
        clearPeerConnections();
        if (voiceSfuClientRef.current) {
            voiceSfuClientRef.current.stop();
            voiceSfuClientRef.current = null;
        }
        setVoiceConnectionStats([]);
        setRemoteAdvertisedVideoSourceByPeer({});
        if (localScreenStreamRef.current) {
            for (const track of localScreenStreamRef.current.getTracks()) track.stop();
            localScreenStreamRef.current = null;
            setLocalScreenShareStream(null);
            setLocalStreamSource(null);
        }
        teardownLocalVoiceMedia();
        setSpeakingUserIds([]);
        setRemoteAudioStreams({});
        setRemoteScreenShares({});
        for (const source of remoteAudioSourceByUserRef.current.values()) source.disconnect();
        for (const gain of remoteAudioGainByUserRef.current.values()) gain.disconnect();
        remoteAudioSourceByUserRef.current.clear();
        remoteAudioGainByUserRef.current.clear();
        remoteAudioElementByUserRef.current.clear();
        if (remoteAudioContextRef.current) {
            void remoteAudioContextRef.current.close();
            remoteAudioContextRef.current = null;
        }
    }, [clearPeerConnections, teardownLocalVoiceMedia]);

    // ── Remote Audio Routing ───────────────────────────────────────────

    const ensureRemoteAudioContext = useCallback(() => {
        if (remoteAudioContextRef.current && remoteAudioContextRef.current.state !== 'closed') return remoteAudioContextRef.current;
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return null;
        const context = new Ctx();
        remoteAudioContextRef.current = context;
        return context;
    }, []);

    const disconnectRemoteAudioForUser = useCallback((userId: string) => {
        remoteAudioSourceByUserRef.current.get(userId)?.disconnect();
        remoteAudioSourceByUserRef.current.delete(userId);
        remoteAudioGainByUserRef.current.get(userId)?.disconnect();
        remoteAudioGainByUserRef.current.delete(userId);
        remoteAudioElementByUserRef.current.delete(userId);
    }, []);

    const applyRemoteAudioGain = useCallback((userId: string, element: HTMLAudioElement, gainValue: number) => {
        const context = ensureRemoteAudioContext();
        if (!context) { element.volume = clampMediaElementVolume(gainValue); return false; }
        if (context.state === 'suspended') void context.resume().catch(() => { });
        const previousElement = remoteAudioElementByUserRef.current.get(userId);
        let gainNode = remoteAudioGainByUserRef.current.get(userId) ?? null;
        if (!gainNode || previousElement !== element) {
            disconnectRemoteAudioForUser(userId);
            const source = context.createMediaElementSource(element);
            gainNode = context.createGain();
            source.connect(gainNode);
            gainNode.connect(context.destination);
            remoteAudioSourceByUserRef.current.set(userId, source);
            remoteAudioGainByUserRef.current.set(userId, gainNode);
            remoteAudioElementByUserRef.current.set(userId, element);
        }
        gainNode.gain.value = Math.max(0, Math.min(4, gainValue));
        return true;
    }, [disconnectRemoteAudioForUser, ensureRemoteAudioContext]);

    // ── Computed ────────────────────────────────────────────────────────

    const activeRemoteAudioUsers = useMemo(() => {
        if (!authUserId) return [];
        return joinedVoiceParticipants
            .filter((p) => p.userId !== authUserId && remoteAudioStreams[p.userId])
            .map((p) => ({ userId: p.userId, username: p.username, stream: remoteAudioStreams[p.userId] }));
    }, [joinedVoiceParticipants, remoteAudioStreams, authUserId]);

    // ── RTP Stats ──────────────────────────────────────────────────────

    const computeKbpsFromSnapshot = useCallback((key: string, bytes: number, ts: number) => {
        const prev = previousRtpSnapshotsRef.current.get(key);
        previousRtpSnapshotsRef.current.set(key, { bytes, timestamp: ts });
        if (!prev || ts <= prev.timestamp || bytes < prev.bytes) return null;
        const deltaMs = ts - prev.timestamp;
        return deltaMs <= 0 ? null : ((bytes - prev.bytes) * 8) / deltaMs;
    }, []);

    const collectVoiceConnectionStats = useCallback(async () => {
        const connections = Array.from(peerConnectionsRef.current.entries());
        if (connections.length === 0) { setVoiceConnectionStats([]); setVoiceStatsUpdatedAt(Date.now()); return; }
        const nameById = new Map(joinedVoiceParticipants.map((p) => [p.userId, p.username]));
        const next: VoiceDetailedConnectionStats[] = [];
        for (const [peerUserId, conn] of connections) {
            try {
                const report = await conn.getStats();
                const oA = createEmptyMediaStats(), iA = createEmptyMediaStats();
                const oV = createEmptyMediaStats(), iV = createEmptyMediaStats();
                const localCands = new Map<string, any>(), remoteCands = new Map<string, any>();
                let selectedPair: any = null;
                for (const stat of report.values()) {
                    if (stat.type === 'local-candidate') { localCands.set(stat.id, stat); continue; }
                    if (stat.type === 'remote-candidate') { remoteCands.set(stat.id, stat); continue; }
                    if (stat.type === 'candidate-pair') { const p = stat as any; if (p.nominated || p.selected) selectedPair = p; continue; }
                    if (stat.type === 'outbound-rtp') {
                        const r = stat as any; if (r.isRemote) continue;
                        const k = r.kind ?? r.mediaType ?? 'audio';
                        const bps = typeof r.bytesSent === 'number' ? computeKbpsFromSnapshot(`${peerUserId}:out:${r.id}`, r.bytesSent, r.timestamp) : null;
                        accumulateMediaStats(k === 'video' ? oV : oA, { bitrateKbps: bps, packets: r.packetsSent ?? null, framesPerSecond: r.framesPerSecond ?? null, frameWidth: r.frameWidth ?? null, frameHeight: r.frameHeight ?? null });
                        continue;
                    }
                    if (stat.type === 'inbound-rtp') {
                        const r = stat as any; const k = r.kind ?? r.mediaType ?? 'audio';
                        const bps = typeof r.bytesReceived === 'number' ? computeKbpsFromSnapshot(`${peerUserId}:in:${r.id}`, r.bytesReceived, r.timestamp) : null;
                        accumulateMediaStats(k === 'video' ? iV : iA, { bitrateKbps: bps, packets: r.packetsReceived ?? null, packetsLost: r.packetsLost ?? null, jitterMs: typeof r.jitter === 'number' ? r.jitter * 1000 : null, framesPerSecond: r.framesPerSecond ?? null, frameWidth: r.frameWidth ?? null, frameHeight: r.frameHeight ?? null });
                    }
                }
                const lc = selectedPair?.localCandidateId ? localCands.get(selectedPair.localCandidateId) : null;
                const rc = selectedPair?.remoteCandidateId ? remoteCands.get(selectedPair.remoteCandidateId) : null;
                next.push({
                    userId: peerUserId, username: nameById.get(peerUserId) ?? 'Unknown',
                    connectionState: conn.connectionState, iceConnectionState: conn.iceConnectionState, signalingState: conn.signalingState,
                    currentRttMs: typeof selectedPair?.currentRoundTripTime === 'number' ? selectedPair.currentRoundTripTime * 1000 : null,
                    availableOutgoingBitrateKbps: typeof selectedPair?.availableOutgoingBitrate === 'number' ? selectedPair.availableOutgoingBitrate / 1000 : null,
                    localCandidateType: lc?.candidateType ?? null, remoteCandidateType: rc?.candidateType ?? null,
                    outboundAudio: oA, inboundAudio: iA, outboundVideo: oV, inboundVideo: iV,
                });
            } catch { /* ignore */ }
        }
        next.sort((a, b) => a.username.localeCompare(b.username));
        setVoiceConnectionStats(next);
        setVoiceStatsUpdatedAt(Date.now());
    }, [computeKbpsFromSnapshot, joinedVoiceParticipants, peerConnectionsRef]);

    // ── Video Share ────────────────────────────────────────────────────

    const applyStreamQualityToStream = useCallback((stream: MediaStream, label: string, source: StreamSource | null) => {
        const requested = getStreamQualityPreset(label);
        const preset = source === 'camera' ? clampCameraPreset(requested) : requested;
        const [track] = stream.getVideoTracks();
        if (!track) return;
        void track.applyConstraints(toVideoTrackConstraints(preset)).catch((err) => {
            trackTelemetryError('stream_constraints_apply_failed', err, { presetLabel: label, source: source ?? 'unknown' });
            showStreamStatusBannerFn('info', 'The selected stream quality could not be fully applied by this browser.');
        });
    }, [showStreamStatusBannerFn]);

    const stopLocalVideoShare = useCallback((renegotiatePeers = true) => {
        const stream = localScreenStreamRef.current;
        if (!stream) { setLocalScreenShareStream(null); setLocalStreamSource(null); return; }
        if (voiceSfuClientRef.current) void voiceSfuClientRef.current.replaceLocalVideoTrack(null, null);
        const chId = activeVoiceChannelIdRef.current;
        for (const [peerUserId] of peerConnectionsRef.current) {
            const sender = videoSenderByPeerRef.current.get(peerUserId);
            if (sender) void sender.replaceTrack(null).catch(() => { });
            if (chId) sendVoiceSignalRef.current(chId, peerUserId, { kind: 'video-source', source: null } satisfies VoiceSignalData);
        }
        for (const track of stream.getTracks()) { track.onended = null; track.stop(); }
        localScreenStreamRef.current = null;
        setLocalScreenShareStream(null);
        setLocalStreamSource(null);
        if (renegotiatePeers && activeVoiceChannelIdRef.current) {
            for (const peerUserId of peerConnectionsRef.current.keys()) sendRequestOffer(peerUserId, activeVoiceChannelIdRef.current);
        }
    }, [sendRequestOffer, peerConnectionsRef, videoSenderByPeerRef]);

    const toggleVideoShare = useCallback(async (source: StreamSource) => {
        if (localScreenStreamRef.current && localStreamSource === source) { stopLocalVideoShare(true); return; }
        if (localScreenStreamRef.current) stopLocalVideoShare(false);
        try {
            let stream: MediaStream;
            if (source === 'screen') {
                stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
            } else {
                let resolved: MediaStream | null = null;
                let startErr: unknown = null;
                for (const label of getCameraCapturePresetLabels(streamQualityLabel)) {
                    try { resolved = await navigator.mediaDevices.getUserMedia({ video: toVideoTrackConstraints(clampCameraPreset(getStreamQualityPreset(label))), audio: false }); break; }
                    catch (e) { startErr = e; }
                }
                if (!resolved) throw startErr ?? new Error('Could not access camera stream');
                stream = resolved;
            }
            localScreenStreamRef.current = stream;
            setLocalScreenShareStream(stream);
            setLocalStreamSource(source);
            applyStreamQualityToStream(stream, streamQualityLabel, source);
            showStreamStatusBannerFn('info', source === 'screen' ? 'Screen sharing is now live.' : 'Camera sharing is now live.');
            const videoTrack = stream.getVideoTracks()[0];
            if (voiceSfuClientRef.current && videoTrack) void voiceSfuClientRef.current.replaceLocalVideoTrack(videoTrack, source);
            if (videoTrack) videoTrack.onended = () => { if (localScreenStreamRef.current === stream) stopLocalVideoShare(true); };
            const chId = activeVoiceChannelIdRef.current;
            if (!chId || !videoTrack) return;
            for (const [peerUserId, connection] of peerConnectionsRef.current) {
                const sender = getOrCreateVideoSender(connection);
                videoSenderByPeerRef.current.set(peerUserId, sender);
                try { await sender.replaceTrack(videoTrack); } catch { /* */ }
                void applyVideoBitrateToConnection(connection, activeStreamBitrateKbps);
                sendVoiceSignalRef.current(chId, peerUserId, { kind: 'video-source', source } satisfies VoiceSignalData);
                sendRequestOffer(peerUserId, chId);
            }
        } catch (err) {
            trackTelemetryError('video_share_start_failed', err, { source, qualityPreset: streamQualityLabel });
            showStreamStatusBannerFn('error', getErrorMessage(err, 'Could not start sharing. Check browser permissions and try again.'));
        }
    }, [localStreamSource, stopLocalVideoShare, applyStreamQualityToStream, streamQualityLabel, showStreamStatusBannerFn, applyVideoBitrateToConnection, activeStreamBitrateKbps, sendRequestOffer, getOrCreateVideoSender, peerConnectionsRef, videoSenderByPeerRef]);

    const handleStreamQualityChange = useCallback((value: string) => {
        if (!isValidStreamQualityLabel(value)) return;
        setStreamQualityLabel(value);
        const stream = localScreenStreamRef.current;
        if (stream) applyStreamQualityToStream(stream, value, localStreamSource);
    }, [applyStreamQualityToStream, localStreamSource]);

    // ── Join / Leave ───────────────────────────────────────────────────

    const joinVoiceChannel = useCallback(async (channelId: string) => {
        if (!authToken || !wsConnected) { setError('Voice requires an active real-time connection'); return; }
        voiceBusyChannelIdRef.current = channelId;
        setVoiceBusyChannelId(channelId);
        try {
            const joinMuted = autoMuteOnJoin || isSelfDeafened;
            if (isSelfMuted !== joinMuted) setIsSelfMuted(joinMuted);
            void getLocalVoiceStream().catch(() => { });
            if (activeVoiceChannelId && activeVoiceChannelId !== channelId) leaveVoice(activeVoiceChannelId);
            const sent = joinVoice(channelId, { muted: joinMuted, deafened: isSelfDeafened });
            if (!sent) throw new Error('VOICE_JOIN_FAILED');
            reconnectVoiceIntentRef.current = { channelId, muted: joinMuted, deafened: isSelfDeafened };
            activeVoiceChannelIdRef.current = channelId;
            setActiveVoiceChannelId(channelId);
            playVoiceStateSound('join');
            setError(null);
        } catch { setError('Could not join voice channel'); }
        finally { setVoiceBusyChannelId(null); }
    }, [authToken, wsConnected, activeVoiceChannelId, playVoiceStateSound, isSelfMuted, isSelfDeafened, autoMuteOnJoin, getLocalVoiceStream, setIsSelfMuted, joinVoice, leaveVoice, setError, setActiveVoiceChannelId, setVoiceBusyChannelId]);

    const leaveVoiceChannel = useCallback(async () => {
        if (!activeVoiceChannelId) return;
        reconnectVoiceIntentRef.current = null;
        const leavingId = activeVoiceChannelId;
        voiceBusyChannelIdRef.current = leavingId;
        setVoiceBusyChannelId(leavingId);
        leaveVoice(leavingId);
        activeVoiceChannelIdRef.current = null;
        playVoiceStateSound('leave');
        setError(null);
        window.setTimeout(() => {
            setVoiceBusyChannelId(null);
            setActiveVoiceChannelId(null);
        }, 1800);
    }, [leaveVoice, activeVoiceChannelId, playVoiceStateSound, setError, setActiveVoiceChannelId, setVoiceBusyChannelId]);

    // ── Transport Sync Effect ──────────────────────────────────────────

    useEffect(() => {
        if (!activeVoiceChannelId || !authUserId) {
            if (wsConnected) teardownVoiceTransport();
            return;
        }
        const participants = voiceParticipantsByChannel[activeVoiceChannelId] ?? [];
        const selfInChannel = participants.some((p) => p.userId === authUserId);
        if (!selfInChannel) { teardownVoiceTransport(); return; }

        const epoch = ++voiceTransportEpochRef.current;
        let cancelled = false;
        const sync = async () => {
            const rawTrack = localVoiceStreamRef.current?.getAudioTracks()[0] ?? null;
            try { await getLocalVoiceStream(!rawTrack || rawTrack.readyState !== 'live'); }
            catch (err) {
                if (!cancelled && voiceTransportEpochRef.current === epoch) {
                    leaveVoiceRef.current(activeVoiceChannelId);
                    setError(getErrorMessage(err, 'Could not access microphone'));
                    activeVoiceChannelIdRef.current = null;
                    setActiveVoiceChannelId(null);
                }
                return;
            }
            if (voiceTransportEpochRef.current !== epoch) return;
            const desired = new Set(participants.map((p) => p.userId).filter((id) => id !== authUserId));
            for (const id of Array.from(peerConnectionsRef.current.keys())) {
                if (!desired.has(id)) closePeerConnection(id);
            }
            if (voiceSfuEnabled) {
                if (!voiceSfuClientRef.current) {
                    if (!wsConnected) return;
                    logVoiceDebug('sfu_init', { channelId: activeVoiceChannelId });
                    voiceSfuClientRef.current = new VoiceSfuClient({
                        selfUserId: authUserId,
                        request: (action, data, timeoutMs) => requestVoiceSfu(activeVoiceChannelId, action, data, timeoutMs),
                        callbacks: {
                            onRemoteAudio: onRemoteAudioStreamStable,
                            onRemoteAudioRemoved: (uid) => onRemoteAudioStreamStable(uid, null),
                            onRemoteVideo: (uid, stream, src) => { onRemoteScreenShareStreamStable(uid, stream); onRemoteAdvertisedVideoSourceStable(uid, src); },
                            onRemoteVideoRemoved: (uid) => { onRemoteScreenShareStreamStable(uid, null); onRemoteAdvertisedVideoSourceStable(uid, null); },
                            onStateChange: (state) => logVoiceDebug('sfu_state_change', { state }),
                        },
                    });
                    const track = localVoiceStreamRef.current?.getAudioTracks()[0] ?? null;
                    try { await voiceSfuClientRef.current.start(track); }
                    catch (err) { logVoiceDebug('sfu_start_error', { err }); setError(getErrorMessage(err, 'Voice SFU connection failed')); voiceSfuClientRef.current?.stop(); voiceSfuClientRef.current = null; }
                } else if (wsConnected) {
                    void voiceSfuClientRef.current.syncProducers();
                }
            } else {
                for (const peerUserId of Array.from(desired).sort()) {
                    try {
                        if (cancelled || voiceTransportEpochRef.current !== epoch) return;
                        const isNew = !peerConnectionsRef.current.has(peerUserId);
                        await ensurePeerConnection(peerUserId, activeVoiceChannelId);
                        if (isNew) await createOfferForPeer(peerUserId, activeVoiceChannelId);
                    } catch { /* best effort */ }
                }
            }
        };
        void sync();
        return () => { cancelled = true; };
    }, [wsConnected, activeVoiceChannelId, authUserId, voiceParticipantsByChannel, teardownVoiceTransport, getLocalVoiceStream, peerConnectionsRef, closePeerConnection, ensurePeerConnection, createOfferForPeer, localVoiceStreamRef, voiceSfuEnabled, requestVoiceSfu, logVoiceDebug, onRemoteAudioStreamStable, onRemoteScreenShareStreamStable, onRemoteAdvertisedVideoSourceStable, setError, setActiveVoiceChannelId]);

    // ── WS Disconnect / Reconnect ──────────────────────────────────────

    useEffect(() => {
        if (wsConnected) return;
        const reconnId = activeVoiceChannelIdRef.current ?? activeVoiceChannelId;
        if (reconnId) reconnectVoiceIntentRef.current = { channelId: reconnId, muted: isSelfMuted || isSelfDeafened, deafened: isSelfDeafened };
        resetVoiceSignalingState();
        setActiveVoiceChannelId(null);
        setVoiceBusyChannelId(null);
        teardownVoiceTransport();
    }, [wsConnected, activeVoiceChannelId, isSelfMuted, isSelfDeafened, teardownVoiceTransport, resetVoiceSignalingState, setActiveVoiceChannelId, setVoiceBusyChannelId]);

    useEffect(() => {
        if (!wsConnected || activeVoiceChannelId || voiceBusyChannelId) return;
        const intent = reconnectVoiceIntentRef.current;
        if (!intent) return;
        const ch = channels.find((c) => c.id === intent.channelId);
        if (!ch?.isVoice) { reconnectVoiceIntentRef.current = null; return; }
        voiceBusyChannelIdRef.current = intent.channelId;
        setVoiceBusyChannelId(intent.channelId);
        const sent = joinVoice(intent.channelId, { muted: intent.muted, deafened: intent.deafened });
        if (!sent) { reconnectVoiceIntentRef.current = null; setVoiceBusyChannelId(null); setError('Could not restore voice channel after reconnect'); return; }
        activeVoiceChannelIdRef.current = intent.channelId;
        setActiveVoiceChannelId(intent.channelId);
        setError(null);
    }, [wsConnected, joinVoice, channels, activeVoiceChannelId, voiceBusyChannelId, setActiveVoiceChannelId, setVoiceBusyChannelId, setError]);

    // ── Peripheral Effects ─────────────────────────────────────────────

    useEffect(() => { applyAudioBitrateToAllConnections(); }, [applyAudioBitrateToAllConnections]);
    useEffect(() => { applyVideoBitrateToAllConnections(); }, [applyVideoBitrateToAllConnections]);

    useEffect(() => {
        applyLocalVoiceTrackState(localVoiceStreamRef.current);
        if (voiceSfuClientRef.current && wsConnected) {
            const track = localVoiceStreamRef.current?.getAudioTracks()[0] ?? null;
            void voiceSfuClientRef.current.replaceLocalAudioTrack(track);
        }
    }, [applyLocalVoiceTrackState, localVoiceStreamRef, wsConnected]);

    // Stale screen share prune
    const pruneStaleScreenShares = useCallback(() => {
        const stale = getStaleRemoteScreenShareUserIds({ remoteScreenShares, remoteVideoSourceByPeer: remoteVideoSourceByPeerRef.current as Map<string, StreamSource>, peerConnectionsByUser: peerConnectionsRef.current });
        if (stale.length === 0) return;
        setRemoteScreenShares((prev) => {
            let changed = false; const next = { ...prev };
            for (const uid of stale) { if (next[uid]) { delete next[uid]; changed = true; } }
            return changed ? next : prev;
        });
    }, [remoteScreenShares, peerConnectionsRef, remoteVideoSourceByPeerRef]);

    useEffect(() => { pruneStaleScreenShares(); }, [pruneStaleScreenShares, voiceParticipantsByChannel, activeVoiceChannelId]);
    useEffect(() => {
        if (!activeVoiceChannelId || !wsConnected) return;
        const id = window.setInterval(pruneStaleScreenShares, 1500);
        return () => window.clearInterval(id);
    }, [activeVoiceChannelId, wsConnected, pruneStaleScreenShares]);

    // Stats polling
    useEffect(() => {
        if (!showDetailedVoiceStats || !activeVoiceChannelId || !wsConnected) return;
        void collectVoiceConnectionStats();
        const id = window.setInterval(() => void collectVoiceConnectionStats(), 2000);
        return () => window.clearInterval(id);
    }, [showDetailedVoiceStats, activeVoiceChannelId, wsConnected, collectVoiceConnectionStats]);

    // Reset stats on leave
    useEffect(() => {
        if (activeVoiceChannelId) return;
        setVoiceConnectionStats([]); setVoiceStatsUpdatedAt(null); previousRtpSnapshotsRef.current.clear();
    }, [activeVoiceChannelId]);

    // Speaking detection – local mic
    useEffect(() => {
        const micMuted = isSelfMuted || isSelfDeafened;
        if (!preferences.showVoiceActivity || !authUserId || !activeVoiceChannelId || !localAudioReady || micMuted) {
            setSpeakingUserIds((prev) => (prev.length === 0 ? prev : [])); return;
        }
        const analyser = localAnalyserRef.current;
        if (!analyser) return;
        const selfId = authUserId;
        let frame = 0;
        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) { const n = (data[i] - 128) / 128; sum += n * n; }
            const rms = Math.sqrt(sum / data.length);
            const speaking = rms >= preferences.voiceInputSensitivity;
            setSpeakingUserIds((prev) => {
                const has = prev.includes(selfId);
                if (speaking && !has) return [...prev, selfId];
                if (!speaking && has) return prev.filter((id) => id !== selfId);
                return prev;
            });
            frame = window.requestAnimationFrame(tick);
        };
        frame = window.requestAnimationFrame(tick);
        return () => { window.cancelAnimationFrame(frame); setSpeakingUserIds((prev) => prev.filter((id) => id !== selfId)); };
    }, [preferences.showVoiceActivity, preferences.voiceInputSensitivity, authUserId, activeVoiceChannelId, localAudioReady, isSelfMuted, isSelfDeafened, localAnalyserRef]);

    // Cleanup on unmount
    useEffect(() => () => { teardownVoiceTransport(); }, [teardownVoiceTransport]);

    // Logout cleanup
    useEffect(() => {
        if (authToken) return;
        reconnectVoiceIntentRef.current = null;
        teardownVoiceTransport();
    }, [authToken, teardownVoiceTransport]);

    // Clean up remote audio nodes for users who left
    useEffect(() => {
        const activeIds = new Set(activeRemoteAudioUsers.map((u) => u.userId));
        for (const uid of Array.from(remoteAudioGainByUserRef.current.keys())) {
            if (!activeIds.has(uid)) disconnectRemoteAudioForUser(uid);
        }
    }, [activeRemoteAudioUsers, disconnectRemoteAudioForUser]);

    // ── Return ─────────────────────────────────────────────────────────

    return {
        // State
        remoteAudioStreams,
        remoteScreenShares,
        remoteAdvertisedVideoSourceByPeer,
        localScreenShareStream,
        localStreamSource,
        streamQualityLabel,
        speakingUserIds,
        showDetailedVoiceStats,
        voiceConnectionStats,
        voiceStatsUpdatedAt,
        streamStatusBanner,
        activeRemoteAudioUsers,
        // Refs
        voiceSfuClientRef,
        localScreenStreamRef,
        activeVoiceChannelIdRef,
        voiceBusyChannelIdRef,
        leaveVoiceRef,
        reconnectVoiceIntentRef,
        // Actions
        joinVoiceChannel,
        leaveVoiceChannel,
        toggleVideoShare,
        handleStreamQualityChange,
        teardownVoiceTransport,
        collectVoiceConnectionStats,
        applyRemoteAudioGain,
        disconnectRemoteAudioForUser,
        stopLocalVideoShare,
        setShowDetailedVoiceStats,
        setRemoteScreenShares,
        setRemoteAdvertisedVideoSourceByPeer,
        setSpeakingUserIds,
        setRemoteAudioStreams,
    };
}
