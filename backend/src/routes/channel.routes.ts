import type { FastifyPluginAsync } from 'fastify';
import type { FastifyRequest } from 'fastify';
import type { ChannelService } from '../services/channel.service.js';
import type { MessageService } from '../services/message.service.js';
import { prisma } from '../repositories/prisma.js';
import {
  channelIdParamsSchema,
  createChannelBodySchema,
  createMessageBodySchema,
  listMessagesQuerySchema,
} from '../schemas/message.schema.js';
import { AppError } from '../utils/app-error.js';

interface ChannelRoutesOptions {
  channelService: ChannelService;
  messageService: MessageService;
}

export const channelRoutes: FastifyPluginAsync<ChannelRoutesOptions> = async (fastify, options) => {
  const authPreHandler = async (request: FastifyRequest) => {
    await request.jwtVerify();
    const user = await prisma.user.findUnique({
      where: { id: request.user.userId },
      select: { id: true },
    });
    if (!user) {
      throw new AppError('INVALID_SESSION', 401, 'Session is no longer valid. Please log in again.');
    }
  };

  fastify.get(
    '/channels',
    {
      preHandler: [authPreHandler],
    },
    async () => {
      const channels = await options.channelService.listChannels();
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
      if (!request.user.isAdmin) {
        throw new AppError('FORBIDDEN', 403, 'Admin permission required');
      }

      const body = createChannelBodySchema.parse(request.body);
      const channel = await options.channelService.createChannel(body.name);
      reply.code(201).send({ channel });
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
        userIsAdmin: request.user.isAdmin,
      });
      fastify.wsGateway.broadcastMessage(channelId, message);

      reply.code(201).send({ message });
    },
  );
};
