import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyPluginAsync } from 'fastify';
import type { ChannelService } from '../services/channel.service.js';
import type { MessageService } from '../services/message.service.js';
import {
  channelIdParamsSchema,
  channelMessageParamsSchema,
  createChannelBodySchema,
  createMessageBodySchema,
  directChannelParamsSchema,
  listMessagesQuerySchema,
  toggleReactionBodySchema,
  updateMessageBodySchema,
  updateVoiceSettingsBodySchema,
} from '../schemas/message.schema.js';
import { AppError } from '../utils/app-error.js';
import { isAdminRole } from '../utils/roles.js';
import { createAuthGuard } from './guards.js';

interface ChannelRoutesOptions {
  channelService: ChannelService;
  messageService: MessageService;
}

export const channelRoutes: FastifyPluginAsync<ChannelRoutesOptions> = async (fastify, options) => {
  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  const deleteFileIfExists = async (filePath: string) => {
    try {
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  };

  const authPreHandler = createAuthGuard();
  const adminAuthPreHandler = createAuthGuard({ requiredRole: 'ADMIN' });
  const privilegedAuthPreHandler = createAuthGuard({ requiredRole: 'PRIVILEGED' });

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
      let filePath: string | null = null;
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
        filePath = path.join(uploadsDir, storedName);

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
        if (filePath) {
          await deleteFileIfExists(filePath);
        }
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
      preHandler: [adminAuthPreHandler],
      config: {
        rateLimit: { max: 10, timeWindow: 60_000 },
      },
    },
    async (request, reply) => {
      const body = createChannelBodySchema.parse(request.body);
      const channel = await options.channelService.createChannel(body.name, body.type);
      reply.code(201).send({ channel });
    },
  );

  fastify.delete(
    '/channels/:id',
    {
      preHandler: [adminAuthPreHandler],
      config: {
        rateLimit: { max: 20, timeWindow: 60_000 },
      },
    },
    async (request) => {
      const { id: channelId } = channelIdParamsSchema.parse(request.params);
      const result = await options.channelService.deleteChannel(channelId);
      return result;
    },
  );

  fastify.patch(
    '/channels/:id/voice-settings',
    {
      preHandler: [privilegedAuthPreHandler],
      config: {
        rateLimit: { max: 30, timeWindow: 60_000 },
      },
    },
    async (request) => {
      const { id: channelId } = channelIdParamsSchema.parse(request.params);
      const body = updateVoiceSettingsBodySchema.parse(request.body);
      const channel = await options.channelService.updateVoiceChannelSettings(channelId, {
        voiceBitrateKbps: body.voiceBitrateKbps,
        streamBitrateKbps: body.streamBitrateKbps,
      });
      fastify.wsGateway.broadcastSystem('channel:updated', { channel });
      return { channel };
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
        replyToMessageId: body.replyToMessageId,
        attachment: body.attachment,
        userId: request.user.userId,
        userIsAdmin: isAdminRole(request.user.role),
      });
      fastify.wsGateway.broadcastMessage(channelId, message);

      reply.code(201).send({ message });
    },
  );

  fastify.patch(
    '/channels/:id/messages/:messageId',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 30, timeWindow: 60_000 },
      },
    },
    async (request) => {
      const { id: channelId, messageId } = channelMessageParamsSchema.parse(request.params);
      const body = updateMessageBodySchema.parse(request.body);

      const message = await options.messageService.updateMessage({
        channelId,
        messageId,
        userId: request.user.userId,
        userIsAdmin: isAdminRole(request.user.role),
        content: body.content,
      });
      fastify.wsGateway.broadcastMessageUpdated(channelId, message);

      return { message };
    },
  );

  fastify.delete(
    '/channels/:id/messages/:messageId',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 30, timeWindow: 60_000 },
      },
    },
    async (request) => {
      const { id: channelId, messageId } = channelMessageParamsSchema.parse(request.params);
      const message = await options.messageService.deleteMessage({
        channelId,
        messageId,
        userId: request.user.userId,
        userIsAdmin: isAdminRole(request.user.role),
      });

      fastify.wsGateway.broadcastMessageDeleted(channelId, message);
      return { message };
    },
  );

  fastify.post(
    '/channels/:id/messages/:messageId/reactions',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 80, timeWindow: 60_000 },
      },
    },
    async (request) => {
      const { id: channelId, messageId } = channelMessageParamsSchema.parse(request.params);
      const body = toggleReactionBodySchema.parse(request.body);
      const result = await options.messageService.toggleReaction({
        channelId,
        messageId,
        userId: request.user.userId,
        emoji: body.emoji,
      });

      fastify.wsGateway.broadcastMessageReaction(channelId, result.message, {
        userId: request.user.userId,
        emoji: body.emoji,
        reacted: result.reacted,
      });
      return {
        message: result.message,
        reacted: result.reacted,
        emoji: body.emoji,
      };
    },
  );
};
