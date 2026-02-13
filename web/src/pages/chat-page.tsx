import { Navigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chatApi } from '../api/chat-api';
import { AdminSettingsPanel, type AdminVoiceTestEntry } from '../components/admin-settings-panel';
import { ChannelSidebar } from '../components/channel-sidebar';
import { ChatView } from '../components/chat-view';
import { FriendsPanel } from '../components/friends-panel';
import { MessageComposer } from '../components/message-composer';
import { SettingsPanel } from '../components/settings-panel';
import { UserProfile } from '../components/user-profile';
import { UserSidebar } from '../components/user-sidebar';
import { VoiceChannelPanel } from '../components/voice-channel-panel';
import { useChatSocket } from '../hooks/use-chat-socket';
import type {
  PresenceState,
  PresenceUser,
  VoiceParticipant,
  VoiceSfuEventPayload,
  VoiceSfuRequestAction,
  VoiceStatePayload,
} from '../hooks/use-chat-socket';
import { useUserPreferences } from '../hooks/use-user-preferences';
import {
  mergeMessages,
  mergeServerWithLocal,
  messageSignature,
  reconcileIncomingMessage,
  useMessageLifecycleFeature,
  type ReplyTarget,
} from './chat/hooks/use-message-lifecycle-feature';
import { upsertChannel, useProfileDmFeature } from './chat/hooks/use-profile-dm-feature';
import { useReactionsFeature } from './chat/hooks/use-reactions-feature';
import { VoiceSfuClient } from './chat/voice-sfu-client';
import { useVoiceFeature } from './chat/hooks/use-voice-feature';
import { useAuth } from '../store/auth-store';
import type {
  AdminSettings,
  AdminStats,
  AdminUserSummary,
  Channel,
  FriendRequestSummary,
  FriendSummary,
  Message,
  UserRole,
} from '../types/api';
import { getErrorMessage } from '../utils/error-message';
import { trackTelemetryError } from '../utils/telemetry';

type MainView = 'chat' | 'friends' | 'settings' | 'admin';
type MobilePane = 'none' | 'channels' | 'users';
type MicrophonePermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported' | 'unknown';
type StreamSource = 'screen' | 'camera';
const DEFAULT_STREAM_QUALITY = '720p 30fps';

const STREAM_QUALITY_CONSTRAINTS: Record<string, { width: number; height: number; frameRate: number }> = {
  '360p 15fps': { width: 640, height: 360, frameRate: 15 },
  '360p 30fps': { width: 640, height: 360, frameRate: 30 },
  '480p 15fps': { width: 854, height: 480, frameRate: 15 },
  '480p 30fps': { width: 854, height: 480, frameRate: 30 },
  '720p 15fps': { width: 1280, height: 720, frameRate: 15 },
  '720p 30fps': { width: 1280, height: 720, frameRate: 30 },
  '720p 60fps': { width: 1280, height: 720, frameRate: 60 },
  '900p 30fps': { width: 1600, height: 900, frameRate: 30 },
  '1080p 30fps': { width: 1920, height: 1080, frameRate: 30 },
  '1080p 60fps': { width: 1920, height: 1080, frameRate: 60 },
  '1440p 30fps': { width: 2560, height: 1440, frameRate: 30 },
  '1440p 60fps': { width: 2560, height: 1440, frameRate: 60 },
  '2160p 30fps': { width: 3840, height: 2160, frameRate: 30 },
};

const CAMERA_MAX_CAPTURE_CONSTRAINTS = {
  width: 1920,
  height: 1080,
  frameRate: 30,
} as const;

const REMOTE_VIDEO_PLAYOUT_DELAY_HINT_SECONDS = 0.35;
const REMOTE_VIDEO_JITTER_BUFFER_TARGET_MS = 300;
const REMOTE_AUDIO_PLAYOUT_DELAY_HINT_SECONDS = 0.2;
const REMOTE_AUDIO_JITTER_BUFFER_TARGET_MS = 180;
const REMOTE_SPEAKING_HOLD_MS = 420;
const REMOTE_SPEAKING_THRESHOLD_FLOOR = 0.006;

const CAMERA_FALLBACK_QUALITY_LABELS = [
  '1080p 30fps',
  '720p 30fps',
  '720p 15fps',
  '480p 30fps',
  '480p 15fps',
  '360p 30fps',
  '360p 15fps',
] as const;

type StreamQualityPreset = { width: number; height: number; frameRate: number };

function getStreamQualityPreset(label: string): StreamQualityPreset {
  return STREAM_QUALITY_CONSTRAINTS[label] ?? STREAM_QUALITY_CONSTRAINTS[DEFAULT_STREAM_QUALITY];
}

function toVideoTrackConstraints(preset: StreamQualityPreset): MediaTrackConstraints {
  return {
    width: { ideal: preset.width, max: preset.width },
    height: { ideal: preset.height, max: preset.height },
    frameRate: { ideal: preset.frameRate, max: preset.frameRate },
  };
}

function clampMediaElementVolume(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1, Math.max(0, value));
}

function computeTimeDomainRms(data: ArrayLike<number>) {
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    const normalized = (data[i] - 128) / 128;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / data.length);
}

function clampCameraPreset(preset: StreamQualityPreset): StreamQualityPreset {
  return {
    width: Math.min(preset.width, CAMERA_MAX_CAPTURE_CONSTRAINTS.width),
    height: Math.min(preset.height, CAMERA_MAX_CAPTURE_CONSTRAINTS.height),
    frameRate: Math.min(preset.frameRate, CAMERA_MAX_CAPTURE_CONSTRAINTS.frameRate),
  };
}

function getCameraCapturePresetLabels(preferredLabel: string): string[] {
  const labels = [preferredLabel, ...CAMERA_FALLBACK_QUALITY_LABELS, DEFAULT_STREAM_QUALITY];
  return [...new Set(labels.filter((label) => Boolean(STREAM_QUALITY_CONSTRAINTS[label])))];
}

