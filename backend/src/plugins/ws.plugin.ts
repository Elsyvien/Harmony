import websocket from '@fastify/websocket';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { ChannelService } from '../services/channel.service.js';
import type { MessageService } from '../services/message.service.js';
import type { VoiceSfuService } from '../services/voice-sfu.service.js';
import { VoiceWsHandler, type VoiceClientContext, type VoiceSfuRequestPayload } from '../handlers/voice-ws.handler.js';
import { prisma } from '../repositories/prisma.js';
import { AppError } from '../utils/app-error.js';
import { isAdminRole } from '../utils/roles.js';
import { isSuspensionActive } from '../utils/suspension.js';

// ─── Plugin Options ──────────────────────────────────────────────────

interface WsPluginOptions {
  channelService: ChannelService;
  messageService: MessageService;
  voiceSfuService: VoiceSfuService;
}

// ─── Types ───────────────────────────────────────────────────────────

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

// ─── Constants ───────────────────────────────────────────────────────

const WS_OPEN_STATE = 1;
const VOICE_SIGNAL_WINDOW_MS = 5_000;
const VOICE_SIGNAL_MAX_PER_WINDOW = 400;

// ─── Plugin ──────────────────────────────────────────────────────────

const wsPluginImpl: FastifyPluginAsync<WsPluginOptions> = async (fastify, options) => {
  await fastify.register(websocket);

  // ── Core State ───────────────────────────────────────────────────

  const channelSubscribers = new Map<string, Set<ClientContext>>();
  const userSubscribers = new Map<string, Set<ClientContext>>();

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

  // ── Voice Handler ────────────────────────────────────────────────

  const voiceHandler = new VoiceWsHandler({
    voiceSfuService: options.voiceSfuService,
    channelService: options.channelService,
    log: fastify.log,
    notifyUsers: (userIds, type, payload) => {
      fastify.wsGateway.notifyUsers(userIds, type, payload);
    },
  });

  // ── Helpers ──────────────────────────────────────────────────────

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

  const leaveChannel = (ctx: ClientContext, channelId: string) => {
    const subscribers = channelSubscribers.get(channelId);
    if (!subscribers) return;
    subscribers.delete(ctx);
    if (subscribers.size === 0) {
      channelSubscribers.delete(channelId);
    }
    ctx.joinedChannels.delete(channelId);
  };

  const leaveAllChannels = (ctx: ClientContext) => {
    for (const channelId of [...ctx.joinedChannels]) {
      leaveChannel(ctx, channelId);
    }
  };

  const unregisterUser = (ctx: ClientContext): boolean => {
    if (!ctx.userId) return false;
    const subscribers = userSubscribers.get(ctx.userId);
    if (!subscribers) return false;
    subscribers.delete(ctx);
    if (subscribers.size === 0) {
      userSubscribers.delete(ctx.userId);
      return true;
    }
    return false;
  };

  const getOnlineUsers = (): PresenceUser[] => {
    const users: PresenceUser[] = [];
    const seen = new Set<string>();
    for (const [userId, subscribers] of userSubscribers) {
      if (seen.has(userId)) continue;
      seen.add(userId);
      const firstClient = subscribers.values().next().value;
      if (!firstClient) continue;
      users.push({
        id: userId,
        username: firstClient.username ?? 'Unknown',
        avatarUrl: firstClient.avatarUrl ?? undefined,
        state: firstClient.state,
      });
    }
    return users.sort((a, b) => a.username.localeCompare(b.username));
  };

  const broadcastPresence = () => {
    const payload = { users: getOnlineUsers() };
    const delivered = new Set<ClientContext>();
    for (const subscribers of userSubscribers.values()) {
      for (const client of subscribers) {
        if (delivered.has(client)) continue;
        send(client, 'presence:update', payload);
        delivered.add(client);
      }
    }
  };

  const broadcastVoiceStateAll = () => {
    // Send full voice state snapshot to all connected users
    const delivered = new Set<ClientContext>();
    for (const voiceState of voiceHandler.getAllVoiceStates()) {
      for (const subscribers of userSubscribers.values()) {
        for (const client of subscribers) {
          if (delivered.has(client)) continue;
          send(client, 'voice:state', voiceState);
          delivered.add(client);
        }
      }
    }
  };

  const sendVoiceStateSnapshot = (ctx: ClientContext) => {
    for (const voiceState of voiceHandler.getAllVoiceStates()) {
      send(ctx, 'voice:state', voiceState);
    }
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
  };

  // ── Idle check heartbeat ─────────────────────────────────────────

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
    if (changed) broadcastPresence();
  };

  const idleInterval = setInterval(checkIdleUsers, 60000);
  fastify.addHook('onClose', async () => {
    clearInterval(idleInterval);
  });

  // ── VoiceWsHandler voice:state broadcast hook ────────────────────
  // The VoiceWsHandler uses notifyUsers for voice-channel-scoped events,
  // but broadcastVoiceState needs to go to ALL connected users (sidebar).
  // We hook into a simple interval/on-demand check pattern.
  // Actually, we override the notifyUsers for voice:state to broadcast to all.
  const originalNotifyUsers = (userIds: string[], type: string, payload: unknown) => {
    for (const userId of userIds) {
      const subscribers = userSubscribers.get(userId);
      if (!subscribers) continue;
      for (const client of subscribers) {
        send(client, type, payload);
      }
    }
  };

  // Re-create voice handler with proper broadcast-to-all for voice:state
  const voiceHandlerWithBroadcast = new VoiceWsHandler({
    voiceSfuService: options.voiceSfuService,
    channelService: options.channelService,
    log: fastify.log,
    notifyUsers: (userIds, type, payload) => {
      if (type === 'voice:state') {
        // Broadcast to ALL connected users, not just voice participants
        const delivered = new Set<ClientContext>();
        for (const subscribers of userSubscribers.values()) {
          for (const client of subscribers) {
            if (delivered.has(client)) continue;
            send(client, type, payload);
            delivered.add(client);
          }
        }
      } else {
        originalNotifyUsers(userIds, type, payload);
      }
    },
  });

  // Use the broadcast version
  const voice = voiceHandlerWithBroadcast;

  // ── Gateway (public API exposed on fastify instance) ─────────────

  fastify.decorate('wsGateway', {
    broadcastMessage: (channelId: string, message: unknown) => {
      const subscribers = channelSubscribers.get(channelId);
      if (!subscribers) return;
      for (const client of subscribers) {
        send(client, 'message:new', { message });
      }
    },
    broadcastMessageUpdated: (channelId: string, message: unknown) => {
      const subscribers = channelSubscribers.get(channelId);
      if (!subscribers) return;
      for (const client of subscribers) {
        send(client, 'message:updated', { message });
      }
    },
    broadcastMessageDeleted: (channelId: string, message: unknown) => {
      const subscribers = channelSubscribers.get(channelId);
      if (!subscribers) return;
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
      if (!subscribers) return;
      for (const client of subscribers) {
        send(client, 'message:reaction', { message, ...meta });
      }
    },
    notifyUsers: (userIds: string[], type: string, payload: unknown) => {
      originalNotifyUsers(userIds, type, payload);
    },
    broadcastSystem: (type: string, payload: unknown) => {
      const delivered = new Set<ClientContext>();
      for (const subscribers of userSubscribers.values()) {
        for (const client of subscribers) {
          if (delivered.has(client)) continue;
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

  // ── WebSocket Endpoint ───────────────────────────────────────────

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

    /** Build a VoiceClientContext from the current ClientContext */
    const toVoiceCtx = (): VoiceClientContext => ({
      userId: ctx.userId!,
      username: ctx.username!,
      avatarUrl: ctx.avatarUrl,
      activeVoiceChannelId: ctx.activeVoiceChannelId,
    });

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

        // ── Auth ───────────────────────────────────────────────────

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

          // Resume voice session if reconnecting within grace period
          const resumedChannel = voice.onSocketReconnect(ctx.userId);
          if (resumedChannel) {
            ctx.activeVoiceChannelId = resumedChannel;
          }

          const subscribers = userSubscribers.get(user.userId) ?? new Set<ClientContext>();
          subscribers.add(ctx);
          userSubscribers.set(user.userId, subscribers);
          send(ctx, 'auth:ok', { userId: user.userId });
          broadcastPresence();
          sendVoiceStateSnapshot(ctx);
          return;
        }

        // ── Auth gate ──────────────────────────────────────────────

        if (!ctx.userId) {
          throw new AppError('UNAUTHORIZED', 401, 'Authenticate first');
        }

        // ── Presence ───────────────────────────────────────────────

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

        // ── Channel Join / Leave ───────────────────────────────────

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

        // ── Voice Join ─────────────────────────────────────────────

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
          const voiceCtx = toVoiceCtx();
          await voice.join(voiceCtx, payload.channelId, {
            muted: payload.muted,
            deafened: payload.deafened,
          });
          ctx.activeVoiceChannelId = voiceCtx.activeVoiceChannelId;
          return;
        }

        // ── Voice Leave ────────────────────────────────────────────

        if (parsed.type === 'voice:leave') {
          const payload = parsed.payload as { channelId?: string } | undefined;
          const voiceCtx = toVoiceCtx();
          voice.leave(voiceCtx, payload?.channelId);
          ctx.activeVoiceChannelId = voiceCtx.activeVoiceChannelId;
          return;
        }

        // ── Voice Self State ───────────────────────────────────────

        if (parsed.type === 'voice:self-state') {
          const payload = parsed.payload as {
            channelId?: string;
            muted?: boolean;
            deafened?: boolean;
          };
          const voiceCtx = toVoiceCtx();
          voice.updateSelfState(voiceCtx, {
            channelId: payload?.channelId,
            muted: payload?.muted,
            deafened: payload?.deafened,
          });
          return;
        }

        // ── Voice SFU Request ──────────────────────────────────────

        if (parsed.type === 'voice:sfu:request') {
          const payload = parsed.payload as {
            requestId?: string;
            channelId?: string;
            action?: string;
            data?: unknown;
          };
          if (!payload?.requestId || typeof payload.requestId !== 'string') {
            throw new AppError('INVALID_SFU_REQUEST', 400, 'Missing requestId');
          }
          if (!payload.channelId || !payload.action) {
            send(ctx, 'voice:sfu:response', {
              requestId: payload.requestId,
              ok: false,
              code: 'INVALID_SFU_REQUEST',
              message: 'Missing channelId or action',
            });
            return;
          }

          const voiceCtx = toVoiceCtx();
          const sfuPayload: VoiceSfuRequestPayload = {
            requestId: payload.requestId,
            channelId: payload.channelId,
            action: payload.action as VoiceSfuRequestPayload['action'],
            data: payload.data,
          };
          const response = await voice.handleSfuRequest(voiceCtx, sfuPayload);
          send(ctx, 'voice:sfu:response', {
            requestId: payload.requestId,
            ...response,
          });
          return;
        }

        // ── Voice Signal (Mesh peer-to-peer fallback) ──────────────

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
              fastify.log.warn(
                { event: 'voice_signal_rate_limited', userId: ctx.userId, channelId: payload.channelId },
                'voice-event',
              );
              send(ctx, 'error', {
                code: 'VOICE_SIGNAL_RATE_LIMITED',
                message: 'Voice signaling rate limit exceeded. Please wait and retry.',
              });
            }
            return;
          }

          const senderVoiceChannel = ctx.activeVoiceChannelId ?? voice.getActiveChannelForUser(ctx.userId);
          if (senderVoiceChannel !== payload.channelId) {
            throw new AppError('VOICE_NOT_JOINED', 403, 'Join the voice channel first');
          }

          const channelParticipants = voice.getParticipants(payload.channelId);
          const targetInChannel = channelParticipants.some((p) => p.userId === payload.targetUserId);
          if (!targetInChannel) {
            throw new AppError('VOICE_TARGET_NOT_AVAILABLE', 404, 'Target user is not in this voice channel');
          }

          fastify.wsGateway.notifyUsers([payload.targetUserId], 'voice:signal', {
            channelId: payload.channelId,
            fromUserId: ctx.userId,
            data: payload.data,
          });
          return;
        }

        // ── Message Send ───────────────────────────────────────────

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

        // ── Ping / Pong ────────────────────────────────────────────

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

    // ── Socket Close ─────────────────────────────────────────────────

    socket.on('close', () => {
      leaveAllChannels(ctx);

      // Start voice disconnect grace period instead of immediate teardown
      if (ctx.userId && ctx.activeVoiceChannelId) {
        voice.onSocketDisconnect(ctx.userId, ctx.activeVoiceChannelId);
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
