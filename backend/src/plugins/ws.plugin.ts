import websocket from '@fastify/websocket';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { ChannelService } from '../services/channel.service.js';
import type { MessageService } from '../services/message.service.js';
import type { VoiceSfuService } from '../services/voice-sfu.service.js';
import { prisma } from '../repositories/prisma.js';
import { AppError } from '../utils/app-error.js';
import { isAdminRole } from '../utils/roles.js';
import { isSuspensionActive } from '../utils/suspension.js';

interface WsPluginOptions {
  channelService: ChannelService;
  messageService: MessageService;
  voiceSfuService: VoiceSfuService;
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
  activeVoiceChannelId: string | null;
  state: PresenceState;
  lastActivity: number;
  voiceSignalWindowStartedAt: number;
  voiceSignalCountInWindow: number;
  voiceSignalRateLimitNotified: boolean;
  socket: {
    send: (data: string) => void;
    on: (event: 'message' | 'close', handler: (raw?: unknown) => void | Promise<void>) => void;
    readyState: number;
  };
}

type VoiceSfuRequestAction =
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

type VoiceSfuRequestPayload = {
  requestId?: string;
  channelId?: string;
  action?: VoiceSfuRequestAction;
  data?: unknown;
};

const WS_OPEN_STATE = 1;
const VOICE_SIGNAL_WINDOW_MS = 5_000;
const VOICE_SIGNAL_MAX_PER_WINDOW = 400;

