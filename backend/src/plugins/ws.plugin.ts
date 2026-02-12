import websocket from '@fastify/websocket';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { ChannelService } from '../services/channel.service.js';
import type { MessageService } from '../services/message.service.js';
import { prisma } from '../repositories/prisma.js';
import { AppError } from '../utils/app-error.js';
import { isAdminRole } from '../utils/roles.js';
import { isSuspensionActive } from '../utils/suspension.js';

interface WsPluginOptions {
  channelService: ChannelService;
  messageService: MessageService;
}

interface VoiceParticipantState {
  userId: string;
  username: string;
  avatarUrl?: string;
  muted: boolean;
  deafened: boolean;
}

type PresenceState = 'online' | 'idle' | 'dnd';

interface PresenceUser {
  id: string;
  username: string;
  avatarUrl?: string;
  state: PresenceState;
}

interface ClientContext {
  userId: string | null;
  username: string | null;
  avatarUrl: string | null;
  role: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER' | null;
  joinedChannels: Set<string>;
  state: PresenceState;
  lastActivity: number;
  socket: {
    send: (data: string) => void;
    on: (event: 'message' | 'close', handler: (raw?: unknown) => void | Promise<void>) => void;
    readyState: number;
  };
}

const WS_OPEN_STATE = 1;

