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

interface ClientContext {
  userId: string | null;
  role: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER' | null;
  joinedChannels: Set<string>;
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

  const leaveAllChannels = (ctx: ClientContext) => {
    for (const channelId of [...ctx.joinedChannels]) {
      leaveChannel(ctx, channelId);
    }
  };

  const unregisterUser = (ctx: ClientContext) => {
    if (!ctx.userId) {
      return;
    }

    const subscribers = userSubscribers.get(ctx.userId);
    if (!subscribers) {
      return;
    }
    subscribers.delete(ctx);
    if (subscribers.size === 0) {
      userSubscribers.delete(ctx.userId);
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
  });

  fastify.get('/ws', { websocket: true }, (socket) => {
    const ctx: ClientContext = {
      userId: null,
      role: null,
      joinedChannels: new Set<string>(),
      socket: socket,
    };

    socket.on('message', async (raw: unknown) => {
      try {
        const parsed = JSON.parse(String(raw)) as { type?: string; payload?: unknown };
        if (!parsed.type) {
          throw new AppError('INVALID_EVENT', 400, 'Missing event type');
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
            select: { id: true, role: true, isSuspended: true, suspendedUntil: true },
          });
          if (!dbUser) {
            throw new AppError('INVALID_SESSION', 401, 'Session is no longer valid. Please log in again.');
          }
          if (isSuspensionActive(dbUser.isSuspended, dbUser.suspendedUntil)) {
            throw new AppError('ACCOUNT_SUSPENDED', 403, 'Your account is currently suspended');
          }
          ctx.userId = user.userId;
          ctx.role = dbUser.role;
          const subscribers = userSubscribers.get(user.userId) ?? new Set<ClientContext>();
          subscribers.add(ctx);
          userSubscribers.set(user.userId, subscribers);
          send(ctx, 'auth:ok', { userId: user.userId });
          return;
        }

        if (!ctx.userId) {
          throw new AppError('UNAUTHORIZED', 401, 'Authenticate first');
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
      unregisterUser(ctx);
    });
  });
};

export const wsPlugin = fp(wsPluginImpl, {
  name: 'ws-plugin',
});
