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
import { useAuth } from '../store/auth-store';
import type {
  AdminSettings,
  AdminStats,
  AdminUserSummary,
  Channel,
  FriendRequestSummary,
  FriendSummary,
  Message,
  MessageAttachment,
  UserRole,
} from '../types/api';
import { getErrorMessage } from '../utils/error-message';

type MainView = 'chat' | 'friends' | 'settings' | 'admin';

function mergeMessages(existing: Message[], incoming: Message[]) {
  const map = new Map<string, Message>();
  for (const message of [...existing, ...incoming]) {
    map.set(message.id, message);
  }
  return [...map.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

function messageSignature(
  channelId: string,
  userId: string,
  content: string,
  attachmentUrl?: string,
) {
  return `${channelId}:${userId}:${content.trim().toLowerCase()}:${attachmentUrl ?? ''}`;
}

function isLogicalSameMessage(a: Message, b: Message) {
  if (a.channelId !== b.channelId || a.userId !== b.userId) {
    return false;
  }
  if (a.content.trim() !== b.content.trim()) {
    return false;
  }
  const aAttachmentUrl = a.attachment?.url ?? null;
  const bAttachmentUrl = b.attachment?.url ?? null;
  if (aAttachmentUrl !== bAttachmentUrl) {
    return false;
  }
  const aTime = new Date(a.createdAt).getTime();
  const bTime = new Date(b.createdAt).getTime();
  return Math.abs(aTime - bTime) <= 60_000;
}

function mergeServerWithLocal(serverMessages: Message[], localMessages: Message[]) {
  const unresolvedLocal = localMessages.filter(
    (local) => !serverMessages.some((server) => isLogicalSameMessage(local, server)),
  );
  return mergeMessages(serverMessages, unresolvedLocal);
}

function reconcileIncomingMessage(existing: Message[], incoming: Message) {
  const optimisticIndex = existing.findIndex(
    (item) =>
      item.optimistic &&
      !item.failed &&
      item.channelId === incoming.channelId &&
      item.userId === incoming.userId &&
      item.content === incoming.content,
  );

  if (optimisticIndex >= 0) {
    const next = [...existing];
    next[optimisticIndex] = incoming;
    return next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  const incomingTime = new Date(incoming.createdAt).getTime();
  const failedIndex = existing.findIndex((item) => {
    if (!item.failed) {
      return false;
    }
    if (
      item.channelId !== incoming.channelId ||
      item.userId !== incoming.userId ||
      item.content !== incoming.content
    ) {
      return false;
    }
    const failedTime = new Date(item.createdAt).getTime();
    return Math.abs(incomingTime - failedTime) <= 30_000;
  });

  if (failedIndex >= 0) {
    const next = [...existing];
    next[failedIndex] = incoming;
    return next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  return mergeMessages(existing, [incoming]);
}

function upsertChannel(existing: Channel[], incoming: Channel) {
  const next = existing.some((channel) => channel.id === incoming.id)
    ? existing.map((channel) => (channel.id === incoming.id ? incoming : channel))
    : [...existing, incoming];

  return next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

type VoiceSignalData =
  | { kind: 'offer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit };

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
  const [openingDmUserId, setOpeningDmUserId] = useState<string | null>(null);
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
  const [savingVoiceBitrateChannelId, setSavingVoiceBitrateChannelId] = useState<string | null>(null);

  const [selectedUser, setSelectedUser] = useState<{ id: string; username: string } | null>(null);
  const [hiddenUnreadCount, setHiddenUnreadCount] = useState(0);
  const pendingSignaturesRef = useRef(new Set<string>());
  const pendingTimeoutsRef = useRef(new Map<string, number>());
  const localVoiceStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const activeVoiceChannelIdRef = useRef<string | null>(null);
  const sendVoiceSignalRef = useRef((() => false) as (channelId: string, targetUserId: string, data: unknown) => boolean);
  const leaveVoiceRef = useRef((() => false) as (channelId?: string) => boolean);

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [channels, activeChannelId],
  );
  const activeVoiceChannel = useMemo(
    () => channels.find((channel) => channel.id === activeVoiceChannelId) ?? null,
    [channels, activeVoiceChannelId],
  );
  const activeVoiceBitrateKbps = activeVoiceChannel?.voiceBitrateKbps ?? 64;
  const subscribedChannelIds = useMemo(() => channels.map((channel) => channel.id), [channels]);

  const voiceParticipantCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [channelId, participants] of Object.entries(voiceParticipantsByChannel)) {
      counts[channelId] = participants.length;
    }
    return counts;
  }, [voiceParticipantsByChannel]);

  const activeVoiceParticipants = useMemo(() => {
    if (!activeChannelId) {
      return [];
    }
    return voiceParticipantsByChannel[activeChannelId] ?? [];
  }, [activeChannelId, voiceParticipantsByChannel]);

  const joinedVoiceParticipants = useMemo(() => {
    if (!activeVoiceChannelId) {
      return [];
    }
    return voiceParticipantsByChannel[activeVoiceChannelId] ?? [];
  }, [activeVoiceChannelId, voiceParticipantsByChannel]);

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

  const clearPendingSignature = useCallback((signature: string) => {
    pendingSignaturesRef.current.delete(signature);
    const timeoutId = pendingTimeoutsRef.current.get(signature);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      pendingTimeoutsRef.current.delete(signature);
    }
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
    setIsSelfDeafened((current) => {
      const next = !current;
      if (next) {
        setIsSelfMuted(true);
      }
      return next;
    });
  }, []);

  const closePeerConnection = useCallback((peerUserId: string) => {
    const connection = peerConnectionsRef.current.get(peerUserId);
    if (connection) {
      connection.onicecandidate = null;
      connection.ontrack = null;
      connection.onconnectionstatechange = null;
      connection.close();
      peerConnectionsRef.current.delete(peerUserId);
    }
    pendingIceRef.current.delete(peerUserId);
    setRemoteAudioStreams((prev) => {
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
    pendingIceRef.current.clear();
    if (localVoiceStreamRef.current) {
      for (const track of localVoiceStreamRef.current.getTracks()) {
        track.stop();
      }
      localVoiceStreamRef.current = null;
    }
    setLocalAudioReady(false);
    setRemoteAudioStreams({});
  }, [closePeerConnection]);

  const getLocalVoiceStream = useCallback(async () => {
    if (localVoiceStreamRef.current) {
      applyLocalVoiceTrackState(localVoiceStreamRef.current);
      return localVoiceStreamRef.current;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Voice is not supported in this browser');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    localVoiceStreamRef.current = stream;
    applyLocalVoiceTrackState(stream);
    setLocalAudioReady(true);
    return stream;
  }, [applyLocalVoiceTrackState]);

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
      await applyAudioBitrateToConnection(connection, activeVoiceBitrateKbps);

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
        const streamFromTrack = event.streams[0];
        if (!streamFromTrack) {
          return;
        }
        setRemoteAudioStreams((prev) => ({
          ...prev,
          [peerUserId]: streamFromTrack,
        }));
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
    [applyAudioBitrateToConnection, closePeerConnection, getLocalVoiceStream, activeVoiceBitrateKbps],
  );

  const createOfferForPeer = useCallback(
    async (peerUserId: string, channelId: string) => {
      if (!auth.user || auth.user.id > peerUserId) {
        return;
      }
      const connection = await ensurePeerConnection(peerUserId, channelId);
      if (connection.signalingState !== 'stable') {
        return;
      }
      const offer = await connection.createOffer({
        offerToReceiveAudio: true,
      });
      await connection.setLocalDescription(offer);
      sendVoiceSignalRef.current(channelId, peerUserId, {
        kind: 'offer',
        sdp: offer,
      } satisfies VoiceSignalData);
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
        if (connection.signalingState !== 'stable') {
          try {
            await connection.setLocalDescription({ type: 'rollback' });
          } catch {
            // Ignore rollback issues and continue best effort.
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

      await connection.setRemoteDescription(signal.sdp);
      await flushPendingIceCandidates(payload.fromUserId, connection);
    },
    [auth.user, ensurePeerConnection, flushPendingIceCandidates],
  );

  const handleVoiceState = useCallback(
    (payload: VoiceStatePayload) => {
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
    [auth.user, voiceBusyChannelId],
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
    sendVoiceSignalRef.current = ws.sendVoiceSignal;
  }, [ws.sendVoiceSignal]);

  useEffect(() => {
    leaveVoiceRef.current = ws.leaveVoice;
  }, [ws.leaveVoice]);

  useEffect(() => {
    activeVoiceChannelIdRef.current = activeVoiceChannelId;
  }, [activeVoiceChannelId]);

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
    document.title = hiddenUnreadCount > 0 ? `(${hiddenUnreadCount}) DiscordClone` : 'DiscordClone';
  }, [hiddenUnreadCount]);

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
      return;
    }
    void loadFriendData();
  }, [auth.token, loadFriendData]);

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
    if (!activeChannelId) {
      setMessages([]);
      return;
    }
    if (activeChannel?.isVoice) {
      setMessages([]);
      setMessageQuery('');
      return;
    }
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
    applyLocalVoiceTrackState(localVoiceStreamRef.current);
  }, [applyLocalVoiceTrackState]);

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
    async (userId: string, input: Partial<{ role: UserRole }>) => {
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
      setSubmittingFriendRequest(true);
      try {
        await chatApi.sendFriendRequest(auth.token, username);
        await loadFriendData();
      } catch (err) {
        setFriendsError(getErrorMessage(err, 'Could not send friend request'));
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

  const openDirectMessage = useCallback(
    async (targetUserId: string) => {
      if (!auth.token) {
        return;
      }
      setOpeningDmUserId(targetUserId);
      try {
        const response = await chatApi.createDirectChannel(auth.token, targetUserId);
        setChannels((prev) => upsertChannel(prev, response.channel));
        setActiveChannelId(response.channel.id);
        setActiveView('chat');
        setFriendsError(null);
      } catch (err) {
        setFriendsError(getErrorMessage(err, 'Could not open DM'));
      } finally {
        setOpeningDmUserId(null);
      }
    },
    [auth.token],
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
        if (activeVoiceChannelId && activeVoiceChannelId !== channelId) {
          ws.leaveVoice(activeVoiceChannelId);
        }
        const sent = ws.joinVoice(channelId);
        if (!sent) {
          throw new Error('VOICE_JOIN_FAILED');
        }
        setActiveVoiceChannelId(channelId);
        setError(null);
      } catch {
        setError('Could not join voice channel');
      } finally {
        setVoiceBusyChannelId(null);
      }
    },
    [auth.token, ws, activeVoiceChannelId],
  );

  const leaveVoiceChannel = useCallback(
    async () => {
      if (!activeVoiceChannelId) {
        return;
      }
      const leavingChannelId = activeVoiceChannelId;
      setVoiceBusyChannelId(leavingChannelId);
      ws.leaveVoice(leavingChannelId);
      setError(null);
      window.setTimeout(() => {
        setVoiceBusyChannelId((current) => (current === leavingChannelId ? null : current));
        setActiveVoiceChannelId((current) => (current === leavingChannelId ? null : current));
      }, 1800);
    },
    [ws, activeVoiceChannelId],
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
    setActiveVoiceChannelId(null);
    setVoiceBusyChannelId(null);
    teardownVoiceTransport();
  }, [ws.connected, teardownVoiceTransport]);

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

  const sendMessage = async (payload: { content: string; attachment?: MessageAttachment }) => {
    if (!auth.token || !activeChannelId || !auth.user) {
      return;
    }
    const trimmedContent = payload.content.trim();
    const attachment = payload.attachment;
    if (!trimmedContent && !attachment) {
      return;
    }

    const signature = messageSignature(
      activeChannelId,
      auth.user.id,
      trimmedContent,
      attachment?.url,
    );
    if (pendingSignaturesRef.current.has(signature)) {
      return;
    }
    pendingSignaturesRef.current.add(signature);
    schedulePendingTimeout(signature);

    const optimisticMessage: Message = {
      id: `tmp-${crypto.randomUUID()}`,
      channelId: activeChannelId,
      userId: auth.user.id,
      content: trimmedContent,
      attachment: attachment ?? null,
      createdAt: new Date().toISOString(),
      optimistic: true,
      user: { id: auth.user.id, username: auth.user.username },
    };
    setMessages((prev) => mergeMessages(prev, [optimisticMessage]));

    const wsSent =
      !attachment && trimmedContent && ws.connected
        ? ws.sendMessage(activeChannelId, trimmedContent)
        : false;
    if (wsSent) {
      return;
    }

    try {
      const response = await chatApi.sendMessage(
        auth.token,
        activeChannelId,
        trimmedContent,
        attachment,
      );
      clearPendingSignature(signature);
      setMessages((prev) => {
        const replaced = prev.map((item) => (item.id === optimisticMessage.id ? response.message : item));
        return mergeMessages(replaced, []);
      });
    } catch (err) {
      try {
        const verification = await chatApi.messages(auth.token, activeChannelId, { limit: 100 });
        const confirmed = verification.messages.find((message) =>
          isLogicalSameMessage(message, optimisticMessage),
        );
        if (confirmed) {
          clearPendingSignature(signature);
          setMessages((prev) => prev.map((item) => (item.id === optimisticMessage.id ? confirmed : item)));
          return;
        }
      } catch {
        // Ignore verification errors and continue with failed-state UI.
      }

      clearPendingSignature(signature);
      setMessages((prev) =>
        prev.map((item) =>
          item.id === optimisticMessage.id ? { ...item, failed: true, optimistic: false } : item,
        ),
      );
      throw err;
    }
  };

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

  const updateVoiceChannelBitrate = async (channelId: string, bitrateKbps: number) => {
    if (!auth.token || !auth.user?.isAdmin) {
      return;
    }
    setSavingVoiceBitrateChannelId(channelId);
    try {
      const response = await chatApi.updateVoiceChannelSettings(auth.token, channelId, {
        voiceBitrateKbps: bitrateKbps,
      });
      setChannels((prev) => upsertChannel(prev, response.channel));
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not update voice quality'));
    } finally {
      setSavingVoiceBitrateChannelId((current) => (current === channelId ? null : current));
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
  const voiceSessionStatus = !ws.connected
    ? 'Disconnected'
    : isVoiceDisconnecting
      ? 'Disconnecting...'
      : localAudioReady
        ? 'Connected'
        : 'Connecting...';

  return (
    <main className="chat-layout">
      <ChannelSidebar
        channels={channels}
        activeChannelId={activeChannelId}
        onSelect={(channelId) => {
          setActiveChannelId(channelId);
          setActiveView('chat');
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
        username={auth.user.username}
        isAdmin={auth.user.isAdmin}
        onCreateChannel={createChannel}
        onDeleteChannel={deleteChannel}
        deletingChannelId={deletingChannelId}
        activeVoiceChannelId={activeVoiceChannelId}
        voiceParticipantCounts={voiceParticipantCounts}
        onJoinVoice={joinVoiceChannel}
        onLeaveVoice={leaveVoiceChannel}
        isSelfMuted={isSelfMuted}
        isSelfDeafened={isSelfDeafened}
        onToggleMute={toggleSelfMute}
        onToggleDeafen={toggleSelfDeafen}
        joiningVoiceChannelId={voiceBusyChannelId}
        incomingFriendRequests={incomingRequests.length}
      />

      <section className="chat-panel">
        <header className="panel-header">
          <div className="panel-header-main">
            <h1>{panelTitle}</h1>
            {error ? <p className="error-banner">{error}</p> : null}
            {!error && notice ? <p className="info-banner">{notice}</p> : null}
          </div>
          {activeView === 'chat' && !activeChannel?.isVoice ? (
            <div className="panel-tools">
              <input
                className="panel-search-input"
                value={messageQuery}
                onChange={(event) => setMessageQuery(event.target.value)}
                placeholder="Search messages"
              />
              {messageQuery ? (
                <button className="ghost-btn small" onClick={() => setMessageQuery('')}>
                  Clear
                </button>
              ) : null}
            </div>
          ) : null}
        </header>

        {activeVoiceChannel ? (
          <div className="voice-session-bar" role="status" aria-live="polite">
            <div className="voice-session-main">
              <strong>Voice: ~{activeVoiceChannel.name}</strong>
              <span className={`voice-session-state ${isVoiceDisconnecting ? 'danger' : ''}`}>
                {voiceSessionStatus}
              </span>
              <small>
                {activeVoiceBitrateKbps} kbps • {activeRemoteAudioUsers.length} remote stream(s)
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
                bitrateKbps={activeChannel.voiceBitrateKbps ?? 64}
                onBitrateChange={(nextBitrate) => {
                  void updateVoiceChannelBitrate(activeChannel.id, nextBitrate);
                }}
                canEditQuality={auth.user.isAdmin}
                qualityBusy={savingVoiceBitrateChannelId === activeChannel.id}
                joined={activeVoiceChannelId === activeChannel.id}
                busy={voiceBusyChannelId === activeChannel.id}
                wsConnected={ws.connected}
                onJoin={() => joinVoiceChannel(activeChannel.id)}
                onLeave={leaveVoiceChannel}
              />
            ) : (
              <>
                <ChatView
                  activeChannelId={activeChannelId}
                  loading={loadingMessages}
                  messages={filteredMessages}
                  wsConnected={ws.connected}
                  use24HourClock={preferences.use24HourClock}
                  showSeconds={preferences.showSeconds}
                  onLoadOlder={loadOlder}
                  onUserClick={setSelectedUser}
                />
                <MessageComposer
                  disabled={!activeChannelId}
                  enterToSend={preferences.enterToSend}
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
            onUpdatePreferences={updatePreferences}
            onResetPreferences={resetPreferences}
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

      {activeView === 'chat' ? <UserSidebar users={onlineUsers} onUserClick={setSelectedUser} /> : null}

      <div className="voice-audio-sinks" aria-hidden="true">
        {activeRemoteAudioUsers.map((user) => (
          <audio
            key={user.userId}
            autoPlay
            playsInline
            muted={isSelfDeafened}
            ref={(node) => {
              if (!node) {
                return;
              }
              if (node.srcObject !== user.stream) {
                node.srcObject = user.stream;
              }
            }}
          />
        ))}
      </div>

      <UserProfile user={selectedUser} onClose={() => setSelectedUser(null)} currentUser={auth.user} />
    </main>
  );
}
