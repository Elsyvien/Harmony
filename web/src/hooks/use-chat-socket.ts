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

export interface PresenceUser {
  id: string;
  username: string;
}

export interface VoiceParticipant {
  userId: string;
  username: string;
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

export function useChatSocket(params: {
  token: string | null;
  activeChannelId: string | null;
  onMessageNew: (message: Message) => void;
  onFriendEvent?: () => void;
  onDmEvent?: (payload: DmNewEventPayload) => void;
  onChannelUpdated?: (channel: Channel) => void;
  onPresenceUpdate?: (users: PresenceUser[]) => void;
  onVoiceState?: (payload: VoiceStatePayload) => void;
  onVoiceSignal?: (payload: VoiceSignalPayload) => void;
}) {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const joinedChannelRef = useRef<string | null>(null);
  const activeChannelIdRef = useRef(params.activeChannelId);
  const onMessageNewRef = useRef(params.onMessageNew);
  const onFriendEventRef = useRef(params.onFriendEvent);
  const onDmEventRef = useRef(params.onDmEvent);
  const onChannelUpdatedRef = useRef(params.onChannelUpdated);
  const onPresenceUpdateRef = useRef(params.onPresenceUpdate);
  const onVoiceStateRef = useRef(params.onVoiceState);
  const onVoiceSignalRef = useRef(params.onVoiceSignal);
  const [connected, setConnected] = useState(false);

  onMessageNewRef.current = params.onMessageNew;
  onFriendEventRef.current = params.onFriendEvent;
  onDmEventRef.current = params.onDmEvent;
  onChannelUpdatedRef.current = params.onChannelUpdated;
  onPresenceUpdateRef.current = params.onPresenceUpdate;
  onVoiceStateRef.current = params.onVoiceState;
  onVoiceSignalRef.current = params.onVoiceSignal;
  activeChannelIdRef.current = params.activeChannelId;

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

    const connect = () => {
      if (isClosed) {
        return;
      }

      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
        sendEvent('auth', { token: params.token });
        if (activeChannelIdRef.current) {
          sendEvent('channel:join', { channelId: activeChannelIdRef.current });
          joinedChannelRef.current = activeChannelIdRef.current;
        }
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
          }
        } catch {
          // Ignore malformed event payloads from the server.
        }
      };

      socket.onclose = () => {
        setConnected(false);
        socketRef.current = null;
        if (!isClosed) {
          reconnectTimerRef.current = window.setTimeout(connect, 2000);
        }
      };
    };

    connect();

    return () => {
      isClosed = true;
      setConnected(false);
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [params.token, sendEvent]);

  useEffect(() => {
    const next = params.activeChannelId;
    const previous = joinedChannelRef.current;
    if (!params.token || !next) {
      return;
    }

    if (previous && previous !== next) {
      sendEvent('channel:leave', { channelId: previous });
    }
    if (previous !== next) {
      sendEvent('channel:join', { channelId: next });
      joinedChannelRef.current = next;
    }
  }, [params.token, params.activeChannelId, sendEvent]);

  const sendMessage = useCallback(
    (channelId: string, content: string) => {
      return sendEvent('message:send', { channelId, content });
    },
    [sendEvent],
  );

  const joinVoice = useCallback(
    (channelId: string) => {
      return sendEvent('voice:join', { channelId });
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

  return { connected, sendMessage, joinVoice, leaveVoice, sendVoiceSignal };
}
