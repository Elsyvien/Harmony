import type { FastifyPluginAsync } from 'fastify';
import type { FastifyRequest } from 'fastify';
import type { ChannelService } from '../services/channel.service.js';
import type { MessageService } from '../services/message.service.js';
import { prisma } from '../repositories/prisma.js';
import {
  channelIdParamsSchema,
  createChannelBodySchema,
  createMessageBodySchema,
  directChannelParamsSchema,
  listMessagesQuerySchema,
} from '../schemas/message.schema.js';
import { AppError } from '../utils/app-error.js';
import { isAdminRole } from '../utils/roles.js';
import { isSuspensionActive } from '../utils/suspension.js';

interface ChannelRoutesOptions {
  channelService: ChannelService;
  messageService: MessageService;
}

export const channelRoutes: FastifyPluginAsync<ChannelRoutesOptions> = async (fastify, options) => {
  const authPreHandler = async (request: FastifyRequest) => {
    await request.jwtVerify();
    const user = await prisma.user.findUnique({
      where: { id: request.user.userId },
      select: { id: true, role: true, isSuspended: true, suspendedUntil: true },
    });
    if (!user) {
      throw new AppError('INVALID_SESSION', 401, 'Session is no longer valid. Please log in again.');
    }
    if (isSuspensionActive(user.isSuspended, user.suspendedUntil)) {
      throw new AppError('ACCOUNT_SUSPENDED', 403, 'Your account is currently suspended');
    }
    request.user.role = user.role;
    request.user.isAdmin = isAdminRole(user.role);
  };

  fastify.get(
    '/channels',
    {
      preHandler: [authPreHandler],
    },
    async (request) => {
      const channels = await options.channelService.listChannels(request.user.userId);
      return { channels };
    },
  );

  fastify.post(
    '/channels',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 10, timeWindow: 60_000 },
      },
    },
    async (request, reply) => {
      if (!isAdminRole(request.user.role)) {
        throw new AppError('FORBIDDEN', 403, 'Admin permission required');
      }

      const body = createChannelBodySchema.parse(request.body);
      const channel = await options.channelService.createChannel(body.name);
      reply.code(201).send({ channel });
    },
  );

  fastify.post(
    '/channels/direct/:userId',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 30, timeWindow: 60_000 },
      },
    },
    async (request) => {
      const { userId } = directChannelParamsSchema.parse(request.params);
      const opened = await options.channelService.openDirectChannel(request.user.userId, userId);
      if (opened.isNew) {
        const targetView = await options.channelService.openDirectChannel(userId, request.user.userId);
        fastify.wsGateway.notifyUsers([userId], 'dm:new', {
          channel: targetView.channel,
          from: {
            id: request.user.userId,
            username: request.user.username,
          },
        });
      }
      return { channel: opened.channel };
    },
  );

  fastify.get(
    '/channels/:id/messages',
    {
      preHandler: [authPreHandler],
    },
    async (request) => {
      const { id: channelId } = channelIdParamsSchema.parse(request.params);
      const query = listMessagesQuerySchema.parse(request.query);
      const before = query.before ? new Date(query.before) : undefined;

      const messages = await options.messageService.listMessages({
        channelId,
        userId: request.user.userId,
        before,
        limit: query.limit,
      });
      return { messages };
    },
  );

  fastify.post(
    '/channels/:id/messages',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 30, timeWindow: 60_000 },
      },
    },
    async (request, reply) => {
      const { id: channelId } = channelIdParamsSchema.parse(request.params);
      const body = createMessageBodySchema.parse(request.body);

      const message = await options.messageService.createMessage({
        channelId,
        content: body.content,
        userId: request.user.userId,
        userIsAdmin: isAdminRole(request.user.role),
      });
      fastify.wsGateway.broadcastMessage(channelId, message);

      reply.code(201).send({ message });
    },
  );
};
