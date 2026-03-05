import type { FastifyPluginAsync } from 'fastify';
import type { ChannelService } from '../services/channel.service.js';
import type { ServerService } from '../services/server.service.js';
import {
  createServerBodySchema,
  createServerInviteBodySchema,
  inviteCodeParamsSchema,
  inviteIdParamsSchema,
  listAuditLogsQuerySchema,
  moderateUserBodySchema,
  serverIdParamsSchema,
} from '../schemas/server.schema.js';
import { createAuthGuard } from './guards.js';

interface ServerRoutesOptions {
  channelService: ChannelService;
  serverService: ServerService;
}

export const serverRoutes: FastifyPluginAsync<ServerRoutesOptions> = async (fastify, options) => {
  const authPreHandler = createAuthGuard();

  fastify.get(
    '/servers',
    {
      preHandler: [authPreHandler],
      config: { rateLimit: { max: 120, timeWindow: 60_000 } },
    },
    async (request) => {
      const servers = await options.serverService.listServers(request.user.userId);
      return { servers };
    },
  );

  fastify.post(
    '/servers',
    {
      preHandler: [authPreHandler],
      config: { rateLimit: { max: 20, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const body = createServerBodySchema.parse(request.body);
      const server = await options.serverService.createServer(request.user.userId, {
        name: body.name,
        description: body.description,
        iconUrl: body.iconUrl,
      });
      reply.code(201).send({ server });
    },
  );

  fastify.get(
    '/servers/:serverId',
    {
      preHandler: [authPreHandler],
      config: { rateLimit: { max: 120, timeWindow: 60_000 } },
    },
    async (request) => {
      const { serverId } = serverIdParamsSchema.parse(request.params);
      const server = await options.serverService.getServerForUser(serverId, request.user.userId);
      return { server };
    },
  );

  fastify.get(
    '/servers/:serverId/channels',
    {
      preHandler: [authPreHandler],
      config: { rateLimit: { max: 120, timeWindow: 60_000 } },
    },
    async (request) => {
      const { serverId } = serverIdParamsSchema.parse(request.params);
      const channels = await options.channelService.listServerChannels(serverId, request.user.userId);
      return { channels };
    },
  );

  fastify.get(
    '/servers/:serverId/members',
    {
      preHandler: [authPreHandler],
      config: { rateLimit: { max: 120, timeWindow: 60_000 } },
    },
    async (request) => {
      const { serverId } = serverIdParamsSchema.parse(request.params);
      const members = await options.serverService.listMembers(request.user.userId, serverId);
      return { members };
    },
  );

  fastify.get(
    '/servers/:serverId/analytics',
    {
      preHandler: [authPreHandler],
      config: { rateLimit: { max: 80, timeWindow: 60_000 } },
    },
    async (request) => {
      const { serverId } = serverIdParamsSchema.parse(request.params);
      const analytics = await options.serverService.getAnalytics(request.user.userId, serverId);
      return { analytics };
    },
  );

  fastify.get(
    '/servers/:serverId/audit-logs',
    {
      preHandler: [authPreHandler],
      config: { rateLimit: { max: 80, timeWindow: 60_000 } },
    },
    async (request) => {
      const { serverId } = serverIdParamsSchema.parse(request.params);
      const query = listAuditLogsQuerySchema.parse(request.query ?? {});
      const logs = await options.serverService.listAuditLogs(request.user.userId, serverId, query.limit);
      return { logs };
    },
  );

  fastify.post(
    '/servers/:serverId/moderation/actions',
    {
      preHandler: [authPreHandler],
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const { serverId } = serverIdParamsSchema.parse(request.params);
      const body = moderateUserBodySchema.parse(request.body ?? {});
      const action = await options.serverService.moderateUser(request.user.userId, {
        serverId,
        targetUserId: body.targetUserId,
        type: body.type,
        reason: body.reason,
        durationHours: body.durationHours,
      });
      reply.code(201).send({ action });
    },
  );

  fastify.get(
    '/servers/:serverId/invites',
    {
      preHandler: [authPreHandler],
      config: { rateLimit: { max: 120, timeWindow: 60_000 } },
    },
    async (request) => {
      const { serverId } = serverIdParamsSchema.parse(request.params);
      const invites = await options.serverService.listInvites(request.user.userId, serverId);
      return { invites };
    },
  );

  fastify.post(
    '/servers/:serverId/invites',
    {
      preHandler: [authPreHandler],
      config: { rateLimit: { max: 40, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const { serverId } = serverIdParamsSchema.parse(request.params);
      const body = createServerInviteBodySchema.parse(request.body ?? {});
      const invite = await options.serverService.createInvite(request.user.userId, {
        serverId,
        expiresInHours: body.expiresInHours,
        maxUses: body.maxUses,
      });
      reply.code(201).send({ invite });
    },
  );

  fastify.delete(
    '/servers/:serverId/invites/:inviteId',
    {
      preHandler: [authPreHandler],
      config: { rateLimit: { max: 40, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const { serverId, inviteId } = inviteIdParamsSchema.parse(request.params);
      await options.serverService.revokeInvite(request.user.userId, serverId, inviteId);
      reply.code(204).send();
    },
  );

  fastify.post(
    '/servers/invites/:code/join',
    {
      preHandler: [authPreHandler],
      config: { rateLimit: { max: 40, timeWindow: 60_000 } },
    },
    async (request) => {
      const { code } = inviteCodeParamsSchema.parse(request.params);
      const server = await options.serverService.joinByInvite(request.user.userId, code);
      return { server };
    },
  );
};
