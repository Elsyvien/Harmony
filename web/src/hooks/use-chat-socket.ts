import { useCallback, useEffect, useRef, useState } from 'react';
import type { Channel, Message } from '../types/api';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:4000/ws';

interface ServerEvent {
  type: string;
  payload: unknown;
}

export interface DmNewEventPayload {
  channel: Channel;
  from: {
    id: string;
    username: string;
  };
}

export type PresenceState = 'online' | 'idle' | 'dnd';

export interface PresenceUser {
  id: string;
  username: string;
  avatarUrl?: string;
  state: PresenceState;
}

export interface VoiceParticipant {
  userId: string;
  username: string;
  avatarUrl?: string;
  muted?: boolean;
  deafened?: boolean;
}

export interface VoiceStatePayload {
  channelId: string;
  participants: VoiceParticipant[];
}

export interface VoiceSignalPayload {
  channelId: string;
  fromUserId: string;
  data: unknown;
}

export interface RealtimeErrorPayload {
  code?: string;
  message?: string;
}

export type VoiceSfuRequestAction =
  | 'get-rtp-capabilities'
  | 'create-transport'
  | 'connect-transport'
  | 'produce'
  | 'close-producer'
  | 'list-producers'
  | 'consume'
  | 'resume-consumer'
  | 'restart-ice'
  | 'get-transport-stats';

export type VoiceSfuEventPayload =
  | {
      channelId: string;
      event: 'producer-added';
      producer: {
        producerId: string;
        userId: string;
        kind: 'audio' | 'video';
        appData?: Record<string, unknown>;
      };
    }
  | {
      channelId: string;
      event: 'producer-removed';
      producerId: string;
      userId: string;
    };

export interface MessageReactionEventPayload {
  message: Message;
  emoji: string;
  userId: string;
  reacted: boolean;
}