const wsPluginImpl: FastifyPluginAsync<WsPluginOptions> = async (fastify, options) => {
  await fastify.register(websocket);

  const channelSubscribers = new Map<string, Set<ClientContext>>();
  const userSubscribers = new Map<string, Set<ClientContext>>();
  const voiceParticipants = new Map<string, Map<string, VoiceParticipantState>>();
  const activeVoiceChannelByUser = new Map<string, string>();
  const voiceSessionCountByUser = new Map<string, number>();

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

  const consumeVoiceSignalBudget = (ctx: ClientContext): 'ok' | 'limited-notify' | 'limited-silent' => {
    const now = Date.now();
    if (now - ctx.voiceSignalWindowStartedAt >= VOICE_SIGNAL_WINDOW_MS) {
      ctx.voiceSignalWindowStartedAt = now;
      ctx.voiceSignalCountInWindow = 0;
      ctx.voiceSignalRateLimitNotified = false;
    }

    ctx.voiceSignalCountInWindow += 1;
    if (ctx.voiceSignalCountInWindow <= VOICE_SIGNAL_MAX_PER_WINDOW) {
      return 'ok';
    }

    if (!ctx.voiceSignalRateLimitNotified) {
      ctx.voiceSignalRateLimitNotified = true;
      return 'limited-notify';
    }

    return 'limited-silent';
  };

  const logVoiceEvent = (
    level: 'debug' | 'info' | 'warn' | 'error',
    event: string,
    details: Record<string, unknown>,
  ) => {
    fastify.log[level]({ event, ...details }, 'voice-event');
  };

  const getVoiceParticipantUserIds = (channelId: string) =>
    Array.from(voiceParticipants.get(channelId)?.keys() ?? []);

  const notifyVoiceChannelUsers = (
    channelId: string,
    type: string,
    payload: unknown,
    options?: { excludeUserId?: string },
  ) => {
    const userIds = getVoiceParticipantUserIds(channelId).filter(
      (userId) => userId !== options?.excludeUserId,
    );
    if (userIds.length === 0) {
      return;
    }
    fastify.wsGateway.notifyUsers(userIds, type, payload);
  };

  const sendSfuResponse = (
    ctx: ClientContext,
    requestId: string,
    response: { ok: boolean; data?: unknown; code?: string; message?: string },
  ) => {
    send(ctx, 'voice:sfu:response', {
      requestId,
      ...response,
    });
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
  fastify.addHook('onClose', async () => {
    clearInterval(idleInterval);
  });

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
      let finalState: PresenceState = 'idle';
      const clients = [...subscribers];
      if (clients.some(c => c.state === 'dnd')) {
        finalState = 'dnd';
      } else if (clients.some(c => c.state === 'online')) {
        finalState = 'online';
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

  const leaveVoiceChannel = (
    userId: string,
    explicitChannelId?: string,
    leaveOptions?: { force?: boolean },
  ) => {
    const currentChannelId = explicitChannelId ?? activeVoiceChannelByUser.get(userId);
    if (!currentChannelId) {
      return;
    }

    const participants = voiceParticipants.get(currentChannelId);
    if (!participants) {
      activeVoiceChannelByUser.delete(userId);
      voiceSessionCountByUser.delete(userId);
      if (options.voiceSfuService.enabled) {
        const removedProducers = options.voiceSfuService.removePeer(currentChannelId, userId);
        for (const producer of removedProducers) {
          notifyVoiceChannelUsers(currentChannelId, 'voice:sfu:event', {
            channelId: currentChannelId,
            event: 'producer-removed',
            producerId: producer.producerId,
            userId: producer.userId,
          });
        }
      }
      return;
    }

    if (leaveOptions?.force) {
      voiceSessionCountByUser.delete(userId);
    } else {
      const nextSessionCount = Math.max(0, (voiceSessionCountByUser.get(userId) ?? 0) - 1);
      if (nextSessionCount > 0) {
        voiceSessionCountByUser.set(userId, nextSessionCount);
        return;
      }
      voiceSessionCountByUser.delete(userId);
    }

    participants.delete(userId);
    activeVoiceChannelByUser.delete(userId);
    let removedSfuProducers: ReturnType<VoiceSfuService['removePeer']> = [];
    if (options.voiceSfuService.enabled) {
      removedSfuProducers = options.voiceSfuService.removePeer(currentChannelId, userId);
    }

    if (participants.size === 0) {
      voiceParticipants.delete(currentChannelId);
    }
    for (const producer of removedSfuProducers) {
      notifyVoiceChannelUsers(currentChannelId, 'voice:sfu:event', {
        channelId: currentChannelId,
        event: 'producer-removed',
        producerId: producer.producerId,
        userId: producer.userId,
      });
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

      if (type === 'admin:settings:updated') {
        void refreshSettings();
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
      activeVoiceChannelId: null,
      state: 'online',
      lastActivity: Date.now(),
      voiceSignalWindowStartedAt: Date.now(),
      voiceSignalCountInWindow: 0,
      voiceSignalRateLimitNotified: false,
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
          if (ctx.userId) {
            throw new AppError('ALREADY_AUTHENTICATED', 400, 'Socket is already authenticated');
          }
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
            const subscribers = userSubscribers.get(ctx.userId);
            if (subscribers) {
              for (const client of subscribers) {
                client.state = payload.state;
                client.lastActivity = Date.now();
              }
            }
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
            logVoiceEvent('warn', 'voice_join_invalid_channel', {
              userId: ctx.userId,
            });
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
            logVoiceEvent('warn', 'voice_join_channel_not_found', {
              userId: ctx.userId,
              channelId: payload.channelId,
            });
            throw new AppError('CHANNEL_NOT_FOUND', 404, 'Channel not found');
          }
          if (!channel.isVoice) {
            logVoiceEvent('warn', 'voice_join_not_voice_channel', {
              userId: ctx.userId,
              channelId: payload.channelId,
            });
            throw new AppError('INVALID_VOICE_CHANNEL', 400, 'Channel is not a voice channel');
          }

          const existingChannelId = activeVoiceChannelByUser.get(ctx.userId);
          if (existingChannelId && existingChannelId !== payload.channelId) {
            leaveVoiceChannel(ctx.userId, existingChannelId, { force: true });
            const userClients = userSubscribers.get(ctx.userId);
            if (userClients) {
              for (const client of userClients) {
                client.activeVoiceChannelId = null;
              }
            }
          }

          if (ctx.activeVoiceChannelId && ctx.activeVoiceChannelId !== payload.channelId) {
            leaveVoiceChannel(ctx.userId, ctx.activeVoiceChannelId);
            ctx.activeVoiceChannelId = null;
          }

          if (ctx.activeVoiceChannelId !== payload.channelId) {
            const nextSessionCount = (voiceSessionCountByUser.get(ctx.userId) ?? 0) + 1;
            voiceSessionCountByUser.set(ctx.userId, nextSessionCount);
            ctx.activeVoiceChannelId = payload.channelId;
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
          logVoiceEvent('info', 'voice_join_ok', {
            userId: ctx.userId,
            channelId: payload.channelId,
            muted,
            deafened,
            participants: participants.size,
          });
          broadcastVoiceState(payload.channelId);
          return;
        }

        if (parsed.type === 'voice:leave') {
          const payload = parsed.payload as { channelId?: string } | undefined;
          const targetChannelId = payload?.channelId ?? ctx.activeVoiceChannelId ?? undefined;
          leaveVoiceChannel(ctx.userId, targetChannelId);
          logVoiceEvent('info', 'voice_leave_ok', {
            userId: ctx.userId,
            channelId: targetChannelId ?? null,
          });
          if (!payload?.channelId || payload.channelId === ctx.activeVoiceChannelId) {
            ctx.activeVoiceChannelId = null;
          }
          return;
        }

        if (parsed.type === 'voice:self-state') {
          const payload = parsed.payload as {
            channelId?: string;
            muted?: boolean;
            deafened?: boolean;
          };
          const activeChannelId = ctx.activeVoiceChannelId ?? activeVoiceChannelByUser.get(ctx.userId);
          if (!activeChannelId) {
            logVoiceEvent('warn', 'voice_self_state_not_joined', {
              userId: ctx.userId,
              requestedChannelId: payload?.channelId ?? null,
            });
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
          logVoiceEvent('info', 'voice_self_state_ok', {
            userId: ctx.userId,
            channelId: activeChannelId,
            muted,
            deafened,
          });
          broadcastVoiceState(activeChannelId);
          return;
        }

        if (parsed.type === 'voice:sfu:request') {
          const payload = parsed.payload as VoiceSfuRequestPayload;
          if (!payload?.requestId || typeof payload.requestId !== 'string') {
            throw new AppError('INVALID_SFU_REQUEST', 400, 'Missing requestId');
          }
          if (!payload.channelId || !payload.action) {
            sendSfuResponse(ctx, payload.requestId, {
              ok: false,
              code: 'INVALID_SFU_REQUEST',
              message: 'Missing channelId or action',
            });
            return;
          }
          if (!options.voiceSfuService.enabled) {
            sendSfuResponse(ctx, payload.requestId, {
              ok: false,
              code: 'SFU_DISABLED',
              message: 'Server-side voice transport is disabled',
            });
            return;
          }

          const activeChannelId = ctx.activeVoiceChannelId ?? activeVoiceChannelByUser.get(ctx.userId);
          if (activeChannelId !== payload.channelId) {
            sendSfuResponse(ctx, payload.requestId, {
              ok: false,
              code: 'VOICE_NOT_JOINED',
              message: 'Join the voice channel first',
            });
            return;
          }

          try {
            if (payload.action === 'get-rtp-capabilities') {
              const rtpCapabilities = await options.voiceSfuService.getRouterRtpCapabilities(payload.channelId);
              sendSfuResponse(ctx, payload.requestId, {
                ok: true,
                data: {
                  rtpCapabilities,
                  audioOnly: options.voiceSfuService.audioOnly,
                },
              });
              return;
            }

            if (payload.action === 'create-transport') {
              const requestData = payload.data as { direction?: 'send' | 'recv' } | undefined;
              if (requestData?.direction !== 'send' && requestData?.direction !== 'recv') {
                throw new AppError('INVALID_SFU_REQUEST', 400, 'Missing transport direction');
              }
              const transport = await options.voiceSfuService.createTransport(
                payload.channelId,
                ctx.userId,
                requestData.direction,
              );
              sendSfuResponse(ctx, payload.requestId, {
                ok: true,
                data: {
                  transport,
                },
              });
              return;
            }

            if (payload.action === 'connect-transport') {
              const requestData = payload.data as {
                transportId?: string;
                dtlsParameters?: unknown;
              } | undefined;
              if (!requestData?.transportId || !requestData.dtlsParameters) {
                throw new AppError('INVALID_SFU_REQUEST', 400, 'Missing transportId or dtlsParameters');
              }
              await options.voiceSfuService.connectTransport(
                payload.channelId,
                ctx.userId,
                requestData.transportId,
                requestData.dtlsParameters as Parameters<VoiceSfuService['connectTransport']>[3],
              );
              sendSfuResponse(ctx, payload.requestId, {
                ok: true,
                data: { connected: true },
              });
              return;
            }

            if (payload.action === 'produce') {
              const requestData = payload.data as {
                transportId?: string;
                kind?: 'audio' | 'video';
                rtpParameters?: unknown;
                appData?: Record<string, unknown>;
              } | undefined;
              if (!requestData?.transportId || !requestData.kind || !requestData.rtpParameters) {
                throw new AppError('INVALID_SFU_REQUEST', 400, 'Missing produce payload fields');
              }
              const producer = await options.voiceSfuService.produce(
                payload.channelId,
                ctx.userId,
                requestData.transportId,
                requestData.kind,
                requestData.rtpParameters as Parameters<VoiceSfuService['produce']>[4],
                requestData.appData,
              );
              notifyVoiceChannelUsers(
                payload.channelId,
                'voice:sfu:event',
                {
                  channelId: payload.channelId,
                  event: 'producer-added',
                  producer,
                },
                { excludeUserId: ctx.userId },
              );
              sendSfuResponse(ctx, payload.requestId, {
                ok: true,
                data: { producer },
              });
              return;
            }

            if (payload.action === 'close-producer') {
              const requestData = payload.data as { producerId?: string } | undefined;
              if (!requestData?.producerId) {
                throw new AppError('INVALID_SFU_REQUEST', 400, 'Missing producerId');
              }
              const closed = await options.voiceSfuService.closeProducer(
                payload.channelId,
                ctx.userId,
                requestData.producerId,
              );
              if (closed) {
                notifyVoiceChannelUsers(payload.channelId, 'voice:sfu:event', {
                  channelId: payload.channelId,
                  event: 'producer-removed',
                  producerId: requestData.producerId,
                  userId: ctx.userId,
                });
              }
              sendSfuResponse(ctx, payload.requestId, {
                ok: true,
                data: { closed },
              });
              return;
            }

            if (payload.action === 'list-producers') {
              const producers = options.voiceSfuService.getProducerInfos(payload.channelId, {
                excludeUserId: ctx.userId,
              });
              sendSfuResponse(ctx, payload.requestId, {
                ok: true,
                data: { producers },
              });
              return;
            }

            if (payload.action === 'consume') {
              const requestData = payload.data as {
                transportId?: string;
                producerId?: string;
                rtpCapabilities?: unknown;
              } | undefined;
              if (!requestData?.transportId || !requestData.producerId || !requestData.rtpCapabilities) {
                throw new AppError('INVALID_SFU_REQUEST', 400, 'Missing consume payload fields');
              }
              const consumer = await options.voiceSfuService.consume(
                payload.channelId,
                ctx.userId,
                requestData.transportId,
                requestData.producerId,
                requestData.rtpCapabilities as Parameters<VoiceSfuService['consume']>[4],
              );
              sendSfuResponse(ctx, payload.requestId, {
                ok: true,
                data: { consumer },
              });
              return;
            }

            if (payload.action === 'resume-consumer') {
              const requestData = payload.data as { consumerId?: string } | undefined;
              if (!requestData?.consumerId) {
                throw new AppError('INVALID_SFU_REQUEST', 400, 'Missing consumerId');
              }
              const resumed = await options.voiceSfuService.resumeConsumer(
                payload.channelId,
                ctx.userId,
                requestData.consumerId,
              );
              sendSfuResponse(ctx, payload.requestId, {
                ok: true,
                data: { resumed },
              });
              return;
            }

            if (payload.action === 'restart-ice') {
              const requestData = payload.data as { transportId?: string } | undefined;
              if (!requestData?.transportId) {
                throw new AppError('INVALID_SFU_REQUEST', 400, 'Missing transportId');
              }
              const result = await options.voiceSfuService.restartIce(
                payload.channelId,
                ctx.userId,
                requestData.transportId,
              );
              sendSfuResponse(ctx, payload.requestId, {
                ok: true,
                data: { iceParameters: result.iceParameters },
              });
              return;
            }

            if (payload.action === 'get-transport-stats') {
              const stats = options.voiceSfuService.getTransportStats(
                payload.channelId,
                ctx.userId,
              );
              sendSfuResponse(ctx, payload.requestId, {
                ok: true,
                data: { transports: stats },
              });
              return;
            }

            throw new AppError('INVALID_SFU_REQUEST', 400, `Unknown SFU action: ${payload.action}`);
          } catch (error) {
            if (error instanceof AppError) {
              sendSfuResponse(ctx, payload.requestId, {
                ok: false,
                code: error.code,
                message: error.message,
              });
              return;
            }
            sendSfuResponse(ctx, payload.requestId, {
              ok: false,
              code: 'SFU_REQUEST_FAILED',
              message: 'Could not process SFU request',
            });
            return;
          }
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

          const voiceSignalBudget = consumeVoiceSignalBudget(ctx);
          if (voiceSignalBudget !== 'ok') {
            if (voiceSignalBudget === 'limited-notify') {
              logVoiceEvent('warn', 'voice_signal_rate_limited', {
                userId: ctx.userId,
                channelId: payload.channelId,
                targetUserId: payload.targetUserId,
                countInWindow: ctx.voiceSignalCountInWindow,
                windowMs: VOICE_SIGNAL_WINDOW_MS,
              });
              send(ctx, 'error', {
                code: 'VOICE_SIGNAL_RATE_LIMITED',
                message: 'Voice signaling rate limit exceeded. Please wait and retry.',
              });
            }
            return;
          }

          const senderVoiceChannel = ctx.activeVoiceChannelId ?? activeVoiceChannelByUser.get(ctx.userId);
          if (senderVoiceChannel !== payload.channelId) {
            logVoiceEvent('warn', 'voice_signal_sender_not_joined', {
              userId: ctx.userId,
              senderVoiceChannel: senderVoiceChannel ?? null,
              requestedChannelId: payload.channelId,
              targetUserId: payload.targetUserId,
            });
            throw new AppError('VOICE_NOT_JOINED', 403, 'Join the voice channel first');
          }
          const participants = voiceParticipants.get(payload.channelId);
          if (!participants?.has(payload.targetUserId)) {
            logVoiceEvent('warn', 'voice_signal_target_not_available', {
              userId: ctx.userId,
              channelId: payload.channelId,
              targetUserId: payload.targetUserId,
            });
            throw new AppError('VOICE_TARGET_NOT_AVAILABLE', 404, 'Target user is not in this voice channel');
          }

          const signalKind =
            payload.data && typeof payload.data === 'object' && 'kind' in payload.data
              ? String((payload.data as { kind?: unknown }).kind ?? 'unknown')
              : 'unknown';
          logVoiceEvent('debug', 'voice_signal_forwarded', {
            userId: ctx.userId,
            channelId: payload.channelId,
            targetUserId: payload.targetUserId,
            signalKind,
          });
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
      if (ctx.userId && ctx.activeVoiceChannelId) {
        leaveVoiceChannel(ctx.userId, ctx.activeVoiceChannelId);
        ctx.activeVoiceChannelId = null;
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
