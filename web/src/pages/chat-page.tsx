import { Navigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chatApi } from '../api/chat-api';
import { AdminSettingsPanel } from '../components/admin-settings-panel';
import { ChannelSidebar } from '../components/channel-sidebar';
import { ChatView } from '../components/chat-view';
import { FriendsPanel } from '../components/friends-panel';
import { MessageComposer } from '../components/message-composer';
import { SettingsPanel } from '../components/settings-panel';
import { UserProfile } from '../components/user-profile';
import { UserSidebar } from '../components/user-sidebar';
import { VoiceChannelPanel } from '../components/voice-channel-panel';
import { useChatSocket } from '../hooks/use-chat-socket';
import type { PresenceUser, VoiceParticipant, VoiceStatePayload } from '../hooks/use-chat-socket';
import { useUserPreferences } from '../hooks/use-user-preferences';
import {
  messageSignature,
  reconcileIncomingMessage,
  useMessageLifecycleFeature,
  type ReplyTarget,
} from './chat/hooks/use-message-lifecycle-feature';
import { useChannelMessageLoader } from './chat/hooks/use-channel-message-loader';
import { upsertChannel, useProfileDmFeature } from './chat/hooks/use-profile-dm-feature';
import { useReactionsFeature } from './chat/hooks/use-reactions-feature';
import { useRemoteSpeakingActivity } from './chat/hooks/use-remote-speaking-activity';

import { useFriendsFeature } from './chat/hooks/use-friends-feature';

import { useChatPresenceFeature } from './chat/hooks/use-chat-presence-feature';
import {
  DEFAULT_STREAM_QUALITY,
  clampCameraPreset,
  getCameraCapturePresetLabels,
  getStreamQualityPreset,
  isValidStreamQualityLabel,
  toVideoTrackConstraints,
} from './chat/utils/stream-quality';
import {
  isVoiceSignalData,
  shouldInitiateOffer,
  type VoiceSignalData,
} from './chat/utils/voice-signaling';
import { getStaleRemoteScreenShareUserIds } from './chat/utils/stale-screen-shares';
import { useVoiceFeature } from './chat/hooks/use-voice-feature';
import { useAuth } from '../store/auth-store';
import type {
  Channel,
  Message,
} from '../types/api';
import { getErrorMessage } from '../utils/error-message';
import { trackTelemetryError } from '../utils/telemetry';

type MainView = 'chat' | 'friends' | 'settings' | 'admin';
type MobilePane = 'none' | 'channels' | 'users';
type MicrophonePermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported' | 'unknown';
type StreamSource = 'screen' | 'camera';

function clampMediaElementVolume(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1, Math.max(0, value));
}

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