export function useChatSocket(params: {
  token: string | null;
  subscribedChannelIds: string[];
  onMessageNew: (message: Message) => void;
  onMessageUpdated?: (message: Message) => void;
  onMessageDeleted?: (message: Message) => void;
  onMessageReaction?: (payload: MessageReactionEventPayload) => void;
  onFriendEvent?: () => void;
  onDmEvent?: (payload: DmNewEventPayload) => void;
  onChannelUpdated?: (channel: Channel) => void;
  onPresenceUpdate?: (users: PresenceUser[]) => void;
  onVoiceState?: (payload: VoiceStatePayload) => void;
  onVoiceSignal?: (payload: VoiceSignalPayload) => void;
  onVoiceSfuEvent?: (payload: VoiceSfuEventPayload) => void;
  onError?: (payload: RealtimeErrorPayload) => void;
}) {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const joinedChannelIdsRef = useRef<Set<string>>(new Set());
  const pendingVoiceSfuRequestsRef = useRef(
    new Map<
      string,
      {
        resolve: (value: unknown) => void;
        reject: (reason?: unknown) => void;
        timeoutId: number;
      }
    >(),
  );
  const authenticatedRef = useRef(false);
  const subscribedChannelIdsRef = useRef(params.subscribedChannelIds);
  const onMessageNewRef = useRef(params.onMessageNew);
  const onMessageUpdatedRef = useRef(params.onMessageUpdated);
  const onMessageDeletedRef = useRef(params.onMessageDeleted);
  const onMessageReactionRef = useRef(params.onMessageReaction);
  const onFriendEventRef = useRef(params.onFriendEvent);
  const onDmEventRef = useRef(params.onDmEvent);
  const onChannelUpdatedRef = useRef(params.onChannelUpdated);
  const onPresenceUpdateRef = useRef(params.onPresenceUpdate);
  const onVoiceStateRef = useRef(params.onVoiceState);
  const onVoiceSignalRef = useRef(params.onVoiceSignal);
  const onVoiceSfuEventRef = useRef(params.onVoiceSfuEvent);
  const onErrorRef = useRef(params.onError);
  const [connected, setConnected] = useState(false);

  onMessageNewRef.current = params.onMessageNew;
  onMessageUpdatedRef.current = params.onMessageUpdated;
  onMessageDeletedRef.current = params.onMessageDeleted;
  onMessageReactionRef.current = params.onMessageReaction;
  onFriendEventRef.current = params.onFriendEvent;
  onDmEventRef.current = params.onDmEvent;
  onChannelUpdatedRef.current = params.onChannelUpdated;
  onPresenceUpdateRef.current = params.onPresenceUpdate;
  onVoiceStateRef.current = params.onVoiceState;
  onVoiceSignalRef.current = params.onVoiceSignal;
  onVoiceSfuEventRef.current = params.onVoiceSfuEvent;
  onErrorRef.current = params.onError;
  subscribedChannelIdsRef.current = params.subscribedChannelIds;

  const sendEvent = useCallback((type: string, payload: unknown) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    socket.send(JSON.stringify({ type, payload }));
    return true;
  }, []);

  useEffect(() => {
    if (!params.token) {
      return;
    }

    let isClosed = false;
    const joinedChannelIds = joinedChannelIdsRef.current;

    const connect = () => {
      if (isClosed) {
        return;
      }

      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      socket.onopen = () => {
        authenticatedRef.current = false;
        setConnected(false);
        sendEvent('auth', { token: params.token });
      };

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as ServerEvent;
          if (parsed.type === 'message:new') {
            const payload = parsed.payload as { message?: Message };
            if (payload.message) {
              onMessageNewRef.current(payload.message);
            }
            return;
          }

          if (parsed.type === 'auth:ok') {
            authenticatedRef.current = true;
            setConnected(true);
            joinedChannelIds.clear();
            for (const channelId of subscribedChannelIdsRef.current) {
              if (!channelId) {
                continue;
              }
              sendEvent('channel:join', { channelId });
              joinedChannelIds.add(channelId);
            }
            return;
          }

          if (parsed.type === 'message:updated') {
            const payload = parsed.payload as { message?: Message };
            if (payload.message) {
              onMessageUpdatedRef.current?.(payload.message);
            }
            return;
          }

          if (parsed.type === 'message:deleted') {
            const payload = parsed.payload as { message?: Message };
            if (payload.message) {
              onMessageDeletedRef.current?.(payload.message);
            }
            return;
          }

          if (parsed.type === 'message:reaction') {
            const payload = parsed.payload as MessageReactionEventPayload | undefined;
            if (payload?.message?.id && payload.emoji && payload.userId) {
              onMessageReactionRef.current?.(payload);
            }
            return;
          }

          if (parsed.type === 'friend:request:new' || parsed.type === 'friend:request:updated') {
            onFriendEventRef.current?.();
            return;
          }

          if (parsed.type === 'dm:new') {
            const payload = parsed.payload as DmNewEventPayload | undefined;
            if (payload?.channel?.id && payload.from?.id) {
              onDmEventRef.current?.(payload);
            }
            return;
          }

          if (parsed.type === 'channel:updated') {
            const payload = parsed.payload as { channel?: Channel } | undefined;
            if (payload?.channel?.id) {
              onChannelUpdatedRef.current?.(payload.channel);
            }
            return;
          }

          if (parsed.type === 'presence:update') {
            const payload = parsed.payload as { users?: PresenceUser[] } | undefined;
            onPresenceUpdateRef.current?.(
              Array.isArray(payload?.users) ? payload.users : [],
            );
            return;
          }

          if (parsed.type === 'voice:state') {
            const payload = parsed.payload as VoiceStatePayload | undefined;
            if (payload?.channelId && Array.isArray(payload.participants)) {
              onVoiceStateRef.current?.(payload);
            }
            return;
          }

          if (parsed.type === 'voice:signal') {
            const payload = parsed.payload as VoiceSignalPayload | undefined;
            if (payload?.channelId && payload.fromUserId && payload.data !== undefined) {
              onVoiceSignalRef.current?.(payload);
            }
            return;
          }

          if (parsed.type === 'voice:sfu:event') {
            const payload = parsed.payload as VoiceSfuEventPayload | undefined;
            if (payload?.channelId && payload.event) {
              onVoiceSfuEventRef.current?.(payload);
            }
            return;
          }

          if (parsed.type === 'voice:sfu:response') {
            const payload = parsed.payload as
              | {
                  requestId?: string;
                  ok?: boolean;
                  data?: unknown;
                  code?: string;
                  message?: string;
                }
              | undefined;
            if (!payload?.requestId) {
              return;
            }
            const pending = pendingVoiceSfuRequestsRef.current.get(payload.requestId);
            if (!pending) {
              return;
            }
            window.clearTimeout(pending.timeoutId);
            pendingVoiceSfuRequestsRef.current.delete(payload.requestId);
            if (payload.ok) {
              pending.resolve(payload.data);
              return;
            }
            pending.reject(
              new Error(payload.message || payload.code || 'SFU request failed'),
            );
            return;
          }

          if (parsed.type === 'error') {
            const payload = parsed.payload as RealtimeErrorPayload | undefined;
            if (typeof payload?.code === 'string' || typeof payload?.message === 'string') {
              onErrorRef.current?.(payload);
            }
            return;
          }

          if (parsed.type === 'pong') {
            const payload = parsed.payload as { start: number };
            if (payload?.start) {
              const rtt = Date.now() - payload.start;
              setPing(rtt);
            }
            return;
          }
        } catch {
          // Ignore malformed event payloads from the server.
        }
      };

      socket.onclose = () => {
        authenticatedRef.current = false;
        setConnected(false);
        setPing(null);
        for (const pending of pendingVoiceSfuRequestsRef.current.values()) {
          window.clearTimeout(pending.timeoutId);
          pending.reject(new Error('Socket connection closed'));
        }
        pendingVoiceSfuRequestsRef.current.clear();
        socketRef.current = null;
        if (!isClosed) {
          reconnectTimerRef.current = window.setTimeout(connect, 2000);
        }
      };
    };

    const pendingVoiceSfuRequests = pendingVoiceSfuRequestsRef.current;

    connect();

    return () => {
      authenticatedRef.current = false;
      isClosed = true;
      setConnected(false);
      setPing(null);
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      for (const pending of pendingVoiceSfuRequests.values()) {
        window.clearTimeout(pending.timeoutId);
        pending.reject(new Error('Socket connection closed'));
      }
      pendingVoiceSfuRequests.clear();
      joinedChannelIds.clear();
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [params.token, sendEvent]);

  useEffect(() => {
    if (!params.token || !connected) {
      return;
    }

    const nextSet = new Set(params.subscribedChannelIds.filter(Boolean));
    const joinedSet = joinedChannelIdsRef.current;

    for (const joinedChannelId of Array.from(joinedSet)) {
      if (nextSet.has(joinedChannelId)) {
        continue;
      }
      sendEvent('channel:leave', { channelId: joinedChannelId });
      joinedSet.delete(joinedChannelId);
    }

    for (const nextChannelId of nextSet) {
      if (joinedSet.has(nextChannelId)) {
        continue;
      }
      sendEvent('channel:join', { channelId: nextChannelId });
      joinedSet.add(nextChannelId);
    }
  }, [connected, params.token, params.subscribedChannelIds, sendEvent]);

  const sendMessage = useCallback(
    (channelId: string, content: string) => {
      return sendEvent('message:send', { channelId, content });
    },
    [sendEvent],
  );

  const joinVoice = useCallback(
    (channelId: string, options?: { muted?: boolean; deafened?: boolean }) => {
      return sendEvent('voice:join', {
        channelId,
        ...(options?.muted !== undefined ? { muted: options.muted } : {}),
        ...(options?.deafened !== undefined ? { deafened: options.deafened } : {}),
      });
    },
    [sendEvent],
  );

  const leaveVoice = useCallback(
    (channelId?: string) => {
      return sendEvent('voice:leave', channelId ? { channelId } : {});
    },
    [sendEvent],
  );

  const sendVoiceSignal = useCallback(
    (channelId: string, targetUserId: string, data: unknown) => {
      return sendEvent('voice:signal', { channelId, targetUserId, data });
    },
    [sendEvent],
  );

  const sendVoiceSelfState = useCallback(
    (channelId: string, muted: boolean, deafened: boolean) => {
      return sendEvent('voice:self-state', { channelId, muted, deafened });
    },
    [sendEvent],
  );

  const requestVoiceSfu = useCallback(
    <TData = unknown>(
      channelId: string,
      action: VoiceSfuRequestAction,
      data?: unknown,
      timeoutMs = 10_000,
    ): Promise<TData> => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN || !authenticatedRef.current) {
        return Promise.reject(new Error('Realtime connection is not active'));
      }
      const requestId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      return new Promise<TData>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          pendingVoiceSfuRequestsRef.current.delete(requestId);
          reject(new Error('SFU request timed out'));
        }, timeoutMs);
        pendingVoiceSfuRequestsRef.current.set(requestId, {
          resolve: (value) => resolve(value as TData),
          reject,
          timeoutId,
        });
        socket.send(
          JSON.stringify({
            type: 'voice:sfu:request',
            payload: {
              requestId,
              channelId,
              action,
              ...(data !== undefined ? { data } : {}),
            },
          }),
        );
      });
    },
    [],
  );

  const sendPresence = useCallback(
    (state: PresenceState) => {
      return sendEvent('presence:set', { state });
    },
    [sendEvent],
  );

  useEffect(() => {
    if (!connected) {
      setPing(null);
      return;
    }
    const interval = window.setInterval(() => {
      const start = Date.now();
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping', payload: { start } }));
      }
    }, 5000); // Ping every 5 seconds

    return () => {
      window.clearInterval(interval);
    };
  }, [connected]);

  const [ping, setPing] = useState<number | null>(null);

  return {
    connected,
    sendMessage,
    joinVoice,
    leaveVoice,
    sendVoiceSignal,
    sendVoiceSelfState,
    requestVoiceSfu,
    sendPresence,
    ping,
  };
}
