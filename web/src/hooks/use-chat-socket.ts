import { useCallback, useEffect, useRef, useState } from 'react';
import type { Channel, Message } from '../types/api';
import { trackTelemetry } from '../utils/telemetry';

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

export interface VoiceJoinAckPayload {
  channelId: string;
  requestId?: string;
}

export interface RealtimeErrorPayload {
  code?: string;
  message?: string;
}

export type VoiceSfuRequestAction =
  | 'get-rtp-capabilities'
  | 'create-transport'
  | 'connect-transport'
  | 'close-transport'
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

export interface MessageReceiptEventPayload {
  channelId: string;
  userId: string;
  upToMessageId: string;
  at: string;
}

export function useChatSocket(params: {
  token: string | null;
  subscribedChannelIds: string[];
  onMessageNew: (message: Message) => void;
  onMessageUpdated?: (message: Message) => void;
  onMessageDeleted?: (message: Message) => void;
  onMessageReaction?: (payload: MessageReactionEventPayload) => void;
  onMessageDelivered?: (payload: MessageReceiptEventPayload) => void;
  onMessageRead?: (payload: MessageReceiptEventPayload) => void;
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
  const reconnectAttemptRef = useRef(0);
  const joinedChannelIdsRef = useRef<Set<string>>(new Set());
  const pendingVoiceJoinRequestsRef = useRef(
    new Map<
      string,
      {
        resolve: (payload: VoiceJoinAckPayload) => void;
        reject: (reason?: unknown) => void;
        timeoutId: number;
      }
    >(),
  );
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
  const onMessageDeliveredRef = useRef(params.onMessageDelivered);
  const onMessageReadRef = useRef(params.onMessageRead);
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
  onMessageDeliveredRef.current = params.onMessageDelivered;
  onMessageReadRef.current = params.onMessageRead;
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

      if (reconnectAttemptRef.current > 0) {
        trackTelemetry({
          name: 'ws.reconnect.attempted',
          context: {
            attempt: reconnectAttemptRef.current,
          },
        });
      } else {
        trackTelemetry({
          name: 'ws.connect.attempted',
          context: {
            url: WS_URL,
          },
        });
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
            if (reconnectAttemptRef.current > 0) {
              trackTelemetry({
                name: 'ws.reconnect.succeeded',
                context: {
                  attempt: reconnectAttemptRef.current,
                },
              });
            } else {
              trackTelemetry({
                name: 'ws.connect.succeeded',
                context: {
                  url: WS_URL,
                },
              });
            }
            reconnectAttemptRef.current = 0;
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

          if (parsed.type === 'message:delivered') {
            const payload = parsed.payload as MessageReceiptEventPayload | undefined;
            if (payload?.channelId && payload.userId && payload.upToMessageId) {
              onMessageDeliveredRef.current?.(payload);
            }
            return;
          }

          if (parsed.type === 'message:read') {
            const payload = parsed.payload as MessageReceiptEventPayload | undefined;
            if (payload?.channelId && payload.userId && payload.upToMessageId) {
              onMessageReadRef.current?.(payload);
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

          if (parsed.type === 'voice:join:ack') {
            const payload = parsed.payload as VoiceJoinAckPayload | undefined;
            if (!payload?.requestId || !payload.channelId) {
              return;
            }
            const pending = pendingVoiceJoinRequestsRef.current.get(payload.requestId);
            if (!pending) {
              return;
            }
            window.clearTimeout(pending.timeoutId);
            pendingVoiceJoinRequestsRef.current.delete(payload.requestId);
            pending.resolve(payload);
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
              if (payload.code === 'VOICE_SIGNAL_RATE_LIMITED') {
                trackTelemetry({
                  name: 'voice.signal.rate_limited',
                  level: 'warn',
                  success: false,
                  context: {
                    channelId: undefined,
                  },
                });
              }
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

      socket.onerror = () => {
        if (reconnectAttemptRef.current > 0) {
          trackTelemetry({
            name: 'ws.reconnect.failed',
            level: 'warn',
            success: false,
            context: {
              attempt: reconnectAttemptRef.current,
              reason: 'socket_error',
            },
          });
        } else {
          trackTelemetry({
            name: 'ws.connect.failed',
            level: 'warn',
            success: false,
            context: {
              url: WS_URL,
              reason: 'socket_error',
            },
          });
        }
      };

      socket.onclose = (event) => {
        authenticatedRef.current = false;
        setConnected(false);
        setPing(null);
        trackTelemetry({
          name: 'ws.disconnected.warn',
          level: 'warn',
          success: false,
          context: {
            code: event.code,
            reason: event.reason || 'socket_closed',
          },
        });
        for (const pending of pendingVoiceSfuRequestsRef.current.values()) {
          window.clearTimeout(pending.timeoutId);
          pending.reject(new Error('Socket connection closed'));
        }
        pendingVoiceSfuRequestsRef.current.clear();
        for (const pending of pendingVoiceJoinRequestsRef.current.values()) {
          window.clearTimeout(pending.timeoutId);
          pending.reject(new Error('Socket connection closed'));
        }
        pendingVoiceJoinRequestsRef.current.clear();
        socketRef.current = null;
        if (!isClosed) {
          reconnectAttemptRef.current += 1;
          reconnectTimerRef.current = window.setTimeout(connect, 2000);
        }
      };
    };

    const pendingVoiceJoinRequests = pendingVoiceJoinRequestsRef.current;
    const pendingVoiceSfuRequests = pendingVoiceSfuRequestsRef.current;

    connect();

    return () => {
      authenticatedRef.current = false;
      isClosed = true;
      setConnected(false);
      setPing(null);
      reconnectAttemptRef.current = 0;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      for (const pending of pendingVoiceSfuRequests.values()) {
        window.clearTimeout(pending.timeoutId);
        pending.reject(new Error('Socket connection closed'));
      }
      pendingVoiceSfuRequests.clear();
      for (const pending of pendingVoiceJoinRequests.values()) {
        window.clearTimeout(pending.timeoutId);
        pending.reject(new Error('Socket connection closed'));
      }
      pendingVoiceJoinRequests.clear();
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
      trackTelemetry({
        name: 'voice.join.attempted',
        context: {
          channelId,
          muted: Boolean(options?.muted),
          deafened: Boolean(options?.deafened),
        },
      });
      return sendEvent('voice:join', {
        channelId,
        ...(options?.muted !== undefined ? { muted: options.muted } : {}),
        ...(options?.deafened !== undefined ? { deafened: options.deafened } : {}),
      });
    },
    [sendEvent],
  );

  const joinVoiceWithAck = useCallback(
    (
      channelId: string,
      options?: { muted?: boolean; deafened?: boolean },
      timeoutMs = 5_000,
    ): Promise<VoiceJoinAckPayload> => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN || !authenticatedRef.current) {
        trackTelemetry({
          name: 'voice.join.failed',
          level: 'warn',
          success: false,
          context: {
            channelId,
            muted: Boolean(options?.muted),
            deafened: Boolean(options?.deafened),
            code: 'REALTIME_NOT_ACTIVE',
          },
        });
        return Promise.reject(new Error('Realtime connection is not active'));
      }
      const startedAt = Date.now();
      trackTelemetry({
        name: 'voice.join.attempted',
        context: {
          channelId,
          muted: Boolean(options?.muted),
          deafened: Boolean(options?.deafened),
        },
      });
      const requestId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      return new Promise<VoiceJoinAckPayload>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          pendingVoiceJoinRequestsRef.current.delete(requestId);
          trackTelemetry({
            name: 'voice.join.failed',
            level: 'warn',
            success: false,
            durationMs: Date.now() - startedAt,
            context: {
              channelId,
              muted: Boolean(options?.muted),
              deafened: Boolean(options?.deafened),
              code: 'VOICE_JOIN_TIMEOUT',
            },
          });
          reject(new Error('Voice join timed out'));
        }, timeoutMs);
        pendingVoiceJoinRequestsRef.current.set(requestId, {
          resolve: (payload) => {
            trackTelemetry({
              name: 'voice.join.succeeded',
              success: true,
              durationMs: Date.now() - startedAt,
              context: {
                channelId: payload.channelId,
                muted: Boolean(options?.muted),
                deafened: Boolean(options?.deafened),
              },
            });
            resolve(payload);
          },
          reject,
          timeoutId,
        });
        try {
          socket.send(
            JSON.stringify({
              type: 'voice:join',
              payload: {
                requestId,
                channelId,
                ...(options?.muted !== undefined ? { muted: options.muted } : {}),
                ...(options?.deafened !== undefined ? { deafened: options.deafened } : {}),
              },
            }),
          );
        } catch (error) {
          window.clearTimeout(timeoutId);
          pendingVoiceJoinRequestsRef.current.delete(requestId);
          trackTelemetry({
            name: 'voice.join.failed',
            level: 'warn',
            success: false,
            durationMs: Date.now() - startedAt,
            context: {
              channelId,
              muted: Boolean(options?.muted),
              deafened: Boolean(options?.deafened),
              code: 'VOICE_JOIN_SEND_FAILED',
            },
          });
          reject(error);
        }
      });
    },
    [],
  );

  const leaveVoice = useCallback(
    (channelId?: string) => {
      const sent = sendEvent('voice:leave', channelId ? { channelId } : {});
      if (sent) {
        trackTelemetry({
          name: 'voice.leave.succeeded',
          success: true,
          context: {
            channelId: channelId ?? 'active',
          },
        });
      }
      return sent;
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
    joinVoiceWithAck,
    leaveVoice,
    sendVoiceSignal,
    sendVoiceSelfState,
    requestVoiceSfu,
    sendPresence,
    ping,
  };
}