type VoiceSignalData =
  | { kind: 'offer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }
  | { kind: 'renegotiate' }
  | { kind: 'video-source'; source: StreamSource | null }
  | { kind: 'stream-snapshot-request'; reason?: 'join-sync' | 'retry' | 'post-reset' | 'manual' }
  | { kind: 'stream-snapshot'; source: StreamSource | null; hasLiveVideoTrack: boolean }
  | { kind: 'stream-snapshot-ack'; source: StreamSource | null; hasLiveVideoTrack: boolean }
  | { kind: 'video-recovery-request'; reason: 'stall-detected' | 'snapshot-mismatch'; stagnantSamples?: number };

type VoiceDetailedMediaStats = {
  bitrateKbps: number | null;
  packets: number | null;
  packetsLost: number | null;
  jitterMs: number | null;
  framesPerSecond: number | null;
  frameWidth: number | null;
  frameHeight: number | null;
};

type VoiceDetailedConnectionStats = {
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

type VoiceProtectionLevel = 'stable' | 'mild' | 'severe';
type AdminVoiceTestId =
  | 'ws-link'
  | 'sfu-handshake'
  | 'audio-context-state'
  | 'rtc-config'
  | 'microphone'
  | 'audio-sender-profile'
  | 'ice-restart'
  | 'stream-sync'
  | 'video-recovery'
  | 'stats-snapshot';

type AdminVoiceTestState = {
  status: AdminVoiceTestEntry['status'];
  message: string;
  ranAt: number | null;
};

const ADMIN_VOICE_TEST_DEFINITIONS: Array<{
  id: AdminVoiceTestId;
  label: string;
  description: string;
}> = [
  {
    id: 'ws-link',
    label: 'Realtime Link',
    description: 'Checks if the websocket realtime connection is active.',
  },
  {
    id: 'sfu-handshake',
    label: 'SFU Handshake',
    description: 'Checks server-audio SFU handshake and channel-scoped capabilities.',
  },
  {
    id: 'audio-context-state',
    label: 'AudioContext State',
    description: 'Checks unlock state and current WebAudio context states.',
  },
  {
    id: 'rtc-config',
    label: 'ICE Config',
    description: 'Validates loaded STUN/TURN runtime config.',
  },
  {
    id: 'microphone',
    label: 'Microphone Pipeline',
    description: 'Requests local mic stream and verifies a live audio track.',
  },
  {
    id: 'audio-sender-profile',
    label: 'Audio Sender Profile',
    description: 'Checks audio sender bitrate/priority profile on active peers.',
  },
  {
    id: 'ice-restart',
    label: 'ICE Restart Support',
    description: 'Confirms connected peers expose ICE restart recovery.',
  },
  {
    id: 'stream-sync',
    label: 'Stream Source Sync',
    description: 'Pushes current stream source state to all voice peers.',
  },
  {
    id: 'video-recovery',
    label: 'Video Recovery Watchdog',
    description: 'Reports current stalled-video watchdog state for peers.',
  },
  {
    id: 'stats-snapshot',
    label: 'Connection Stats Snapshot',
    description: 'Runs a fresh detailed connection stats sample.',
  },
];

function createInitialAdminVoiceTestState(): Record<AdminVoiceTestId, AdminVoiceTestState> {
  const next = {} as Record<AdminVoiceTestId, AdminVoiceTestState>;
  for (const test of ADMIN_VOICE_TEST_DEFINITIONS) {
    next[test.id] = {
      status: 'idle',
      message: 'Not run yet.',
      ranAt: null,
    };
  }
  return next;
}

function createEmptyMediaStats(): VoiceDetailedMediaStats {
  return {
    bitrateKbps: null,
    packets: null,
    packetsLost: null,
    jitterMs: null,
    framesPerSecond: null,
    frameWidth: null,
    frameHeight: null,
  };
}

function mapPeerConnectionStateToIceState(
  state: RTCPeerConnectionState,
): RTCIceConnectionState {
  if (state === 'connected') {
    return 'connected';
  }
  if (state === 'connecting') {
    return 'checking';
  }
  if (state === 'disconnected') {
    return 'disconnected';
  }
  if (state === 'failed') {
    return 'failed';
  }
  if (state === 'closed') {
    return 'closed';
  }
  return 'new';
}

function accumulateMediaStats(
  target: VoiceDetailedMediaStats,
  update: Partial<VoiceDetailedMediaStats>,
) {
  if (typeof update.bitrateKbps === 'number') {
    target.bitrateKbps = (target.bitrateKbps ?? 0) + update.bitrateKbps;
  }
  if (typeof update.packets === 'number') {
    target.packets = (target.packets ?? 0) + update.packets;
  }
  if (typeof update.packetsLost === 'number') {
    target.packetsLost = (target.packetsLost ?? 0) + update.packetsLost;
  }
  if (typeof update.jitterMs === 'number') {
    target.jitterMs = update.jitterMs;
  }
  if (typeof update.framesPerSecond === 'number') {
    target.framesPerSecond = update.framesPerSecond;
  }
  if (typeof update.frameWidth === 'number') {
    target.frameWidth = update.frameWidth;
  }
  if (typeof update.frameHeight === 'number') {
    target.frameHeight = update.frameHeight;
  }
}

function isVoiceSignalData(value: unknown): value is VoiceSignalData {
  if (!value || typeof value !== 'object' || !('kind' in value)) {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'offer' || kind === 'answer') {
    return Boolean((value as { sdp?: unknown }).sdp);
  }
  if (kind === 'ice') {
    return Boolean((value as { candidate?: unknown }).candidate);
  }
  if (kind === 'renegotiate') {
    return true;
  }
  if (kind === 'video-source') {
    const source = (value as { source?: unknown }).source;
    return source === 'screen' || source === 'camera' || source === null;
  }
  if (kind === 'stream-snapshot-request') {
    const reason = (value as { reason?: unknown }).reason;
    return (
      reason === undefined ||
      reason === 'join-sync' ||
      reason === 'retry' ||
      reason === 'post-reset' ||
      reason === 'manual'
    );
  }
  if (kind === 'stream-snapshot' || kind === 'stream-snapshot-ack') {
    const source = (value as { source?: unknown }).source;
    const hasLiveVideoTrack = (value as { hasLiveVideoTrack?: unknown }).hasLiveVideoTrack;
    return (
      (source === 'screen' || source === 'camera' || source === null) &&
      typeof hasLiveVideoTrack === 'boolean'
    );
  }
  if (kind === 'video-recovery-request') {
    const reason = (value as { reason?: unknown }).reason;
    const stagnantSamples = (value as { stagnantSamples?: unknown }).stagnantSamples;
    return (
      (reason === 'stall-detected' || reason === 'snapshot-mismatch') &&
      (stagnantSamples === undefined || typeof stagnantSamples === 'number')
    );
  }
  return false;
}

function createDefaultVoiceIceConfig(): RTCConfiguration {
  return {
    iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
    iceCandidatePoolSize: 4,
    iceTransportPolicy: 'all',
  };
}

function normalizeVoiceIceConfig(value: unknown): RTCConfiguration {
  const fallback = createDefaultVoiceIceConfig();
  if (!value || typeof value !== 'object') {
    return fallback;
  }

  const raw = value as {
    iceServers?: Array<{ urls?: string | string[]; username?: string; credential?: string }>;
    iceTransportPolicy?: unknown;
    iceCandidatePoolSize?: unknown;
  };

  const parsedServers: RTCIceServer[] = [];
  for (const server of raw.iceServers ?? []) {
    const urls = Array.isArray(server.urls)
      ? server.urls.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      : typeof server.urls === 'string' && server.urls.length > 0
        ? [server.urls]
        : [];
    if (urls.length === 0) {
      continue;
    }
    parsedServers.push({
      urls: urls.slice(0, 1),
      ...(server.username ? { username: server.username } : {}),
      ...(server.credential ? { credential: server.credential } : {}),
    });
  }

  const iceTransportPolicy: RTCIceTransportPolicy =
    raw.iceTransportPolicy === 'relay' ? 'relay' : 'all';
  const iceCandidatePoolSize =
    typeof raw.iceCandidatePoolSize === 'number' && Number.isFinite(raw.iceCandidatePoolSize)
      ? Math.max(0, Math.min(8, Math.round(raw.iceCandidatePoolSize)))
      : 2;

  return {
    iceServers: parsedServers.length > 0 ? parsedServers.slice(0, 3) : fallback.iceServers,
    iceTransportPolicy,
    iceCandidatePoolSize,
  };
}

function hasTurnRelayInIceConfig(config: RTCConfiguration) {
  for (const server of config.iceServers ?? []) {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    if (urls.some((url) => typeof url === 'string' && (url.startsWith('turn:') || url.startsWith('turns:')))) {
      return true;
    }
  }
  return false;
}

function shouldInitiateOffer(localUserId: string, remoteUserId: string) {
  return localUserId < remoteUserId;
}

function resolveAudioContextClass() {
  return (
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

export function ChatPage() {
  const auth = useAuth();
  const { preferences, updatePreferences, resetPreferences } = useUserPreferences();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageQuery, setMessageQuery] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<MainView>('chat');
  const [mobilePane, setMobilePane] = useState<MobilePane>('none');

  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  const [loadingAdminStats, setLoadingAdminStats] = useState(false);
  const [adminStatsError, setAdminStatsError] = useState<string | null>(null);
  const [adminSettings, setAdminSettings] = useState<AdminSettings | null>(null);
  const [loadingAdminSettings, setLoadingAdminSettings] = useState(false);
  const [adminSettingsError, setAdminSettingsError] = useState<string | null>(null);
  const [savingAdminSettings, setSavingAdminSettings] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUserSummary[]>([]);
  const [loadingAdminUsers, setLoadingAdminUsers] = useState(false);
  const [adminUsersError, setAdminUsersError] = useState<string | null>(null);
  const [updatingAdminUserId, setUpdatingAdminUserId] = useState<string | null>(null);
  const [deletingAdminUserId, setDeletingAdminUserId] = useState<string | null>(null);
  const [clearingAdminUsers, setClearingAdminUsers] = useState(false);
  const [runningAdminVoiceTests, setRunningAdminVoiceTests] = useState(false);
  const [adminVoiceTestStateById, setAdminVoiceTestStateById] = useState<
    Record<AdminVoiceTestId, AdminVoiceTestState>
  >(() => createInitialAdminVoiceTestState());

  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequestSummary[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequestSummary[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [friendsError, setFriendsError] = useState<string | null>(null);
  const [friendActionBusyId, setFriendActionBusyId] = useState<string | null>(null);
  const [submittingFriendRequest, setSubmittingFriendRequest] = useState(false);
  const [deletingChannelId, setDeletingChannelId] = useState<string | null>(null);
  const [unreadChannelCounts, setUnreadChannelCounts] = useState<Record<string, number>>({});
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const [voiceParticipantsByChannel, setVoiceParticipantsByChannel] = useState<
    Record<string, VoiceParticipant[]>
  >({});
  const [activeVoiceChannelId, setActiveVoiceChannelId] = useState<string | null>(null);
  const [voiceBusyChannelId, setVoiceBusyChannelId] = useState<string | null>(null);
  const [localAudioReady, setLocalAudioReady] = useState(false);
  const [isSelfMuted, setIsSelfMuted] = useState(false);
  const [isSelfDeafened, setIsSelfDeafened] = useState(false);
  const [remoteAudioStreams, setRemoteAudioStreams] = useState<Record<string, MediaStream>>({});
  const [speakingUserIds, setSpeakingUserIds] = useState<string[]>([]);
  const [remoteScreenShares, setRemoteScreenShares] = useState<Record<string, MediaStream>>({});
  const [localScreenShareStream, setLocalScreenShareStream] = useState<MediaStream | null>(null);
  const [localStreamSource, setLocalStreamSource] = useState<StreamSource | null>(null);
  const [streamQualityLabel, setStreamQualityLabel] = useState(DEFAULT_STREAM_QUALITY);
  const [protectVoiceEnabled, setProtectVoiceEnabled] = useState(true);
  const [voiceProtectionLevel, setVoiceProtectionLevel] = useState<VoiceProtectionLevel>('stable');
  const [showDetailedVoiceStats, setShowDetailedVoiceStats] = useState(false);
  const [voiceConnectionStats, setVoiceConnectionStats] = useState<VoiceDetailedConnectionStats[]>([]);
  const [voiceStatsUpdatedAt, setVoiceStatsUpdatedAt] = useState<number | null>(null);
  const [voiceIceConfig, setVoiceIceConfig] = useState<RTCConfiguration>(() =>
    createDefaultVoiceIceConfig(),
  );
  const [voiceSfuEnabled, setVoiceSfuEnabled] = useState(false);
  const [voiceSfuAudioOnly, setVoiceSfuAudioOnly] = useState(true);
  const [voiceAudioTransportMode, setVoiceAudioTransportMode] = useState<'p2p' | 'sfu'>('p2p');
  const [voiceSfuTransportState, setVoiceSfuTransportState] =
    useState<RTCPeerConnectionState>('new');
  const [savingVoiceSettingsChannelId, setSavingVoiceSettingsChannelId] = useState<string | null>(null);
  const [streamStatusBanner, setStreamStatusBanner] = useState<{
    type: 'error' | 'info';
    message: string;
  } | null>(null);

  const [composerInsertRequest, setComposerInsertRequest] = useState<{
    key: number;
    text: string;
  } | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [audioInputDevices, setAudioInputDevices] = useState<
    Array<{ deviceId: string; label: string }>
  >([]);
  const [microphonePermission, setMicrophonePermission] =
    useState<MicrophonePermissionState>('unknown');
  const [requestingMicrophonePermission, setRequestingMicrophonePermission] = useState(false);
  const [hiddenUnreadCount, setHiddenUnreadCount] = useState(0);
  const previousIncomingRequestCountRef = useRef<number | null>(null);
  const streamStatusBannerTimeoutRef = useRef<number | null>(null);
  const previousVoiceProtectionLevelRef = useRef<VoiceProtectionLevel>('stable');
  const pendingSignaturesRef = useRef(new Set<string>());
  const pendingTimeoutsRef = useRef(new Map<string, number>());
  const muteStateBeforeDeafenRef = useRef<boolean | null>(null);
  const localVoiceStreamRef = useRef<MediaStream | null>(null);
  const localVoiceProcessedStreamRef = useRef<MediaStream | null>(null);
  const localVoiceGainNodeRef = useRef<GainNode | null>(null);
  const localVoiceGainContextRef = useRef<AudioContext | null>(null);
  const voiceInputGainRef = useRef(preferences.voiceInputGain);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const localAnalyserContextRef = useRef<AudioContext | null>(null);
  const localAnalyserSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const remoteAudioContextRef = useRef<AudioContext | null>(null);
  const remoteAudioSourceByUserRef = useRef<Map<string, MediaElementAudioSourceNode>>(new Map());
  const remoteAudioGainByUserRef = useRef<Map<string, GainNode>>(new Map());
  const remoteAudioElementByUserRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const remoteSpeakingContextRef = useRef<AudioContext | null>(null);
  const remoteSpeakingSourceByUserRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const remoteSpeakingAnalyserByUserRef = useRef<Map<string, AnalyserNode>>(new Map());
  const remoteSpeakingDataByUserRef = useRef<Map<string, Uint8Array>>(new Map());
  const remoteSpeakingLastSpokeAtByUserRef = useRef<Map<string, number>>(new Map());
  const localVoiceInputDeviceIdRef = useRef<string | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const peerSignalingQueueRef = useRef<Map<string, Promise<void>>>(new Map());
  const videoSenderByPeerRef = useRef<Map<string, RTCRtpSender>>(new Map());
  const pendingVideoRenegotiationByPeerRef = useRef<Set<string>>(new Set());
  const makingOfferByPeerRef = useRef<Map<string, boolean>>(new Map());
  const ignoreOfferByPeerRef = useRef<Map<string, boolean>>(new Map());
  const remoteVideoSourceByPeerRef = useRef<Map<string, StreamSource | null>>(new Map());
  const remoteVideoStreamByPeerRef = useRef<Map<string, MediaStream>>(new Map());
  const pendingStreamSnapshotRetryTimeoutByPeerRef = useRef<Map<string, number>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const disconnectTimeoutByPeerRef = useRef<Map<string, number>>(new Map());
  const previousRtpSnapshotsRef = useRef<Map<string, { bytes: number; timestamp: number }>>(new Map());
  const voiceParticipantIdsByChannelRef = useRef<Map<string, Set<string>>>(new Map());
  const activeVoiceChannelIdRef = useRef<string | null>(null);
  const voiceBusyChannelIdRef = useRef<string | null>(null);
  const queuedVoiceSignalsRef = useRef<Array<{ channelId: string; fromUserId: string; data: VoiceSignalData }>>([]);
  const drainingVoiceSignalsRef = useRef(false);
  const localVoiceAcquirePromiseRef = useRef<Promise<MediaStream> | null>(null);
  const voiceTransportEpochRef = useRef(0);
  const voiceDebugEnabledRef = useRef(false);
  const audioContextsUnlockedRef = useRef(false);
  const remoteVideoTrafficByPeerRef = useRef<
    Map<string, { bytesReceived: number; packetsReceived: number; stagnantSamples: number }>
  >(new Map());
  const remoteVideoRecoveryAttemptByPeerRef = useRef<Map<string, number>>(new Map());
  const remoteVideoRecoveryStreakByPeerRef = useRef<Map<string, number>>(new Map());
  const voiceSfuClientRef = useRef<VoiceSfuClient | null>(null);
  const voiceSfuChannelIdRef = useRef<string | null>(null);
  const voiceSfuAudioActiveRef = useRef(false);
  const remoteAudioUsersViaSfuRef = useRef<Set<string>>(new Set());
  const requestVoiceSfuRef = useRef(
    ((() => Promise.reject(new Error('SFU request unavailable'))) as <TData = unknown>(
      channelId: string,
      action: VoiceSfuRequestAction,
      data?: unknown,
      timeoutMs?: number,
    ) => Promise<TData>),
  );
  const sendVoiceSignalRef = useRef((() => false) as (channelId: string, targetUserId: string, data: unknown) => boolean);
  const createOfferForPeerRef = useRef((() => Promise.resolve()) as (peerUserId: string, channelId: string) => Promise<void>);
  const leaveVoiceRef = useRef((() => false) as (channelId?: string) => boolean);
  const messageSearchInputRef = useRef<HTMLInputElement | null>(null);
  const hasTurnRelayConfigured = useMemo(() => hasTurnRelayInIceConfig(voiceIceConfig), [voiceIceConfig]);

  const logVoiceDebug = useCallback((event: string, details?: Record<string, unknown>) => {
    if (!voiceDebugEnabledRef.current) {
      return;
    }
    const payload = {
      ts: new Date().toISOString(),
      event,
      ...(details ?? {}),
    };
    const serialized = JSON.stringify(payload);
    const win = window as typeof window & { __harmonyVoiceLogs?: string[] };
    const logs = win.__harmonyVoiceLogs ?? [];
    logs.push(serialized);
    if (logs.length > 300) {
      logs.splice(0, logs.length - 300);
    }
    win.__harmonyVoiceLogs = logs;
    console.debug('[voice-debug]', payload);
  }, []);

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [channels, activeChannelId],
  );

  const handleDirectChannelOpened = useCallback((channel: Channel) => {
    setChannels((prev) => upsertChannel(prev, channel));
    setActiveChannelId(channel.id);
    setActiveView('chat');
  }, []);

  const {
    selectedUser,
    setSelectedUser,
    selectedUserFriendRequestState,
    selectedUserIncomingRequestId,
    acceptingSelectedUserFriendRequest,
    openingDmUserId,
    openDirectMessage,
  } = useProfileDmFeature({
    authToken: auth.token,
    currentUserId: auth.user?.id,
    friends,
    incomingRequests,
    outgoingRequests,
    friendActionBusyId,
    setFriendsError,
    onDirectChannelOpened: handleDirectChannelOpened,
  });

  const {
    activeVoiceChannel,
    activeVoiceBitrateKbps,
    activeStreamBitrateKbps,
    canEditVoiceSettings,
    voiceParticipantCounts,
    activeVoiceParticipants,
    joinedVoiceParticipants,
    voiceStreamingUserIdsByChannel,
    audioContextMenu,
    closeAudioContextMenu,
    openUserAudioMenu,
    getUserAudioState,
    setUserVolume,
    toggleUserMuted,
  } = useVoiceFeature({
    channels,
    activeChannelId,
    activeVoiceChannelId,
    voiceParticipantsByChannel,
    remoteScreenShares,
    localScreenShareStream,
    localStreamSource,
    authUserId: auth.user?.id,
    authUserRole: auth.user?.role,
  });

  const subscribedChannelIds = useMemo(() => channels.map((channel) => channel.id), [channels]);
  const effectiveStreamBitrateKbps = useMemo(() => {
    if (!protectVoiceEnabled) {
      return activeStreamBitrateKbps;
    }
    if (voiceProtectionLevel === 'severe') {
      return Math.min(activeStreamBitrateKbps, 900);
    }
    if (voiceProtectionLevel === 'mild') {
      return Math.min(activeStreamBitrateKbps, 1600);
    }
    return activeStreamBitrateKbps;
  }, [activeStreamBitrateKbps, protectVoiceEnabled, voiceProtectionLevel]);

  const computeKbpsFromSnapshot = useCallback((snapshotKey: string, bytes: number, timestamp: number) => {
    const previous = previousRtpSnapshotsRef.current.get(snapshotKey);
    previousRtpSnapshotsRef.current.set(snapshotKey, { bytes, timestamp });
    if (!previous || timestamp <= previous.timestamp || bytes < previous.bytes) {
      return null;
    }
    const deltaBytes = bytes - previous.bytes;
    const deltaMs = timestamp - previous.timestamp;
    if (deltaMs <= 0) {
      return null;
    }
    return (deltaBytes * 8) / deltaMs;
  }, []);

  const showStreamStatusBanner = useCallback((type: 'error' | 'info', message: string) => {
    setStreamStatusBanner({ type, message });
    if (streamStatusBannerTimeoutRef.current) {
      window.clearTimeout(streamStatusBannerTimeoutRef.current);
    }
    streamStatusBannerTimeoutRef.current = window.setTimeout(() => {
      setStreamStatusBanner(null);
      streamStatusBannerTimeoutRef.current = null;
    }, 6000);
  }, []);

  useEffect(() => {
    return () => {
      if (!streamStatusBannerTimeoutRef.current) {
        return;
      }
      window.clearTimeout(streamStatusBannerTimeoutRef.current);
      streamStatusBannerTimeoutRef.current = null;
    };
  }, []);

  const collectVoiceConnectionStats = useCallback(async () => {
    const connections = Array.from(peerConnectionsRef.current.entries());
    if (connections.length === 0) {
      if (voiceAudioTransportMode === 'sfu' && auth.user) {
        const syntheticStats = joinedVoiceParticipants
          .filter((participant) => participant.userId !== auth.user?.id)
          .map((participant) => ({
            userId: participant.userId,
            username: participant.username,
            connectionState: voiceSfuTransportState,
            iceConnectionState: mapPeerConnectionStateToIceState(voiceSfuTransportState),
            signalingState: 'stable' as RTCSignalingState,
            currentRttMs: null,
            availableOutgoingBitrateKbps: null,
            localCandidateType: 'sfu',
            remoteCandidateType: 'sfu',
            outboundAudio: createEmptyMediaStats(),
            inboundAudio: createEmptyMediaStats(),
            outboundVideo: createEmptyMediaStats(),
            inboundVideo: createEmptyMediaStats(),
          }));
        syntheticStats.sort((a, b) => a.username.localeCompare(b.username));
        setVoiceConnectionStats(syntheticStats);
        setVoiceStatsUpdatedAt(Date.now());
        return;
      }
      setVoiceConnectionStats([]);
      setVoiceStatsUpdatedAt(Date.now());
      return;
    }

    const participantNameById = new Map(joinedVoiceParticipants.map((participant) => [participant.userId, participant.username]));
    const nextStats: VoiceDetailedConnectionStats[] = [];

    for (const [peerUserId, connection] of connections) {
      try {
        const report = await connection.getStats();
        const outboundAudio = createEmptyMediaStats();
        const inboundAudio = createEmptyMediaStats();
        const outboundVideo = createEmptyMediaStats();
        const inboundVideo = createEmptyMediaStats();

        const localCandidates = new Map<string, { candidateType?: string }>();
        const remoteCandidates = new Map<string, { candidateType?: string }>();
        let selectedPair: (RTCIceCandidatePairStats & {
          availableOutgoingBitrate?: number;
        }) | null = null;

        for (const stat of report.values()) {
          if (stat.type === 'local-candidate') {
            localCandidates.set(stat.id, stat as unknown as { candidateType?: string });
            continue;
          }
          if (stat.type === 'remote-candidate') {
            remoteCandidates.set(stat.id, stat as unknown as { candidateType?: string });
            continue;
          }
          if (stat.type === 'candidate-pair') {
            const pair = stat as RTCIceCandidatePairStats & {
              selected?: boolean;
              availableOutgoingBitrate?: number;
            };
            if (pair.nominated || pair.selected) {
              selectedPair = pair;
            }
            continue;
          }

          if (stat.type === 'outbound-rtp') {
            const rtp = stat as RTCOutboundRtpStreamStats & {
              kind?: string;
              mediaType?: string;
              isRemote?: boolean;
              frameWidth?: number;
              frameHeight?: number;
              framesPerSecond?: number;
            };
            if (rtp.isRemote) {
              continue;
            }
            const mediaKind = rtp.kind ?? rtp.mediaType ?? 'audio';
            const bitrateKbps =
              typeof rtp.bytesSent === 'number'
                ? computeKbpsFromSnapshot(`${peerUserId}:out:${rtp.id}`, rtp.bytesSent, rtp.timestamp)
                : null;
            if (mediaKind === 'video') {
              accumulateMediaStats(outboundVideo, {
                bitrateKbps,
                packets: typeof rtp.packetsSent === 'number' ? rtp.packetsSent : null,
                framesPerSecond:
                  typeof rtp.framesPerSecond === 'number' ? rtp.framesPerSecond : null,
                frameWidth: typeof rtp.frameWidth === 'number' ? rtp.frameWidth : null,
                frameHeight: typeof rtp.frameHeight === 'number' ? rtp.frameHeight : null,
              });
            } else {
              accumulateMediaStats(outboundAudio, {
                bitrateKbps,
                packets: typeof rtp.packetsSent === 'number' ? rtp.packetsSent : null,
              });
            }
            continue;
          }

          if (stat.type === 'inbound-rtp') {
            const rtp = stat as RTCInboundRtpStreamStats & {
              kind?: string;
              mediaType?: string;
              frameWidth?: number;
              frameHeight?: number;
              framesPerSecond?: number;
            };
            const mediaKind = rtp.kind ?? rtp.mediaType ?? 'audio';
            const bitrateKbps =
              typeof rtp.bytesReceived === 'number'
                ? computeKbpsFromSnapshot(`${peerUserId}:in:${rtp.id}`, rtp.bytesReceived, rtp.timestamp)
                : null;
            const update: Partial<VoiceDetailedMediaStats> = {
              bitrateKbps,
              packets: typeof rtp.packetsReceived === 'number' ? rtp.packetsReceived : null,
              packetsLost: typeof rtp.packetsLost === 'number' ? rtp.packetsLost : null,
              jitterMs: typeof rtp.jitter === 'number' ? rtp.jitter * 1000 : null,
              framesPerSecond: typeof rtp.framesPerSecond === 'number' ? rtp.framesPerSecond : null,
              frameWidth: typeof rtp.frameWidth === 'number' ? rtp.frameWidth : null,
              frameHeight: typeof rtp.frameHeight === 'number' ? rtp.frameHeight : null,
            };
            if (mediaKind === 'video') {
              accumulateMediaStats(inboundVideo, update);
            } else {
              accumulateMediaStats(inboundAudio, update);
            }
          }
        }

        const localCandidate = selectedPair?.localCandidateId
          ? localCandidates.get(selectedPair.localCandidateId)
          : null;
        const remoteCandidate = selectedPair?.remoteCandidateId
          ? remoteCandidates.get(selectedPair.remoteCandidateId)
          : null;

        nextStats.push({
          userId: peerUserId,
          username: participantNameById.get(peerUserId) ?? 'Unknown',
          connectionState: connection.connectionState,
          iceConnectionState: connection.iceConnectionState,
          signalingState: connection.signalingState,
          currentRttMs:
            typeof selectedPair?.currentRoundTripTime === 'number'
              ? selectedPair.currentRoundTripTime * 1000
              : null,
          availableOutgoingBitrateKbps:
            typeof selectedPair?.availableOutgoingBitrate === 'number'
              ? selectedPair.availableOutgoingBitrate / 1000
              : null,
          localCandidateType: localCandidate?.candidateType ?? null,
          remoteCandidateType: remoteCandidate?.candidateType ?? null,
          outboundAudio,
          inboundAudio,
          outboundVideo,
          inboundVideo,
        });
      } catch {
        // Ignore stats collection failures for a single peer and continue.
      }
    }

    nextStats.sort((a, b) => a.username.localeCompare(b.username));
    setVoiceConnectionStats(nextStats);
    setVoiceStatsUpdatedAt(Date.now());
  }, [
    computeKbpsFromSnapshot,
    joinedVoiceParticipants,
    auth.user,
    voiceAudioTransportMode,
    voiceSfuTransportState,
  ]);

  useEffect(() => {
    if (!protectVoiceEnabled) {
      previousVoiceProtectionLevelRef.current = 'stable';
      return;
    }
    if (voiceProtectionLevel === previousVoiceProtectionLevelRef.current) {
      return;
    }
    previousVoiceProtectionLevelRef.current = voiceProtectionLevel;
    if (voiceProtectionLevel === 'stable') {
      showStreamStatusBanner('info', 'Protect Voice: network recovered, stream bitrate restored.');
      return;
    }
    if (voiceProtectionLevel === 'mild') {
      showStreamStatusBanner(
        'info',
        'Protect Voice: mild network stress detected, stream bitrate temporarily reduced.',
      );
      return;
    }
    showStreamStatusBanner(
      'info',
      'Protect Voice: severe network stress detected, stream bitrate strongly reduced.',
    );
  }, [protectVoiceEnabled, voiceProtectionLevel, showStreamStatusBanner]);

  const activeRemoteAudioUsers = useMemo(() => {
    if (!auth.user) {
      return [];
    }
    return joinedVoiceParticipants
      .filter((participant) => participant.userId !== auth.user?.id)
      .map((participant) => ({
        userId: participant.userId,
        username: participant.username,
        stream: remoteAudioStreams[participant.userId],
      }))
      .filter(
        (entry): entry is { userId: string; username: string; stream: MediaStream } =>
          Boolean(entry.stream),
      );
  }, [joinedVoiceParticipants, remoteAudioStreams, auth.user]);

  const viewedRemoteAudioUsers = useMemo(() => {
    if (!auth.user) {
      return [];
    }
    return activeVoiceParticipants
      .filter((participant) => participant.userId !== auth.user?.id)
      .map((participant) => ({
        userId: participant.userId,
        username: participant.username,
        stream: remoteAudioStreams[participant.userId],
      }))
      .filter(
        (entry): entry is { userId: string; username: string; stream: MediaStream } =>
          Boolean(entry.stream),
      );
  }, [activeVoiceParticipants, remoteAudioStreams, auth.user]);

  const filteredMessages = useMemo(() => {
    const query = messageQuery.trim().toLowerCase();
    if (!query) {
      return messages;
    }
    return messages.filter(
      (message) =>
        message.content.toLowerCase().includes(query) ||
        message.user.username.toLowerCase().includes(query),
    );
  }, [messages, messageQuery]);

  const refreshMicrophonePermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicrophonePermission('unsupported');
      return;
    }
    if (!navigator.permissions?.query) {
      setMicrophonePermission('unknown');
      return;
    }
    try {
      const result = await navigator.permissions.query({
        name: 'microphone' as PermissionName,
      });
      setMicrophonePermission(result.state as MicrophonePermissionState);
    } catch {
      setMicrophonePermission('unknown');
    }
  }, []);

  const enumerateAudioInputDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setAudioInputDevices([]);
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices
        .filter((device) => device.kind === 'audioinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
        }));
      setAudioInputDevices(inputs);
    } catch {
      setAudioInputDevices([]);
    }
  }, []);

  const unlockAudioContexts = useCallback(async () => {
    if (!audioContextsUnlockedRef.current) {
      audioContextsUnlockedRef.current = true;
    }

    const AudioContextClass = resolveAudioContextClass();
    if (!AudioContextClass) {
      return false;
    }

    if (!remoteAudioContextRef.current || remoteAudioContextRef.current.state === 'closed') {
      remoteAudioContextRef.current = new AudioContextClass();
    }
    if (!remoteSpeakingContextRef.current || remoteSpeakingContextRef.current.state === 'closed') {
      remoteSpeakingContextRef.current = new AudioContextClass();
    }

    const contexts = [
      remoteAudioContextRef.current,
      remoteSpeakingContextRef.current,
      localVoiceGainContextRef.current,
      localAnalyserContextRef.current,
    ].filter((context): context is AudioContext => Boolean(context && context.state !== 'closed'));

    await Promise.allSettled(
      contexts.map(async (context) => {
        if (context.state !== 'suspended') {
          return;
        }
        await context.resume();
      }),
    );

    return contexts.some((context) => context.state === 'running');
  }, []);

  const loadMessages = useCallback(
    async (channelId: string, before?: string, prepend = false) => {
      if (!auth.token) {
        return;
      }
      setLoadingMessages(true);
      try {
        const response = await chatApi.messages(auth.token, channelId, { before, limit: 50 });
        setMessages((prev) => {
          if (prepend) {
            return mergeMessages(response.messages, prev);
          }
          const localPending = prev.filter((item) => item.optimistic || item.failed);
          return mergeServerWithLocal(response.messages, localPending);
        });
      } finally {
        setLoadingMessages(false);
      }
    },
    [auth.token],
  );

  const loadFriendData = useCallback(async () => {
    if (!auth.token) {
      return;
    }
    setLoadingFriends(true);
    try {
      const [friendsResponse, requestResponse] = await Promise.all([
        chatApi.friends(auth.token),
        chatApi.friendRequests(auth.token),
      ]);
      setFriends(friendsResponse.friends);
      setIncomingRequests(requestResponse.incoming);
      setOutgoingRequests(requestResponse.outgoing);
      setFriendsError(null);
    } catch (err) {
      setFriendsError(getErrorMessage(err, 'Could not load friends'));
    } finally {
      setLoadingFriends(false);
    }
  }, [auth.token]);

  const playIncomingMessageSound = useCallback(() => {
    if (!preferences.playMessageSound) {
      return;
    }
    if (!audioContextsUnlockedRef.current) {
      return;
    }
    try {
      const AudioContextClass = resolveAudioContextClass();
      if (!AudioContextClass) {
        return;
      }
      const ctx = new AudioContextClass();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.13);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.14);
      window.setTimeout(() => {
        void ctx.close();
      }, 220);
    } catch {
      // Best effort only.
    }
  }, [preferences.playMessageSound]);

  const playVoiceStateSound = useCallback((kind: 'join' | 'leave') => {
    if (!audioContextsUnlockedRef.current) {
      return;
    }
    try {
      const AudioContextClass = resolveAudioContextClass();
      if (!AudioContextClass) {
        return;
      }
      const ctx = new AudioContextClass();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = kind === 'join' ? 700 : 460;
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.13);
      window.setTimeout(() => {
        void ctx.close();
      }, 220);
    } catch {
      // Best effort only.
    }
  }, []);

  const clearPendingSignature = useCallback((signature: string) => {
    pendingSignaturesRef.current.delete(signature);
    const timeoutId = pendingTimeoutsRef.current.get(signature);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      pendingTimeoutsRef.current.delete(signature);
    }
  }, []);

  const hasPendingSignature = useCallback(
    (signature: string) => pendingSignaturesRef.current.has(signature),
    [],
  );

  const addPendingSignature = useCallback((signature: string) => {
    pendingSignaturesRef.current.add(signature);
  }, []);

  const schedulePendingTimeout = useCallback(
    (signature: string) => {
      const timeoutId = window.setTimeout(() => {
        clearPendingSignature(signature);
      }, 12_000);
      pendingTimeoutsRef.current.set(signature, timeoutId);
    },
    [clearPendingSignature],
  );

  const applyLocalVoiceTrackState = useCallback(
    (stream: MediaStream | null) => {
      if (!stream) {
        return;
      }
      const shouldEnableMic = !isSelfMuted && !isSelfDeafened;
      for (const track of stream.getAudioTracks()) {
        track.enabled = shouldEnableMic;
      }
    },
    [isSelfMuted, isSelfDeafened],
  );

  const toggleSelfMute = useCallback(() => {
    void unlockAudioContexts();
    if (isSelfDeafened) {
      return;
    }
    setIsSelfMuted((current) => !current);
  }, [isSelfDeafened, unlockAudioContexts]);

  const toggleSelfDeafen = useCallback(() => {
    void unlockAudioContexts();
    if (!isSelfDeafened) {
      muteStateBeforeDeafenRef.current = isSelfMuted;
      setIsSelfMuted(true);
      setIsSelfDeafened(true);
      return;
    }
    const restoreMutedState = muteStateBeforeDeafenRef.current ?? false;
    setIsSelfDeafened(false);
    setIsSelfMuted(restoreMutedState);
    muteStateBeforeDeafenRef.current = null;
  }, [isSelfDeafened, isSelfMuted, unlockAudioContexts]);

  const closePeerConnection = useCallback((peerUserId: string) => {
    const disconnectTimeout = disconnectTimeoutByPeerRef.current.get(peerUserId);
    if (disconnectTimeout) {
      window.clearTimeout(disconnectTimeout);
      disconnectTimeoutByPeerRef.current.delete(peerUserId);
    }
    const connection = peerConnectionsRef.current.get(peerUserId);
    if (connection) {
      connection.onicecandidate = null;
      connection.ontrack = null;
      connection.onsignalingstatechange = null;
      connection.onconnectionstatechange = null;
      connection.close();
      peerConnectionsRef.current.delete(peerUserId);
    }
    videoSenderByPeerRef.current.delete(peerUserId);
    pendingVideoRenegotiationByPeerRef.current.delete(peerUserId);
    makingOfferByPeerRef.current.delete(peerUserId);
    ignoreOfferByPeerRef.current.delete(peerUserId);
    remoteVideoSourceByPeerRef.current.delete(peerUserId);
    remoteVideoStreamByPeerRef.current.delete(peerUserId);
    const pendingSnapshotTimeout = pendingStreamSnapshotRetryTimeoutByPeerRef.current.get(peerUserId);
    if (pendingSnapshotTimeout) {
      window.clearTimeout(pendingSnapshotTimeout);
      pendingStreamSnapshotRetryTimeoutByPeerRef.current.delete(peerUserId);
    }
    pendingIceRef.current.delete(peerUserId);
    remoteVideoTrafficByPeerRef.current.delete(peerUserId);
    remoteVideoRecoveryAttemptByPeerRef.current.delete(peerUserId);
    remoteVideoRecoveryStreakByPeerRef.current.delete(peerUserId);
    const remoteAudioSource = remoteAudioSourceByUserRef.current.get(peerUserId);
    if (remoteAudioSource) {
      remoteAudioSource.disconnect();
      remoteAudioSourceByUserRef.current.delete(peerUserId);
    }
    const remoteAudioGain = remoteAudioGainByUserRef.current.get(peerUserId);
    if (remoteAudioGain) {
      remoteAudioGain.disconnect();
      remoteAudioGainByUserRef.current.delete(peerUserId);
    }
    remoteAudioElementByUserRef.current.delete(peerUserId);
    const remoteSpeakingSource = remoteSpeakingSourceByUserRef.current.get(peerUserId);
    if (remoteSpeakingSource) {
      remoteSpeakingSource.disconnect();
      remoteSpeakingSourceByUserRef.current.delete(peerUserId);
    }
    remoteSpeakingAnalyserByUserRef.current.delete(peerUserId);
    remoteSpeakingDataByUserRef.current.delete(peerUserId);
    remoteSpeakingLastSpokeAtByUserRef.current.delete(peerUserId);
    setRemoteAudioStreams((prev) => {
      if (!prev[peerUserId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[peerUserId];
      return next;
    });
    setRemoteScreenShares((prev) => {
      if (!prev[peerUserId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[peerUserId];
      return next;
    });
  }, []);

  const teardownVoiceTransport = useCallback(() => {
    voiceTransportEpochRef.current += 1;
    localVoiceAcquirePromiseRef.current = null;
    voiceSfuClientRef.current?.stop();
    voiceSfuClientRef.current = null;
    voiceSfuChannelIdRef.current = null;
    voiceSfuAudioActiveRef.current = false;
    remoteAudioUsersViaSfuRef.current.clear();
    setVoiceAudioTransportMode('p2p');
    setVoiceSfuTransportState('new');
    for (const peerUserId of peerConnectionsRef.current.keys()) {
      closePeerConnection(peerUserId);
    }
    peerConnectionsRef.current.clear();
    videoSenderByPeerRef.current.clear();
    pendingVideoRenegotiationByPeerRef.current.clear();
    makingOfferByPeerRef.current.clear();
    ignoreOfferByPeerRef.current.clear();
    remoteVideoSourceByPeerRef.current.clear();
    remoteVideoStreamByPeerRef.current.clear();
    for (const timeoutId of pendingStreamSnapshotRetryTimeoutByPeerRef.current.values()) {
      window.clearTimeout(timeoutId);
    }
    pendingStreamSnapshotRetryTimeoutByPeerRef.current.clear();
    pendingIceRef.current.clear();
    remoteVideoTrafficByPeerRef.current.clear();
    remoteVideoRecoveryAttemptByPeerRef.current.clear();
    remoteVideoRecoveryStreakByPeerRef.current.clear();
    for (const timeoutId of disconnectTimeoutByPeerRef.current.values()) {
      window.clearTimeout(timeoutId);
    }
    disconnectTimeoutByPeerRef.current.clear();
    if (localVoiceStreamRef.current) {
      for (const track of localVoiceStreamRef.current.getTracks()) {
        track.stop();
      }
      localVoiceStreamRef.current = null;
      localVoiceInputDeviceIdRef.current = null;
    }
    if (localVoiceGainNodeRef.current) {
      localVoiceGainNodeRef.current.disconnect();
      localVoiceGainNodeRef.current = null;
    }
    if (localVoiceGainContextRef.current) {
      void localVoiceGainContextRef.current.close();
      localVoiceGainContextRef.current = null;
    }
    localVoiceProcessedStreamRef.current = null;
    if (localScreenStreamRef.current) {
      for (const track of localScreenStreamRef.current.getTracks()) {
        track.stop();
      }
      localScreenStreamRef.current = null;
      setLocalScreenShareStream(null);
      setLocalStreamSource(null);
    }
    if (localAnalyserSourceRef.current) {
      localAnalyserSourceRef.current.disconnect();
      localAnalyserSourceRef.current = null;
    }
    localAnalyserRef.current = null;
    if (localAnalyserContextRef.current) {
      void localAnalyserContextRef.current.close();
      localAnalyserContextRef.current = null;
    }
    setLocalAudioReady(false);
    setSpeakingUserIds([]);
    setRemoteAudioStreams({});
    setRemoteScreenShares({});
    for (const source of remoteAudioSourceByUserRef.current.values()) {
      source.disconnect();
    }
    for (const gain of remoteAudioGainByUserRef.current.values()) {
      gain.disconnect();
    }
    remoteAudioSourceByUserRef.current.clear();
    remoteAudioGainByUserRef.current.clear();
    remoteAudioElementByUserRef.current.clear();
    if (remoteAudioContextRef.current) {
      void remoteAudioContextRef.current.close();
      remoteAudioContextRef.current = null;
    }
    for (const source of remoteSpeakingSourceByUserRef.current.values()) {
      source.disconnect();
    }
    remoteSpeakingSourceByUserRef.current.clear();
    remoteSpeakingAnalyserByUserRef.current.clear();
    remoteSpeakingDataByUserRef.current.clear();
    remoteSpeakingLastSpokeAtByUserRef.current.clear();
    if (remoteSpeakingContextRef.current) {
      void remoteSpeakingContextRef.current.close();
      remoteSpeakingContextRef.current = null;
    }
  }, [closePeerConnection]);

  const resetLocalAnalyser = useCallback(() => {
    if (localAnalyserSourceRef.current) {
      localAnalyserSourceRef.current.disconnect();
      localAnalyserSourceRef.current = null;
    }
    localAnalyserRef.current = null;
    if (localAnalyserContextRef.current) {
      void localAnalyserContextRef.current.close();
      localAnalyserContextRef.current = null;
    }
  }, []);

  const ensureRemoteAudioContext = useCallback(() => {
    if (!audioContextsUnlockedRef.current) {
      return null;
    }
    if (remoteAudioContextRef.current && remoteAudioContextRef.current.state !== 'closed') {
      return remoteAudioContextRef.current;
    }
    const AudioContextClass = resolveAudioContextClass();
    if (!AudioContextClass) {
      return null;
    }
    const context = new AudioContextClass();
    remoteAudioContextRef.current = context;
    return context;
  }, []);

  const ensureRemoteSpeakingContext = useCallback(() => {
    if (!audioContextsUnlockedRef.current) {
      return null;
    }
    if (remoteSpeakingContextRef.current && remoteSpeakingContextRef.current.state !== 'closed') {
      return remoteSpeakingContextRef.current;
    }
    const AudioContextClass = resolveAudioContextClass();
    if (!AudioContextClass) {
      return null;
    }
    const context = new AudioContextClass();
    remoteSpeakingContextRef.current = context;
    return context;
  }, []);

  const disconnectRemoteAudioForUser = useCallback((userId: string) => {
    const source = remoteAudioSourceByUserRef.current.get(userId);
    if (source) {
      try { source.disconnect(); } catch {}
      remoteAudioSourceByUserRef.current.delete(userId);
    }
    const gain = remoteAudioGainByUserRef.current.get(userId);
    if (gain) {
      try { gain.disconnect(); } catch {}
      remoteAudioGainByUserRef.current.delete(userId);
    }
    remoteAudioElementByUserRef.current.delete(userId);
  }, []);

  const disconnectRemoteSpeakingForUser = useCallback((userId: string) => {
    const source = remoteSpeakingSourceByUserRef.current.get(userId);
    if (source) {
      try { source.disconnect(); } catch {}
      remoteSpeakingSourceByUserRef.current.delete(userId);
    }
    remoteSpeakingAnalyserByUserRef.current.delete(userId);
    remoteSpeakingDataByUserRef.current.delete(userId);
    remoteSpeakingLastSpokeAtByUserRef.current.delete(userId);
  }, []);

  const stopVoiceSfuTransport = useCallback(() => {
    voiceSfuClientRef.current?.stop();
    voiceSfuClientRef.current = null;
    voiceSfuChannelIdRef.current = null;
    voiceSfuAudioActiveRef.current = false;
    remoteAudioUsersViaSfuRef.current.clear();
    setVoiceAudioTransportMode('p2p');
    setVoiceSfuTransportState('new');
  }, []);

  const startVoiceSfuTransport = useCallback(
    async (channelId: string, localAudioTrack: MediaStreamTrack | null) => {
      if (!auth.user || !voiceSfuEnabled) {
        stopVoiceSfuTransport();
        return false;
      }
      const existingClient = voiceSfuClientRef.current;
      if (existingClient && voiceSfuChannelIdRef.current === channelId) {
        await existingClient.replaceLocalAudioTrack(localAudioTrack);
        voiceSfuAudioActiveRef.current = true;
        setVoiceAudioTransportMode('sfu');
        return true;
      }

      stopVoiceSfuTransport();

      const client = new VoiceSfuClient({
        selfUserId: auth.user.id,
        request: (action, data, timeoutMs) =>
          requestVoiceSfuRef.current(channelId, action, data, timeoutMs),
        callbacks: {
          onRemoteAudio: (userId, stream) => {
            remoteAudioUsersViaSfuRef.current.add(userId);
            setRemoteAudioStreams((prev) => ({
              ...prev,
              [userId]: stream,
            }));
          },
          onRemoteAudioRemoved: (userId) => {
            remoteAudioUsersViaSfuRef.current.delete(userId);
            setRemoteAudioStreams((prev) => {
              if (!prev[userId]) {
                return prev;
              }
              const next = { ...prev };
              delete next[userId];
              return next;
            });
          },
          onStateChange: (state) => {
            setVoiceSfuTransportState(state as RTCPeerConnectionState);
            logVoiceDebug('voice_sfu_transport_state', {
              channelId,
              state,
            });
          },
        },
      });

      try {
        await client.start(localAudioTrack);
        voiceSfuClientRef.current = client;
        voiceSfuChannelIdRef.current = channelId;
        voiceSfuAudioActiveRef.current = true;
        setVoiceAudioTransportMode('sfu');
        return true;
      } catch (error) {
        stopVoiceSfuTransport();
        logVoiceDebug('voice_sfu_start_failed', {
          channelId,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    },
    [auth.user, logVoiceDebug, stopVoiceSfuTransport, voiceSfuEnabled],
  );

  const handleVoiceSfuEvent = useCallback(
    async (payload: VoiceSfuEventPayload) => {
      if (payload.channelId !== activeVoiceChannelIdRef.current) {
        return;
      }
      const client = voiceSfuClientRef.current;
      if (!client) {
        return;
      }
      try {
        await client.handleSfuEvent(payload);
      } catch (error) {
        logVoiceDebug('voice_sfu_event_failed', {
          channelId: payload.channelId,
          event: payload.event,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [logVoiceDebug],
  );

  const applyRemoteAudioGain = useCallback(
    (userId: string, element: HTMLAudioElement, gainValue: number) => {
      const context = ensureRemoteAudioContext();
      if (!context) {
        element.volume = clampMediaElementVolume(gainValue);
        return false;
      }

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
    },
    [disconnectRemoteAudioForUser, ensureRemoteAudioContext],
  );

  useEffect(() => {
    const activeUserIds = new Set(activeRemoteAudioUsers.map((user) => user.userId));
    for (const userId of Array.from(remoteAudioGainByUserRef.current.keys())) {
      if (activeUserIds.has(userId)) {
        continue;
      }
      disconnectRemoteAudioForUser(userId);
    }
    for (const userId of Array.from(remoteSpeakingSourceByUserRef.current.keys())) {
      if (activeUserIds.has(userId)) {
        continue;
      }
      disconnectRemoteSpeakingForUser(userId);
    }
  }, [activeRemoteAudioUsers, disconnectRemoteAudioForUser, disconnectRemoteSpeakingForUser]);

  const pruneStaleRemoteScreenShares = useCallback(() => {
    const staleUserIds: string[] = [];
    for (const [userId, stream] of Object.entries(remoteScreenShares)) {
      const peerConnection = peerConnectionsRef.current.get(userId);
      const advertisedSource = remoteVideoSourceByPeerRef.current.get(userId);
      const videoTracks = stream.getVideoTracks();
      const hasLiveVideoTrack = videoTracks.some((track) => track.readyState === 'live');
      const isPeerClosed = peerConnection?.connectionState === 'closed';
      const senderExplicitlyStopped = advertisedSource === null;
      if (!hasLiveVideoTrack || isPeerClosed || senderExplicitlyStopped) {
        staleUserIds.push(userId);
      }
    }
    if (staleUserIds.length === 0) {
      return;
    }
    setRemoteScreenShares((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const userId of staleUserIds) {
        if (!next[userId]) {
          continue;
        }
        delete next[userId];
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [remoteScreenShares]);

  const initLocalAnalyser = useCallback((stream: MediaStream) => {
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }
    resetLocalAnalyser();
    const analyserContext = new AudioContextClass();
    const analyser = analyserContext.createAnalyser();
    analyser.fftSize = 1024;
    const source = analyserContext.createMediaStreamSource(stream);
    source.connect(analyser);
    localAnalyserContextRef.current = analyserContext;
    localAnalyserSourceRef.current = source;
    localAnalyserRef.current = analyser;
  }, [resetLocalAnalyser]);

  const replaceAudioTrackAcrossPeers = useCallback(async (audioTrack: MediaStreamTrack) => {
    const replacementTasks: Promise<void>[] = [];
    for (const connection of peerConnectionsRef.current.values()) {
      for (const sender of connection.getSenders()) {
        if (sender.track?.kind !== 'audio') {
          continue;
        }
        replacementTasks.push(
          sender.replaceTrack(audioTrack).catch(() => {
            // Ignore replacement errors; next renegotiation can recover.
          }),
        );
      }
    }
    if (replacementTasks.length > 0) {
      await Promise.allSettled(replacementTasks);
    }
  }, []);

  const requestMicrophoneStream = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Voice is not supported in this browser');
    }
    const preferredDeviceId = preferences.voiceInputDeviceId || null;
    let resolvedDeviceId = preferredDeviceId;
    const buildConstraints = (deviceId: string | null): MediaTrackConstraints => ({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: buildConstraints(preferredDeviceId),
        video: false,
      });
      return { stream, resolvedDeviceId };
    } catch (err) {
      if (!preferredDeviceId) {
        throw err;
      }
      updatePreferences({ voiceInputDeviceId: null });
      resolvedDeviceId = null;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: buildConstraints(null),
        video: false,
      });
      return { stream, resolvedDeviceId };
    }
  }, [preferences.voiceInputDeviceId, updatePreferences]);

  const getLocalVoiceStream = useCallback(async (forceRefresh = false) => {
    const preferredDeviceId = preferences.voiceInputDeviceId || null;
    const currentRawStream = localVoiceStreamRef.current;
    const currentRawTrack = currentRawStream?.getAudioTracks()[0] ?? null;
    const canReuseCurrentStream =
      !forceRefresh &&
      currentRawStream !== null &&
      currentRawTrack !== null &&
      currentRawTrack.readyState === 'live' &&
      localVoiceInputDeviceIdRef.current === preferredDeviceId;

    if (canReuseCurrentStream) {
      applyLocalVoiceTrackState(currentRawStream);
      return localVoiceProcessedStreamRef.current ?? currentRawStream;
    }

    if (localVoiceAcquirePromiseRef.current) {
      return localVoiceAcquirePromiseRef.current;
    }

    const acquirePromise = (async () => {
      const previousRawStream = localVoiceStreamRef.current;
      const previousGainNode = localVoiceGainNodeRef.current;
      const previousGainContext = localVoiceGainContextRef.current;
      const { stream: rawStream, resolvedDeviceId } = await requestMicrophoneStream();
      const rawTrack = rawStream.getAudioTracks()[0] ?? null;
      if (!rawTrack) {
        for (const track of rawStream.getTracks()) {
          track.stop();
        }
        throw new Error('No microphone track available');
      }

      localVoiceGainNodeRef.current = null;
      localVoiceGainContextRef.current = null;
      localVoiceProcessedStreamRef.current = null;

      let processedStream = rawStream;
      try {
        const AudioContextClass = resolveAudioContextClass();
        if (AudioContextClass) {
          const gainContext = new AudioContextClass();
          if (audioContextsUnlockedRef.current && gainContext.state === 'suspended') {
            try {
              await gainContext.resume();
            } catch {
              // Some browsers only allow resume from a direct user gesture.
            }
          }
          if (gainContext.state === 'running') {
            const source = gainContext.createMediaStreamSource(rawStream);
            const gainNode = gainContext.createGain();
            const targetGain = Math.max(0.0001, voiceInputGainRef.current / 100);
            if (previousGainNode) {
              gainNode.gain.setValueAtTime(0.0001, gainContext.currentTime);
              gainNode.gain.exponentialRampToValueAtTime(targetGain, gainContext.currentTime + 0.22);
            } else {
              gainNode.gain.value = targetGain;
            }
            const destination = gainContext.createMediaStreamDestination();
            source.connect(gainNode);
            gainNode.connect(destination);
            localVoiceGainContextRef.current = gainContext;
            localVoiceGainNodeRef.current = gainNode;
            localVoiceProcessedStreamRef.current = destination.stream;
            processedStream = destination.stream;
          } else {
            void gainContext.close();
          }
        }
      } catch {
        processedStream = rawStream;
      }

      const processedTrack = processedStream.getAudioTracks()[0] ?? rawTrack;
      localVoiceStreamRef.current = rawStream;
      localVoiceInputDeviceIdRef.current = resolvedDeviceId;

      await replaceAudioTrackAcrossPeers(processedTrack);
      if (voiceSfuAudioActiveRef.current) {
        await voiceSfuClientRef.current?.replaceLocalAudioTrack(processedTrack);
      }

      if (previousGainNode) {
        try {
          const fadeStart = previousGainContext?.currentTime ?? 0;
          const currentGain = Math.max(0.0001, previousGainNode.gain.value || 0.0001);
          previousGainNode.gain.cancelScheduledValues(fadeStart);
          previousGainNode.gain.setValueAtTime(currentGain, fadeStart);
          previousGainNode.gain.exponentialRampToValueAtTime(0.0001, fadeStart + 0.22);
        } catch {
          // Best effort only for smoother transitions.
        }
      }

      if (previousRawStream && previousRawStream !== rawStream) {
        window.setTimeout(() => {
          for (const track of previousRawStream.getTracks()) {
            track.stop();
          }
          if (previousGainNode) {
            try {
              previousGainNode.disconnect();
            } catch {
              // Ignore disconnect errors for stale nodes.
            }
          }
          if (previousGainContext) {
            void previousGainContext.close();
          }
        }, 320);
      } else if (previousGainNode) {
        try {
          previousGainNode.disconnect();
        } catch {
          // Ignore disconnect errors for stale nodes.
        }
        if (previousGainContext) {
          void previousGainContext.close();
        }
      }

      applyLocalVoiceTrackState(rawStream);
      initLocalAnalyser(rawStream);
      void refreshMicrophonePermission();
      void enumerateAudioInputDevices();
      setLocalAudioReady(true);
      return processedStream;
    })();

    localVoiceAcquirePromiseRef.current = acquirePromise;
    try {
      return await acquirePromise;
    } finally {
      if (localVoiceAcquirePromiseRef.current === acquirePromise) {
        localVoiceAcquirePromiseRef.current = null;
      }
    }
  }, [
    applyLocalVoiceTrackState,
    enumerateAudioInputDevices,
    initLocalAnalyser,
    preferences.voiceInputDeviceId,
    refreshMicrophonePermission,
    replaceAudioTrackAcrossPeers,
    requestMicrophoneStream,
  ]);

  const applyAudioBitrateToConnection = useCallback(
    async (connection: RTCPeerConnection, bitrateKbps: number) => {
      const bitrateBps = Math.max(8, bitrateKbps) * 1000;
      for (const sender of connection.getSenders()) {
        if (!sender.track || sender.track.kind !== 'audio') {
          continue;
        }
        try {
          const parameters = sender.getParameters();
          const existingEncodings =
            parameters.encodings && parameters.encodings.length > 0
              ? parameters.encodings
              : [{}];
          parameters.encodings = existingEncodings.map((encoding) => {
            const tuned = {
              ...encoding,
              maxBitrate: bitrateBps,
            } as RTCRtpEncodingParameters & {
              dtx?: 'enabled' | 'disabled';
              priority?: RTCPriorityType;
              networkPriority?: RTCPriorityType;
            };
            tuned.dtx = 'disabled';
            tuned.priority = 'high';
            tuned.networkPriority = 'high';
            return tuned;
          });
          await sender.setParameters(parameters);
        } catch {
          // Browser may not allow dynamic sender parameter updates.
        }
      }
    },
    [],
  );

  const applyAudioCodecPreferences = useCallback((connection: RTCPeerConnection) => {
    const senderCapabilities = RTCRtpSender.getCapabilities?.('audio');
    if (!senderCapabilities?.codecs?.length) {
      return;
    }
    const opusCodecs = senderCapabilities.codecs.filter((codec) =>
      codec.mimeType.toLowerCase() === 'audio/opus');
    if (opusCodecs.length === 0) {
      return;
    }
    const nonOpusCodecs = senderCapabilities.codecs.filter((codec) =>
      codec.mimeType.toLowerCase() !== 'audio/opus');
    const prioritizedCodecs = [...opusCodecs, ...nonOpusCodecs];
    for (const transceiver of connection.getTransceivers()) {
      const senderKind = transceiver.sender.track?.kind;
      const receiverKind = transceiver.receiver.track?.kind;
      if (senderKind !== 'audio' && receiverKind !== 'audio') {
        continue;
      }
      if (!transceiver.setCodecPreferences) {
        continue;
      }
      try {
        transceiver.setCodecPreferences(prioritizedCodecs);
      } catch {
        // Codec preferences are optional and browser-dependent.
      }
    }
  }, []);

  const applyVideoBitrateToConnection = useCallback(
    async (connection: RTCPeerConnection, bitrateKbps: number) => {
      const bitrateBps = Math.max(128, bitrateKbps) * 1000;
      for (const sender of connection.getSenders()) {
        if (!sender.track || sender.track.kind !== 'video') {
          continue;
        }
        try {
          const parameters = sender.getParameters();
          const existingEncodings =
            parameters.encodings && parameters.encodings.length > 0
              ? parameters.encodings
              : [{}];
          parameters.encodings = existingEncodings.map((encoding) => ({
            ...encoding,
            maxBitrate: bitrateBps,
          }));
          await sender.setParameters(parameters);
        } catch {
          // Browser may not allow dynamic sender parameter updates.
        }
      }
    },
    [],
  );

  const applyReceiverBuffering = useCallback(
    (receiver: RTCRtpReceiver | null | undefined, kind: 'audio' | 'video') => {
      if (!receiver) {
        return;
      }
      const bufferedReceiver = receiver as RTCRtpReceiver & {
        playoutDelayHint?: number;
        jitterBufferTarget?: number;
      };
      const playoutDelayHintSeconds =
        kind === 'video'
          ? REMOTE_VIDEO_PLAYOUT_DELAY_HINT_SECONDS
          : REMOTE_AUDIO_PLAYOUT_DELAY_HINT_SECONDS;
      const jitterBufferTargetMs =
        kind === 'video' ? REMOTE_VIDEO_JITTER_BUFFER_TARGET_MS : REMOTE_AUDIO_JITTER_BUFFER_TARGET_MS;

      if ('playoutDelayHint' in bufferedReceiver) {
        try {
          bufferedReceiver.playoutDelayHint = playoutDelayHintSeconds;
        } catch {
          // Browser can reject runtime tuning on some builds.
        }
      }
      if ('jitterBufferTarget' in bufferedReceiver) {
        try {
          bufferedReceiver.jitterBufferTarget = jitterBufferTargetMs;
        } catch {
          // Browser can reject runtime tuning on some builds.
        }
      }
    },
    [],
  );

  const applyConnectionReceiverBuffering = useCallback(
    (connection: RTCPeerConnection) => {
      for (const receiver of connection.getReceivers()) {
        const kind = receiver.track?.kind;
        if (kind !== 'audio' && kind !== 'video') {
          continue;
        }
        applyReceiverBuffering(receiver, kind);
      }
    },
    [applyReceiverBuffering],
  );

  const getOrCreateVideoSender = useCallback((connection: RTCPeerConnection) => {
    const existingVideoSender =
      connection.getSenders().find((candidate) => candidate.track?.kind === 'video') ?? null;
    if (existingVideoSender) {
      return existingVideoSender;
    }

    const sendCapableVideoTransceiver = connection.getTransceivers().find((transceiver) => {
      const direction = transceiver.currentDirection ?? transceiver.direction;
      if (direction !== 'sendrecv' && direction !== 'sendonly') {
        return false;
      }
      return (
        transceiver.sender.track?.kind === 'video' ||
        transceiver.receiver.track?.kind === 'video'
      );
    });
    if (sendCapableVideoTransceiver) {
      return sendCapableVideoTransceiver.sender;
    }

    return connection.addTransceiver('video', { direction: 'sendrecv' }).sender;
  }, []);

  const flushPendingIceCandidates = useCallback(async (peerUserId: string, connection: RTCPeerConnection) => {
    const queued = pendingIceRef.current.get(peerUserId);
    if (!queued?.length || !connection.remoteDescription) {
      return;
    }
    pendingIceRef.current.delete(peerUserId);
    for (const candidate of queued) {
      try {
        await connection.addIceCandidate(candidate);
      } catch {
        // Ignore invalid/stale ICE candidates.
      }
    }
  }, []);

  const ensurePeerConnection = useCallback(
    async (peerUserId: string, channelId: string) => {
      const existing = peerConnectionsRef.current.get(peerUserId);
      if (existing) {
        logVoiceDebug('peer_connection_reuse', { peerUserId, channelId });
        return existing;
      }

      const stream = await getLocalVoiceStream();
      const connection = new RTCPeerConnection({
        ...voiceIceConfig,
      });
      peerConnectionsRef.current.set(peerUserId, connection);
      applyAudioCodecPreferences(connection);
      applyConnectionReceiverBuffering(connection);
      logVoiceDebug('peer_connection_create', {
        peerUserId,
        channelId,
        hasTurnRelayConfigured,
        iceTransportPolicy: voiceIceConfig.iceTransportPolicy ?? 'all',
        audioMode: voiceSfuAudioActiveRef.current ? 'sfu' : 'p2p',
      });

      if (!voiceSfuAudioActiveRef.current) {
        for (const track of stream.getTracks()) {
          connection.addTrack(track, stream);
        }
      }
      const videoSender = getOrCreateVideoSender(connection);
      videoSenderByPeerRef.current.set(peerUserId, videoSender);
      const localVideoTrack = localScreenStreamRef.current?.getVideoTracks()[0] ?? null;
      if (localVideoTrack) {
        try {
          await videoSender.replaceTrack(localVideoTrack);
        } catch {
          // Keep empty sender and continue. Next renegotiation can recover.
        }
      }
      await applyAudioBitrateToConnection(connection, activeVoiceBitrateKbps);
      await applyVideoBitrateToConnection(connection, effectiveStreamBitrateKbps);

      connection.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }
        sendVoiceSignalRef.current(channelId, peerUserId, {
          kind: 'ice',
          candidate: event.candidate.toJSON(),
        } satisfies VoiceSignalData);
      };

      sendVoiceSignalRef.current(channelId, peerUserId, {
        kind: 'video-source',
        source: localStreamSource,
      } satisfies VoiceSignalData);

      connection.ontrack = (event) => {
        applyReceiverBuffering(event.receiver, event.track.kind === 'video' ? 'video' : 'audio');
        const streamFromTrack = event.streams[0] ?? new MediaStream([event.track]);
        if (event.track.kind === 'audio') {
          if (remoteAudioUsersViaSfuRef.current.has(peerUserId)) {
            return;
          }
          setRemoteAudioStreams((prev) => ({
            ...prev,
            [peerUserId]: streamFromTrack,
          }));
        } else if (event.track.kind === 'video') {
          remoteVideoStreamByPeerRef.current.set(peerUserId, streamFromTrack);
          const setRemoteVideoVisible = () => {
            const advertisedSource = remoteVideoSourceByPeerRef.current.get(peerUserId);
            if (advertisedSource === null) {
              return;
            }
            const hasLiveVideoTrack = streamFromTrack
              .getVideoTracks()
              .some((track) => track.readyState === 'live');
            if (!hasLiveVideoTrack) {
              return;
            }
            setRemoteScreenShares((prev) => ({
              ...prev,
              [peerUserId]: streamFromTrack,
            }));
          };
          const clearRemoteVideo = () => {
            setRemoteScreenShares((prev) => {
              if (!prev[peerUserId]) {
                return prev;
              }
              const next = { ...prev };
              delete next[peerUserId];
              return next;
            });
          };
          setRemoteVideoVisible();
          event.track.onmute = clearRemoteVideo;
          event.track.onunmute = setRemoteVideoVisible;
          event.track.onended = () => {
            remoteVideoStreamByPeerRef.current.delete(peerUserId);
            clearRemoteVideo();
          };
        }
      };

      connection.onsignalingstatechange = () => {
        if (connection.signalingState !== 'stable') {
          return;
        }
        if (!pendingVideoRenegotiationByPeerRef.current.has(peerUserId)) {
          return;
        }
        const activeChannelId = activeVoiceChannelIdRef.current;
        if (!activeChannelId) {
          pendingVideoRenegotiationByPeerRef.current.delete(peerUserId);
          return;
        }
        pendingVideoRenegotiationByPeerRef.current.delete(peerUserId);
        if (!auth.user || !shouldInitiateOffer(auth.user.id, peerUserId)) {
          sendVoiceSignalRef.current(activeChannelId, peerUserId, {
            kind: 'renegotiate',
          } satisfies VoiceSignalData);
          return;
        }
        void createOfferForPeerRef.current(peerUserId, activeChannelId);
      };

      connection.onconnectionstatechange = () => {
        const existingDisconnectTimeout = disconnectTimeoutByPeerRef.current.get(peerUserId);
        if (existingDisconnectTimeout && connection.connectionState !== 'disconnected') {
          window.clearTimeout(existingDisconnectTimeout);
          disconnectTimeoutByPeerRef.current.delete(peerUserId);
        }
        logVoiceDebug('peer_connection_state', {
          peerUserId,
          channelId,
          connectionState: connection.connectionState,
          iceConnectionState: connection.iceConnectionState,
          signalingState: connection.signalingState,
        });
        if (connection.connectionState === 'closed') {
          closePeerConnection(peerUserId);
          return;
        }
        if (connection.connectionState === 'failed') {
          if (!hasTurnRelayConfigured) {
            setError(
              'Voice P2P connection failed (no TURN configured). This usually happens on strict/mobile/company NAT networks.',
            );
          }
          const activeChannelId = activeVoiceChannelIdRef.current;
          if (activeChannelId) {
            try {
              connection.restartIce?.();
            } catch {
              // Best effort; fallback path below still handles recovery.
            }
            if (auth.user && shouldInitiateOffer(auth.user.id, peerUserId)) {
              void createOfferForPeerRef.current(peerUserId, activeChannelId);
            } else {
              sendVoiceSignalRef.current(activeChannelId, peerUserId, {
                kind: 'renegotiate',
              } satisfies VoiceSignalData);
            }
          }
          if (disconnectTimeoutByPeerRef.current.has(peerUserId)) {
            return;
          }
          const timeoutId = window.setTimeout(() => {
            disconnectTimeoutByPeerRef.current.delete(peerUserId);
            if (connection.connectionState !== 'failed' && connection.connectionState !== 'disconnected') {
              return;
            }
            const fallbackChannelId = activeVoiceChannelIdRef.current;
            closePeerConnection(peerUserId);
            if (!fallbackChannelId) {
              return;
            }
            // Hard reset connection if still failed after 10 seconds
            void createOfferForPeerRef.current(peerUserId, fallbackChannelId);
          }, 10000);
          disconnectTimeoutByPeerRef.current.set(peerUserId, timeoutId);
          return;
        }

        if (connection.connectionState === 'disconnected') {
          if (disconnectTimeoutByPeerRef.current.has(peerUserId)) {
            return;
          }
          const activeChannelId = activeVoiceChannelIdRef.current;
          if (activeChannelId) {
            try {
              connection.restartIce?.();
            } catch {
              // Best effort; fallback timeout handles hard recovery.
            }
            if (auth.user && shouldInitiateOffer(auth.user.id, peerUserId)) {
              void createOfferForPeerRef.current(peerUserId, activeChannelId);
            } else {
              sendVoiceSignalRef.current(activeChannelId, peerUserId, {
                kind: 'renegotiate',
              } satisfies VoiceSignalData);
            }
          }
          const timeoutId = window.setTimeout(() => {
            disconnectTimeoutByPeerRef.current.delete(peerUserId);
            if (connection.connectionState !== 'failed' && connection.connectionState !== 'disconnected') {
              return;
            }
            const fallbackChannelId = activeVoiceChannelIdRef.current;
            closePeerConnection(peerUserId);
            if (!fallbackChannelId) {
              return;
            }
            // Hard reset connection if still disconnected after 12 seconds
            void createOfferForPeerRef.current(peerUserId, fallbackChannelId);
          }, 12000);
          disconnectTimeoutByPeerRef.current.set(peerUserId, timeoutId);
        }
      };
      return connection;
    },
    [
      auth.user,
      applyAudioBitrateToConnection,
      applyVideoBitrateToConnection,
      closePeerConnection,
      getLocalVoiceStream,
      activeVoiceBitrateKbps,
      effectiveStreamBitrateKbps,
      applyConnectionReceiverBuffering,
      applyAudioCodecPreferences,
      applyReceiverBuffering,
      getOrCreateVideoSender,
      localStreamSource,
      voiceIceConfig,
      hasTurnRelayConfigured,
      logVoiceDebug,
    ],
  );

  const createOfferForPeer = useCallback(
    async (peerUserId: string, channelId: string) => {
      if (!auth.user) {
        return;
      }
      if (!shouldInitiateOffer(auth.user.id, peerUserId)) {
        return;
      }
      const connection = await ensurePeerConnection(peerUserId, channelId);
      if (makingOfferByPeerRef.current.get(peerUserId)) {
        pendingVideoRenegotiationByPeerRef.current.add(peerUserId);
        return;
      }
      if (connection.signalingState !== 'stable') {
        pendingVideoRenegotiationByPeerRef.current.add(peerUserId);
        return;
      }
      pendingVideoRenegotiationByPeerRef.current.delete(peerUserId);
      makingOfferByPeerRef.current.set(peerUserId, true);
      try {
        const offer = await connection.createOffer();
        if (connection.signalingState !== 'stable') {
          pendingVideoRenegotiationByPeerRef.current.add(peerUserId);
          return;
        }
        await connection.setLocalDescription(offer);
        const localDescription = connection.localDescription;
        if (!localDescription || localDescription.type !== 'offer') {
          pendingVideoRenegotiationByPeerRef.current.add(peerUserId);
          return;
        }
        sendVoiceSignalRef.current(channelId, peerUserId, {
          kind: 'offer',
          sdp: localDescription,
        } satisfies VoiceSignalData);
      } catch {
        pendingVideoRenegotiationByPeerRef.current.add(peerUserId);
      } finally {
        makingOfferByPeerRef.current.delete(peerUserId);
      }
    },
    [auth.user, ensurePeerConnection],
  );

  const requestVideoRenegotiationForPeer = useCallback(
    (peerUserId: string, channelId: string) => {
      if (!auth.user) {
        return;
      }
      if (shouldInitiateOffer(auth.user.id, peerUserId)) {
        void createOfferForPeer(peerUserId, channelId);
        return;
      }
      sendVoiceSignalRef.current(channelId, peerUserId, {
        kind: 'renegotiate',
      } satisfies VoiceSignalData);
    },
    [auth.user, createOfferForPeer],
  );

  const getLocalVideoSourceSnapshot = useCallback(() => {
    const localVideoTrack = localScreenStreamRef.current
      ?.getVideoTracks()
      .find((track) => track.readyState === 'live') ?? null;
    if (!localVideoTrack || !localStreamSource) {
      return {
        source: null as StreamSource | null,
        hasLiveVideoTrack: false,
      };
    }
    return {
      source: localStreamSource,
      hasLiveVideoTrack: true,
    };
  }, [localStreamSource]);

  const sendStreamSnapshotToPeer = useCallback(
    (channelId: string, peerUserId: string) => {
      const snapshot = getLocalVideoSourceSnapshot();
      sendVoiceSignalRef.current(channelId, peerUserId, {
        kind: 'stream-snapshot',
        source: snapshot.source,
        hasLiveVideoTrack: snapshot.hasLiveVideoTrack,
      } satisfies VoiceSignalData);
    },
    [getLocalVideoSourceSnapshot],
  );

  const requestStreamSnapshotFromPeer = useCallback(
    (
      channelId: string,
      peerUserId: string,
      reason: 'join-sync' | 'retry' | 'post-reset' | 'manual' = 'join-sync',
    ) => {
      sendVoiceSignalRef.current(channelId, peerUserId, {
        kind: 'stream-snapshot-request',
        reason,
      } satisfies VoiceSignalData);

      const existingTimeout = pendingStreamSnapshotRetryTimeoutByPeerRef.current.get(peerUserId);
      if (existingTimeout) {
        window.clearTimeout(existingTimeout);
      }
      const timeoutId = window.setTimeout(() => {
        pendingStreamSnapshotRetryTimeoutByPeerRef.current.delete(peerUserId);
        if (activeVoiceChannelIdRef.current !== channelId) {
          return;
        }
        sendVoiceSignalRef.current(channelId, peerUserId, {
          kind: 'stream-snapshot-request',
          reason: 'retry',
        } satisfies VoiceSignalData);
      }, 1400);
      pendingStreamSnapshotRetryTimeoutByPeerRef.current.set(peerUserId, timeoutId);
    },
    [],
  );

  const syncLocalVideoSourceToPeers = useCallback(
    (channelId: string, targetPeerUserIds: string[]) => {
      if (targetPeerUserIds.length === 0) {
        return;
      }
      for (const peerUserId of targetPeerUserIds) {
        sendVoiceSignalRef.current(channelId, peerUserId, {
          kind: 'video-source',
          source: localStreamSource,
        } satisfies VoiceSignalData);
      }
    },
    [localStreamSource],
  );

  const canProcessVoiceSignalsForChannel = useCallback((channelId: string) => {
    const activeVoiceChannelId = activeVoiceChannelIdRef.current;
    const busyVoiceChannelId = voiceBusyChannelIdRef.current;
    return activeVoiceChannelId === channelId || busyVoiceChannelId === channelId;
  }, []);

  const processVoiceSignal = useCallback(
    async (payload: { channelId: string; fromUserId: string; data: VoiceSignalData }) => {
      if (!auth.user || payload.fromUserId === auth.user.id) {
        return;
      }
      const selfUserId = auth.user.id;

      const currentQueue = peerSignalingQueueRef.current.get(payload.fromUserId) ?? Promise.resolve();
      const nextQueue = currentQueue
        .then(async () => {
          const signal = payload.data;
      if (signal.kind === 'stream-snapshot-request') {
        sendStreamSnapshotToPeer(payload.channelId, payload.fromUserId);
        return;
      }

      if (signal.kind === 'stream-snapshot') {
        const pendingTimeout = pendingStreamSnapshotRetryTimeoutByPeerRef.current.get(payload.fromUserId);
        if (pendingTimeout) {
          window.clearTimeout(pendingTimeout);
          pendingStreamSnapshotRetryTimeoutByPeerRef.current.delete(payload.fromUserId);
        }

        remoteVideoSourceByPeerRef.current.set(payload.fromUserId, signal.source);
        const stream = remoteVideoStreamByPeerRef.current.get(payload.fromUserId);
        const hasLiveVideoTrack = Boolean(
          stream?.getVideoTracks().some((track) => track.readyState === 'live'),
        );

        if (signal.source === 'screen' || signal.source === 'camera') {
          if (stream && hasLiveVideoTrack) {
            setRemoteScreenShares((prev) => ({
              ...prev,
              [payload.fromUserId]: stream,
            }));
          } else {
            setRemoteScreenShares((prev) => {
              if (!prev[payload.fromUserId]) {
                return prev;
              }
              const next = { ...prev };
              delete next[payload.fromUserId];
              return next;
            });
            sendVoiceSignalRef.current(payload.channelId, payload.fromUserId, {
              kind: 'video-recovery-request',
              reason: 'snapshot-mismatch',
            } satisfies VoiceSignalData);
            requestVideoRenegotiationForPeer(payload.fromUserId, payload.channelId);
          }
        } else {
          setRemoteScreenShares((prev) => {
            if (!prev[payload.fromUserId]) {
              return prev;
            }
            const next = { ...prev };
            delete next[payload.fromUserId];
            return next;
          });
        }

        sendVoiceSignalRef.current(payload.channelId, payload.fromUserId, {
          kind: 'stream-snapshot-ack',
          source: signal.source,
          hasLiveVideoTrack,
        } satisfies VoiceSignalData);
        return;
      }

      if (signal.kind === 'stream-snapshot-ack') {
        const localSnapshot = getLocalVideoSourceSnapshot();
        const peerMissingExpectedVideo =
          localSnapshot.source !== null &&
          signal.source === localSnapshot.source &&
          !signal.hasLiveVideoTrack;
        if (peerMissingExpectedVideo) {
          requestVideoRenegotiationForPeer(payload.fromUserId, payload.channelId);
        }
        return;
      }

      if (signal.kind === 'video-recovery-request') {
        const connection = await ensurePeerConnection(payload.fromUserId, payload.channelId);
        const sender = getOrCreateVideoSender(connection);
        videoSenderByPeerRef.current.set(payload.fromUserId, sender);

        const localVideoTrack = localScreenStreamRef.current
          ?.getVideoTracks()
          .find((track) => track.readyState === 'live') ?? null;
        if (!localVideoTrack || !localStreamSource) {
          try {
            await sender.replaceTrack(null);
          } catch {
            // Best effort. Renegotiation path below can still recover receiver state.
          }
          sendVoiceSignalRef.current(payload.channelId, payload.fromUserId, {
            kind: 'video-source',
            source: null,
          } satisfies VoiceSignalData);
          requestVideoRenegotiationForPeer(payload.fromUserId, payload.channelId);
          return;
        }

        try {
          await sender.replaceTrack(localVideoTrack);
        } catch {
          // Best effort only. Recovery continues via renegotiation.
        }
        void applyVideoBitrateToConnection(connection, effectiveStreamBitrateKbps);
        sendVoiceSignalRef.current(payload.channelId, payload.fromUserId, {
          kind: 'video-source',
          source: localStreamSource,
        } satisfies VoiceSignalData);
        requestVideoRenegotiationForPeer(payload.fromUserId, payload.channelId);
        return;
      }

      if (signal.kind === 'video-source') {
        remoteVideoSourceByPeerRef.current.set(payload.fromUserId, signal.source);
        if (signal.source === 'screen' || signal.source === 'camera') {
          const stream = remoteVideoStreamByPeerRef.current.get(payload.fromUserId);
          const hasLiveVideoTrack = Boolean(
            stream?.getVideoTracks().some((track) => track.readyState === 'live'),
          );
          if (stream && hasLiveVideoTrack) {
            setRemoteScreenShares((prev) => ({
              ...prev,
              [payload.fromUserId]: stream,
            }));
          } else {
            sendVoiceSignalRef.current(payload.channelId, payload.fromUserId, {
              kind: 'video-recovery-request',
              reason: 'snapshot-mismatch',
            } satisfies VoiceSignalData);
            requestVideoRenegotiationForPeer(payload.fromUserId, payload.channelId);
            requestStreamSnapshotFromPeer(payload.channelId, payload.fromUserId, 'retry');
          }
        } else {
          setRemoteScreenShares((prev) => {
            if (!prev[payload.fromUserId]) {
              return prev;
            }
            const next = { ...prev };
            delete next[payload.fromUserId];
            return next;
          });
        }
        return;
      }

      if (signal.kind === 'renegotiate') {
        if (!shouldInitiateOffer(selfUserId, payload.fromUserId)) {
          return;
        }
        const existingConnection = peerConnectionsRef.current.get(payload.fromUserId);
        if (existingConnection && existingConnection.connectionState !== 'closed') {
          if (existingConnection.signalingState === 'stable') {
            try {
              await createOfferForPeerRef.current(payload.fromUserId, payload.channelId);
            } catch {
              pendingVideoRenegotiationByPeerRef.current.add(payload.fromUserId);
            }
          } else {
            pendingVideoRenegotiationByPeerRef.current.add(payload.fromUserId);
          }
          return;
        }
        closePeerConnection(payload.fromUserId);
        try {
          await ensurePeerConnection(payload.fromUserId, payload.channelId);
          await createOfferForPeerRef.current(payload.fromUserId, payload.channelId);
        } catch {
          // Best effort. Next sync cycle can recover.
        }
        return;
      }

      if (signal.kind === 'ice') {
        const connection = peerConnectionsRef.current.get(payload.fromUserId);
        if (!connection || !connection.remoteDescription) {
          const queue = pendingIceRef.current.get(payload.fromUserId) ?? [];
          queue.push(signal.candidate);
          pendingIceRef.current.set(payload.fromUserId, queue);
          return;
        }
        try {
          await connection.addIceCandidate(signal.candidate);
        } catch {
          // Ignore invalid/stale ICE candidates.
        }
        return;
      }

      const connection = await ensurePeerConnection(payload.fromUserId, payload.channelId);

      if (signal.kind === 'offer') {
        if (shouldInitiateOffer(selfUserId, payload.fromUserId)) {
          return;
        }

        if (connection.signalingState === 'have-local-offer') {
          try {
            await connection.setLocalDescription({ type: 'rollback' });
          } catch {
            pendingVideoRenegotiationByPeerRef.current.add(payload.fromUserId);
            return;
          }
        }

        if (connection.signalingState !== 'stable' && connection.signalingState !== 'have-local-offer') {
          return;
        }

        try {
          if (connection.connectionState === 'closed') return;
          await connection.setRemoteDescription(signal.sdp);
          
          applyConnectionReceiverBuffering(connection);
          await flushPendingIceCandidates(payload.fromUserId, connection);

          // Modern atomic answer creation & setting
          await connection.setLocalDescription(); 
          
          if (!connection.localDescription) {
             return;
          }

          sendVoiceSignalRef.current(payload.channelId, payload.fromUserId, {
            kind: 'answer',
            sdp: connection.localDescription,
          } satisfies VoiceSignalData);
        } catch (err) {
          trackTelemetryError('voice_signal_offer_processing_failed', err, {
            peerUserId: payload.fromUserId,
            channelId: payload.channelId,
            signalingState: connection.signalingState,
          });
          // Avoid loop: don't always reset here, let sync transport handle it
        }
        return;
      }

      if (!shouldInitiateOffer(selfUserId, payload.fromUserId)) {
        return;
      }

      if (signal.kind !== 'answer') {
        return;
      }

      if (connection.signalingState !== 'have-local-offer') {
        return;
      }

      try {
        if (connection.connectionState === 'closed') return;
        await connection.setRemoteDescription(signal.sdp);
        applyConnectionReceiverBuffering(connection);
        await flushPendingIceCandidates(payload.fromUserId, connection);
      } catch (err) {
        trackTelemetryError('voice_signal_answer_remote_description_failed', err, {
          peerUserId: payload.fromUserId,
          channelId: payload.channelId,
          signalingState: connection.signalingState,
        });
        closePeerConnection(payload.fromUserId);
        try {
          await ensurePeerConnection(payload.fromUserId, payload.channelId);
          await createOfferForPeerRef.current(payload.fromUserId, payload.channelId);
        } catch {
          // Best effort. Next voice sync can recover.
        }
        return;
      }
      applyConnectionReceiverBuffering(connection);
      await flushPendingIceCandidates(payload.fromUserId, connection);
    })
    .catch((err) => {
      trackTelemetryError('voice_signal_queue_processing_failed', err, {
        fromUserId: payload.fromUserId,
        channelId: payload.channelId,
      });
    });

  peerSignalingQueueRef.current.set(payload.fromUserId, nextQueue);
},
[
  auth.user,
  applyConnectionReceiverBuffering,
  applyVideoBitrateToConnection,
  closePeerConnection,
  effectiveStreamBitrateKbps,
  ensurePeerConnection,
  flushPendingIceCandidates,
  getLocalVideoSourceSnapshot,
  getOrCreateVideoSender,
  localStreamSource,
  requestVideoRenegotiationForPeer,
  sendStreamSnapshotToPeer,
],
);

  const drainQueuedVoiceSignals = useCallback(async () => {
    if (drainingVoiceSignalsRef.current || !auth.user) {
      return;
    }
    drainingVoiceSignalsRef.current = true;
    try {
      let loopGuard = 0;
      while (queuedVoiceSignalsRef.current.length > 0 && loopGuard < 400) {
        loopGuard += 1;
        const pending = queuedVoiceSignalsRef.current;
        queuedVoiceSignalsRef.current = [];
        const deferred: Array<{ channelId: string; fromUserId: string; data: VoiceSignalData }> = [];

        for (const signal of pending) {
          if (!canProcessVoiceSignalsForChannel(signal.channelId)) {
            deferred.push(signal);
            continue;
          }
          await processVoiceSignal(signal);
        }

        if (deferred.length > 0) {
          queuedVoiceSignalsRef.current = deferred;
          break;
        }
      }
    } finally {
      drainingVoiceSignalsRef.current = false;
    }
  }, [auth.user, canProcessVoiceSignalsForChannel, processVoiceSignal]);

  const handleVoiceSignal = useCallback(
    async (payload: { channelId: string; fromUserId: string; data: unknown }) => {
      if (!auth.user || payload.fromUserId === auth.user.id) {
        return;
      }
      if (!isVoiceSignalData(payload.data)) {
        return;
      }

      const normalizedPayload = {
        channelId: payload.channelId,
        fromUserId: payload.fromUserId,
        data: payload.data,
      };

      if (!canProcessVoiceSignalsForChannel(payload.channelId)) {
        const queue = queuedVoiceSignalsRef.current;
        queue.push(normalizedPayload);
        logVoiceDebug('voice_signal_queued', {
          fromUserId: payload.fromUserId,
          channelId: payload.channelId,
          kind: payload.data.kind,
          queueSize: queue.length,
        });
        if (queue.length > 300) {
          let overflow = queue.length - 300;
          for (let index = 0; index < queue.length && overflow > 0;) {
            if (queue[index].data.kind === 'ice') {
              queue.splice(index, 1);
              overflow -= 1;
              continue;
            }
            index += 1;
          }
          if (overflow > 0) {
            queue.splice(0, overflow);
          }
        }
        return;
      }

      logVoiceDebug('voice_signal_process', {
        fromUserId: payload.fromUserId,
        channelId: payload.channelId,
        kind: payload.data.kind,
      });
      await processVoiceSignal(normalizedPayload);
      await drainQueuedVoiceSignals();
    },
    [auth.user, canProcessVoiceSignalsForChannel, drainQueuedVoiceSignals, logVoiceDebug, processVoiceSignal],
  );

  const handleVoiceState = useCallback(
    (payload: VoiceStatePayload) => {
      const nextParticipantIds = new Set(payload.participants.map((participant) => participant.userId));
      const hadPreviousState = voiceParticipantIdsByChannelRef.current.has(payload.channelId);
      const previousParticipantIds = voiceParticipantIdsByChannelRef.current.get(payload.channelId) ?? new Set<string>();
      const isCurrentVoiceChannel = activeVoiceChannelIdRef.current === payload.channelId;
      if (auth.user && hadPreviousState && isCurrentVoiceChannel) {
        const selfUserId = auth.user.id;
        const someoneElseJoined = [...nextParticipantIds].some(
          (participantId) =>
            participantId !== selfUserId && !previousParticipantIds.has(participantId),
        );
        const someoneElseLeft = [...previousParticipantIds].some(
          (participantId) =>
            participantId !== selfUserId && !nextParticipantIds.has(participantId),
        );

        if (someoneElseJoined) {
          playVoiceStateSound('join');
        }
        if (someoneElseLeft) {
          playVoiceStateSound('leave');
        }
      }
      voiceParticipantIdsByChannelRef.current.set(payload.channelId, nextParticipantIds);

      setVoiceParticipantsByChannel((prev) => ({
        ...prev,
        [payload.channelId]: payload.participants,
      }));

      if (!auth.user) {
        return;
      }

      const selfPresent = payload.participants.some((participant) => participant.userId === auth.user?.id);
      if (selfPresent) {
        activeVoiceChannelIdRef.current = payload.channelId;
        setActiveVoiceChannelId(payload.channelId);
        setVoiceBusyChannelId((current) => (current === payload.channelId ? null : current));
        return;
      }

      setActiveVoiceChannelId((current) => {
        if (current !== payload.channelId) {
          return current;
        }
        if (voiceBusyChannelId === payload.channelId) {
          return current;
        }
        activeVoiceChannelIdRef.current = null;
        return null;
      });
      if (voiceBusyChannelId !== payload.channelId) {
        setVoiceBusyChannelId((current) => (current === payload.channelId ? null : current));
      }
    },
    [auth.user, voiceBusyChannelId, playVoiceStateSound],
  );

  const ws = useChatSocket({
    token: auth.token,
    subscribedChannelIds,
    onMessageNew: (message) => {
      const isOwnMessage = auth.user?.id === message.userId;
      const isViewedChannel = activeView === 'chat' && message.channelId === activeChannelId;
      if (!isOwnMessage && !isViewedChannel) {
        setUnreadChannelCounts((prev) => ({
          ...prev,
          [message.channelId]: (prev[message.channelId] ?? 0) + 1,
        }));
      }
      if (auth.user) {
        const signature = messageSignature(
          message.channelId,
          auth.user.id,
          message.content,
          message.attachment?.url,
        );
        clearPendingSignature(signature);
        if (message.userId !== auth.user.id && message.channelId === activeChannelId) {
          playIncomingMessageSound();
        }
      }
      if (document.hidden && !isOwnMessage) {
        setHiddenUnreadCount((count) => count + 1);
      }
      if (message.channelId !== activeChannelId) {
        return;
      }
      setMessages((prev) => reconcileIncomingMessage(prev, message));
    },
    onMessageUpdated: (message) => {
      if (message.channelId !== activeChannelId) {
        return;
      }
      setMessages((prev) => prev.map((item) => (item.id === message.id ? message : item)));
      setReplyTarget((current) =>
        current && current.id === message.id
          ? {
            ...current,
            content: message.deletedAt ? '' : message.content,
          }
          : current,
      );
    },
    onMessageDeleted: (message) => {
      if (message.channelId !== activeChannelId) {
        return;
      }
      setMessages((prev) => prev.map((item) => (item.id === message.id ? message : item)));
      setReplyTarget((current) => (current && current.id === message.id ? null : current));
    },
    onMessageReaction: (payload) => {
      if (payload.message.channelId !== activeChannelId) {
        return;
      }
      setMessages((prev) =>
        prev.map((item) => (item.id === payload.message.id ? payload.message : item)),
      );
    },
    onFriendEvent: () => {
      void loadFriendData();
    },
    onDmEvent: (payload) => {
      setChannels((prev) => upsertChannel(prev, payload.channel));
      const isViewedChannel = activeView === 'chat' && payload.channel.id === activeChannelId;
      if (payload.from.id !== auth.user?.id && !isViewedChannel) {
        setUnreadChannelCounts((prev) => ({
          ...prev,
          [payload.channel.id]: (prev[payload.channel.id] ?? 0) + 1,
        }));
      }
      setNotice(`New DM from @${payload.from.username}`);
      if (document.hidden) {
        setHiddenUnreadCount((count) => count + 1);
      }
    },
    onChannelUpdated: (channel) => {
      setChannels((prev) => upsertChannel(prev, channel));
    },
    onPresenceUpdate: (users) => {
      setOnlineUsers(users);
    },
    onVoiceState: handleVoiceState,
    onVoiceSignal: (payload) => {
      void handleVoiceSignal(payload);
    },
    onVoiceSfuEvent: (payload) => {
      void handleVoiceSfuEvent(payload);
    },
  });

  useEffect(() => {
    if (!protectVoiceEnabled || !activeVoiceChannelId || !ws.connected) {
      setVoiceProtectionLevel('stable');
      return;
    }

    let cancelled = false;
    const sampleVoiceNetworkStress = async () => {
      const connections = Array.from(peerConnectionsRef.current.values()).filter(
        (connection) => connection.connectionState !== 'closed',
      );
      if (connections.length === 0) {
        if (!cancelled) {
          setVoiceProtectionLevel('stable');
        }
        return;
      }

      const rttMsValues: number[] = [];
      const jitterMsValues: number[] = [];
      const audioLossRatios: number[] = [];

      await Promise.allSettled(
        connections.map(async (connection) => {
          const report = await connection.getStats();
          let selectedPairRttMs: number | null = null;
          for (const stat of report.values()) {
            if (stat.type === 'candidate-pair') {
              const pair = stat as RTCIceCandidatePairStats & { selected?: boolean };
              if ((pair.selected || pair.nominated) && typeof pair.currentRoundTripTime === 'number') {
                selectedPairRttMs = pair.currentRoundTripTime * 1000;
              }
              continue;
            }
            if (stat.type !== 'inbound-rtp') {
              continue;
            }
            const inbound = stat as RTCInboundRtpStreamStats & {
              kind?: string;
              mediaType?: string;
            };
            const mediaKind = inbound.kind ?? inbound.mediaType ?? 'audio';
            if (mediaKind !== 'audio') {
              continue;
            }
            if (typeof inbound.jitter === 'number') {
              jitterMsValues.push(inbound.jitter * 1000);
            }
            if (
              typeof inbound.packetsLost === 'number' &&
              typeof inbound.packetsReceived === 'number' &&
              inbound.packetsLost >= 0 &&
              inbound.packetsReceived >= 0
            ) {
              const totalPackets = inbound.packetsLost + inbound.packetsReceived;
              if (totalPackets > 0) {
                audioLossRatios.push(inbound.packetsLost / totalPackets);
              }
            }
          }
          if (selectedPairRttMs !== null) {
            rttMsValues.push(selectedPairRttMs);
          }
        }),
      );

      const avgRttMs =
        rttMsValues.length > 0 ? rttMsValues.reduce((sum, value) => sum + value, 0) / rttMsValues.length : 0;
      const avgLossRatio =
        audioLossRatios.length > 0
          ? audioLossRatios.reduce((sum, value) => sum + value, 0) / audioLossRatios.length
          : 0;
      const maxJitterMs = jitterMsValues.length > 0 ? Math.max(...jitterMsValues) : 0;

      const nextLevel: VoiceProtectionLevel =
        avgLossRatio > 0.08 || avgRttMs > 320 || maxJitterMs > 90
          ? 'severe'
          : avgLossRatio > 0.03 || avgRttMs > 180 || maxJitterMs > 45
            ? 'mild'
            : 'stable';
      if (!cancelled) {
        setVoiceProtectionLevel((current) => (current === nextLevel ? current : nextLevel));
      }
    };

    void sampleVoiceNetworkStress();
    const intervalId = window.setInterval(() => {
      void sampleVoiceNetworkStress();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [protectVoiceEnabled, activeVoiceChannelId, ws.connected]);

  useEffect(() => {
    if (!ws.connected || !auth.user || !activeVoiceChannelId) {
      return;
    }
    const selfUserId = auth.user.id;
    const participants = voiceParticipantsByChannel[activeVoiceChannelId] ?? [];
    const selfParticipant = participants.find((participant) => participant.userId === selfUserId);
    if (!selfParticipant) {
      return;
    }
    const desiredDeafened = isSelfDeafened;
    const desiredMuted = isSelfMuted || desiredDeafened;
    if (
      Boolean(selfParticipant.deafened) === desiredDeafened &&
      Boolean(selfParticipant.muted) === desiredMuted
    ) {
      return;
    }
    ws.sendVoiceSelfState(activeVoiceChannelId, desiredMuted, desiredDeafened);
  }, [ws, auth.user, activeVoiceChannelId, voiceParticipantsByChannel, isSelfMuted, isSelfDeafened]);

  useEffect(() => {
    if (!ws.connected || !auth.user || !activeVoiceChannelId) {
      return;
    }
    const participants = voiceParticipantsByChannel[activeVoiceChannelId] ?? [];
    const targetPeerUserIds = participants
      .map((participant) => participant.userId)
      .filter((userId) => userId !== auth.user?.id);
    if (targetPeerUserIds.length === 0) {
      return;
    }
    syncLocalVideoSourceToPeers(activeVoiceChannelId, targetPeerUserIds);
    const intervalId = window.setInterval(() => {
      syncLocalVideoSourceToPeers(activeVoiceChannelId, targetPeerUserIds);
    }, 4500);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    ws.connected,
    auth.user,
    activeVoiceChannelId,
    voiceParticipantsByChannel,
    syncLocalVideoSourceToPeers,
  ]);

  useEffect(() => {
    sendVoiceSignalRef.current = ws.sendVoiceSignal;
  }, [ws.sendVoiceSignal]);

  useEffect(() => {
    requestVoiceSfuRef.current = ws.requestVoiceSfu;
  }, [ws.requestVoiceSfu]);

  useEffect(() => {
    createOfferForPeerRef.current = createOfferForPeer;
  }, [createOfferForPeer]);

  useEffect(() => {
    leaveVoiceRef.current = ws.leaveVoice;
  }, [ws.leaveVoice]);

  useEffect(() => {
    activeVoiceChannelIdRef.current = activeVoiceChannelId;
  }, [activeVoiceChannelId]);

  useEffect(() => {
    voiceBusyChannelIdRef.current = voiceBusyChannelId;
  }, [voiceBusyChannelId]);

  useEffect(() => {
    if (!ws.connected || !auth.user) {
      return;
    }
    void drainQueuedVoiceSignals();
  }, [ws.connected, auth.user, activeVoiceChannelId, voiceBusyChannelId, drainQueuedVoiceSignals]);

  // Live-update the input gain node when the preference changes
  useEffect(() => {
    voiceInputGainRef.current = preferences.voiceInputGain;
    if (localVoiceGainNodeRef.current) {
      localVoiceGainNodeRef.current.gain.value = preferences.voiceInputGain / 100;
    }
  }, [preferences.voiceInputGain]);

  useEffect(() => {
    if (activeChannel?.isVoice) {
      return;
    }
    setShowDetailedVoiceStats(false);
  }, [activeChannel?.isVoice]);

  useEffect(() => {
    if (activeVoiceChannelId) {
      return;
    }
    setVoiceConnectionStats([]);
    setVoiceStatsUpdatedAt(null);
    previousRtpSnapshotsRef.current.clear();
  }, [activeVoiceChannelId]);

  useEffect(() => {
    if (!showDetailedVoiceStats || !activeVoiceChannelId || !ws.connected) {
      return;
    }
    void collectVoiceConnectionStats();
    const intervalId = window.setInterval(() => {
      void collectVoiceConnectionStats();
    }, 2000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [showDetailedVoiceStats, activeVoiceChannelId, ws.connected, collectVoiceConnectionStats]);

  useEffect(() => {
    return () => {
      teardownVoiceTransport();
    };
  }, [teardownVoiceTransport]);

  useEffect(() => {
    const timeoutMap = pendingTimeoutsRef.current;
    const signatureSet = pendingSignaturesRef.current;
    return () => {
      for (const timeoutId of timeoutMap.values()) {
        window.clearTimeout(timeoutId);
      }
      timeoutMap.clear();
      signatureSet.clear();
    };
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) {
        setHiddenUnreadCount(0);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, []);

  useEffect(() => {
    document.title = hiddenUnreadCount > 0 ? `(${hiddenUnreadCount}) Harmony` : 'Harmony';
  }, [hiddenUnreadCount]);

  useEffect(() => {
    void refreshMicrophonePermission();
    void enumerateAudioInputDevices();
    if (!navigator.mediaDevices?.addEventListener) {
      return;
    }
    const handleDeviceChange = () => {
      void enumerateAudioInputDevices();
    };
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [refreshMicrophonePermission, enumerateAudioInputDevices]);

  useEffect(() => {
    if (audioContextsUnlockedRef.current) {
      return;
    }

    let removed = false;
    const removeListeners = () => {
      if (removed) {
        return;
      }
      removed = true;
      window.removeEventListener('pointerdown', onUserGestureUnlock);
      window.removeEventListener('keydown', onUserGestureUnlock);
      window.removeEventListener('touchstart', onUserGestureUnlock);
    };
    const onUserGestureUnlock = () => {
      void unlockAudioContexts()
        .catch(() => {
          // Keep listeners active. Next gesture can retry unlock.
        })
        .finally(() => {
          if (audioContextsUnlockedRef.current) {
            removeListeners();
          }
        });
    };

    window.addEventListener('pointerdown', onUserGestureUnlock);
    window.addEventListener('keydown', onUserGestureUnlock);
    window.addEventListener('touchstart', onUserGestureUnlock, { passive: true });
    return () => {
      removeListeners();
    };
  }, [unlockAudioContexts]);

  useEffect(() => {
    if (!preferences.voiceInputDeviceId) {
      return;
    }
    if (audioInputDevices.length === 0) {
      return;
    }
    if (audioInputDevices.some((device) => device.deviceId === preferences.voiceInputDeviceId)) {
      return;
    }
    updatePreferences({ voiceInputDeviceId: null });
  }, [audioInputDevices, preferences.voiceInputDeviceId, updatePreferences]);

  useEffect(() => {
    try {
      const enabled = localStorage.getItem('harmony_voice_debug') === '1';
      voiceDebugEnabledRef.current = enabled;
    } catch {
      voiceDebugEnabledRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setNotice(null);
    }, 5000);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [notice]);

  useEffect(() => {
    let disposed = false;
    const loadRtcConfig = async () => {
      try {
        const response = await chatApi.rtcConfig();
        if (disposed) {
          return;
        }
        setVoiceIceConfig(normalizeVoiceIceConfig(response.rtc));
        const sfuEnabled = Boolean(response.sfu?.enabled);
        setVoiceSfuEnabled(sfuEnabled);
        setVoiceSfuAudioOnly(response.sfu?.audioOnly !== false);
      } catch {
        if (!disposed) {
          setVoiceIceConfig(createDefaultVoiceIceConfig());
          setVoiceSfuEnabled(false);
          setVoiceSfuAudioOnly(true);
        }
      }
    };
    void loadRtcConfig();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!auth.token) {
      setOnlineUsers([]);
      setUnreadChannelCounts({});
      setVoiceParticipantsByChannel({});
      voiceParticipantIdsByChannelRef.current.clear();
      queuedVoiceSignalsRef.current = [];
      drainingVoiceSignalsRef.current = false;
      activeVoiceChannelIdRef.current = null;
      voiceBusyChannelIdRef.current = null;
      setActiveVoiceChannelId(null);
      setVoiceBusyChannelId(null);
      teardownVoiceTransport();
      return;
    }
    let disposed = false;
    const load = async () => {
      try {
        const response = await chatApi.channels(auth.token as string);
        if (disposed) {
          return;
        }
        setChannels(response.channels);
        setError(null);
        setActiveChannelId((current) => current ?? response.channels[0]?.id ?? null);
      } catch (err) {
        if (!disposed) {
          setError(getErrorMessage(err, 'Could not load channels'));
        }
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [auth.token, teardownVoiceTransport]);

  useEffect(() => {
    if (!auth.token) {
      previousIncomingRequestCountRef.current = null;
      return;
    }
    void loadFriendData();
  }, [auth.token, loadFriendData]);

  useEffect(() => {
    if (!auth.token) {
      previousIncomingRequestCountRef.current = null;
      return;
    }
    const currentIncomingCount = incomingRequests.length;
    const previousIncomingCount = previousIncomingRequestCountRef.current;
    previousIncomingRequestCountRef.current = currentIncomingCount;

    if (previousIncomingCount === null || currentIncomingCount <= previousIncomingCount) {
      return;
    }

    const newRequestCount = currentIncomingCount - previousIncomingCount;
    setNotice(
      newRequestCount === 1
        ? 'You received a friend request.'
        : `You received ${newRequestCount} friend requests.`,
    );
  }, [auth.token, incomingRequests.length]);

  useEffect(() => {
    if (activeView !== 'chat' || !activeChannelId) {
      return;
    }
    setUnreadChannelCounts((prev) => {
      if (!prev[activeChannelId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[activeChannelId];
      return next;
    });
  }, [activeView, activeChannelId]);

  useEffect(() => {
    closeAudioContextMenu();
    setReplyTarget(null);
    setMobilePane('none');
  }, [activeView, activeChannelId, closeAudioContextMenu]);

  useEffect(() => {
    if (!activeChannelId) {
      setMessages([]);
      return;
    }
    if (activeChannel?.isVoice) {
      setMessages([]);
      setMessageQuery('');
      return;
    }
    setMessages([]);
    setMessageQuery('');
    void loadMessages(activeChannelId);
  }, [activeChannelId, activeChannel?.isVoice, loadMessages]);

  const activeVoiceParticipantIds = useMemo(() => {
    if (!activeVoiceChannelId) return "";
    const p = voiceParticipantsByChannel[activeVoiceChannelId] ?? [];
    return p.map(u => u.userId).sort().join(',');
  }, [voiceParticipantsByChannel, activeVoiceChannelId]);

  useEffect(() => {
    if (!ws.connected || !activeVoiceChannelId || !auth.user) {
      teardownVoiceTransport();
      return;
    }

    const transportEpoch = ++voiceTransportEpochRef.current;
    let cancelled = false;

    // Faster initial sync, but still debounced
    const timer = window.setTimeout(() => {
      const syncVoiceTransport = async () => {
        const participants = voiceParticipantsByChannel[activeVoiceChannelId] ?? [];
        const selfInChannel = participants.some((p) => p.userId === auth.user?.id);
        if (!selfInChannel) {
          teardownVoiceTransport();
          return;
        }

        const currentRawTrack = localVoiceStreamRef.current?.getAudioTracks()[0] ?? null;
        const needsFreshStream = !currentRawTrack || currentRawTrack.readyState !== 'live';
        try {
          await getLocalVoiceStream(needsFreshStream);
        } catch (err) {
          if (!cancelled && voiceTransportEpochRef.current === transportEpoch) {
            leaveVoiceRef.current(activeVoiceChannelId);
            setError(getErrorMessage(err, 'Could not access microphone for voice channel'));
            activeVoiceChannelIdRef.current = null;
            setActiveVoiceChannelId(null);
          }
          return;
        }

        if (cancelled || voiceTransportEpochRef.current !== transportEpoch) return;

        const localProcessedAudioTrack =
          (localVoiceProcessedStreamRef.current ?? localVoiceStreamRef.current)
            ?.getAudioTracks()
            .find((track) => track.readyState === 'live') ?? null;
        if (voiceSfuEnabled) {
          const sfuStarted = await startVoiceSfuTransport(activeVoiceChannelId, localProcessedAudioTrack);
          if (!sfuStarted) {
            setNotice('Voice fallback active: using direct P2P audio transport.');
          } else {
            await voiceSfuClientRef.current?.syncProducers();
          }
        } else {
          stopVoiceSfuTransport();
        }

        const desiredPeerUserIds = new Set(
          participants
            .map((p) => p.userId)
            .filter((uid) => uid !== auth.user?.id)
        );

        for (const existingPeerUserId of Array.from(peerConnectionsRef.current.keys())) {
          if (!desiredPeerUserIds.has(existingPeerUserId)) {
            closePeerConnection(existingPeerUserId);
          }
        }

        const sortedPeerUserIds = Array.from(desiredPeerUserIds).sort();
        await Promise.allSettled(
          sortedPeerUserIds.map(async (peerUserId) => {
            if (cancelled || voiceTransportEpochRef.current !== transportEpoch) return;
            try {
              const hadExistingConnection = peerConnectionsRef.current.has(peerUserId);
              const pc = await ensurePeerConnection(peerUserId, activeVoiceChannelId);
              if (pc.signalingState === 'stable' && !hadExistingConnection) {
                // Newly created peer connection needs an initial offer.
                await createOfferForPeer(peerUserId, activeVoiceChannelId);
                requestStreamSnapshotFromPeer(activeVoiceChannelId, peerUserId, 'join-sync');
              } else if (pc.signalingState === 'stable') {
                // Already exists, ensure it is healthy.
                if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                  pc.restartIce?.();
                }
              }
            } catch {}
          })
        );
      };
      void syncVoiceTransport();
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    ws.connected,
    activeVoiceChannelId,
    activeVoiceParticipantIds, // Only re-run when actual participant IDs change
    auth.user,
    teardownVoiceTransport,
    getLocalVoiceStream,
    closePeerConnection,
    ensurePeerConnection,
    createOfferForPeer,
    requestStreamSnapshotFromPeer,
    startVoiceSfuTransport,
    stopVoiceSfuTransport,
    voiceSfuEnabled,
  ]);

  useEffect(() => {
    const connections = Array.from(peerConnectionsRef.current.values());
    if (connections.length === 0) {
      return;
    }
    for (const connection of connections) {
      void applyAudioBitrateToConnection(connection, activeVoiceBitrateKbps);
    }
  }, [applyAudioBitrateToConnection, activeVoiceBitrateKbps]);

  useEffect(() => {
    const connections = Array.from(peerConnectionsRef.current.values());
    if (connections.length === 0) {
      return;
    }
    for (const connection of connections) {
      void applyVideoBitrateToConnection(connection, effectiveStreamBitrateKbps);
    }
  }, [applyVideoBitrateToConnection, effectiveStreamBitrateKbps]);

  useEffect(() => {
    applyLocalVoiceTrackState(localVoiceStreamRef.current);
  }, [applyLocalVoiceTrackState]);

  useEffect(() => {
    pruneStaleRemoteScreenShares();
  }, [pruneStaleRemoteScreenShares, voiceParticipantsByChannel, activeVoiceChannelId]);

  useEffect(() => {
    if (!activeVoiceChannelId || !ws.connected) {
      return;
    }
    const intervalId = window.setInterval(() => {
      pruneStaleRemoteScreenShares();
    }, 1500);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeVoiceChannelId, ws.connected, pruneStaleRemoteScreenShares]);

  useEffect(() => {
    if (!activeVoiceChannelId || !ws.connected) {
      remoteVideoTrafficByPeerRef.current.clear();
      remoteVideoRecoveryAttemptByPeerRef.current.clear();
      remoteVideoRecoveryStreakByPeerRef.current.clear();
      return;
    }

    let cancelled = false;
    const monitorRemoteVideoFlow = async () => {
      const now = Date.now();
      const activePeerIds = new Set(peerConnectionsRef.current.keys());

      for (const peerUserId of Array.from(remoteVideoTrafficByPeerRef.current.keys())) {
        if (!activePeerIds.has(peerUserId)) {
          remoteVideoTrafficByPeerRef.current.delete(peerUserId);
          remoteVideoRecoveryAttemptByPeerRef.current.delete(peerUserId);
          remoteVideoRecoveryStreakByPeerRef.current.delete(peerUserId);
        }
      }

      await Promise.allSettled(
        Array.from(peerConnectionsRef.current.entries()).map(async ([peerUserId, connection]) => {
          const advertisedSource = remoteVideoSourceByPeerRef.current.get(peerUserId);
          const expectsRemoteVideo = advertisedSource === 'screen' || advertisedSource === 'camera';
          if (!expectsRemoteVideo || connection.connectionState === 'closed') {
            remoteVideoTrafficByPeerRef.current.delete(peerUserId);
            return;
          }

          let bytesReceived = 0;
          let packetsReceived = 0;
          try {
            const report = await connection.getStats();
            for (const stat of report.values()) {
              if (stat.type !== 'inbound-rtp') {
                continue;
              }
              const inbound = stat as RTCInboundRtpStreamStats & {
                kind?: string;
                mediaType?: string;
              };
              const mediaKind = inbound.kind ?? inbound.mediaType ?? 'audio';
              if (mediaKind !== 'video') {
                continue;
              }
              if (typeof inbound.bytesReceived === 'number') {
                bytesReceived += inbound.bytesReceived;
              }
              if (typeof inbound.packetsReceived === 'number') {
                packetsReceived += inbound.packetsReceived;
              }
            }
          } catch {
            return;
          }

          const previous = remoteVideoTrafficByPeerRef.current.get(peerUserId);
          const hasProgress =
            !previous ||
            bytesReceived > previous.bytesReceived + 1500 ||
            packetsReceived > previous.packetsReceived + 2;
          const stagnantSamples = hasProgress ? 0 : (previous?.stagnantSamples ?? 0) + 1;

          remoteVideoTrafficByPeerRef.current.set(peerUserId, {
            bytesReceived,
            packetsReceived,
            stagnantSamples,
          });

          if (hasProgress) {
            remoteVideoRecoveryStreakByPeerRef.current.set(peerUserId, 0);
          }

          if (stagnantSamples < 4) {
            return;
          }
          const lastAttemptAt = remoteVideoRecoveryAttemptByPeerRef.current.get(peerUserId) ?? 0;
          if (now - lastAttemptAt < 10000) {
            return;
          }

          remoteVideoRecoveryAttemptByPeerRef.current.set(peerUserId, now);
          const nextRecoveryStreak = (remoteVideoRecoveryStreakByPeerRef.current.get(peerUserId) ?? 0) + 1;
          remoteVideoRecoveryStreakByPeerRef.current.set(peerUserId, nextRecoveryStreak);
          remoteVideoTrafficByPeerRef.current.set(peerUserId, {
            bytesReceived,
            packetsReceived,
            stagnantSamples: 0,
          });
          logVoiceDebug('remote_video_stall_recovery', {
            channelId: activeVoiceChannelId,
            peerUserId,
            bytesReceived,
            packetsReceived,
            recoveryStreak: nextRecoveryStreak,
          });
          sendVoiceSignalRef.current(activeVoiceChannelId, peerUserId, {
            kind: 'video-recovery-request',
            reason: 'stall-detected',
            stagnantSamples,
          } satisfies VoiceSignalData);
          requestVideoRenegotiationForPeer(peerUserId, activeVoiceChannelId);

          if (nextRecoveryStreak < 3) {
            return;
          }

          remoteVideoRecoveryStreakByPeerRef.current.set(peerUserId, 0);
          closePeerConnection(peerUserId);
          logVoiceDebug('remote_video_stall_hard_reset', {
            channelId: activeVoiceChannelId,
            peerUserId,
          });
          try {
            await ensurePeerConnection(peerUserId, activeVoiceChannelId);
            await createOfferForPeerRef.current(peerUserId, activeVoiceChannelId);
            requestStreamSnapshotFromPeer(activeVoiceChannelId, peerUserId, 'post-reset');
          } catch {
            // Best effort only. Next transport sync can recover.
          }
        }),
      );

      if (cancelled) {
        return;
      }
    };

    void monitorRemoteVideoFlow();
    const intervalId = window.setInterval(() => {
      void monitorRemoteVideoFlow();
    }, 4500);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    activeVoiceChannelId,
    ws.connected,
    closePeerConnection,
    ensurePeerConnection,
    logVoiceDebug,
    requestStreamSnapshotFromPeer,
    requestVideoRenegotiationForPeer,
  ]);

  // Speaking detection – local mic
  useEffect(() => {
    const micMuted = isSelfMuted || isSelfDeafened;
    if (!preferences.showVoiceActivity || !auth.user || !activeVoiceChannelId || !localAudioReady || micMuted) {
      setSpeakingUserIds((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    const analyser = localAnalyserRef.current;
    if (!analyser) {
      return;
    }

    const selfId = auth.user.id;
    let frame = 0;
    const data = new Uint8Array(analyser.fftSize);

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const normalized = (data[i] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / data.length);
      const speaking = rms >= preferences.voiceInputSensitivity;
      setSpeakingUserIds((prev) => {
        const hasSelf = prev.includes(selfId);
        if (speaking && !hasSelf) {
          return [...prev, selfId];
        }
        if (!speaking && hasSelf) {
          return prev.filter((id) => id !== selfId);
        }
        return prev;
      });
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      setSpeakingUserIds((prev) => prev.filter((id) => id !== selfId));
    };
  }, [
    preferences.showVoiceActivity,
    preferences.voiceInputSensitivity,
    auth.user,
    activeVoiceChannelId,
    localAudioReady,
    isSelfMuted,
    isSelfDeafened,
  ]);

  // Speaking detection – remote audio
  useEffect(() => {
    if (!preferences.showVoiceActivity || !auth.user) {
      for (const userId of Array.from(remoteSpeakingSourceByUserRef.current.keys())) {
        disconnectRemoteSpeakingForUser(userId);
      }
      setSpeakingUserIds((prev) => prev.filter((id) => id === auth.user?.id));
      return;
    }

    const context = ensureRemoteSpeakingContext();
    if (!context) {
      return;
    }
    if (audioContextsUnlockedRef.current && context.state === 'suspended') {
      void context.resume().catch(() => {
        // Best effort. A user gesture will resume later if needed.
      });
    }

    const activeRemoteUserIds = new Set(viewedRemoteAudioUsers.map((user) => user.userId));
    for (const { userId, stream } of viewedRemoteAudioUsers) {
      const existingSource = remoteSpeakingSourceByUserRef.current.get(userId);
      if (existingSource && existingSource.mediaStream === stream) {
        continue;
      }
      disconnectRemoteSpeakingForUser(userId);
      try {
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);
        remoteSpeakingSourceByUserRef.current.set(userId, source);
        remoteSpeakingAnalyserByUserRef.current.set(userId, analyser);
        remoteSpeakingDataByUserRef.current.set(userId, new Uint8Array(analyser.fftSize));
      } catch {
        // Some browsers can reject source creation for transient tracks; retry next cycle.
      }
    }
    for (const userId of Array.from(remoteSpeakingSourceByUserRef.current.keys())) {
      if (activeRemoteUserIds.has(userId)) {
        continue;
      }
      disconnectRemoteSpeakingForUser(userId);
    }

    const speakingThreshold = Math.max(
      REMOTE_SPEAKING_THRESHOLD_FLOOR,
      preferences.voiceInputSensitivity * 0.75,
    );
    const remoteOrder = viewedRemoteAudioUsers.map((user) => user.userId);
    let frame = 0;
    const tick = () => {
      const now = performance.now();
      const remoteSpeakingSet = new Set<string>();

      for (const userId of remoteOrder) {
        const analyser = remoteSpeakingAnalyserByUserRef.current.get(userId);
        const data = remoteSpeakingDataByUserRef.current.get(userId);
        if (!analyser || !data) {
          continue;
        }
        analyser.getByteTimeDomainData(data as Uint8Array<ArrayBuffer>);
        const rms = computeTimeDomainRms(data);
        if (rms >= speakingThreshold) {
          remoteSpeakingLastSpokeAtByUserRef.current.set(userId, now);
          remoteSpeakingSet.add(userId);
          continue;
        }
        const lastSpokeAt = remoteSpeakingLastSpokeAtByUserRef.current.get(userId) ?? 0;
        if (now - lastSpokeAt <= REMOTE_SPEAKING_HOLD_MS) {
          remoteSpeakingSet.add(userId);
        }
      }

      setSpeakingUserIds((prev) => {
        const selfList = prev.filter((id) => id === auth.user?.id);
        const next = [...selfList, ...remoteOrder.filter((userId) => remoteSpeakingSet.has(userId))];
        if (next.length === prev.length && next.every((id, index) => id === prev[index])) {
          return prev;
        }
        return next;
      });

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    preferences.showVoiceActivity,
    preferences.voiceInputSensitivity,
    viewedRemoteAudioUsers,
    auth.user,
    ensureRemoteSpeakingContext,
    disconnectRemoteSpeakingForUser,
  ]);

  const applyStreamQualityToStream = useCallback((
    stream: MediaStream,
    presetLabel: string,
    source: StreamSource | null,
  ) => {
    const requestedPreset = getStreamQualityPreset(presetLabel);
    const preset = source === 'camera' ? clampCameraPreset(requestedPreset) : requestedPreset;
    const [track] = stream.getVideoTracks();
    if (!track) {
      return;
    }
    void track
      .applyConstraints(toVideoTrackConstraints(preset))
      .catch((err) => {
        trackTelemetryError('stream_constraints_apply_failed', err, {
          presetLabel,
          source: source ?? 'unknown',
          requestedWidth: requestedPreset.width,
          requestedHeight: requestedPreset.height,
          requestedFrameRate: requestedPreset.frameRate,
          appliedWidth: preset.width,
          appliedHeight: preset.height,
          appliedFrameRate: preset.frameRate,
        });
        showStreamStatusBanner(
          'info',
          'The selected stream quality could not be fully applied by this browser.',
        );
      });
  }, [showStreamStatusBanner]);

  const stopLocalVideoShare = useCallback(
    (renegotiatePeers = true) => {
      const stream = localScreenStreamRef.current;
      if (!stream) {
        setLocalScreenShareStream(null);
        setLocalStreamSource(null);
        return;
      }

      const currentVoiceChannelId = activeVoiceChannelIdRef.current;
      for (const [peerUserId] of peerConnectionsRef.current) {
        const sender = videoSenderByPeerRef.current.get(peerUserId);
        if (!sender) {
          continue;
        }
        void sender.replaceTrack(null).catch(() => {
          // Best effort. Keep sender/transceiver to avoid m-line reorder issues.
        });
        if (currentVoiceChannelId) {
          sendVoiceSignalRef.current(currentVoiceChannelId, peerUserId, {
            kind: 'video-source',
            source: null,
          } satisfies VoiceSignalData);
        }
      }

      for (const track of stream.getTracks()) {
        track.onended = null;
        track.stop();
      }
      localScreenStreamRef.current = null;
      setLocalScreenShareStream(null);
      setLocalStreamSource(null);

      const activeChannelId = activeVoiceChannelIdRef.current;
      if (!renegotiatePeers || !activeChannelId) {
        return;
      }
      for (const peerUserId of peerConnectionsRef.current.keys()) {
        requestVideoRenegotiationForPeer(peerUserId, activeChannelId);
      }
    },
    [requestVideoRenegotiationForPeer],
  );

  const toggleVideoShare = useCallback(
    async (source: StreamSource) => {
      await unlockAudioContexts();
      if (localScreenStreamRef.current && localStreamSource === source) {
        stopLocalVideoShare(true);
        return;
      }
      if (localScreenStreamRef.current) {
        stopLocalVideoShare(false);
      }

      try {
        let stream: MediaStream;
        if (source === 'screen') {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false,
          });
        } else {
          const requestedPreset = getStreamQualityPreset(streamQualityLabel);
          const cappedRequestedPreset = clampCameraPreset(requestedPreset);
          const cappedForStability =
            requestedPreset.width !== cappedRequestedPreset.width ||
            requestedPreset.height !== cappedRequestedPreset.height ||
            requestedPreset.frameRate !== cappedRequestedPreset.frameRate;

          let startError: unknown = null;
          let resolvedStream: MediaStream | null = null;
          for (const presetLabel of getCameraCapturePresetLabels(streamQualityLabel)) {
            const candidatePreset = clampCameraPreset(getStreamQualityPreset(presetLabel));
            try {
              resolvedStream = await navigator.mediaDevices.getUserMedia({
                video: toVideoTrackConstraints(candidatePreset),
                audio: false,
              });
              if (presetLabel !== streamQualityLabel || cappedForStability) {
                showStreamStatusBanner(
                  'info',
                  'Camera quality was reduced for stability on this device.',
                );
              }
              break;
            } catch (err) {
              startError = err;
            }
          }

          if (!resolvedStream) {
            throw startError ?? new Error('Could not access camera stream');
          }
          stream = resolvedStream;
        }

        localScreenStreamRef.current = stream;
        setLocalScreenShareStream(stream);
        setLocalStreamSource(source);
        applyStreamQualityToStream(stream, streamQualityLabel, source);
        showStreamStatusBanner(
          'info',
          source === 'screen' ? 'Screen sharing is now live.' : 'Camera sharing is now live.',
        );

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.onended = () => {
            if (localScreenStreamRef.current === stream) {
              stopLocalVideoShare(true);
            }
          };
        }

        const currentVoiceChannelId = activeVoiceChannelIdRef.current;
        if (!currentVoiceChannelId || !videoTrack) {
          return;
        }

        for (const [peerUserId, connection] of peerConnectionsRef.current) {
          const sender = getOrCreateVideoSender(connection);
          videoSenderByPeerRef.current.set(peerUserId, sender);

          try {
            await sender.replaceTrack(videoTrack);
          } catch {
            // Keep sender/transceiver stable. Offer loop can recover transport later.
          }

          void applyVideoBitrateToConnection(connection, effectiveStreamBitrateKbps);
          sendVoiceSignalRef.current(currentVoiceChannelId, peerUserId, {
            kind: 'video-source',
            source,
          } satisfies VoiceSignalData);
          requestVideoRenegotiationForPeer(peerUserId, currentVoiceChannelId);
        }
      } catch (err) {
        trackTelemetryError('video_share_start_failed', err, {
          source,
          qualityPreset: streamQualityLabel,
        });
        showStreamStatusBanner(
          'error',
          getErrorMessage(err, 'Could not start sharing. Check browser permissions and try again.'),
        );
      }
    },
    [
      localStreamSource,
      stopLocalVideoShare,
      applyStreamQualityToStream,
      streamQualityLabel,
      showStreamStatusBanner,
      applyVideoBitrateToConnection,
      effectiveStreamBitrateKbps,
      requestVideoRenegotiationForPeer,
      getOrCreateVideoSender,
      unlockAudioContexts,
    ],
  );

  const handleStreamQualityChange = useCallback(
    (value: string) => {
      if (!STREAM_QUALITY_CONSTRAINTS[value]) {
        return;
      }
      setStreamQualityLabel(value);
      const stream = localScreenStreamRef.current;
      if (!stream) {
        return;
      }
      applyStreamQualityToStream(stream, value, localStreamSource);
    },
    [applyStreamQualityToStream, localStreamSource],
  );

  const loadAdminStats = useCallback(async () => {
    if (!auth.token || !auth.user?.isAdmin) {
      return;
    }
    setLoadingAdminStats(true);
    try {
      const response = await chatApi.adminStats(auth.token);
      setAdminStats(response.stats);
      setAdminStatsError(null);
    } catch (err) {
      setAdminStatsError(getErrorMessage(err, 'Could not load admin stats'));
    } finally {
      setLoadingAdminStats(false);
    }
  }, [auth.token, auth.user?.isAdmin]);

  const loadAdminSettings = useCallback(async () => {
    if (!auth.token || !auth.user?.isAdmin) {
      return;
    }
    setLoadingAdminSettings(true);
    try {
      const response = await chatApi.adminSettings(auth.token);
      setAdminSettings(response.settings);
      setAdminSettingsError(null);
    } catch (err) {
      setAdminSettingsError(getErrorMessage(err, 'Could not load admin settings'));
    } finally {
      setLoadingAdminSettings(false);
    }
  }, [auth.token, auth.user?.isAdmin]);

  const saveAdminSettings = useCallback(
    async (next: AdminSettings) => {
      if (!auth.token || !auth.user?.isAdmin) {
        return;
      }
      setSavingAdminSettings(true);
      try {
        const response = await chatApi.updateAdminSettings(auth.token, next);
        setAdminSettings(response.settings);
        setAdminSettingsError(null);
      } catch (err) {
        setAdminSettingsError(getErrorMessage(err, 'Could not save admin settings'));
      } finally {
        setSavingAdminSettings(false);
      }
    },
    [auth.token, auth.user?.isAdmin],
  );

  const loadAdminUsers = useCallback(async () => {
    if (!auth.token || !auth.user?.isAdmin) {
      return;
    }
    setLoadingAdminUsers(true);
    try {
      const response = await chatApi.adminUsers(auth.token);
      setAdminUsers(response.users);
      setAdminUsersError(null);
    } catch (err) {
      setAdminUsersError(getErrorMessage(err, 'Could not load users'));
    } finally {
      setLoadingAdminUsers(false);
    }
  }, [auth.token, auth.user?.isAdmin]);

  const updateAdminUser = useCallback(
    async (
      userId: string,
      input: Partial<{
        role: UserRole;
        avatarUrl: string | null;
        isSuspended: boolean;
        suspensionHours: number;
      }>,
    ) => {
      if (!auth.token || !auth.user?.isAdmin) {
        return;
      }
      setUpdatingAdminUserId(userId);
      try {
        const response = await chatApi.updateAdminUser(auth.token, userId, input);
        setAdminUsers((prev) => prev.map((user) => (user.id === userId ? response.user : user)));
        setAdminUsersError(null);
      } catch (err) {
        setAdminUsersError(getErrorMessage(err, 'Could not update user'));
      } finally {
        setUpdatingAdminUserId(null);
      }
    },
    [auth.token, auth.user?.isAdmin],
  );

  const deleteAdminUser = useCallback(
    async (userId: string) => {
      if (!auth.token || !auth.user?.isAdmin) {
        return;
      }
      setDeletingAdminUserId(userId);
      try {
        await chatApi.deleteAdminUser(auth.token, userId);
        setAdminUsers((prev) => prev.filter((user) => user.id !== userId));
        setAdminUsersError(null);
      } catch (err) {
        setAdminUsersError(getErrorMessage(err, 'Could not delete user'));
      } finally {
        setDeletingAdminUserId(null);
      }
    },
    [auth.token, auth.user?.isAdmin],
  );

  const clearAdminUsersExceptCurrent = useCallback(async () => {
    if (!auth.token || !auth.user?.isAdmin) {
      return;
    }
    setClearingAdminUsers(true);
    try {
      const response = await chatApi.clearAdminUsersExceptSelf(auth.token);
      setAdminUsers((prev) => prev.filter((user) => user.id === auth.user?.id));
      setAdminUsersError(null);
      setNotice(
        response.deletedCount === 1
          ? 'Deleted 1 user. Your account was kept.'
          : `Deleted ${response.deletedCount} users. Your account was kept.`,
      );
    } catch (err) {
      setAdminUsersError(getErrorMessage(err, 'Could not clear users'));
    } finally {
      setClearingAdminUsers(false);
    }
  }, [auth.token, auth.user?.id, auth.user?.isAdmin]);

  const sendFriendRequest = useCallback(
    async (username: string) => {
      if (!auth.token) {
        return;
      }
      const normalizedUsername = username.trim().replace(/^@/, '');
      if (!normalizedUsername) {
        return;
      }
      setSubmittingFriendRequest(true);
      try {
        await chatApi.sendFriendRequest(auth.token, normalizedUsername);
        await loadFriendData();
        setFriendsError(null);
        setNotice(`Friend request sent to ${normalizedUsername}.`);
      } catch (err) {
        setFriendsError(getErrorMessage(err, 'Could not send friend request'));
        setNotice(null);
      } finally {
        setSubmittingFriendRequest(false);
      }
    },
    [auth.token, loadFriendData],
  );

  const acceptFriendRequest = useCallback(
    async (requestId: string) => {
      if (!auth.token) {
        return;
      }
      setFriendActionBusyId(requestId);
      try {
        await chatApi.acceptFriendRequest(auth.token, requestId);
        await loadFriendData();
      } catch (err) {
        setFriendsError(getErrorMessage(err, 'Could not accept request'));
      } finally {
        setFriendActionBusyId(null);
      }
    },
    [auth.token, loadFriendData],
  );

  const declineFriendRequest = useCallback(
    async (requestId: string) => {
      if (!auth.token) {
        return;
      }
      setFriendActionBusyId(requestId);
      try {
        await chatApi.declineFriendRequest(auth.token, requestId);
        await loadFriendData();
      } catch (err) {
        setFriendsError(getErrorMessage(err, 'Could not decline request'));
      } finally {
        setFriendActionBusyId(null);
      }
    },
    [auth.token, loadFriendData],
  );

  const cancelFriendRequest = useCallback(
    async (requestId: string) => {
      if (!auth.token) {
        return;
      }
      setFriendActionBusyId(requestId);
      try {
        await chatApi.cancelFriendRequest(auth.token, requestId);
        await loadFriendData();
      } catch (err) {
        setFriendsError(getErrorMessage(err, 'Could not cancel request'));
      } finally {
        setFriendActionBusyId(null);
      }
    },
    [auth.token, loadFriendData],
  );

  const removeFriend = useCallback(
    async (friendshipId: string) => {
      if (!auth.token) {
        return;
      }
      setFriendActionBusyId(friendshipId);
      try {
        await chatApi.removeFriend(auth.token, friendshipId);
        await loadFriendData();
      } catch (err) {
        setFriendsError(getErrorMessage(err, 'Could not remove friend'));
      } finally {
        setFriendActionBusyId(null);
      }
    },
    [auth.token, loadFriendData],
  );

  const joinVoiceChannel = useCallback(
    async (channelId: string) => {
      if (!auth.token) {
        return;
      }
      if (!ws.connected) {
        setError('Voice requires an active real-time connection');
        return;
      }
      voiceBusyChannelIdRef.current = channelId;
      setVoiceBusyChannelId(channelId);
      try {
        await unlockAudioContexts();
        // Pre-warm mic capture immediately on user gesture to reduce setup latency.
        void getLocalVoiceStream().catch(() => {
          // Join flow continues; sync phase will report errors if capture truly fails.
        });
        const joinMuted = preferences.autoMuteOnJoin || isSelfDeafened;
        if (isSelfMuted !== joinMuted) {
          setIsSelfMuted(joinMuted);
        }
        if (activeVoiceChannelId && activeVoiceChannelId !== channelId) {
          ws.leaveVoice(activeVoiceChannelId);
        }
        const sent = ws.joinVoice(channelId, {
          muted: joinMuted,
          deafened: isSelfDeafened,
        });
        if (!sent) {
          throw new Error('VOICE_JOIN_FAILED');
        }
        activeVoiceChannelIdRef.current = channelId;
        setActiveVoiceChannelId(channelId);
        playVoiceStateSound('join');
        setError(null);
      } catch {
        setError('Could not join voice channel');
      } finally {
        setVoiceBusyChannelId(null);
      }
    },
    [
      auth.token,
      ws,
      activeVoiceChannelId,
      playVoiceStateSound,
      isSelfMuted,
      isSelfDeafened,
      preferences.autoMuteOnJoin,
      getLocalVoiceStream,
      unlockAudioContexts,
    ],
  );

  const leaveVoiceChannel = useCallback(
    async () => {
      if (!activeVoiceChannelId) {
        return;
      }
      const leavingChannelId = activeVoiceChannelId;
      voiceBusyChannelIdRef.current = leavingChannelId;
      setVoiceBusyChannelId(leavingChannelId);
      ws.leaveVoice(leavingChannelId);
      activeVoiceChannelIdRef.current = null;
      playVoiceStateSound('leave');
      setError(null);
      window.setTimeout(() => {
        setVoiceBusyChannelId((current) => (current === leavingChannelId ? null : current));
        setActiveVoiceChannelId((current) => (current === leavingChannelId ? null : current));
      }, 1800);
    },
    [ws, activeVoiceChannelId, playVoiceStateSound],
  );

  const requestMicrophonePermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicrophonePermission('unsupported');
      return;
    }
    if (!window.isSecureContext) {
      setError('Microphone permission requires HTTPS (or localhost).');
      return;
    }
    setRequestingMicrophonePermission(true);
    try {
      await unlockAudioContexts();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      for (const track of stream.getTracks()) {
        track.stop();
      }
      await Promise.all([refreshMicrophonePermission(), enumerateAudioInputDevices()]);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Microphone permission was denied'));
      await refreshMicrophonePermission();
    } finally {
      setRequestingMicrophonePermission(false);
    }
  }, [enumerateAudioInputDevices, refreshMicrophonePermission, unlockAudioContexts]);

  const runAdminVoiceTest = useCallback(async (rawTestId: string) => {
    const testId = rawTestId as AdminVoiceTestId;
    if (!ADMIN_VOICE_TEST_DEFINITIONS.some((test) => test.id === testId)) {
      return;
    }

    const updateTestState = (status: AdminVoiceTestState['status'], message: string) => {
      setAdminVoiceTestStateById((prev) => ({
        ...prev,
        [testId]: {
          status,
          message,
          ranAt: Date.now(),
        },
      }));
    };

    updateTestState('running', 'Running test...');
    try {
      if (testId === 'ws-link') {
        updateTestState(
          ws.connected ? 'pass' : 'fail',
          ws.connected ? 'Realtime websocket is connected.' : 'Realtime websocket is disconnected.',
        );
        return;
      }

      if (testId === 'sfu-handshake') {
        if (!voiceSfuEnabled) {
          updateTestState('fail', 'SFU is disabled in server RTC config.');
          return;
        }
        if (!activeVoiceChannelId || !auth.user) {
          updateTestState('fail', 'Join a voice channel first to validate SFU handshake.');
          return;
        }
        const response = await ws.requestVoiceSfu<{
          rtpCapabilities?: { codecs?: unknown[] };
          audioOnly?: boolean;
        }>(activeVoiceChannelId, 'get-rtp-capabilities');
        const codecCount = response?.rtpCapabilities?.codecs?.length ?? 0;
        const transportModeLabel = voiceAudioTransportMode === 'sfu' ? 'server-sfu' : 'p2p-fallback';
        updateTestState(
          codecCount > 0 ? 'pass' : 'fail',
          codecCount > 0
            ? `SFU handshake ok (${codecCount} codec(s), audioOnly=${response?.audioOnly !== false}, mode=${transportModeLabel}).`
            : 'SFU handshake returned no RTP codecs.',
        );
        return;
      }

      if (testId === 'audio-context-state') {
        const formatState = (label: string, context: AudioContext | null) =>
          `${label}:${context?.state ?? 'none'}`;
        const stateSummary = [
          formatState('remoteAudio', remoteAudioContextRef.current),
          formatState('remoteSpeaking', remoteSpeakingContextRef.current),
          formatState('localGain', localVoiceGainContextRef.current),
          formatState('localAnalyser', localAnalyserContextRef.current),
        ].join(' | ');
        updateTestState(
          audioContextsUnlockedRef.current ? 'pass' : 'fail',
          audioContextsUnlockedRef.current
            ? `Audio unlocked. ${stateSummary}`
            : `Audio not unlocked by gesture yet. ${stateSummary}`,
        );
        return;
      }

      if (testId === 'rtc-config') {
        const serverCount = voiceIceConfig.iceServers?.length ?? 0;
        updateTestState(
          serverCount > 0 ? 'pass' : 'fail',
          serverCount > 0 ? `Loaded ${serverCount} ICE server(s).` : 'No ICE servers are configured.',
        );
        return;
      }

      if (testId === 'microphone') {
        const stream = await getLocalVoiceStream();
        const hasLiveTrack = stream.getAudioTracks().some((track) => track.readyState === 'live');
        updateTestState(
          hasLiveTrack ? 'pass' : 'fail',
          hasLiveTrack
            ? 'Microphone stream is live.'
            : 'Microphone stream was created but no live audio track was found.',
        );
        return;
      }

      if (testId === 'audio-sender-profile') {
        const peerConnections = Array.from(peerConnectionsRef.current.entries());
        if (peerConnections.length === 0) {
          updateTestState('pass', 'No active peers. Connect another user to validate sender profile.');
          return;
        }

        const issues: string[] = [];
        const requiredBitrateBps = Math.max(8, activeVoiceBitrateKbps) * 1000;
        for (const [peerUserId, connection] of peerConnections) {
          const audioSenders = connection
            .getSenders()
            .filter((sender) => sender.track?.kind === 'audio');
          if (audioSenders.length === 0) {
            issues.push(`${peerUserId}: no audio sender`);
            continue;
          }
          for (const sender of audioSenders) {
            const params = sender.getParameters();
            const encodings = params.encodings ?? [];
            for (const encoding of encodings) {
              if (typeof encoding.maxBitrate === 'number' && encoding.maxBitrate < requiredBitrateBps * 0.8) {
                issues.push(`${peerUserId}: maxBitrate below channel target`);
              }
              const dtxValue = (encoding as { dtx?: string }).dtx;
              if (dtxValue && dtxValue !== 'disabled') {
                issues.push(`${peerUserId}: dtx is not disabled`);
              }
              const priorityValue = (encoding as { priority?: string }).priority;
              if (priorityValue && priorityValue !== 'high') {
                issues.push(`${peerUserId}: priority is not high`);
              }
            }
          }
        }

        updateTestState(
          issues.length === 0 ? 'pass' : 'fail',
          issues.length === 0
            ? `Audio sender profile validated on ${peerConnections.length} peer(s).`
            : `Profile issues: ${issues.slice(0, 3).join(' | ')}`,
        );
        return;
      }

      if (testId === 'ice-restart') {
        const peerConnections = Array.from(peerConnectionsRef.current.entries());
        if (peerConnections.length === 0) {
          updateTestState('pass', 'No active peers. Connect another user to validate ICE restart support.');
          return;
        }
        const unsupportedPeers = peerConnections
          .filter(([, connection]) => typeof connection.restartIce !== 'function')
          .map(([peerUserId]) => peerUserId);
        updateTestState(
          unsupportedPeers.length === 0 ? 'pass' : 'fail',
          unsupportedPeers.length === 0
            ? `ICE restart is available on ${peerConnections.length} peer connection(s).`
            : `ICE restart missing on: ${unsupportedPeers.join(', ')}`,
        );
        return;
      }

      if (testId === 'stream-sync') {
        if (!activeVoiceChannelId || !auth.user) {
          updateTestState('fail', 'Join a voice channel first to validate stream sync.');
          return;
        }
        const peers = (voiceParticipantsByChannel[activeVoiceChannelId] ?? [])
          .map((participant) => participant.userId)
          .filter((userId) => userId !== auth.user?.id);
        if (peers.length === 0) {
          updateTestState('pass', 'No peers in voice channel. Stream sync will run once peers join.');
          return;
        }
        syncLocalVideoSourceToPeers(activeVoiceChannelId, peers);
        updateTestState('pass', `Pushed stream source snapshot to ${peers.length} peer(s).`);
        return;
      }

      if (testId === 'video-recovery') {
        const stalledPeers = Array.from(remoteVideoTrafficByPeerRef.current.entries())
          .filter(([, sample]) => sample.stagnantSamples >= 3)
          .map(([peerUserId]) => peerUserId);
        updateTestState(
          stalledPeers.length === 0 ? 'pass' : 'fail',
          stalledPeers.length === 0
            ? `Watchdog healthy (${remoteVideoTrafficByPeerRef.current.size} monitored peer(s)).`
            : `Stalled peers detected: ${stalledPeers.join(', ')}`,
        );
        return;
      }

      await collectVoiceConnectionStats();
      updateTestState('pass', `Detailed stats snapshot collected (${peerConnectionsRef.current.size} peer(s)).`);
    } catch (err) {
      updateTestState('fail', getErrorMessage(err, 'Test failed unexpectedly.'));
    }
  }, [
    ws,
    voiceIceConfig.iceServers,
    voiceSfuEnabled,
    voiceAudioTransportMode,
    getLocalVoiceStream,
    activeVoiceBitrateKbps,
    activeVoiceChannelId,
    auth.user,
    voiceParticipantsByChannel,
    syncLocalVideoSourceToPeers,
    collectVoiceConnectionStats,
  ]);

  const runAllAdminVoiceTests = useCallback(async () => {
    if (runningAdminVoiceTests) {
      return;
    }
    setRunningAdminVoiceTests(true);
    try {
      for (const test of ADMIN_VOICE_TEST_DEFINITIONS) {
        // Keep test execution deterministic and make feedback easy to trace.
        await runAdminVoiceTest(test.id);
      }
    } finally {
      setRunningAdminVoiceTests(false);
    }
  }, [runningAdminVoiceTests, runAdminVoiceTest]);

  const adminVoiceTests = useMemo<AdminVoiceTestEntry[]>(
    () =>
      ADMIN_VOICE_TEST_DEFINITIONS.map((test) => ({
        id: test.id,
        label: test.label,
        description: test.description,
        status: adminVoiceTestStateById[test.id].status,
        message: adminVoiceTestStateById[test.id].message,
        ranAt: adminVoiceTestStateById[test.id].ranAt,
      })),
    [adminVoiceTestStateById],
  );

  useEffect(() => {
    if (activeView !== 'admin' || !auth.user?.isAdmin) {
      return;
    }
    void loadAdminStats();
    void loadAdminSettings();
    void loadAdminUsers();
    const interval = window.setInterval(() => {
      void loadAdminStats();
      void loadAdminSettings();
      void loadAdminUsers();
    }, 5000);
    return () => {
      window.clearInterval(interval);
    };
  }, [activeView, auth.user?.isAdmin, loadAdminStats, loadAdminSettings, loadAdminUsers]);

  useEffect(() => {
    if (activeView !== 'friends' || !auth.token) {
      return;
    }
    const interval = window.setInterval(() => {
      void loadFriendData();
    }, 8000);
    return () => {
      window.clearInterval(interval);
    };
  }, [activeView, auth.token, loadFriendData]);

  useEffect(() => {
    if (!auth.token || !activeChannelId || ws.connected) {
      return;
    }
    const interval = window.setInterval(() => {
      void loadMessages(activeChannelId);
    }, 5000);
    return () => {
      window.clearInterval(interval);
    };
  }, [auth.token, activeChannelId, loadMessages, ws.connected]);

  useEffect(() => {
    if (ws.connected) {
      return;
    }
    voiceParticipantIdsByChannelRef.current.clear();
    setActiveVoiceChannelId(null);
    setVoiceBusyChannelId(null);
    teardownVoiceTransport();
  }, [ws.connected, teardownVoiceTransport]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      if (event.shiftKey || event.altKey) {
        return;
      }
      if (event.key.toLowerCase() !== 'k') {
        return;
      }
      if (activeView !== 'chat' || activeChannel?.isVoice) {
        return;
      }
      event.preventDefault();
      messageSearchInputRef.current?.focus();
      messageSearchInputRef.current?.select();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [activeView, activeChannel?.isVoice]);

  const { toggleMessageReaction } = useReactionsFeature({
    authToken: auth.token,
    activeChannelId,
    setMessages,
    setError,
  });

  const { editMessage, deleteMessage, sendMessage } = useMessageLifecycleFeature({
    authToken: auth.token,
    authUser: auth.user ? { id: auth.user.id, username: auth.user.username } : null,
    activeChannelId,
    replyTarget,
    setMessages,
    setReplyTarget,
    setError,
    wsConnected: ws.connected,
    sendRealtimeMessage: ws.sendMessage,
    hasPendingSignature,
    addPendingSignature,
    schedulePendingTimeout,
    clearPendingSignature,
  });

  if (!auth.token || !auth.user) {
    if (auth.token && auth.hydrating) {
      return (
        <main className="chat-layout">
          <section className="chat-panel">
            <header className="panel-header">
              <h1>Restoring session...</h1>
            </header>
            <section className="chat-view">
              <p className="muted">Loading account...</p>
            </section>
          </section>
        </main>
      );
    }
    return <Navigate to="/login" replace />;
  }

  const loadOlder = async () => {
    if (!activeChannelId || messages.length === 0) {
      return;
    }
    await loadMessages(activeChannelId, messages[0].createdAt, true);
  };

  const logout = async () => {
    if (auth.token) {
      try {
        await chatApi.logout(auth.token);
      } catch {
        // Keep logout resilient even if backend is down.
      }
    }
    auth.clearAuth();
  };

  const createChannel = async (name: string, type: 'TEXT' | 'VOICE') => {
    if (!auth.token || !auth.user?.isAdmin) {
      return;
    }
    try {
      const response = await chatApi.createChannel(auth.token, name, type);
      setChannels((prev) => {
        const exists = prev.some((channel) => channel.id === response.channel.id);
        return exists ? prev : [...prev, response.channel];
      });
      setActiveChannelId(response.channel.id);
      setActiveView('chat');
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not create channel'));
    }
  };

  const updateVoiceChannelSettings = async (
    channelId: string,
    input: { voiceBitrateKbps?: number; streamBitrateKbps?: number },
  ) => {
    if (!auth.token || !canEditVoiceSettings) {
      return;
    }
    setSavingVoiceSettingsChannelId(channelId);
    try {
      const response = await chatApi.updateVoiceChannelSettings(auth.token, channelId, input);
      setChannels((prev) => upsertChannel(prev, response.channel));
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not update voice quality'));
    } finally {
      setSavingVoiceSettingsChannelId((current) => (current === channelId ? null : current));
    }
  };

  const uploadAttachment = async (file: File) => {
    if (!auth.token) {
      throw new Error('Not authenticated');
    }
    try {
      const response = await chatApi.uploadAttachment(auth.token, file);
      setError(null);
      return response.attachment;
    } catch (err) {
      setError(getErrorMessage(err, 'Could not upload attachment'));
      throw err;
    }
  };

  const deleteChannel = async (channelId: string) => {
    if (!auth.token || !auth.user?.isAdmin) {
      return;
    }
    setDeletingChannelId(channelId);
    try {
      if (activeVoiceChannelId === channelId) {
        ws.leaveVoice(channelId);
        setActiveVoiceChannelId(null);
      }
      await chatApi.deleteChannel(auth.token, channelId);
      setChannels((prev) => {
        const nextChannels = prev.filter((channel) => channel.id !== channelId);
        if (activeChannelId === channelId) {
          const fallback = nextChannels.find((channel) => !channel.isDirect) ?? nextChannels[0] ?? null;
          setActiveChannelId(fallback?.id ?? null);
        }
        return nextChannels;
      });
      setVoiceParticipantsByChannel((prev) => {
        const next = { ...prev };
        delete next[channelId];
        return next;
      });
      setUnreadChannelCounts((prev) => {
        if (!prev[channelId]) {
          return prev;
        }
        const next = { ...prev };
        delete next[channelId];
        return next;
      });
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not delete channel'));
    } finally {
      setDeletingChannelId(null);
    }
  };

  const panelTitle =
    activeView === 'chat'
      ? activeChannel
        ? activeChannel.isDirect
          ? `@${activeChannel.directUser?.username ?? 'Direct Message'}`
          : activeChannel.isVoice
            ? `~${activeChannel.name}`
            : `#${activeChannel.name}`
        : 'Select channel'
      : activeView === 'friends'
        ? 'Friends'
        : activeView === 'settings'
          ? 'Settings'
          : 'Admin Settings';
  const isVoiceDisconnecting =
    Boolean(activeVoiceChannelId) && voiceBusyChannelId === activeVoiceChannelId;
  const isViewingJoinedVoiceChannel =
    activeView === 'chat' &&
    Boolean(activeChannel?.isVoice) &&
    activeChannel?.id === activeVoiceChannelId;
  const voiceSessionStatus = !ws.connected
    ? 'Disconnected'
    : isVoiceDisconnecting
      ? 'Disconnecting...'
      : localAudioReady
        ? 'Connected'
        : 'Connecting...';
  const chatLayoutClassName = [
    'chat-layout',
    mobilePane === 'channels' ? 'mobile-channels-open' : '',
    mobilePane === 'users' ? 'mobile-users-open' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const currentUserId = auth.user?.id ?? '';
  const currentPresenceState: PresenceState =
    onlineUsers.find((user) => user.id === currentUserId)?.state ?? 'online';
  const setPresenceState = (nextState: string) => {
    if (!currentUserId) {
      return;
    }
    const normalizedState: PresenceState =
      nextState === 'dnd' || nextState === 'idle' ? nextState : 'online';
    setOnlineUsers((prev) => {
      const currentUserIndex = prev.findIndex((user) => user.id === currentUserId);
      if (currentUserIndex < 0) {
        return prev;
      }
      const currentUser = prev[currentUserIndex];
      if (currentUser.state === normalizedState) {
        return prev;
      }
      const next = [...prev];
      next[currentUserIndex] = { ...currentUser, state: normalizedState };
      return next;
    });
    ws.sendPresence(normalizedState);
  };

  return (
    <main className={chatLayoutClassName}>
      <ChannelSidebar
        channels={channels}
        activeChannelId={activeChannelId}
        onSelect={(channelId) => {
          setActiveChannelId(channelId);
          setActiveView('chat');
          setMobilePane('none');
          setUnreadChannelCounts((prev) => {
            if (!prev[channelId]) {
              return prev;
            }
            const next = { ...prev };
            delete next[channelId];
            return next;
          });
        }}
        unreadChannelCounts={unreadChannelCounts}
        activeView={activeView}
        onChangeView={setActiveView}
        onLogout={logout}
        userId={auth.user.id}
        username={auth.user.username}
        isAdmin={auth.user.isAdmin}
        onCreateChannel={createChannel}
        onDeleteChannel={deleteChannel}
        deletingChannelId={deletingChannelId}
        activeVoiceChannelId={activeVoiceChannelId}
        voiceParticipantCounts={voiceParticipantCounts}
        voiceParticipantsByChannel={voiceParticipantsByChannel}
        voiceStreamingUserIdsByChannel={voiceStreamingUserIdsByChannel}
        remoteScreenShares={remoteScreenShares}
        localScreenShareStream={localScreenShareStream}
        localStreamSource={localStreamSource}
        speakingUserIds={speakingUserIds}
        onJoinVoice={joinVoiceChannel}
        onLeaveVoice={leaveVoiceChannel}
        isSelfMuted={isSelfMuted}
        isSelfDeafened={isSelfDeafened}
        onToggleMute={toggleSelfMute}
        onToggleDeafen={toggleSelfDeafen}
        joiningVoiceChannelId={voiceBusyChannelId}
        incomingFriendRequests={incomingRequests.length}
        avatarUrl={auth.user.avatarUrl}
        ping={ws.ping}
        state={currentPresenceState}
      />

      <section className="chat-panel">
        <header className="panel-header">
          <div className="panel-header-main">
            {activeView === 'chat' ? (
              <button
                className="mobile-pane-toggle"
                onClick={() =>
                  setMobilePane((current) => (current === 'channels' ? 'none' : 'channels'))
                }
              >
                Channels
              </button>
            ) : null}
            <h1>{panelTitle}</h1>
            {activeView === 'chat' ? (
              <button
                className="mobile-pane-toggle"
                onClick={() => setMobilePane((current) => (current === 'users' ? 'none' : 'users'))}
              >
                Online
              </button>
            ) : null}
            {error ? <p className="error-banner">{error}</p> : null}
            {!error && notice ? <p className="info-banner">{notice}</p> : null}
            {streamStatusBanner ? (
              <p className={streamStatusBanner.type === 'error' ? 'error-banner' : 'info-banner'}>
                {streamStatusBanner.message}
              </p>
            ) : null}
          </div>
          {activeView === 'chat' && !activeChannel?.isVoice ? (
            <div className="panel-tools">
              <input
                ref={messageSearchInputRef}
                className="panel-search-input"
                value={messageQuery}
                onChange={(event) => setMessageQuery(event.target.value)}
                placeholder="Search messages"
                aria-label="Search messages"
              />
              <span className="panel-search-hint">Ctrl/Cmd+K</span>
              {messageQuery ? (
                <button className="ghost-btn small" onClick={() => setMessageQuery('')}>
                  Clear
                </button>
              ) : null}
            </div>
          ) : null}
        </header>

        {activeVoiceChannel && !isViewingJoinedVoiceChannel ? (
          <div className="voice-session-bar" role="status" aria-live="polite">
            <div className="voice-session-main">
              <strong>Voice: ~{activeVoiceChannel.name}</strong>
              <span className={`voice-session-state ${isVoiceDisconnecting ? 'danger' : ''}`}>
                {voiceSessionStatus}
              </span>
              <small>
                Voice {activeVoiceBitrateKbps} kbps • Stream {activeStreamBitrateKbps} kbps
                {protectVoiceEnabled && effectiveStreamBitrateKbps < activeStreamBitrateKbps
                  ? ` (effective ${effectiveStreamBitrateKbps})`
                  : ''}
                {' • '}
                {activeRemoteAudioUsers.length} remote stream(s)
                {' • '}
                Audio via {voiceAudioTransportMode === 'sfu' ? 'Server SFU' : 'P2P'}
                {voiceAudioTransportMode === 'sfu' && voiceSfuAudioOnly ? ' (audio-only)' : ''}
              </small>
            </div>
            <button
              className="ghost-btn danger small"
              disabled={isVoiceDisconnecting}
              onClick={() => {
                void leaveVoiceChannel();
              }}
            >
              {isVoiceDisconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        ) : null}

        {activeView === 'chat' ? (
          <>
            {activeChannel?.isVoice ? (
              <VoiceChannelPanel
                channelName={activeChannel.name}
                participants={activeVoiceParticipants}
                currentUserId={auth.user.id}
                localAudioReady={localAudioReady}
                remoteAudioUsers={viewedRemoteAudioUsers}
                voiceBitrateKbps={activeChannel.voiceBitrateKbps ?? 64}
                streamBitrateKbps={activeChannel.streamBitrateKbps ?? 2500}
                onVoiceBitrateChange={(nextBitrate) => {
                  void updateVoiceChannelSettings(activeChannel.id, { voiceBitrateKbps: nextBitrate });
                }}
                onStreamBitrateChange={(nextBitrate) => {
                  void updateVoiceChannelSettings(activeChannel.id, { streamBitrateKbps: nextBitrate });
                }}
                canEditChannelBitrate={canEditVoiceSettings}
                qualityBusy={savingVoiceSettingsChannelId === activeChannel.id}
                joined={activeVoiceChannelId === activeChannel.id}
                busy={voiceBusyChannelId === activeChannel.id}
                wsConnected={ws.connected}
                isMuted={isSelfMuted || isSelfDeafened}
                onToggleMute={toggleSelfMute}
                speakingUserIds={speakingUserIds}
                showVoiceActivity={preferences.showVoiceActivity}
                onJoin={() => joinVoiceChannel(activeChannel.id)}
                onLeave={leaveVoiceChannel}
                onParticipantContextMenu={(participant, position) =>
                  openUserAudioMenu(
                    { id: participant.userId, username: participant.username },
                    position,
                  )
                }
                getParticipantAudioState={(userId) => getUserAudioState(userId)}
                localScreenShareStream={localScreenShareStream}
                localStreamSource={localStreamSource}
                remoteScreenShares={remoteScreenShares}
                onToggleVideoShare={toggleVideoShare}
                streamQualityLabel={streamQualityLabel}
                onStreamQualityChange={handleStreamQualityChange}
                showDetailedStats={showDetailedVoiceStats}
                onToggleDetailedStats={() =>
                  setShowDetailedVoiceStats((current) => !current)
                }
                connectionStats={voiceConnectionStats}
                statsUpdatedAt={voiceStatsUpdatedAt}
                protectVoiceEnabled={protectVoiceEnabled}
                protectVoiceStatus={voiceProtectionLevel}
                onToggleProtectVoice={() => setProtectVoiceEnabled((current) => !current)}
              />
            ) : (
              <>
                <ChatView
                  activeChannelId={activeChannelId}
                  loading={loadingMessages}
                  messages={filteredMessages}
                  wsConnected={ws.connected}
                  currentUserId={auth.user.id}
                  use24HourClock={preferences.use24HourClock}
                  showSeconds={preferences.showSeconds}
                  reducedMotion={preferences.reducedMotion}
                  onLoadOlder={loadOlder}
                  onUserClick={setSelectedUser}
                  onMentionUser={(user) => {
                    setComposerInsertRequest({
                      key: Date.now(),
                      text: `@${user.username}`,
                    });
                  }}
                  onReplyToMessage={(message) => {
                    setReplyTarget({
                      id: message.id,
                      userId: message.userId,
                      username: message.user.username,
                      content: message.content,
                    });
                  }}
                  onToggleReaction={toggleMessageReaction}
                  onEditMessage={editMessage}
                  onDeleteMessage={deleteMessage}
                  canManageAllMessages={auth.user.isAdmin}
                />
                <MessageComposer
                  disabled={!activeChannelId}
                  enterToSend={preferences.enterToSend}
                  draftScopeKey={activeChannelId}
                  insertRequest={composerInsertRequest}
                  replyTo={
                    replyTarget
                      ? {
                        username: replyTarget.username,
                        content: replyTarget.content,
                      }
                      : null
                  }
                  replyToMessageId={replyTarget?.id ?? null}
                  onClearReply={() => setReplyTarget(null)}
                  onSend={sendMessage}
                  onUploadAttachment={uploadAttachment}
                />
              </>
            )}
          </>
        ) : null}

        {activeView === 'friends' ? (
          <FriendsPanel
            friends={friends}
            incoming={incomingRequests}
            outgoing={outgoingRequests}
            loading={loadingFriends}
            error={friendsError}
            actionBusyId={friendActionBusyId}
            submittingRequest={submittingFriendRequest}
            onRefresh={loadFriendData}
            onSendRequest={sendFriendRequest}
            onAccept={acceptFriendRequest}
            onDecline={declineFriendRequest}
            onCancel={cancelFriendRequest}
            onRemove={removeFriend}
            onStartDm={openDirectMessage}
            openingDmUserId={openingDmUserId}
          />
        ) : null}

        {activeView === 'settings' ? (
          <SettingsPanel
            user={auth.user}
            wsConnected={ws.connected}
            preferences={preferences}
            audioInputDevices={audioInputDevices}
            microphonePermission={microphonePermission}
            requestingMicrophonePermission={requestingMicrophonePermission}
            onUpdatePreferences={updatePreferences}
            onResetPreferences={resetPreferences}
            onRequestMicrophonePermission={requestMicrophonePermission}
            onLogout={logout}
            state={currentPresenceState}
            onSetState={setPresenceState}
          />
        ) : null}

        {activeView === 'admin' && auth.user.isAdmin ? (
          <AdminSettingsPanel
            stats={adminStats}
            settings={adminSettings}
            settingsLoading={loadingAdminSettings}
            settingsError={adminSettingsError}
            savingSettings={savingAdminSettings}
            loading={loadingAdminStats}
            error={adminStatsError}
            onRefresh={loadAdminStats}
            onRefreshSettings={loadAdminSettings}
            onSaveSettings={saveAdminSettings}
            users={adminUsers}
            usersLoading={loadingAdminUsers}
            usersError={adminUsersError}
            updatingUserId={updatingAdminUserId}
            deletingUserId={deletingAdminUserId}
            onRefreshUsers={loadAdminUsers}
            onUpdateUser={updateAdminUser}
            onDeleteUser={deleteAdminUser}
            onClearUsersExceptCurrent={clearAdminUsersExceptCurrent}
            clearingUsersExceptCurrent={clearingAdminUsers}
            currentUserId={auth.user.id}
            voiceTests={adminVoiceTests}
            runningVoiceTests={runningAdminVoiceTests}
            onRunVoiceTest={runAdminVoiceTest}
            onRunAllVoiceTests={runAllAdminVoiceTests}
          />
        ) : null}
      </section>

      {activeView === 'chat' ? (
        <UserSidebar
          users={onlineUsers}
          onUserClick={(user) => {
            setSelectedUser(user);
            setMobilePane('none');
          }}
          onUserContextMenu={(user, position) => openUserAudioMenu(user, position)}
        />
      ) : null}

      <div className="voice-audio-sinks" aria-hidden="true">
        {activeRemoteAudioUsers.map((user) => (
          <audio
            key={user.userId}
            autoPlay
            playsInline
            muted={isSelfDeafened || getUserAudioState(user.userId).muted}
            ref={(node) => {
              if (!node) {
                return;
              }
              if (node.srcObject !== user.stream) {
                node.srcObject = user.stream;
              }
              const localAudio = getUserAudioState(user.userId);
              const effectiveVolume =
                (preferences.voiceOutputVolume / 100) * (localAudio.volume / 100);
              const usingAudioGraph = applyRemoteAudioGain(user.userId, node, effectiveVolume);
              if (!usingAudioGraph) {
                node.volume = clampMediaElementVolume(effectiveVolume);
              } else {
                node.volume = 1;
              }
              node.muted =
                isSelfDeafened ||
                localAudio.muted ||
                preferences.voiceOutputVolume <= 0 ||
                localAudio.volume <= 0;
              if (!node.muted) {
                void node.play().catch(() => {
                  // Best effort for browsers that need an explicit playback call after stream updates.
                });
              }
            }}
          />
        ))}
      </div>

      {audioContextMenu ? (
        <div
          className="audio-context-menu"
          style={{ left: `${audioContextMenu.x}px`, top: `${audioContextMenu.y}px` }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header>
            <strong>{audioContextMenu.username}</strong>
            <small>Local audio controls</small>
          </header>
          <label className="audio-context-volume">
            <span>Volume</span>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={1}
                  value={getUserAudioState(audioContextMenu.userId).volume}
                onChange={(event) => {
                setUserVolume(audioContextMenu.userId, Number(event.target.value));
              }}
            />
            <output>{getUserAudioState(audioContextMenu.userId).volume}%</output>
          </label>
          <button
            className={getUserAudioState(audioContextMenu.userId).muted ? 'ghost-btn danger' : 'ghost-btn'}
            onClick={() => {
              toggleUserMuted(audioContextMenu.userId);
            }}
          >
            {getUserAudioState(audioContextMenu.userId).muted ? 'Unmute User' : 'Mute User'}
          </button>
        </div>
      ) : null}

      <UserProfile
        user={selectedUser}
        onClose={() => setSelectedUser(null)}
        currentUser={auth.user}
        friendRequestState={selectedUserFriendRequestState}
        incomingRequestId={selectedUserIncomingRequestId}
        acceptingFriendRequest={acceptingSelectedUserFriendRequest}
        sendingFriendRequest={submittingFriendRequest}
        friendRequestError={friendsError}
        onSendFriendRequest={sendFriendRequest}
        onAcceptFriendRequest={acceptFriendRequest}
      />

      {mobilePane !== 'none' ? (
        <button
          type="button"
          className="mobile-drawer-backdrop"
          aria-label="Close side panel"
          onClick={() => setMobilePane('none')}
        />
      ) : null}

      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <button
          className={activeView === 'chat' && mobilePane === 'none' ? 'active' : ''}
          onClick={() => {
            setActiveView('chat');
            setMobilePane('none');
          }}
        >
          Chat
        </button>
        <button
          className={mobilePane === 'channels' ? 'active' : ''}
          onClick={() => {
            setActiveView('chat');
            setMobilePane((current) => (current === 'channels' ? 'none' : 'channels'));
          }}
        >
          Channels
        </button>
        <button
          className={mobilePane === 'users' ? 'active' : ''}
          onClick={() => {
            setActiveView('chat');
            setMobilePane((current) => (current === 'users' ? 'none' : 'users'));
          }}
        >
          Users
        </button>
        <button
          className={activeView === 'friends' ? 'active' : ''}
          onClick={() => {
            setActiveView('friends');
            setMobilePane('none');
          }}
        >
          Friends
        </button>
        <button
          className={activeView === 'settings' ? 'active' : ''}
          onClick={() => {
            setActiveView('settings');
            setMobilePane('none');
          }}
        >
          Settings
        </button>
      </nav>
    </main>
  );
}
