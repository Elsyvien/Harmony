import type { FastifyPluginAsync } from 'fastify';
import type { FastifyRequest } from 'fastify';
import type { ChannelService } from '../services/channel.service.js';
import type { MessageService } from '../services/message.service.js';
import {
  channelIdParamsSchema,
  createMessageBodySchema,
  listMessagesQuerySchema,
} from '../schemas/message.schema.js';

interface ChannelRoutesOptions {
  channelService: ChannelService;
  messageService: MessageService;
}

export const channelRoutes: FastifyPluginAsync<ChannelRoutesOptions> = async (fastify, options) => {
  const authPreHandler = async (request: FastifyRequest) => {
    await request.jwtVerify();
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
      });
      fastify.wsGateway.broadcastMessage(channelId, message);

      reply.code(201).send({ message });
    },
  );
};
