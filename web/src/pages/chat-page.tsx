import { Navigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { chatApi } from '../api/chat-api';
import { UserProfile } from '../components/user-profile';

import { ChatPageShell } from './chat/components/chat-page-shell';
import { useChatSocket } from '../hooks/use-chat-socket';
import type { PresenceUser, RealtimeErrorPayload, VoiceParticipant } from '../hooks/use-chat-socket';
import { useUserPreferences } from '../hooks/use-user-preferences';
import {
  applyReceiptProgress,
  messageSignature,
  reconcileIncomingMessage,
  useMessageLifecycleFeature,
  type ReplyTarget,
} from './chat/hooks/use-message-lifecycle-feature';
import { useChannelMessageLoader } from './chat/hooks/use-channel-message-loader';
import { upsertChannel, useProfileDmFeature } from './chat/hooks/use-profile-dm-feature';
import { useReactionsFeature } from './chat/hooks/use-reactions-feature';
import { useRemoteSpeakingActivity } from './chat/hooks/use-remote-speaking-activity';
import { useAdminFeature } from './chat/hooks/use-admin-feature';
import { useFriendsFeature } from './chat/hooks/use-friends-feature';
import { useChatPresenceFeature } from './chat/hooks/use-chat-presence-feature';
import { useChannelManagementFeature } from './chat/hooks/use-channel-management-feature';
import { useChatPageEffects } from './chat/hooks/use-chat-page-effects';
import type { VoiceSfuClientLike } from './chat/voice-sfu-client';
import { usePeerConnectionManager } from './chat/hooks/use-peer-connection-manager';
import { useVoiceTransport } from './chat/hooks/use-voice-transport';
import { useVoiceSignaling } from './chat/hooks/use-voice-signaling';
import { type VoiceSignalData } from './chat/utils/voice-signaling';
import { useVoiceChannel } from './chat/hooks/use-voice-channel';
import { useVoiceFeature } from './chat/hooks/use-voice-feature';
import { useAuth } from '../store/auth-store';
import type {
  Channel,
  ModerationActionSummary,
  Message,
  ServerAnalytics,
  ServerAuditLog,
  ServerInviteSummary,
  ServerMemberSummary,
  ServerSummary,
} from '../types/api';
import { getErrorMessage } from '../utils/error-message';
import { trackTelemetry } from '../utils/telemetry';
import {
  filterChannelsForScope,
  findServerByScope,
  isChannelVisibleInScope,
  isServerManagerRole,
  pickFallbackChannelId,
  type RailScope,
} from './chat/utils/server-scope';

type MainView = 'chat' | 'friends' | 'settings' | 'admin' | 'server';
type MobilePane = 'none' | 'channels' | 'users';
type StreamSource = 'screen' | 'camera';
type VoiceReconnectIntent = {
  channelId: string;
  muted: boolean;
  deafened: boolean;
};

function clampMediaElementVolume(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1, Math.max(0, value));
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
      urls,
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
  const { preferences, updatePreferences, resetPreferences, applyVoiceDefaults } = useUserPreferences();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [railScope, setRailScope] = useState<RailScope>({ kind: 'home' });
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageQuery, setMessageQuery] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<MainView>('chat');
  const [mobilePane, setMobilePane] = useState<MobilePane>('none');
  const [unreadChannelCounts, setUnreadChannelCounts] = useState<Record<string, number>>({});
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const [voiceParticipantsByChannel, setVoiceParticipantsByChannel] = useState<
    Record<string, VoiceParticipant[]>
  >({});
  const [activeVoiceChannelId, setActiveVoiceChannelId] = useState<string | null>(null);
  const [voiceBusyChannelId, setVoiceBusyChannelId] = useState<string | null>(null);
  const [localStreamSource, setLocalStreamSource] = useState<StreamSource | null>(null);
  const [voiceIceConfig, setVoiceIceConfig] = useState<RTCConfiguration>(() =>
    createDefaultVoiceIceConfig(),
  );
  const [voiceSfuEnabled, setVoiceSfuEnabled] = useState(false);
  const [voiceSfuProvider, setVoiceSfuProvider] = useState<'mediasoup' | 'cloudflare'>('mediasoup');
  const voiceSfuClientRef = useRef<VoiceSfuClientLike | null>(null);
  const [creatingServer, setCreatingServer] = useState(false);
  const [joiningServer, setJoiningServer] = useState(false);
  const [serverPanelLoading, setServerPanelLoading] = useState(false);
  const [serverPanelError, setServerPanelError] = useState<string | null>(null);
  const [serverInvites, setServerInvites] = useState<ServerInviteSummary[]>([]);
  const [serverAnalytics, setServerAnalytics] = useState<ServerAnalytics | null>(null);
  const [serverAuditLogs, setServerAuditLogs] = useState<ServerAuditLog[]>([]);
  const [serverMembers, setServerMembers] = useState<ServerMemberSummary[]>([]);
  const [serverModerationActions, setServerModerationActions] = useState<ModerationActionSummary[]>([]);
  const [serverInviteBusy, setServerInviteBusy] = useState(false);
  const [serverModerationBusy, setServerModerationBusy] = useState(false);

  const [composerInsertRequest, setComposerInsertRequest] = useState<{
    key: number;
    text: string;
  } | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
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
    adminAnalyticsOverview,
    adminAnalyticsTimeseries,
    loadingAdminAnalytics,
    adminAnalyticsError,
    updatingAdminUserId,
    deletingAdminUserId,
    clearingAdminUsers,
    loadAdminStats,
    loadAdminSettings,
    saveAdminSettings,
    loadAdminUsers,
    loadAdminAnalytics,
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
  const {
    currentPresenceState,
    setPresenceStateLocal,
    incrementHiddenUnread,
  } = useChatPresenceFeature({
    currentUserId: auth.user?.id ?? null,
    onlineUsers,
    setOnlineUsers,
  });
  const previousIncomingRequestCountRef = useRef<number | null>(null);
  const lastReadMessageIdByChannelRef = useRef(new Map<string, string>());
  const markReadInFlightByChannelRef = useRef(new Set<string>());
  const pendingSignaturesRef = useRef(new Set<string>());
  const pendingTimeoutsRef = useRef(new Map<string, number>());
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const activeVoiceChannelIdRef = useRef<string | null>(null);
  const voiceBusyChannelIdRef = useRef<string | null>(null);
  const getLocalVoiceStreamRef = useRef((() => Promise.reject(new Error('Voice stream not ready'))) as () => Promise<MediaStream>);
  const disconnectRemoteAudioForUserRef = useRef((() => undefined) as (userId: string) => void);
  const voiceDebugEnabledRef = useRef(false);
  const sendVoiceSignalRef = useRef((() => false) as (channelId: string, targetUserId: string, data: unknown) => boolean);
  const reconnectVoiceIntentRef = useRef<VoiceReconnectIntent | null>(null);
  const resetVoiceSignalingStateRef = useRef<(() => void) | null>(null);
  const applyRemoteAudioStreamUpdateRef = useRef((() => undefined) as (userId: string, stream: MediaStream | null) => void);
  const applyRemoteScreenShareUpdateRef = useRef((() => undefined) as (userId: string, stream: MediaStream | null) => void);
  const applyRemoteVideoSourceUpdateRef = useRef((() => undefined) as (userId: string, source: 'screen' | 'camera' | null) => void);
  const setRemoteScreenSharesStateRef = useRef((() => undefined) as (updater: any) => void);
  const setRemoteAdvertisedVideoSourceStateRef = useRef((() => undefined) as (updater: any) => void);
  const messageSearchInputRef = useRef<HTMLInputElement | null>(null);
  const lastTrackedOpenedChannelRef = useRef<string | null>(null);
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

  const selectedServer = useMemo(() => findServerByScope(servers, railScope), [servers, railScope]);
  const selectedServerId = selectedServer?.id ?? null;
  const scopedChannels = useMemo(() => filterChannelsForScope(channels, railScope), [channels, railScope]);
  const canManageSelectedServer = useMemo(
    () => isServerManagerRole(selectedServer?.memberRole),
    [selectedServer?.memberRole],
  );
  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [channels, activeChannelId],
  );

  useEffect(() => {
    if (activeView !== 'chat') {
      lastTrackedOpenedChannelRef.current = null;
      return;
    }
    if (!activeChannel) {
      return;
    }
    if (lastTrackedOpenedChannelRef.current === activeChannel.id) {
      return;
    }
    lastTrackedOpenedChannelRef.current = activeChannel.id;
    trackTelemetry({
      name: 'channel.opened.succeeded',
      success: true,
      context: {
        channelId: activeChannel.id,
        channelType: activeChannel.isVoice ? 'voice' : activeChannel.isDirect ? 'direct' : 'text',
        isDirect: activeChannel.isDirect,
      },
    });
  }, [activeView, activeChannel]);

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

  const subscribedChannelIds = useMemo(() => channels.map((channel) => channel.id), [channels]);

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

  const sendVoiceSignal = useCallback(
    (channelId: string, targetUserId: string, data: VoiceSignalData) =>
      sendVoiceSignalRef.current(channelId, targetUserId, data),
    [],
  );

  const activeVoiceChannelForTransport = useMemo(
    () => channels.find((channel) => channel.id === activeVoiceChannelId) ?? null,
    [channels, activeVoiceChannelId],
  );
  const activeVoiceBitrateKbpsForTransport = activeVoiceChannelForTransport?.voiceBitrateKbps ?? 64;
  const activeStreamBitrateKbpsForTransport =
    activeVoiceChannelForTransport?.streamBitrateKbps ?? 2500;

  // Stable callbacks for usePeerConnectionManager — must not change reference on every render
  // or they will cause ensurePeerConnection to be recreated and syncVoiceTransport to re-run
  // constantly, creating an offer/answer loop that prevents connections from establishing.
  const onRemoteAudioStreamStable = useCallback((peerUserId: string, stream: MediaStream | null) => {
    applyRemoteAudioStreamUpdateRef.current(peerUserId, stream);
  }, []);

  const onRemoteScreenShareStreamStable = useCallback((peerUserId: string, stream: MediaStream | null) => {
    applyRemoteScreenShareUpdateRef.current(peerUserId, stream);
  }, []);

  const onRemoteAdvertisedVideoSourceStable = useCallback((peerUserId: string, source: 'screen' | 'camera' | null) => {
    applyRemoteVideoSourceUpdateRef.current(peerUserId, source);
  }, []);

  const onDisconnectRemoteAudioStable = useCallback((peerUserId: string) => {
    disconnectRemoteAudioForUserRef.current(peerUserId);
  }, []);

  const onConnectionFailureWithoutTurnStable = useCallback(() => {
    setError('Voice P2P connection failed (no TURN configured). This usually happens on strict/mobile/company NAT networks.');
  }, [setError]);

  const {
    peerConnectionsRef,
    videoSenderByPeerRef,
    pendingVideoRenegotiationByPeerRef,
    remoteVideoSourceByPeerRef,
    remoteVideoStreamByPeerRef,
    pendingIceRef,
    flushPendingIceCandidates,
    closePeerConnection,
    ensurePeerConnection,
    createOfferForPeer,
    sendRequestOffer,
    replaceAudioTrackAcrossPeers,
    applyVideoBitrateToConnection,
    applyAudioBitrateToAllConnections,
    applyVideoBitrateToAllConnections,
    getOrCreateVideoSender,
    clearPeerConnections,
  } = usePeerConnectionManager({
    authUserId: auth.user?.id ?? null,
    activeVoiceBitrateKbps: activeVoiceBitrateKbpsForTransport,
    activeStreamBitrateKbps: activeStreamBitrateKbpsForTransport,
    voiceIceConfig,
    hasTurnRelayConfigured,
    localStreamSource,
    localScreenStreamRef,
    activeVoiceChannelIdRef,
    getLocalVoiceStream: () => getLocalVoiceStreamRef.current(),
    sendVoiceSignal,
    onRemoteAudioStream: onRemoteAudioStreamStable,
    onRemoteScreenShareStream: onRemoteScreenShareStreamStable,
    onRemoteAdvertisedVideoSource: onRemoteAdvertisedVideoSourceStable,
    onDisconnectRemoteAudio: onDisconnectRemoteAudioStable,
    onConnectionFailureWithoutTurn: onConnectionFailureWithoutTurnStable,
    logVoiceDebug,
  });

  const {
    localAudioReady,
    isSelfMuted,
    isSelfDeafened,
    setIsSelfMuted,
    localVoiceStreamRef,
    localVoiceProcessedStreamRef,
    localAnalyserRef,
    audioInputDevices,
    microphonePermission,
    requestingMicrophonePermission,
    requestMicrophonePermission,
    applyLocalVoiceTrackState,
    toggleSelfMute,
    toggleSelfDeafen,
    getLocalVoiceStream,
    teardownLocalVoiceMedia,
  } = useVoiceTransport({
    preferences,
    updatePreferences,
    setError,
    setNotice,
    replaceAudioTrackAcrossPeers,
  });

  const getCurrentOutgoingVoiceTrack = useCallback(() => {
    const processedTrack = localVoiceProcessedStreamRef.current?.getAudioTracks()[0] ?? null;
    if (processedTrack && processedTrack.readyState === 'live') {
      return processedTrack;
    }
    return localVoiceStreamRef.current?.getAudioTracks()[0] ?? null;
  }, [localVoiceProcessedStreamRef, localVoiceStreamRef]);

  const {
    handleVoiceSignal,
    handleVoiceState,
    resetVoiceSignalingState,
  } = useVoiceSignaling({
    authUser: auth.user ? { id: auth.user.id } : null,
    activeVoiceChannelIdRef,
    voiceBusyChannelIdRef,
    voiceBusyChannelId,
    playVoiceStateSound,
    closePeerConnection,
    ensurePeerConnection,
    flushPendingIceCandidates,
    createOfferForPeer,
    sendVoiceSignal,
    peerConnectionsRef,
    voiceSfuClientRef,
    pendingIceRef,
    pendingVideoRenegotiationByPeerRef,
    remoteVideoSourceByPeerRef,
    remoteVideoStreamByPeerRef,
    setRemoteAdvertisedVideoSourceByPeer: (updater) =>
      setRemoteAdvertisedVideoSourceStateRef.current(updater),
    setRemoteScreenShares: (updater) => setRemoteScreenSharesStateRef.current(updater),
    setVoiceParticipantsByChannel,
    setActiveVoiceChannelId,
    setVoiceBusyChannelId,
    logVoiceDebug,
  });

  const applyMessageReceipt = useCallback(
    (payload: { channelId: string; userId: string; upToMessageId: string }, kind: 'delivered' | 'read') => {
      setMessages((prev) => applyReceiptProgress(prev, payload, kind));
    },
    [],
  );

  const markChannelAsReadUpTo = useCallback(
    async (channelId: string, upToMessageId: string) => {
      if (!auth.token || !auth.user || activeView !== 'chat') {
        return;
      }
      const lastMarkedMessageId = lastReadMessageIdByChannelRef.current.get(channelId);
      if (lastMarkedMessageId === upToMessageId) {
        return;
      }
      if (markReadInFlightByChannelRef.current.has(channelId)) {
        return;
      }
      markReadInFlightByChannelRef.current.add(channelId);

      try {
        const response = await chatApi.markChannelRead(auth.token, channelId, upToMessageId);
        const confirmedUpToMessageId = response.receipt.upToMessageId;
        if (!confirmedUpToMessageId) {
          return;
        }
        lastReadMessageIdByChannelRef.current.set(channelId, confirmedUpToMessageId);
        setMessages((prev) =>
          applyReceiptProgress(
            prev,
            {
              channelId,
              userId: response.receipt.userId,
              upToMessageId: confirmedUpToMessageId,
            },
            'read',
          ),
        );
      } catch {
        // Ignore read-receipt failures and retry on next state change.
      } finally {
        markReadInFlightByChannelRef.current.delete(channelId);
      }
    },
    [auth.token, auth.user, activeView],
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
        const hadPending = hasPendingSignature(signature);
        clearPendingSignature(signature);
        if (message.userId === auth.user.id && hadPending) {
          trackTelemetry({
            name: 'message.send.acked',
            success: true,
            statusCode: 200,
            context: {
              channelId: message.channelId,
              transport: 'ws',
              hasAttachment: Boolean(message.attachment),
              hasReply: Boolean(message.replyToMessageId),
              statusCode: 200,
            },
          });
        }
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
      setMessages((prev) => {
        const withIncoming = reconcileIncomingMessage(prev, message);
        if (isOwnMessage) {
          return withIncoming;
        }
        // Fallback: if a user can post in the channel, treat previous messages as read by them.
        return applyReceiptProgress(
          withIncoming,
          {
            channelId: message.channelId,
            userId: message.userId,
            upToMessageId: message.id,
          },
          'read',
        );
      });
      if (!isOwnMessage && isViewedChannel && !activeChannel?.isVoice) {
        void markChannelAsReadUpTo(message.channelId, message.id);
      }
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
    onMessageDelivered: (payload) => {
      applyMessageReceipt(payload, 'delivered');
    },
    onMessageRead: (payload) => {
      applyMessageReceipt(payload, 'read');
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
    onVoiceSfuEvent: (payload) => {
      void voiceSfuClientRef.current?.handleSfuEvent(payload);
    },
    onError: (payload: RealtimeErrorPayload) => {
      const code = payload.code ?? 'WS_ERROR';
      const message = payload.message ?? 'Realtime event failed';
      if (code === 'VOICE_SIGNAL_RATE_LIMITED') {
        setNotice(message);
        return;
      }
      if (code.startsWith('VOICE_') || code.startsWith('SFU_')) {
        logVoiceDebug('voice_socket_error', {
          code,
          message,
        });
        setError(message);
      }
    },
  });

  const {
    remoteAudioStreams,
    remoteScreenShares,
    remoteAdvertisedVideoSourceByPeer,
    localScreenShareStream,
    streamQualityLabel,
    speakingUserIds,
    showDetailedVoiceStats,
    voiceConnectionStats,
    voiceStatsUpdatedAt,
    streamStatusBanner,
    activeRemoteAudioUsers,
    leaveVoiceRef: hookLeaveVoiceRef,
    joinVoiceChannel,
    leaveVoiceChannel,
    toggleVideoShare,
    handleStreamQualityChange,
    applyRemoteAudioGain,
    disconnectRemoteAudioForUser,
    setShowDetailedVoiceStats,
    setRemoteScreenShares,
    setRemoteAdvertisedVideoSourceByPeer,
    setSpeakingUserIds,
    setRemoteAudioStreams,
  } = useVoiceChannel({
    authUserId: auth.user?.id,
    authToken: auth.token,
    wsConnected: ws.connected,
    voiceSfuEnabled,
    voiceSfuProvider,
    voiceIceConfig,
    activeVoiceChannelId,
    voiceBusyChannelId,
    voiceParticipantsByChannel,
    isSelfMuted,
    isSelfDeafened,
    localAudioReady,
    preferences: {
      showVoiceActivity: preferences.showVoiceActivity,
      voiceInputSensitivity: preferences.voiceInputSensitivity,
      voiceOutputVolume: preferences.voiceOutputVolume,
    },
    localStreamSource,
    setLocalStreamSource,
    localVoiceStreamRef,
    localAnalyserRef,
    getLocalVoiceStream,
    getCurrentOutgoingVoiceTrack,
    teardownLocalVoiceMedia,
    applyLocalVoiceTrackState,
    peerConnectionsRef,
    videoSenderByPeerRef,
    pendingVideoRenegotiationByPeerRef,
    remoteVideoSourceByPeerRef,
    remoteVideoStreamByPeerRef,
    closePeerConnection,
    ensurePeerConnection,
    createOfferForPeer,
    sendRequestOffer,
    clearPeerConnections,
    getOrCreateVideoSender,
    applyVideoBitrateToConnection,
    applyAudioBitrateToAllConnections,
    applyVideoBitrateToAllConnections,
    activeStreamBitrateKbps: activeStreamBitrateKbpsForTransport,
    requestVoiceSfu: ws.requestVoiceSfu,
    joinVoiceWithAck: ws.joinVoiceWithAck,
    leaveVoice: ws.leaveVoice,
    sendVoiceSignal: ws.sendVoiceSignal,
    setError,
    setActiveVoiceChannelId,
    setVoiceBusyChannelId,
    setIsSelfMuted,
    channels,
    resetVoiceSignalingStateRef,
    playVoiceStateSound,
    logVoiceDebug,
    onRemoteAudioStreamStable,
    onRemoteScreenShareStreamStable,
    onRemoteAdvertisedVideoSourceStable,
    autoMuteOnJoin: preferences.autoMuteOnJoin,
    voiceSfuClientRef,
    localScreenStreamRef,
    activeVoiceChannelIdRef,
    voiceBusyChannelIdRef,
    reconnectVoiceIntentRef,
  });

  const {
    activeVoiceChannel,
    activeVoiceBitrateKbps,
    activeStreamBitrateKbps,
    voiceParticipantCounts,
    activeVoiceParticipants,
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

  const {
    deletingChannelId,
    savingVoiceSettingsChannelId,
    createChannel,
    updateVoiceChannelSettings,
    uploadAttachment,
    deleteChannel,
  } = useChannelManagementFeature({
    authToken: auth.token,
    canManageChannels: canManageSelectedServer,
    canEditVoiceSettings: canManageSelectedServer,
    activeChannelId,
    activeVoiceChannelId,
    leaveVoice: (channelId) => hookLeaveVoiceRef.current(channelId),
    setChannels,
    setActiveChannelId,
    setActiveView,
    setVoiceParticipantsByChannel,
    setUnreadChannelCounts,
    setActiveVoiceChannelId,
    setError,
  });

  const mergeChannels = useCallback((incoming: Channel[]) => {
    setChannels((prev) => {
      const byId = new Map(prev.map((channel) => [channel.id, channel]));
      for (const channel of incoming) {
        byId.set(channel.id, channel);
      }
      return [...byId.values()].sort(
        (left, right) =>
          new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
      );
    });
  }, []);

  const selectHomeScope = useCallback(() => {
    setRailScope({ kind: 'home' });
    setActiveView('chat');
    setMobilePane('none');
  }, []);

  const selectServerScope = useCallback((serverId: string) => {
    setRailScope({ kind: 'server', serverId });
    setActiveView('chat');
    setMobilePane('none');
  }, []);

  const createScopedChannel = useCallback(
    async (name: string, type: 'TEXT' | 'VOICE') => {
      if (!selectedServerId) {
        setError('Select a server first');
        return;
      }
      await createChannel(name, type, selectedServerId);
    },
    [createChannel, selectedServerId, setError],
  );

  const createServerFromRail = useCallback(async () => {
    if (!auth.token) {
      return;
    }
    const name = window.prompt('Server name');
    if (!name || !name.trim()) {
      return;
    }
    setCreatingServer(true);
    try {
      const response = await chatApi.createServer(auth.token, { name: name.trim() });
      setServers((prev) => {
        const exists = prev.some((server) => server.id === response.server.id);
        return exists ? prev : [...prev, response.server];
      });
      const channelsResponse = await chatApi.serverChannels(auth.token, response.server.id);
      mergeChannels(channelsResponse.channels);
      setRailScope({ kind: 'server', serverId: response.server.id });
      setActiveView('chat');
      setActiveChannelId(channelsResponse.channels[0]?.id ?? null);
      setNotice(`Server ${response.server.name} created.`);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not create server'));
    } finally {
      setCreatingServer(false);
    }
  }, [auth.token, mergeChannels, setError]);

  const joinServerFromRail = useCallback(async () => {
    if (!auth.token) {
      return;
    }
    const code = window.prompt('Invite code');
    if (!code || !code.trim()) {
      return;
    }
    setJoiningServer(true);
    try {
      const response = await chatApi.joinServerByInvite(auth.token, code.trim());
      setServers((prev) => {
        const exists = prev.some((server) => server.id === response.server.id);
        return exists ? prev : [...prev, response.server];
      });
      const channelsResponse = await chatApi.serverChannels(auth.token, response.server.id);
      mergeChannels(channelsResponse.channels);
      setRailScope({ kind: 'server', serverId: response.server.id });
      setActiveView('chat');
      setActiveChannelId(channelsResponse.channels[0]?.id ?? null);
      setNotice(`Joined ${response.server.name}.`);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not join server'));
    } finally {
      setJoiningServer(false);
    }
  }, [auth.token, mergeChannels, setError]);

  const loadServerManagementData = useCallback(async () => {
    if (!auth.token || !selectedServerId || !canManageSelectedServer) {
      return;
    }
    setServerPanelLoading(true);
    try {
      const [invitesResponse, analyticsResponse, logsResponse, membersResponse] = await Promise.all([
        chatApi.serverInvites(auth.token, selectedServerId),
        chatApi.serverAnalytics(auth.token, selectedServerId),
        chatApi.serverAuditLogs(auth.token, selectedServerId, 50),
        chatApi.serverMembers(auth.token, selectedServerId),
      ]);
      setServerInvites(invitesResponse.invites);
      setServerAnalytics(analyticsResponse.analytics);
      setServerAuditLogs(logsResponse.logs);
      setServerMembers(membersResponse.members);
      setServerPanelError(null);
    } catch (err) {
      setServerPanelError(getErrorMessage(err, 'Could not load server management data'));
    } finally {
      setServerPanelLoading(false);
    }
  }, [auth.token, selectedServerId, canManageSelectedServer]);

  const createServerInvite = useCallback(
    async (input: { maxUses?: number; expiresInHours?: number }) => {
      if (!auth.token || !selectedServerId) {
        return;
      }
      setServerInviteBusy(true);
      try {
        await chatApi.createServerInvite(auth.token, selectedServerId, input);
        await loadServerManagementData();
      } catch (err) {
        setServerPanelError(getErrorMessage(err, 'Could not create invite'));
      } finally {
        setServerInviteBusy(false);
      }
    },
    [auth.token, selectedServerId, loadServerManagementData],
  );

  const revokeServerInvite = useCallback(
    async (inviteId: string) => {
      if (!auth.token || !selectedServerId) {
        return;
      }
      setServerInviteBusy(true);
      try {
        await chatApi.revokeServerInvite(auth.token, selectedServerId, inviteId);
        await loadServerManagementData();
      } catch (err) {
        setServerPanelError(getErrorMessage(err, 'Could not revoke invite'));
      } finally {
        setServerInviteBusy(false);
      }
    },
    [auth.token, selectedServerId, loadServerManagementData],
  );

  const moderateServerMember = useCallback(
    async (input: {
      targetUserId: string;
      type: 'WARN' | 'TIMEOUT' | 'KICK' | 'BAN' | 'UNBAN';
      reason?: string;
      durationHours?: number;
    }) => {
      if (!auth.token || !selectedServerId) {
        return;
      }
      setServerModerationBusy(true);
      try {
        const response = await chatApi.moderateServerUser(auth.token, selectedServerId, input);
        setServerModerationActions((prev) => [response.action, ...prev].slice(0, 25));
        await loadServerManagementData();
      } catch (err) {
        setServerPanelError(getErrorMessage(err, 'Could not submit moderation action'));
      } finally {
        setServerModerationBusy(false);
      }
    },
    [auth.token, selectedServerId, loadServerManagementData],
  );

  useRemoteSpeakingActivity({
    enabled: preferences.showVoiceActivity,
    sensitivity: preferences.voiceInputSensitivity,
    currentUserId: auth.user?.id,
    remoteAudioUsers: viewedRemoteAudioUsers,
    setSpeakingUserIds,
  });

  useChatPageEffects({
    notice,
    setNotice,
    activeView,
    activeChannelId,
    activeChannelIsVoice: Boolean(activeChannel?.isVoice),
    closeAudioContextMenu,
    setReplyTarget,
    setMobilePane,
    setUnreadChannelCounts,
    setMessages,
    setMessageQuery,
    loadMessages,
    authToken: auth.token,
    wsConnected: ws.connected,
    isAdminUser: auth.user?.isAdmin,
    loadAdminStats,
    loadAdminSettings,
    loadAdminUsers,
    loadAdminAnalytics,
    loadFriendData,
    messageSearchInputRef,
  });

  const markActiveChannelAsRead = useCallback(async () => {
    if (!activeChannelId || activeChannel?.isVoice) {
      return;
    }

    const latestPersisted = [...messages]
      .reverse()
      .find((message) => !message.id.startsWith('tmp-'));
    if (!latestPersisted) {
      return;
    }

    await markChannelAsReadUpTo(activeChannelId, latestPersisted.id);
  }, [activeChannelId, activeChannel?.isVoice, messages, markChannelAsReadUpTo]);

  useEffect(() => {
    void markActiveChannelAsRead();
  }, [markActiveChannelAsRead]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        return;
      }
      void markActiveChannelAsRead();
    };
    const handleFocus = () => {
      void markActiveChannelAsRead();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [markActiveChannelAsRead]);

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
    getLocalVoiceStreamRef.current = getLocalVoiceStream;
  }, [getLocalVoiceStream]);

  useEffect(() => {
    resetVoiceSignalingStateRef.current = resetVoiceSignalingState;
  }, [resetVoiceSignalingState]);

  useEffect(() => {
    disconnectRemoteAudioForUserRef.current = disconnectRemoteAudioForUser;
  }, [disconnectRemoteAudioForUser]);

  useEffect(() => {
    applyRemoteAudioStreamUpdateRef.current = (peerUserId, stream) => {
      setRemoteAudioStreams((prev) => {
        if (!stream) {
          if (!prev[peerUserId]) {
            return prev;
          }
          const next = { ...prev };
          delete next[peerUserId];
          return next;
        }
        return { ...prev, [peerUserId]: stream };
      });
    };
  }, [setRemoteAudioStreams]);

  useEffect(() => {
    applyRemoteScreenShareUpdateRef.current = (peerUserId, stream) => {
      setRemoteScreenShares((prev) => {
        if (!stream) {
          if (!prev[peerUserId]) {
            return prev;
          }
          const next = { ...prev };
          delete next[peerUserId];
          return next;
        }
        return { ...prev, [peerUserId]: stream };
      });
    };
  }, [setRemoteScreenShares]);

  useEffect(() => {
    applyRemoteVideoSourceUpdateRef.current = (peerUserId, source) => {
      setRemoteAdvertisedVideoSourceByPeer((prev) => {
        if (source === null) {
          if (!(peerUserId in prev)) {
            return prev;
          }
          const next = { ...prev };
          delete next[peerUserId];
          return next;
        }
        if (prev[peerUserId] === source) {
          return prev;
        }
        return { ...prev, [peerUserId]: source };
      });
    };
  }, [setRemoteAdvertisedVideoSourceByPeer]);

  useEffect(() => {
    setRemoteScreenSharesStateRef.current = setRemoteScreenShares;
  }, [setRemoteScreenShares]);

  useEffect(() => {
    setRemoteAdvertisedVideoSourceStateRef.current = setRemoteAdvertisedVideoSourceByPeer;
  }, [setRemoteAdvertisedVideoSourceByPeer]);

  useEffect(() => {
    if (activeChannel?.isVoice) {
      return;
    }
    setShowDetailedVoiceStats(false);
  }, [activeChannel?.isVoice, setShowDetailedVoiceStats]);

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
    try {
      const enabled = localStorage.getItem('harmony_voice_debug') === '1';
      voiceDebugEnabledRef.current = enabled;
    } catch {
      voiceDebugEnabledRef.current = false;
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    const loadRtcConfig = async () => {
      try {
        const response = await chatApi.rtcConfig();
        if (disposed) {
          return;
        }
        setVoiceIceConfig(normalizeVoiceIceConfig(response.rtc));
        setVoiceSfuEnabled(Boolean(response.sfu?.enabled));
        setVoiceSfuProvider(response.sfu?.provider === 'cloudflare' ? 'cloudflare' : 'mediasoup');
        applyVoiceDefaults({
          voiceNoiseSuppression: response.voiceDefaults?.noiseSuppression,
          voiceEchoCancellation: response.voiceDefaults?.echoCancellation,
          voiceAutoGainControl: response.voiceDefaults?.autoGainControl,
        });
      } catch {
        if (!disposed) {
          setVoiceIceConfig(createDefaultVoiceIceConfig());
          setVoiceSfuEnabled(false);
          setVoiceSfuProvider('mediasoup');
        }
      }
    };
    void loadRtcConfig();
    return () => {
      disposed = true;
    };
  }, [applyVoiceDefaults]);

  useEffect(() => {
    if (auth.token) {
      return;
    }
    setServers([]);
    setRailScope({ kind: 'home' });
    setServerInvites([]);
    setServerAnalytics(null);
    setServerAuditLogs([]);
    setServerMembers([]);
    setServerModerationActions([]);
    setServerPanelError(null);
    reconnectVoiceIntentRef.current = null;
    setOnlineUsers([]);
    setUnreadChannelCounts({});
    lastReadMessageIdByChannelRef.current.clear();
    markReadInFlightByChannelRef.current.clear();
    setVoiceParticipantsByChannel({});
    resetVoiceSignalingState();
    setActiveVoiceChannelId(null);
    setVoiceBusyChannelId(null);
  }, [auth.token, resetVoiceSignalingState]);

  useEffect(() => {
    if (!auth.token) {
      return;
    }
    let disposed = false;
    const token = auth.token;
    const load = async () => {
      try {
        const [channelsResponse, serversResponse] = await Promise.all([
          chatApi.channels(token),
          chatApi.servers(token),
        ]);
        if (disposed) {
          return;
        }
        setChannels(channelsResponse.channels);
        setServers(serversResponse.servers);
        const nextScope: RailScope = { kind: 'home' };
        setRailScope(nextScope);
        setActiveView('chat');
        setServerInvites([]);
        setServerAnalytics(null);
        setServerAuditLogs([]);
        setServerMembers([]);
        setServerModerationActions([]);
        setServerPanelError(null);
        setError(null);
        const firstHomeChannelId = pickFallbackChannelId(channelsResponse.channels, nextScope);
        setActiveChannelId(firstHomeChannelId);
      } catch (err) {
        if (!disposed) {
          setError(getErrorMessage(err, 'Could not load chat data'));
        }
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [auth.token]);

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
    if (railScope.kind !== 'server') {
      return;
    }
    if (selectedServer) {
      return;
    }
    setRailScope({ kind: 'home' });
    setActiveView('chat');
  }, [railScope, selectedServer]);

  useEffect(() => {
    if (activeView === 'server' && railScope.kind === 'home') {
      setActiveView('chat');
    }
  }, [activeView, railScope.kind]);

  useEffect(() => {
    if (activeView !== 'chat') {
      return;
    }
    if (!activeChannelId) {
      const fallback = pickFallbackChannelId(channels, railScope);
      if (fallback) {
        setActiveChannelId(fallback);
      }
      return;
    }
    const current = channels.find((channel) => channel.id === activeChannelId) ?? null;
    if (!current) {
      return;
    }
    if (isChannelVisibleInScope(current, railScope)) {
      return;
    }
    setActiveChannelId(pickFallbackChannelId(channels, railScope));
  }, [activeView, activeChannelId, channels, railScope]);

  useEffect(() => {
    if (activeView !== 'server' || !selectedServerId || !canManageSelectedServer) {
      return;
    }
    void loadServerManagementData();
  }, [activeView, selectedServerId, canManageSelectedServer, loadServerManagementData]);

  useEffect(() => {
    if (railScope.kind === 'server') {
      setServerPanelError(null);
      return;
    }
    setServerInvites([]);
    setServerAnalytics(null);
    setServerAuditLogs([]);
    setServerMembers([]);
    setServerModerationActions([]);
    setServerPanelError(null);
  }, [railScope.kind, selectedServerId]);

  const { toggleMessageReaction } = useReactionsFeature({
    authToken: auth.token,
    activeChannelId,
    setMessages,
    setError,
  });

  const { editMessage, deleteMessage, sendMessage, retryMessage } = useMessageLifecycleFeature({
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

  const knownUsersById = useMemo(() => {
    const map: Record<
      string,
      {
        id: string;
        username: string;
        avatarUrl?: string | null;
      }
    > = {};
    const upsert = (user: { id?: string; username?: string; avatarUrl?: string | null } | null | undefined) => {
      if (!user?.id || !user.username) {
        return;
      }
      map[user.id] = {
        id: user.id,
        username: user.username,
        avatarUrl: user.avatarUrl,
      };
    };

    upsert(auth.user);
    for (const user of onlineUsers) {
      upsert(user);
    }
    for (const message of messages) {
      upsert(message.user);
      for (const readUser of message.readUsers ?? []) {
        upsert(readUser);
      }
    }
    for (const friend of friends) {
      upsert(friend.user);
    }
    for (const request of incomingRequests) {
      upsert(request.from);
      upsert(request.to);
    }
    for (const request of outgoingRequests) {
      upsert(request.from);
      upsert(request.to);
    }
    for (const participants of Object.values(voiceParticipantsByChannel)) {
      for (const participant of participants) {
        upsert({
          id: participant.userId,
          username: participant.username,
          avatarUrl: participant.avatarUrl,
        });
      }
    }

    return map;
  }, [auth.user, onlineUsers, messages, friends, incomingRequests, outgoingRequests, voiceParticipantsByChannel]);

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

  const scopeLabel = railScope.kind === 'home' ? 'Home' : (selectedServer?.name ?? 'Server');
  const panelTitle =
    activeView === 'chat'
      ? activeChannel
        ? activeChannel.isDirect
          ? `@${activeChannel.directUser?.username ?? 'Direct Message'}`
          : activeChannel.isVoice
            ? `~${activeChannel.name}`
            : `#${activeChannel.name}`
        : railScope.kind === 'home'
          ? 'Home'
          : `${scopeLabel} / Select channel`
      : activeView === 'friends'
        ? 'Friends'
        : activeView === 'settings'
          ? 'Settings'
          : activeView === 'server'
            ? `${scopeLabel} Management`
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
    <ChatPageShell
      chatLayoutClassName={chatLayoutClassName}
      serverRailProps={{
        servers,
        scope: railScope,
        onSelectHome: selectHomeScope,
        onSelectServer: selectServerScope,
        onCreateServer: () => {
          void createServerFromRail();
        },
        onJoinServer: () => {
          void joinServerFromRail();
        },
        creatingServer,
        joiningServer,
      }}
      sidebarProps={{
        channels: scopedChannels,
        activeChannelId,
        onSelect: (channelId) => {
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
        },
        unreadChannelCounts,
        activeView,
        onChangeView: setActiveView,
        scope: railScope.kind,
        scopeLabel,
        onLogout: logout,
        userId: auth.user.id,
        username: auth.user.username,
        isAdmin: auth.user.isAdmin,
        canManageScope: railScope.kind === 'server' && canManageSelectedServer,
        canOpenServerView: railScope.kind === 'server' && canManageSelectedServer,
        onOpenServerView: () => setActiveView('server'),
        onCreateChannel: createScopedChannel,
        onDeleteChannel: deleteChannel,
        deletingChannelId,
        activeVoiceChannelId,
        voiceParticipantCounts,
        voiceParticipantsByChannel,
        voiceStreamingUserIdsByChannel,
        speakingUserIds,
        onJoinVoice: joinVoiceChannel,
        onLeaveVoice: leaveVoiceChannel,
        isSelfMuted,
        isSelfDeafened,
        onToggleMute: toggleSelfMute,
        onToggleDeafen: toggleSelfDeafen,
        joiningVoiceChannelId: voiceBusyChannelId,
        incomingFriendRequests: incomingRequests.length,
        avatarUrl: auth.user.avatarUrl,
        ping: ws.ping,
        state: currentPresenceState,
      }}
      activeView={activeView}
      activeChannelIsVoice={Boolean(activeChannel?.isVoice)}
      panelTitle={panelTitle}
      error={error}
      notice={notice}
      streamStatusBanner={streamStatusBanner}
      messageSearchInputRef={messageSearchInputRef}
      messageQuery={messageQuery}
      onMessageQueryChange={setMessageQuery}
      onClearMessageQuery={() => setMessageQuery('')}
      activeVoiceSession={
        activeVoiceChannel
          ? {
            channelName: activeVoiceChannel.name,
            isViewingJoinedVoiceChannel,
            isDisconnecting: isVoiceDisconnecting,
            status: voiceSessionStatus,
            voiceBitrateKbps: activeVoiceBitrateKbps,
            streamBitrateKbps: activeStreamBitrateKbps,
            remoteStreamCount: activeRemoteAudioUsers.length,
            onDisconnect: () => {
              void leaveVoiceChannel();
            },
          }
          : null
      }
      voicePanelProps={
        activeChannel && activeChannel.isVoice
          ? {
            channelName: activeChannel.name,
            participants: activeVoiceParticipants,
            currentUserId: auth.user.id,
            localAudioReady,
            remoteAudioUsers: viewedRemoteAudioUsers,
            voiceBitrateKbps: activeChannel.voiceBitrateKbps ?? 64,
            streamBitrateKbps: activeChannel.streamBitrateKbps ?? 2500,
            onVoiceBitrateChange: (nextBitrate) => {
              void updateVoiceChannelSettings(activeChannel.id, { voiceBitrateKbps: nextBitrate });
            },
            onStreamBitrateChange: (nextBitrate) => {
              void updateVoiceChannelSettings(activeChannel.id, { streamBitrateKbps: nextBitrate });
            },
            canEditChannelBitrate:
              railScope.kind === 'server' &&
              activeChannel.serverId === railScope.serverId &&
              canManageSelectedServer,
            qualityBusy: savingVoiceSettingsChannelId === activeChannel.id,
            joined: activeVoiceChannelId === activeChannel.id,
            busy: voiceBusyChannelId === activeChannel.id,
            wsConnected: ws.connected,
            isMuted: isSelfMuted || isSelfDeafened,
            onToggleMute: toggleSelfMute,
            speakingUserIds,
            showVoiceActivity: preferences.showVoiceActivity,
            onJoin: () => joinVoiceChannel(activeChannel.id),
            onLeave: leaveVoiceChannel,
            onParticipantContextMenu: (participant, position) =>
              openUserAudioMenu(
                { id: participant.userId, username: participant.username },
                position,
              ),
            getParticipantAudioState: (userId) => getUserAudioState(userId),
            localScreenShareStream,
            localStreamSource,
            remoteScreenShares,
            onToggleVideoShare: toggleVideoShare,
            streamQualityLabel,
            onStreamQualityChange: handleStreamQualityChange,
            showDetailedStats: showDetailedVoiceStats,
            onToggleDetailedStats: () => setShowDetailedVoiceStats((current) => !current),
            connectionStats: voiceConnectionStats,
            statsUpdatedAt: voiceStatsUpdatedAt,
          }
          : null
      }
      chatViewProps={{
        activeChannelId,
        loading: loadingMessages,
        messages: filteredMessages,
        wsConnected: ws.connected,
        currentUserId: auth.user.id,
        knownUsersById,
        use24HourClock: preferences.use24HourClock,
        showSeconds: preferences.showSeconds,
        reducedMotion: preferences.reducedMotion,
        onLoadOlder: loadOlder,
        onUserClick: setSelectedUser,
        onMentionUser: (user) => {
          setComposerInsertRequest({
            key: Date.now(),
            text: `@${user.username}`,
          });
        },
        onReplyToMessage: (message) => {
          setReplyTarget({
            id: message.id,
            userId: message.userId,
            username: message.user.username,
            content: message.content,
          });
        },
        onToggleReaction: toggleMessageReaction,
        onEditMessage: editMessage,
        onDeleteMessage: deleteMessage,
        onRetryMessage: retryMessage,
        canManageAllMessages: auth.user.isAdmin,
      }}
      composerProps={{
        disabled: !activeChannelId,
        enterToSend: preferences.enterToSend,
        draftScopeKey: activeChannelId,
        insertRequest: composerInsertRequest,
        replyTo: replyTarget
          ? {
            username: replyTarget.username,
            content: replyTarget.content,
          }
          : null,
        replyToMessageId: replyTarget?.id ?? null,
        onClearReply: () => setReplyTarget(null),
        onSend: sendMessage,
        onUploadAttachment: uploadAttachment,
      }}
      friendsPanelProps={{
        friends,
        incoming: incomingRequests,
        outgoing: outgoingRequests,
        loading: loadingFriends,
        error: friendsError,
        actionBusyId: friendActionBusyId,
        submittingRequest: submittingFriendRequest,
        onRefresh: loadFriendData,
        onSendRequest: sendFriendRequest,
        onAccept: acceptFriendRequest,
        onDecline: declineFriendRequest,
        onCancel: cancelFriendRequest,
        onRemove: removeFriend,
        onStartDm: openDirectMessage,
        openingDmUserId,
      }}
      settingsPanelProps={{
        user: auth.user,
        wsConnected: ws.connected,
        preferences,
        audioInputDevices,
        microphonePermission,
        requestingMicrophonePermission,
        onUpdatePreferences: updatePreferences,
        onResetPreferences: resetPreferences,
        onRequestMicrophonePermission: requestMicrophonePermission,
        onLogout: logout,
        state: currentPresenceState,
        onSetState: setPresenceState,
      }}
      adminPanelProps={
        activeView === 'admin' && auth.user.isAdmin
          ? {
            stats: adminStats,
            settings: adminSettings,
            settingsLoading: loadingAdminSettings,
            settingsError: adminSettingsError,
            savingSettings: savingAdminSettings,
            loading: loadingAdminStats,
            error: adminStatsError,
            onRefresh: loadAdminStats,
            onRefreshSettings: loadAdminSettings,
            onSaveSettings: saveAdminSettings,
            users: adminUsers,
            usersLoading: loadingAdminUsers,
            usersError: adminUsersError,
            analyticsOverview: adminAnalyticsOverview,
            analyticsTimeseries: adminAnalyticsTimeseries,
            analyticsLoading: loadingAdminAnalytics,
            analyticsError: adminAnalyticsError,
            updatingUserId: updatingAdminUserId,
            deletingUserId: deletingAdminUserId,
            onRefreshUsers: loadAdminUsers,
            onRefreshAnalytics: loadAdminAnalytics,
            onUpdateUser: updateAdminUser,
            onDeleteUser: deleteAdminUser,
            onClearUsersExceptCurrent: clearAdminUsersExceptCurrent,
            clearingUsersExceptCurrent: clearingAdminUsers,
            currentUserId: auth.user.id,
          }
          : null
      }
      serverPanelProps={
        activeView === 'server'
          ? {
            server: selectedServer,
            canManage: canManageSelectedServer,
            loading: serverPanelLoading,
            error: serverPanelError,
            invites: serverInvites,
            analytics: serverAnalytics,
            logs: serverAuditLogs,
            members: serverMembers,
            moderationActions: serverModerationActions,
            inviteBusy: serverInviteBusy,
            moderationBusy: serverModerationBusy,
            onRefresh: loadServerManagementData,
            onCreateInvite: createServerInvite,
            onRevokeInvite: revokeServerInvite,
            onModerate: moderateServerMember,
          }
          : null
      }
      userSidebarProps={{
        users: onlineUsers,
        onUserClick: (user) => {
          setSelectedUser(user);
          setMobilePane('none');
        },
        onUserContextMenu: (user, position) => openUserAudioMenu(user, position),
      }}
    >
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
          className={mobilePane === 'channels' ? 'active' : ''}
          onClick={() => {
            setActiveView('chat');
            setMobilePane((current) => (current === 'channels' ? 'none' : 'channels'));
          }}
        >
          Browse
        </button>
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
          className={activeView === 'friends' ? 'active' : ''}
          onClick={() => {
            setActiveView('friends');
            setMobilePane('none');
          }}
        >
          Friends
        </button>
        <button
          className={mobilePane === 'users' ? 'active' : ''}
          disabled={activeView !== 'chat' || Boolean(activeChannel?.isVoice)}
          onClick={() => {
            setActiveView('chat');
            setMobilePane((current) => (current === 'users' ? 'none' : 'users'));
          }}
        >
          People
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
    </ChatPageShell>
  );
}











