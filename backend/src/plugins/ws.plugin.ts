import websocket from '@fastify/websocket';
import type { FastifyPluginAsync } from 'fastify';
import type { ChannelService } from '../services/channel.service.js';
import type { MessageService } from '../services/message.service.js';
import { AppError } from '../utils/app-error.js';

interface WsPluginOptions {
  channelService: ChannelService;
  messageService: MessageService;
}

interface ClientContext {
  userId: string | null;
  joinedChannels: Set<string>;
  socket: {
    send: (data: string) => void;
    on: (event: 'message' | 'close', handler: (raw?: unknown) => void | Promise<void>) => void;
    readyState: number;
  };
}

const WS_OPEN_STATE = 1;

export const wsPlugin: FastifyPluginAsync<WsPluginOptions> = async (fastify, options) => {
  await fastify.register(websocket);

  const channelSubscribers = new Map<string, Set<ClientContext>>();

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
  });

  fastify.get('/ws', { websocket: true }, (connection) => {
    const ctx: ClientContext = {
      userId: null,
      joinedChannels: new Set<string>(),
      socket: connection.socket,
    };

    connection.socket.on('message', async (raw: unknown) => {
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
            isAdmin: boolean;
          }>(payload.token);
          ctx.userId = user.userId;
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

          const exists = await options.channelService.ensureChannelExists(payload.channelId);
          if (!exists) {
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

    connection.socket.on('close', () => {
      leaveAllChannels(ctx);
    });
  });
};
