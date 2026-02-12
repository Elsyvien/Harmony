import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
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
  const uploadsDir = path.resolve(process.cwd(), 'uploads');

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
    '/uploads',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 30, timeWindow: 60_000 },
      },
    },
    async (request, reply) => {
      try {
        const part = await request.file();
        if (!part) {
          throw new AppError('ATTACHMENT_REQUIRED', 400, 'No attachment was uploaded');
        }

        await mkdir(uploadsDir, { recursive: true });

        const originalName = part.filename?.trim() ? part.filename.trim() : 'attachment';
        const cleanedOriginal = originalName
          .replace(/[^\w.\-() ]/g, '_')
          .slice(0, 120);
        const extension = path.extname(cleanedOriginal).slice(0, 12);
        const storedName = `${Date.now()}-${randomUUID()}${extension}`;
        const filePath = path.join(uploadsDir, storedName);

        let size = 0;
        part.file.on('data', (chunk: Buffer) => {
          size += chunk.length;
        });

        await pipeline(part.file, createWriteStream(filePath));

        if (size <= 0) {
          throw new AppError('EMPTY_ATTACHMENT', 400, 'Attachment cannot be empty');
        }

        reply.code(201).send({
          attachment: {
            url: `/uploads/${storedName}`,
            name: cleanedOriginal || 'attachment',
            type: part.mimetype || 'application/octet-stream',
            size,
          },
        });
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'FST_REQ_FILE_TOO_LARGE'
        ) {
          throw new AppError('ATTACHMENT_TOO_LARGE', 400, 'Attachment exceeds the 8MB limit');
        }
        throw error;
      }
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

  fastify.delete(
    '/channels/:id',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 20, timeWindow: 60_000 },
      },
    },
    async (request) => {
      if (!isAdminRole(request.user.role)) {
        throw new AppError('FORBIDDEN', 403, 'Admin permission required');
      }

      const { id: channelId } = channelIdParamsSchema.parse(request.params);
      const result = await options.channelService.deleteChannel(channelId);
      return result;
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
        attachment: body.attachment,
        userId: request.user.userId,
        userIsAdmin: isAdminRole(request.user.role),
      });
      fastify.wsGateway.broadcastMessage(channelId, message);

      reply.code(201).send({ message });
    },
  );
};
