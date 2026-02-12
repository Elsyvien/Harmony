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
  mergeMessages,
  mergeServerWithLocal,
  messageSignature,
  reconcileIncomingMessage,
  useMessageLifecycleFeature,
  type ReplyTarget,
} from './chat/hooks/use-message-lifecycle-feature';
import { upsertChannel, useProfileDmFeature } from './chat/hooks/use-profile-dm-feature';
import { useReactionsFeature } from './chat/hooks/use-reactions-feature';
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
  return Math.max(0, value);
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
  | { kind: 'ice'; candidate: RTCIceCandidateInit };

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
  return false;
}

function isPolitePeer(localUserId: string, remoteUserId: string) {
  return localUserId > remoteUserId;
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
  const [showDetailedVoiceStats, setShowDetailedVoiceStats] = useState(false);
  const [voiceConnectionStats, setVoiceConnectionStats] = useState<VoiceDetailedConnectionStats[]>([]);
  const [voiceStatsUpdatedAt, setVoiceStatsUpdatedAt] = useState<number | null>(null);
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
  const pendingSignaturesRef = useRef(new Set<string>());
  const pendingTimeoutsRef = useRef(new Map<string, number>());
  const muteStateBeforeDeafenRef = useRef<boolean | null>(null);
  const localVoiceStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const localAnalyserContextRef = useRef<AudioContext | null>(null);
  const localAnalyserSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const remoteAudioContextRef = useRef<AudioContext | null>(null);
  const remoteAudioSourceByUserRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const remoteAudioGainByUserRef = useRef<Map<string, GainNode>>(new Map());
  const remoteAudioStreamByUserRef = useRef<Map<string, MediaStream>>(new Map());
  const localVoiceInputDeviceIdRef = useRef<string | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const videoSenderByPeerRef = useRef<Map<string, RTCRtpSender>>(new Map());
  const pendingVideoRenegotiationByPeerRef = useRef<Set<string>>(new Set());
  const makingOfferByPeerRef = useRef<Map<string, boolean>>(new Map());
  const ignoreOfferByPeerRef = useRef<Map<string, boolean>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const previousRtpSnapshotsRef = useRef<Map<string, { bytes: number; timestamp: number }>>(new Map());
  const voiceParticipantIdsByChannelRef = useRef<Map<string, Set<string>>>(new Map());
  const activeVoiceChannelIdRef = useRef<string | null>(null);
  const sendVoiceSignalRef = useRef((() => false) as (channelId: string, targetUserId: string, data: unknown) => boolean);
  const createOfferForPeerRef = useRef((() => Promise.resolve()) as (peerUserId: string, channelId: string) => Promise<void>);
  const leaveVoiceRef = useRef((() => false) as (channelId?: string) => boolean);
  const messageSearchInputRef = useRef<HTMLInputElement | null>(null);

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
    pendingIceRef.current.delete(peerUserId);
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
    for (const peerUserId of peerConnectionsRef.current.keys()) {
      closePeerConnection(peerUserId);
    }
    peerConnectionsRef.current.clear();
    videoSenderByPeerRef.current.clear();
    pendingVideoRenegotiationByPeerRef.current.clear();
    makingOfferByPeerRef.current.clear();
    ignoreOfferByPeerRef.current.clear();
    pendingIceRef.current.clear();
    if (localVoiceStreamRef.current) {
      for (const track of localVoiceStreamRef.current.getTracks()) {
        track.stop();
      }
      localVoiceStreamRef.current = null;
      localVoiceInputDeviceIdRef.current = null;
    }
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
    for (const userId of remoteAudioSourceByUserRef.current.keys()) {
      const source = remoteAudioSourceByUserRef.current.get(userId);
      if (source) {
        source.disconnect();
      }
      const gain = remoteAudioGainByUserRef.current.get(userId);
      if (gain) {
        gain.disconnect();
      }
    }
    remoteAudioSourceByUserRef.current.clear();
    remoteAudioGainByUserRef.current.clear();
    remoteAudioStreamByUserRef.current.clear();
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
    remoteAudioStreamByUserRef.current.delete(userId);
  }, []);

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

  const getLocalVoiceStream = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Voice is not supported in this browser');
    }
    const preferredDeviceId = preferences.voiceInputDeviceId || null;
    let resolvedDeviceId = preferredDeviceId;

    if (
      localVoiceStreamRef.current &&
      localVoiceInputDeviceIdRef.current === preferredDeviceId
    ) {
      applyLocalVoiceTrackState(localVoiceStreamRef.current);
      return localVoiceStreamRef.current;
    }

    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(preferredDeviceId ? { deviceId: { exact: preferredDeviceId } } : {}),
    };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });
    } catch (err) {
      if (!preferredDeviceId) {
        throw err;
      }
      updatePreferences({ voiceInputDeviceId: null });
      resolvedDeviceId = null;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    }

    const nextTrack = stream.getAudioTracks()[0] ?? null;
    if (!nextTrack) {
      throw new Error('No microphone track available');
    }

    const previousStream = localVoiceStreamRef.current;
    localVoiceStreamRef.current = stream;
    localVoiceInputDeviceIdRef.current = resolvedDeviceId;

    if (previousStream) {
      for (const connection of peerConnectionsRef.current.values()) {
        for (const sender of connection.getSenders()) {
          if (sender.track?.kind !== 'audio') {
            continue;
          }
          try {
            await sender.replaceTrack(nextTrack);
          } catch {
            // Ignore replacement errors; next reconnection cycle can recover.
          }
        }
      }
      for (const track of previousStream.getTracks()) {
        track.stop();
      }
    }

    applyLocalVoiceTrackState(stream);
    initLocalAnalyser(stream);
    void refreshMicrophonePermission();
    void enumerateAudioInputDevices();

    setLocalAudioReady(true);
    return stream;
  }, [
    applyLocalVoiceTrackState,
    enumerateAudioInputDevices,
    initLocalAnalyser,
    preferences.voiceInputDeviceId,
    refreshMicrophonePermission,
    updatePreferences,
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
        return existing;
      }

      const stream = await getLocalVoiceStream();
      const connection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });

      for (const track of stream.getTracks()) {
        connection.addTrack(track, stream);
      }
      if (localScreenStreamRef.current) {
        for (const track of localScreenStreamRef.current.getTracks()) {
          const sender = connection.addTrack(track, localScreenStreamRef.current);
          if (track.kind === 'video') {
            videoSenderByPeerRef.current.set(peerUserId, sender);
          }
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

      connection.ontrack = (event) => {
        const streamFromTrack = event.streams[0] ?? new MediaStream([event.track]);
        if (event.track.kind === 'audio') {
          setRemoteAudioStreams((prev) => ({
            ...prev,
            [peerUserId]: streamFromTrack,
          }));
        } else if (event.track.kind === 'video') {
          const setRemoteVideoVisible = () => {
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
          event.track.onended = clearRemoteVideo;
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
        if (
          connection.connectionState === 'closed' ||
          connection.connectionState === 'failed'
        ) {
          closePeerConnection(peerUserId);
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
    ],
  );

  const createOfferForPeer = useCallback(
    async (peerUserId: string, channelId: string) => {
      if (!auth.user) {
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
        const offer = await connection.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
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

  const handleVoiceSignal = useCallback(
    async (payload: { channelId: string; fromUserId: string; data: unknown }) => {
      if (!auth.user || payload.fromUserId === auth.user.id) {
        return;
      }
      if (!activeVoiceChannelIdRef.current || activeVoiceChannelIdRef.current !== payload.channelId) {
        return;
      }
      if (!isVoiceSignalData(payload.data)) {
        return;
      }

      const signal = payload.data;
      if (signal.kind === 'ice') {
        if (ignoreOfferByPeerRef.current.get(payload.fromUserId)) {
          return;
        }
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
        const offerCollision =
          makingOfferByPeerRef.current.get(payload.fromUserId) === true ||
          connection.signalingState !== 'stable';
        const polite = isPolitePeer(auth.user.id, payload.fromUserId);

        if (!polite && offerCollision) {
          ignoreOfferByPeerRef.current.set(payload.fromUserId, true);
          return;
        }

        ignoreOfferByPeerRef.current.set(payload.fromUserId, false);

        if (offerCollision && connection.signalingState === 'have-local-offer') {
          try {
            await connection.setLocalDescription({ type: 'rollback' });
          } catch {
            pendingVideoRenegotiationByPeerRef.current.add(payload.fromUserId);
            return;
          }
        }
        await connection.setRemoteDescription(signal.sdp);
        await flushPendingIceCandidates(payload.fromUserId, connection);
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        sendVoiceSignalRef.current(payload.channelId, payload.fromUserId, {
          kind: 'answer',
          sdp: answer,
        } satisfies VoiceSignalData);
        return;
      }

      if (
        ignoreOfferByPeerRef.current.get(payload.fromUserId) ||
        connection.signalingState !== 'have-local-offer'
      ) {
        return;
      }

      await connection.setRemoteDescription(signal.sdp);
      await flushPendingIceCandidates(payload.fromUserId, connection);
    },
    [auth.user, ensurePeerConnection, flushPendingIceCandidates],
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
    if (!auth.token) {
      setOnlineUsers([]);
      setUnreadChannelCounts({});
      setVoiceParticipantsByChannel({});
      voiceParticipantIdsByChannelRef.current.clear();
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

    let cancelled = false;
    const syncVoiceTransport = async () => {
      try {
        await getLocalVoiceStream();
      } catch (err) {
        if (!cancelled) {
          leaveVoiceRef.current(activeVoiceChannelId);
          setError(getErrorMessage(err, 'Could not access microphone for voice channel'));
          setActiveVoiceChannelId(null);
        }
        return;
      }

      if (cancelled) {
        return;
      }

      const peerUserIds = participants
        .map((participant) => participant.userId)
        .filter((userId) => userId !== auth.user?.id);

      for (const existingPeerUserId of Array.from(peerConnectionsRef.current.keys())) {
        if (!peerUserIds.includes(existingPeerUserId)) {
          closePeerConnection(existingPeerUserId);
        }
      }

      for (const peerUserId of peerUserIds) {
        try {
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
    if (!preferences.showVoiceActivity) {
      setSpeakingUserIds((prev) => prev.filter((id) => id === auth.user?.id));
      return;
    }

    const nextRemoteSpeaking = viewedRemoteAudioUsers
      .filter(({ stream }) => stream.active)
      .map(({ userId }) => userId);

    setSpeakingUserIds((prev) => {
      const localSelf = prev.filter((id) => id === auth.user?.id);
      const merged = [...new Set([...localSelf, ...nextRemoteSpeaking])];
      if (merged.length === prev.length && merged.every((id, index) => id === prev[index])) {
        return prev;
      }
      return merged;
    });
  }, [preferences.showVoiceActivity, viewedRemoteAudioUsers, auth.user?.id]);

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
      for (const [peerUserId, connection] of peerConnectionsRef.current) {
        const sender = videoSenderByPeerRef.current.get(peerUserId);
        if (!sender) {
          continue;
        }
        void sender.replaceTrack(null).catch(() => {
          // Fallback for browsers that fail replaceTrack(null) on live senders.
          try {
            connection.removeTrack(sender);
            videoSenderByPeerRef.current.delete(peerUserId);
            pendingVideoRenegotiationByPeerRef.current.add(peerUserId);
            if (renegotiatePeers && currentVoiceChannelId) {
              void createOfferForPeer(peerUserId, currentVoiceChannelId);
            }
          } catch {
            // Best effort. Connection resync can recover on next state change.
          }
        });
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
      for (const peerUserId of pendingVideoRenegotiationByPeerRef.current) {
        if (!peerConnectionsRef.current.has(peerUserId)) {
          continue;
        }
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
          let shouldRenegotiate = false;
          let sender = videoSenderByPeerRef.current.get(peerUserId) ?? null;

          if (sender && !connection.getSenders().some((candidate) => candidate === sender)) {
            sender = null;
            videoSenderByPeerRef.current.delete(peerUserId);
          }

          if (!sender) {
            sender =
              connection.getSenders().find((candidate) => candidate.track?.kind === 'video') ?? null;
            if (sender) {
              videoSenderByPeerRef.current.set(peerUserId, sender);
            }
          }

          if (sender) {
            try {
              await sender.replaceTrack(videoTrack);
            } catch {
              try {
                connection.removeTrack(sender);
              } catch {
                // Ignore; addTrack below will recover if sender is already detached.
              }
              videoSenderByPeerRef.current.delete(peerUserId);
              pendingVideoRenegotiationByPeerRef.current.add(peerUserId);
              sender = connection.addTrack(videoTrack, stream);
              videoSenderByPeerRef.current.set(peerUserId, sender);
              shouldRenegotiate = true;
            }
          } else {
            sender = connection.addTrack(videoTrack, stream);
            videoSenderByPeerRef.current.set(peerUserId, sender);
            shouldRenegotiate = true;
          }

          void applyVideoBitrateToConnection(connection, activeStreamBitrateKbps);
          if (shouldRenegotiate) {
            void createOfferForPeer(peerUserId, currentVoiceChannelId);
          }
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
      setVoiceBusyChannelId(channelId);
      try {
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
        setActiveVoiceChannelId(channelId);
        playVoiceStateSound('join');
        setError(null);
      } catch {
        setError('Could not join voice channel');
      } finally {
        setVoiceBusyChannelId(null);
      }
    },
    [auth.token, ws, activeVoiceChannelId, playVoiceStateSound, isSelfMuted, isSelfDeafened, preferences.autoMuteOnJoin],
  );

  const leaveVoiceChannel = useCallback(
    async () => {
      if (!activeVoiceChannelId) {
        return;
      }
      const leavingChannelId = activeVoiceChannelId;
      setVoiceBusyChannelId(leavingChannelId);
      ws.leaveVoice(leavingChannelId);
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
    const activeUserIds = new Set(activeRemoteAudioUsers.map((user) => user.userId));

    for (const userId of remoteAudioSourceByUserRef.current.keys()) {
      if (!activeUserIds.has(userId)) {
        disconnectRemoteAudioForUser(userId);
      }
    }

    if (!activeRemoteAudioUsers.length) {
      return;
    }

    const context = ensureRemoteAudioContext();
    if (!context) {
      return;
    }

    if (context.state === 'suspended') {
      void context.resume().catch(() => {
        // Best effort: browser may still require explicit user interaction.
      });
    }

    for (const user of activeRemoteAudioUsers) {
      const previousStream = remoteAudioStreamByUserRef.current.get(user.userId);
      let gainNode = remoteAudioGainByUserRef.current.get(user.userId) ?? null;

      if (!gainNode || previousStream !== user.stream) {
        disconnectRemoteAudioForUser(user.userId);
        const source = context.createMediaStreamSource(user.stream);
        gainNode = context.createGain();
        source.connect(gainNode);
        gainNode.connect(context.destination);
        remoteAudioSourceByUserRef.current.set(user.userId, source);
        remoteAudioGainByUserRef.current.set(user.userId, gainNode);
        remoteAudioStreamByUserRef.current.set(user.userId, user.stream);
      }

      const localAudio = getUserAudioState(user.userId);
      const shouldMute =
        isSelfDeafened ||
        localAudio.muted ||
        preferences.voiceOutputVolume <= 0 ||
        localAudio.volume <= 0;
      const effectiveVolume =
        shouldMute
          ? 0
          : (preferences.voiceOutputVolume / 100) * (localAudio.volume / 100);

      gainNode.gain.value = clampMediaElementVolume(effectiveVolume);
    }
  }, [
    activeRemoteAudioUsers,
    disconnectRemoteAudioForUser,
    ensureRemoteAudioContext,
    getUserAudioState,
    isSelfDeafened,
    preferences.voiceOutputVolume,
  ]);

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

      <div className="voice-audio-sinks" aria-hidden="true" />

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