function createDefaultVoiceIceConfig(): RTCConfiguration {
  return {
    iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
    iceCandidatePoolSize: 2,
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
  const [remoteAdvertisedVideoSourceByPeer, setRemoteAdvertisedVideoSourceByPeer] =
    useState<Record<string, StreamSource | null>>({});
  const [localScreenShareStream, setLocalScreenShareStream] = useState<MediaStream | null>(null);
  const [localStreamSource, setLocalStreamSource] = useState<StreamSource | null>(null);
  const [streamQualityLabel, setStreamQualityLabel] = useState(DEFAULT_STREAM_QUALITY);
  const [showDetailedVoiceStats, setShowDetailedVoiceStats] = useState(false);
  const [voiceConnectionStats, setVoiceConnectionStats] = useState<VoiceDetailedConnectionStats[]>([]);
  const [voiceStatsUpdatedAt, setVoiceStatsUpdatedAt] = useState<number | null>(null);
  const [voiceIceConfig, setVoiceIceConfig] = useState<RTCConfiguration>(() =>
    createDefaultVoiceIceConfig(),
  );
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
  const {
    adminStats,
    loadingAdminStats,
    adminStatsError,
    adminSettings,
    loadingAdminSettings,
    adminSettingsError,
    savingAdminSettings,
    adminUsers,
    loadingAdminUsers,
    adminUsersError,
    updatingAdminUserId,
    deletingAdminUserId,
    clearingAdminUsers,
    loadAdminStats,
    loadAdminSettings,
    saveAdminSettings,
    loadAdminUsers,
    updateAdminUser,
    deleteAdminUser,
    clearAdminUsersExceptCurrent,
  } = useAdminFeature({
    authToken: auth.token,
    isAdmin: auth.user?.isAdmin,
    currentUserId: auth.user?.id,
    onNotice: setNotice,
  });
  const {
    friends,
    incomingRequests,
    outgoingRequests,
    loadingFriends,
    friendsError,
    friendActionBusyId,
    submittingFriendRequest,
    setFriendsError,
    loadFriendData,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    cancelFriendRequest,
    removeFriend,
  } = useFriendsFeature({
    authToken: auth.token,
    onNotice: setNotice,
  });
  const {    currentPresenceState,
    setPresenceStateLocal,
    incrementHiddenUnread,
  } = useChatPresenceFeature({
    currentUserId: auth.user?.id ?? null,
    onlineUsers,
    setOnlineUsers,
  });
  const previousIncomingRequestCountRef = useRef<number | null>(null);
  const streamStatusBannerTimeoutRef = useRef<number | null>(null);
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
  const localVoiceInputDeviceIdRef = useRef<string | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const videoSenderByPeerRef = useRef<Map<string, RTCRtpSender>>(new Map());
  const pendingVideoRenegotiationByPeerRef = useRef<Set<string>>(new Set());
  const makingOfferByPeerRef = useRef<Map<string, boolean>>(new Map());
  const ignoreOfferByPeerRef = useRef<Map<string, boolean>>(new Map());
  const remoteVideoSourceByPeerRef = useRef<Map<string, StreamSource | null>>(new Map());
  const remoteVideoStreamByPeerRef = useRef<Map<string, MediaStream>>(new Map());
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
    remoteAdvertisedVideoSourceByPeer,
    localScreenShareStream,
    localStreamSource,
    authUserId: auth.user?.id,
    authUserRole: auth.user?.role,
  });

  const subscribedChannelIds = useMemo(() => channels.map((channel) => channel.id), [channels]);

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
  }, [computeKbpsFromSnapshot, joinedVoiceParticipants]);

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

  const loadMessages = useChannelMessageLoader({
    token: auth.token,
    activeChannelId,
    setMessages,
    setLoadingMessages,
  });


  const playIncomingMessageSound = useCallback(() => {
    if (!preferences.playMessageSound) {
      return;
    }
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
    if (isSelfDeafened) {
      return;
    }
    setIsSelfMuted((current) => !current);
  }, [isSelfDeafened]);

  const toggleSelfDeafen = useCallback(() => {
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
  }, [isSelfDeafened, isSelfMuted]);

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
    setRemoteAdvertisedVideoSourceByPeer((prev) => {
      if (!(peerUserId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[peerUserId];
      return next;
    });
    remoteVideoStreamByPeerRef.current.delete(peerUserId);
    pendingIceRef.current.delete(peerUserId);
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
    for (const peerUserId of peerConnectionsRef.current.keys()) {
      closePeerConnection(peerUserId);
    }
    peerConnectionsRef.current.clear();
    videoSenderByPeerRef.current.clear();
    pendingVideoRenegotiationByPeerRef.current.clear();
    makingOfferByPeerRef.current.clear();
    ignoreOfferByPeerRef.current.clear();
    remoteVideoSourceByPeerRef.current.clear();
    setRemoteAdvertisedVideoSourceByPeer({});
    remoteVideoStreamByPeerRef.current.clear();
    pendingIceRef.current.clear();
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
    if (remoteAudioContextRef.current && remoteAudioContextRef.current.state !== 'closed') {
      return remoteAudioContextRef.current;
    }
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      return null;
    }
    const context = new AudioContextClass();
    remoteAudioContextRef.current = context;
    return context;
  }, []);

  const disconnectRemoteAudioForUser = useCallback((userId: string) => {
    const source = remoteAudioSourceByUserRef.current.get(userId);
    if (source) {
      source.disconnect();
      remoteAudioSourceByUserRef.current.delete(userId);
    }
    const gain = remoteAudioGainByUserRef.current.get(userId);
    if (gain) {
      gain.disconnect();
      remoteAudioGainByUserRef.current.delete(userId);
    }
    remoteAudioElementByUserRef.current.delete(userId);
  }, []);

  const applyRemoteAudioGain = useCallback(
    (userId: string, element: HTMLAudioElement, gainValue: number) => {
      const context = ensureRemoteAudioContext();
      if (!context) {
        element.volume = clampMediaElementVolume(gainValue);
        return false;
      }

      if (context.state === 'suspended') {
        void context.resume().catch(() => {
          // Best effort. User interaction will resume later.
        });
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
  }, [activeRemoteAudioUsers, disconnectRemoteAudioForUser]);

  const pruneStaleRemoteScreenShares = useCallback(() => {
    const staleUserIds = getStaleRemoteScreenShareUserIds({
      remoteScreenShares,
      remoteVideoSourceByPeer: remoteVideoSourceByPeerRef.current,
      peerConnectionsByUser: peerConnectionsRef.current,
    });
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
    if (analyserContext.state === 'suspended') {
      void analyserContext.resume().catch(() => {
        // Some browsers require an explicit user gesture to resume.
      });
    }
    const analyser = analyserContext.createAnalyser();
    analyser.fftSize = 1024;
    const source = analyserContext.createMediaStreamSource(stream);
    source.connect(analyser);
    localAnalyserContextRef.current = analyserContext;
    localAnalyserSourceRef.current = source;
    localAnalyserRef.current = analyser;
  }, [resetLocalAnalyser]);

  const replaceAudioTrackAcrossPeers = useCallback(async (audioTrack: MediaStreamTrack) => {
    for (const connection of peerConnectionsRef.current.values()) {
      for (const sender of connection.getSenders()) {
        if (sender.track?.kind !== 'audio') {
          continue;
        }
        try {
          await sender.replaceTrack(audioTrack);
        } catch {
          // Ignore replacement errors; next renegotiation can recover.
        }
      }
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
      const { stream: rawStream, resolvedDeviceId } = await requestMicrophoneStream();
      const rawTrack = rawStream.getAudioTracks()[0] ?? null;
      if (!rawTrack) {
        for (const track of rawStream.getTracks()) {
          track.stop();
        }
        throw new Error('No microphone track available');
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

      let processedStream = rawStream;
      try {
        const AudioContextClass =
          window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioContextClass) {
          const gainContext = new AudioContextClass();
          if (gainContext.state === 'suspended') {
            void gainContext.resume().catch(() => {
              // Some browsers require an explicit user gesture to resume.
            });
          }
          const source = gainContext.createMediaStreamSource(rawStream);
          const gainNode = gainContext.createGain();
          gainNode.gain.value = voiceInputGainRef.current / 100;
          const destination = gainContext.createMediaStreamDestination();
          source.connect(gainNode);
          gainNode.connect(destination);
          localVoiceGainContextRef.current = gainContext;
          localVoiceGainNodeRef.current = gainNode;
          localVoiceProcessedStreamRef.current = destination.stream;
          processedStream = destination.stream;
        }
      } catch {
        processedStream = rawStream;
      }

      const processedTrack = processedStream.getAudioTracks()[0] ?? rawTrack;
      localVoiceStreamRef.current = rawStream;
      localVoiceInputDeviceIdRef.current = resolvedDeviceId;

      await replaceAudioTrackAcrossPeers(processedTrack);

      if (previousRawStream && previousRawStream !== rawStream) {
        for (const track of previousRawStream.getTracks()) {
          track.stop();
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

  const getOrCreateVideoSender = useCallback((connection: RTCPeerConnection) => {
    const fromVideoTransceiver = connection
      .getTransceivers()
      .find((transceiver) => transceiver.receiver.track?.kind === 'video')
      ?.sender;
    if (fromVideoTransceiver) {
      return fromVideoTransceiver;
    }

    const existingVideoSender =
      connection.getSenders().find((candidate) => candidate.track?.kind === 'video') ?? null;
    if (existingVideoSender) {
      return existingVideoSender;
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
      logVoiceDebug('peer_connection_create', {
        peerUserId,
        channelId,
        hasTurnRelayConfigured,
        iceTransportPolicy: voiceIceConfig.iceTransportPolicy ?? 'all',
      });

      for (const track of stream.getTracks()) {
        connection.addTrack(track, stream);
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
      await applyVideoBitrateToConnection(connection, activeStreamBitrateKbps);

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
        const streamFromTrack = event.streams[0] ?? new MediaStream([event.track]);
        if (event.track.kind === 'audio') {
          setRemoteAudioStreams((prev) => ({
            ...prev,
            [peerUserId]: streamFromTrack,
          }));
        } else if (event.track.kind === 'video') {
          remoteVideoStreamByPeerRef.current.set(peerUserId, streamFromTrack);
          const setRemoteVideoVisible = () => {
            const currentSource = remoteVideoSourceByPeerRef.current.get(peerUserId) ?? null;
            if (currentSource === null) {
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
            sendVoiceSignalRef.current(activeChannelId, peerUserId, { kind: 'renegotiate' } satisfies VoiceSignalData);
          }
          closePeerConnection(peerUserId);
          if (activeChannelId) {
            void createOfferForPeerRef.current(peerUserId, activeChannelId);
          }
          return;
        }

        if (connection.connectionState === 'disconnected') {
          if (disconnectTimeoutByPeerRef.current.has(peerUserId)) {
            return;
          }
          const timeoutId = window.setTimeout(() => {
            disconnectTimeoutByPeerRef.current.delete(peerUserId);
            const activeChannelId = activeVoiceChannelIdRef.current;
            if (!activeChannelId) {
              closePeerConnection(peerUserId);
              return;
            }
            sendVoiceSignalRef.current(activeChannelId, peerUserId, { kind: 'renegotiate' } satisfies VoiceSignalData);
            closePeerConnection(peerUserId);
            void createOfferForPeerRef.current(peerUserId, activeChannelId);
          }, 3500);
          disconnectTimeoutByPeerRef.current.set(peerUserId, timeoutId);
        }
      };

      peerConnectionsRef.current.set(peerUserId, connection);
      return connection;
    },
    [
      applyAudioBitrateToConnection,
      applyVideoBitrateToConnection,
      closePeerConnection,
      getLocalVoiceStream,
      activeVoiceBitrateKbps,
      activeStreamBitrateKbps,
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

      const signal = payload.data;
      if (signal.kind === 'video-source') {
        remoteVideoSourceByPeerRef.current.set(payload.fromUserId, signal.source);
        setRemoteAdvertisedVideoSourceByPeer((prev) => ({
          ...prev,
          [payload.fromUserId]: signal.source,
        }));
        if (signal.source === 'screen' || signal.source === 'camera') {
          const stream = remoteVideoStreamByPeerRef.current.get(payload.fromUserId);
          if (stream) {
            setRemoteScreenShares((prev) => ({
              ...prev,
              [payload.fromUserId]: stream,
            }));
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
        const localUserId = auth.user.id;
        if (!shouldInitiateOffer(localUserId, payload.fromUserId)) {
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
      const localUserId = auth.user.id;

      if (signal.kind === 'offer') {
        if (shouldInitiateOffer(localUserId, payload.fromUserId)) {
          // Deterministic initiator should not receive offers in steady state.
          return;
        }

        if (connection.signalingState === 'have-local-offer') {
          try {
            await connection.setLocalDescription({ type: 'rollback' });
          } catch {
            pendingVideoRenegotiationByPeerRef.current.add(payload.fromUserId);
            return;
          }
        } else if (connection.signalingState !== 'stable') {
          return;
        }

        try {
          await connection.setRemoteDescription(signal.sdp);
        } catch (err) {
          trackTelemetryError('voice_signal_offer_remote_description_failed', err, {
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
        await flushPendingIceCandidates(payload.fromUserId, connection);
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        sendVoiceSignalRef.current(payload.channelId, payload.fromUserId, {
          kind: 'answer',
          sdp: answer,
        } satisfies VoiceSignalData);
        return;
      }

      if (!shouldInitiateOffer(localUserId, payload.fromUserId)) {
        return;
      }

      if (connection.signalingState !== 'have-local-offer') {
        return;
      }

      try {
        await connection.setRemoteDescription(signal.sdp);
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
      await flushPendingIceCandidates(payload.fromUserId, connection);
    },
    [auth.user, closePeerConnection, ensurePeerConnection, flushPendingIceCandidates],
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
          queue.splice(0, queue.length - 300);
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
        incrementHiddenUnread();
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
        incrementHiddenUnread();
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
  });

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
    sendVoiceSignalRef.current = ws.sendVoiceSignal;
  }, [ws.sendVoiceSignal]);

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
      } catch {
        if (!disposed) {
          setVoiceIceConfig(createDefaultVoiceIceConfig());
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

  useEffect(() => {
    if (!ws.connected || !activeVoiceChannelId || !auth.user) {
      teardownVoiceTransport();
      return;
    }

    const participants = voiceParticipantsByChannel[activeVoiceChannelId] ?? [];
    const selfInChannel = participants.some((participant) => participant.userId === auth.user?.id);
    if (!selfInChannel) {
      teardownVoiceTransport();
      return;
    }

    const transportEpoch = ++voiceTransportEpochRef.current;
    let cancelled = false;
    const syncVoiceTransport = async () => {
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

      if (cancelled || voiceTransportEpochRef.current !== transportEpoch) {
        return;
      }

      const desiredPeerUserIds = new Set(
        participants
          .map((participant) => participant.userId)
          .filter((userId) => userId !== auth.user?.id),
      );

      for (const existingPeerUserId of Array.from(peerConnectionsRef.current.keys())) {
        if (!desiredPeerUserIds.has(existingPeerUserId)) {
          closePeerConnection(existingPeerUserId);
        }
      }

      const sortedPeerUserIds = Array.from(desiredPeerUserIds).sort();
      for (const peerUserId of sortedPeerUserIds) {
        try {
          if (cancelled || voiceTransportEpochRef.current !== transportEpoch) {
            return;
          }
          await ensurePeerConnection(peerUserId, activeVoiceChannelId);
          await createOfferForPeer(peerUserId, activeVoiceChannelId);
        } catch {
          // Best effort: peer transport can recover on next state update.
        }
      }
    };

    void syncVoiceTransport();
    return () => {
      cancelled = true;
    };
  }, [
    ws.connected,
    activeVoiceChannelId,
    auth.user,
    voiceParticipantsByChannel,
    teardownVoiceTransport,
    getLocalVoiceStream,
    closePeerConnection,
    ensurePeerConnection,
    createOfferForPeer,
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
      void applyVideoBitrateToConnection(connection, activeStreamBitrateKbps);
    }
  }, [applyVideoBitrateToConnection, activeStreamBitrateKbps]);

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

  useRemoteSpeakingActivity({
    enabled: preferences.showVoiceActivity,
    sensitivity: preferences.voiceInputSensitivity,
    currentUserId: auth.user?.id,
    remoteAudioUsers: viewedRemoteAudioUsers,
    setSpeakingUserIds,
  });

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

      if (!renegotiatePeers || !activeVoiceChannelIdRef.current) {
        return;
      }
      for (const peerUserId of peerConnectionsRef.current.keys()) {
        void createOfferForPeer(peerUserId, activeVoiceChannelIdRef.current);
      }
    },
    [createOfferForPeer],
  );

  const toggleVideoShare = useCallback(
    async (source: StreamSource) => {
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

          void applyVideoBitrateToConnection(connection, activeStreamBitrateKbps);
          sendVoiceSignalRef.current(currentVoiceChannelId, peerUserId, {
            kind: 'video-source',
            source,
          } satisfies VoiceSignalData);
          void createOfferForPeer(peerUserId, currentVoiceChannelId);
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
      activeStreamBitrateKbps,
      createOfferForPeer,
      getOrCreateVideoSender,
    ],
  );

  const handleStreamQualityChange = useCallback(
    (value: string) => {
      if (!isValidStreamQualityLabel(value)) {
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
        const joinMuted = preferences.autoMuteOnJoin || isSelfDeafened;
        if (isSelfMuted !== joinMuted) {
          setIsSelfMuted(joinMuted);
        }
        // Pre-warm voice capture on the user gesture path so browser audio contexts can unlock.
        void getLocalVoiceStream().catch(() => {
          // Join flow still continues; sync phase will surface actionable errors.
        });
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
  }, [enumerateAudioInputDevices, refreshMicrophonePermission]);

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
  const setPresenceState = (nextState: string) => {
    const normalizedState = setPresenceStateLocal(nextState);
    if (!normalizedState) {
      return;
    }
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
                Voice {activeVoiceBitrateKbps} kbps • Stream {activeStreamBitrateKbps} kbps • {activeRemoteAudioUsers.length} remote stream(s)
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
        onSendFriendRequest={async (username) => {
          await sendFriendRequest(username);
        }}
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




