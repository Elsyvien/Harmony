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
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const [voiceParticipantsByChannel, setVoiceParticipantsByChannel] = useState<
    Record<string, VoiceParticipant[]>
  >({});
  const [activeVoiceChannelId, setActiveVoiceChannelId] = useState<string | null>(null);
  const [voiceBusyChannelId, setVoiceBusyChannelId] = useState<string | null>(null);

  const [selectedUser, setSelectedUser] = useState<{ id: string; username: string } | null>(null);
  const [hiddenUnreadCount, setHiddenUnreadCount] = useState(0);
  const pendingSignaturesRef = useRef(new Set<string>());
  const pendingTimeoutsRef = useRef(new Map<string, number>());

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [channels, activeChannelId],
  );

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
        return;
      }

      setActiveVoiceChannelId((current) => (current === payload.channelId ? null : current));
    },
    [auth.user],
  );

  const ws = useChatSocket({
    token: auth.token,
    activeChannelId,
    onMessageNew: (message) => {
      if (message.channelId !== activeChannelId) {
        return;
      }
      if (auth.user) {
        const signature = messageSignature(
          message.channelId,
          auth.user.id,
          message.content,
          message.attachment?.url,
        );
        clearPendingSignature(signature);
        if (message.userId !== auth.user.id) {
          playIncomingMessageSound();
        }
      }
      if (document.hidden) {
        setHiddenUnreadCount((count) => count + 1);
      }
      setMessages((prev) => reconcileIncomingMessage(prev, message));
    },
    onFriendEvent: () => {
      void loadFriendData();
    },
    onDmEvent: (payload) => {
      setChannels((prev) => upsertChannel(prev, payload.channel));
      setNotice(`New DM from @${payload.from.username}`);
      if (document.hidden) {
        setHiddenUnreadCount((count) => count + 1);
      }
    },
    onPresenceUpdate: (users) => {
      setOnlineUsers(users);
    },
    onVoiceState: handleVoiceState,
    onVoiceSignal: () => {
      // WebRTC media exchange will use this event in the next phase.
    },
  });

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
      setVoiceParticipantsByChannel({});
      setActiveVoiceChannelId(null);
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
  }, [auth.token]);

  useEffect(() => {
    if (!auth.token) {
      return;
    }
    void loadFriendData();
  }, [auth.token, loadFriendData]);

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
      setVoiceBusyChannelId(activeVoiceChannelId);
      try {
        ws.leaveVoice(activeVoiceChannelId);
        setActiveVoiceChannelId(null);
        setError(null);
      } finally {
        setVoiceBusyChannelId(null);
      }
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
  }, [ws.connected]);

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

  return (
    <main className="chat-layout">
      <ChannelSidebar
        channels={channels}
        activeChannelId={activeChannelId}
        onSelect={(channelId) => {
          setActiveChannelId(channelId);
          setActiveView('chat');
        }}
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

        {activeView === 'chat' ? (
          <>
            {activeChannel?.isVoice ? (
              <VoiceChannelPanel
                channelName={activeChannel.name}
                participants={activeVoiceParticipants}
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

      <UserProfile user={selectedUser} onClose={() => setSelectedUser(null)} currentUser={auth.user} />
    </main>
  );
}