const wsPluginImpl: FastifyPluginAsync<WsPluginOptions> = async (fastify, options) => {
  await fastify.register(websocket);

  const channelSubscribers = new Map<string, Set<ClientContext>>();
  const userSubscribers = new Map<string, Set<ClientContext>>();
  const voiceParticipants = new Map<string, Map<string, VoiceParticipantState>>();
  const activeVoiceChannelByUser = new Map<string, string>();

  // Global settings for idle timeout
  let idleTimeoutMinutes = 15;

  const refreshSettings = async () => {
    try {
      const settings = await prisma.appSettings.findUnique({ where: { id: 'global' } });
      if (settings) {
        idleTimeoutMinutes = settings.idleTimeoutMinutes;
      }
    } catch {
      // Ignore
    }
  };
  await refreshSettings();

  const send = (ctx: ClientContext, type: string, payload: unknown) => {
    if (ctx.socket.readyState === WS_OPEN_STATE) {
      ctx.socket.send(JSON.stringify({ type, payload }));
    }
  };

  const leaveChannel = (ctx: ClientContext, channelId: string) => {
    const subscribers = channelSubscribers.get(channelId);
    if (!subscribers) {
      return;
    }

    subscribers.delete(ctx);
    if (subscribers.size === 0) {
      channelSubscribers.delete(channelId);
    }
    ctx.joinedChannels.delete(channelId);
  };

  // Heartbeat to check for idle users
  const checkIdleUsers = () => {
    const now = Date.now();
    let changed = false;
    for (const subscribers of userSubscribers.values()) {
      for (const client of subscribers) {
        if (client.state === 'online') {
          const diffMs = now - client.lastActivity;
          if (diffMs > idleTimeoutMinutes * 60 * 1000) {
            client.state = 'idle';
            changed = true;
          }
        }
      }
    }
    if (changed) {
      broadcastPresence();
    }
  };
  const idleInterval = setInterval(checkIdleUsers, 60000); // Check every minute

  const leaveAllChannels = (ctx: ClientContext) => {
    for (const channelId of [...ctx.joinedChannels]) {
      leaveChannel(ctx, channelId);
    }
  };

  const unregisterUser = (ctx: ClientContext) => {
    if (!ctx.userId) {
      return false;
    }

    const subscribers = userSubscribers.get(ctx.userId);
    if (!subscribers) {
      return false;
    }
    subscribers.delete(ctx);
    if (subscribers.size === 0) {
      userSubscribers.delete(ctx.userId);
    }
    return true;
  };

  const getOnlineUsers = () => {
    const users: PresenceUser[] = [];
    for (const [userId, subscribers] of userSubscribers) {
      const client = [...subscribers][0];
      if (!client || !client.username) {
        continue;
      }

      // Aggregate state: DND > Online > Idle
      // If any connection is Online, user is Online. If all Idle, user is Idle.
      // If any is DND, it takes priority if no one is Online? 
      // Discord usually shows the most active state.
      let finalState: PresenceState = 'idle';
      const clients = [...subscribers];
      if (clients.some(c => c.state === 'online')) {
        finalState = 'online';
      } else if (clients.some(c => c.state === 'dnd')) {
        finalState = 'dnd';
      }

      users.push({
        id: userId,
        username: client.username,
        avatarUrl: client.avatarUrl ?? undefined,
        state: finalState,
      });
    }
    return users.sort((a, b) => a.username.localeCompare(b.username));
  };

  const broadcastPresence = () => {
    const payload = { users: getOnlineUsers() };
    const delivered = new Set<ClientContext>();
    for (const subscribers of userSubscribers.values()) {
      for (const client of subscribers) {
        if (delivered.has(client)) {
          continue;
        }
        send(client, 'presence:update', payload);
        delivered.add(client);
      }
    }
  };

  const broadcastVoiceState = (channelId: string) => {
    const participants = Array.from(voiceParticipants.get(channelId)?.values() ?? []).sort((a, b) =>
      a.username.localeCompare(b.username),
    );
    const payload = { channelId, participants };
    const delivered = new Set<ClientContext>();

    for (const subscribers of userSubscribers.values()) {
      for (const client of subscribers) {
        if (delivered.has(client)) {
          continue;
        }
        send(client, 'voice:state', payload);
        delivered.add(client);
      }
    }
  };

  const sendVoiceStateSnapshot = (ctx: ClientContext) => {
    for (const [channelId, participantsMap] of voiceParticipants.entries()) {
      const participants = Array.from(participantsMap.values()).sort((a, b) =>
        a.username.localeCompare(b.username),
      );
      send(ctx, 'voice:state', { channelId, participants });
    }
  };

  const leaveVoiceChannel = (userId: string, explicitChannelId?: string) => {
    const currentChannelId = explicitChannelId ?? activeVoiceChannelByUser.get(userId);
    if (!currentChannelId) {
      return;
    }

    const participants = voiceParticipants.get(currentChannelId);
    if (!participants) {
      activeVoiceChannelByUser.delete(userId);
      return;
    }

    participants.delete(userId);
    activeVoiceChannelByUser.delete(userId);

    if (participants.size === 0) {
      voiceParticipants.delete(currentChannelId);
    }
    broadcastVoiceState(currentChannelId);
  };

  const applyUserProfileUpdate = (
    userId: string,
    profile: { username: string; avatarUrl: string | null },
  ) => {
    const subscribers = userSubscribers.get(userId);
    if (subscribers) {
      for (const client of subscribers) {
        client.username = profile.username;
        client.avatarUrl = profile.avatarUrl;
      }
    }

    const channelsToUpdate = new Set<string>();
    for (const [channelId, participants] of voiceParticipants.entries()) {
      if (!participants.has(userId)) {
        continue;
      }
      participants.set(userId, {
        userId,
        username: profile.username,
        avatarUrl: profile.avatarUrl ?? undefined,
        muted: participants.get(userId)?.muted ?? false,
        deafened: participants.get(userId)?.deafened ?? false,
      });
      channelsToUpdate.add(channelId);
    }

    for (const channelId of channelsToUpdate) {
      broadcastVoiceState(channelId);
    }
  };

  fastify.decorate('wsGateway', {
    broadcastMessage: (channelId: string, message: unknown) => {
      const subscribers = channelSubscribers.get(channelId);
      if (!subscribers) {
        return;
      }

      for (const client of subscribers) {
        send(client, 'message:new', { message });
      }
    },
    broadcastMessageUpdated: (channelId: string, message: unknown) => {
      const subscribers = channelSubscribers.get(channelId);
      if (!subscribers) {
        return;
      }

      for (const client of subscribers) {
        send(client, 'message:updated', { message });
      }
    },
    broadcastMessageDeleted: (channelId: string, message: unknown) => {
      const subscribers = channelSubscribers.get(channelId);
      if (!subscribers) {
        return;
      }

      for (const client of subscribers) {
        send(client, 'message:deleted', { message });
      }
    },
    broadcastMessageReaction: (
      channelId: string,
      message: unknown,
      meta: { userId: string; emoji: string; reacted: boolean },
    ) => {
      const subscribers = channelSubscribers.get(channelId);
      if (!subscribers) {
        return;
      }

      for (const client of subscribers) {
        send(client, 'message:reaction', { message, ...meta });
      }
    },
    notifyUsers: (userIds: string[], type: string, payload: unknown) => {
      for (const userId of userIds) {
        const subscribers = userSubscribers.get(userId);
        if (!subscribers) {
          continue;
        }
        for (const client of subscribers) {
          send(client, type, payload);
        }
      }
    },
    broadcastSystem: (type: string, payload: unknown) => {
      const delivered = new Set<ClientContext>();
      for (const subscribers of userSubscribers.values()) {
        for (const client of subscribers) {
          if (delivered.has(client)) {
            continue;
          }
          send(client, type, payload);
          delivered.add(client);
        }
      }
    },
    broadcastPresence: () => {
      broadcastPresence();
    },
    updateUserProfile: (userId: string, profile: { username: string; avatarUrl: string | null }) => {
      applyUserProfileUpdate(userId, profile);
      broadcastPresence();
    },
  });

  fastify.get('/ws', { websocket: true }, (socket) => {
    const ctx: ClientContext = {
      userId: null,
      username: null,
      avatarUrl: null,
      role: null,
      joinedChannels: new Set<string>(),
      state: 'online',
      lastActivity: Date.now(),
      socket: socket,
    };

    socket.on('message', async (raw: unknown) => {
      try {
        const parsed = JSON.parse(String(raw)) as { type?: string; payload?: unknown };
        if (!parsed.type) {
          throw new AppError('INVALID_EVENT', 400, 'Missing event type');
        }

        // Update activity on any event
        ctx.lastActivity = Date.now();
        if (ctx.state === 'idle') {
          ctx.state = 'online';
          broadcastPresence();
        }

        if (parsed.type === 'auth') {
          const payload = parsed.payload as { token?: string };
          if (!payload?.token) {
            throw new AppError('INVALID_AUTH', 401, 'Missing auth token');
          }

          const user = await fastify.jwt.verify<{
            userId: string;
            username: string;
            email: string;
            role: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER';
          }>(payload.token);
          const dbUser = await prisma.user.findUnique({
            where: { id: user.userId },
            select: {
              id: true,
              username: true,
              avatarUrl: true,
              role: true,
              isSuspended: true,
              suspendedUntil: true,
            },
          });
          if (!dbUser) {
            throw new AppError('INVALID_SESSION', 401, 'Session is no longer valid. Please log in again.');
          }
          if (isSuspensionActive(dbUser.isSuspended, dbUser.suspendedUntil)) {
            throw new AppError('ACCOUNT_SUSPENDED', 403, 'Your account is currently suspended');
          }
          ctx.userId = user.userId;
          ctx.username = dbUser.username;
          ctx.avatarUrl = dbUser.avatarUrl;
          ctx.role = dbUser.role;
          const subscribers = userSubscribers.get(user.userId) ?? new Set<ClientContext>();
          subscribers.add(ctx);
          userSubscribers.set(user.userId, subscribers);
          send(ctx, 'auth:ok', { userId: user.userId });
          broadcastPresence();
          sendVoiceStateSnapshot(ctx);
          return;
        }

        if (!ctx.userId) {
          throw new AppError('UNAUTHORIZED', 401, 'Authenticate first');
        }

        if (parsed.type === 'presence:set') {
          const payload = parsed.payload as { state?: PresenceState };
          if (payload?.state === 'online' || payload?.state === 'dnd' || payload?.state === 'idle') {
            ctx.state = payload.state;
            broadcastPresence();
          }
          return;
        }

        if (parsed.type === 'channel:join') {
          const payload = parsed.payload as { channelId?: string };
          if (!payload?.channelId) {
            throw new AppError('INVALID_CHANNEL', 400, 'Missing channelId');
          }

          const canAccessChannel = await options.channelService.ensureChannelAccess(
            payload.channelId,
            ctx.userId,
          );
          if (!canAccessChannel) {
            throw new AppError('CHANNEL_NOT_FOUND', 404, 'Channel not found');
          }

          const subscribers = channelSubscribers.get(payload.channelId) ?? new Set<ClientContext>();
          subscribers.add(ctx);
          channelSubscribers.set(payload.channelId, subscribers);
          ctx.joinedChannels.add(payload.channelId);
          send(ctx, 'channel:joined', { channelId: payload.channelId });
          return;
        }

        if (parsed.type === 'channel:leave') {
          const payload = parsed.payload as { channelId?: string };
          if (!payload?.channelId) {
            throw new AppError('INVALID_CHANNEL', 400, 'Missing channelId');
          }
          leaveChannel(ctx, payload.channelId);
          send(ctx, 'channel:left', { channelId: payload.channelId });
          return;
        }

        if (parsed.type === 'voice:join') {
          const payload = parsed.payload as {
            channelId?: string;
            muted?: boolean;
            deafened?: boolean;
          };
          if (!payload?.channelId) {
            throw new AppError('INVALID_CHANNEL', 400, 'Missing channelId');
          }
          if (!ctx.username) {
            throw new AppError('INVALID_SESSION', 401, 'Session is no longer valid. Please log in again.');
          }

          const channel = await options.channelService.getChannelSummaryForUser(
            payload.channelId,
            ctx.userId,
          );
          if (!channel) {
            throw new AppError('CHANNEL_NOT_FOUND', 404, 'Channel not found');
          }
          if (!channel.isVoice) {
            throw new AppError('INVALID_VOICE_CHANNEL', 400, 'Channel is not a voice channel');
          }

          const existingChannelId = activeVoiceChannelByUser.get(ctx.userId);
          if (existingChannelId && existingChannelId !== payload.channelId) {
            leaveVoiceChannel(ctx.userId, existingChannelId);
          }

          const participants = voiceParticipants.get(payload.channelId) ?? new Map();
          const deafened = Boolean(payload.deafened);
          const muted = deafened ? true : Boolean(payload.muted);
          participants.set(ctx.userId, {
            userId: ctx.userId,
            username: ctx.username,
            avatarUrl: ctx.avatarUrl ?? undefined,
            muted,
            deafened,
          });
          voiceParticipants.set(payload.channelId, participants);
          activeVoiceChannelByUser.set(ctx.userId, payload.channelId);
          broadcastVoiceState(payload.channelId);
          return;
        }

        if (parsed.type === 'voice:leave') {
          const payload = parsed.payload as { channelId?: string } | undefined;
          leaveVoiceChannel(ctx.userId, payload?.channelId);
          return;
        }

        if (parsed.type === 'voice:self-state') {
          const payload = parsed.payload as {
            channelId?: string;
            muted?: boolean;
            deafened?: boolean;
          };
          const activeChannelId = activeVoiceChannelByUser.get(ctx.userId);
          if (!activeChannelId) {
            throw new AppError('VOICE_NOT_JOINED', 403, 'Join the voice channel first');
          }
          if (payload?.channelId && payload.channelId !== activeChannelId) {
            throw new AppError('INVALID_CHANNEL', 400, 'Invalid channelId for voice state');
          }
          const participants = voiceParticipants.get(activeChannelId);
          const currentParticipant = participants?.get(ctx.userId);
          if (!participants || !currentParticipant) {
            throw new AppError('VOICE_NOT_JOINED', 403, 'Join the voice channel first');
          }

          const deafened = Boolean(payload?.deafened);
          const muted = deafened ? true : Boolean(payload?.muted);
          participants.set(ctx.userId, {
            ...currentParticipant,
            muted,
            deafened,
          });
          broadcastVoiceState(activeChannelId);
          return;
        }

        if (parsed.type === 'voice:signal') {
          const payload = parsed.payload as {
            channelId?: string;
            targetUserId?: string;
            data?: unknown;
          };
          if (!payload?.channelId || !payload.targetUserId || payload.data === undefined) {
            throw new AppError('INVALID_SIGNAL', 400, 'Missing channelId, targetUserId or data');
          }

          const senderVoiceChannel = activeVoiceChannelByUser.get(ctx.userId);
          if (senderVoiceChannel !== payload.channelId) {
            throw new AppError('VOICE_NOT_JOINED', 403, 'Join the voice channel first');
          }
          const participants = voiceParticipants.get(payload.channelId);
          if (!participants?.has(payload.targetUserId)) {
            throw new AppError('VOICE_TARGET_NOT_AVAILABLE', 404, 'Target user is not in this voice channel');
          }

          fastify.wsGateway.notifyUsers([payload.targetUserId], 'voice:signal', {
            channelId: payload.channelId,
            fromUserId: ctx.userId,
            data: payload.data,
          });
          return;
        }

        if (parsed.type === 'message:send') {
          const payload = parsed.payload as { channelId?: string; content?: string };
          if (!payload?.channelId || typeof payload.content !== 'string') {
            throw new AppError('INVALID_MESSAGE', 400, 'Missing channelId or content');
          }

          const message = await options.messageService.createMessage({
            channelId: payload.channelId,
            content: payload.content,
            userId: ctx.userId,
            userIsAdmin: isAdminRole(ctx.role),
          });

          fastify.wsGateway.broadcastMessage(payload.channelId, message);
          return;
        }

        if (parsed.type === 'ping') {
          send(ctx, 'pong', parsed.payload);
          return;
        }

        throw new AppError('UNKNOWN_EVENT', 400, `Unknown event: ${parsed.type}`);
      } catch (error) {
        if (error instanceof AppError) {
          send(ctx, 'error', { code: error.code, message: error.message });
          return;
        }
        send(ctx, 'error', { code: 'WS_ERROR', message: 'Could not process websocket event' });
      }
    });

    socket.on('close', () => {
      leaveAllChannels(ctx);
      if (ctx.userId) {
        leaveVoiceChannel(ctx.userId);
      }
      const changed = unregisterUser(ctx);
      if (changed) {
        broadcastPresence();
      }
    });
  });
};

export const wsPlugin = fp(wsPluginImpl, {
  name: 'ws-plugin',
});
