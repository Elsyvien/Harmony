import type { FastifyPluginAsync } from 'fastify';
import { friendshipIdParamsSchema, friendRequestBodySchema } from '../schemas/friend.schema.js';
import type { FriendService } from '../services/friend.service.js';
import { createAuthGuard } from './guards.js';

interface FriendRoutesOptions {
  friendService: FriendService;
}

export const friendRoutes: FastifyPluginAsync<FriendRoutesOptions> = async (fastify, options) => {
  const authPreHandler = createAuthGuard();

  fastify.get(
    '/friends',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 40, timeWindow: 60_000 },
      },
    },
    async (request) => {
      const friends = await options.friendService.listFriends(request.user.userId);
      return { friends };
    },
  );

  fastify.get(
    '/friends/requests',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 40, timeWindow: 60_000 },
      },
    },
    async (request) => {
      const requests = await options.friendService.listRequests(request.user.userId);
      return requests;
    },
  );

  fastify.post(
    '/friends/requests',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 20, timeWindow: 60_000 },
      },
    },
    async (request, reply) => {
      const body = friendRequestBodySchema.parse(request.body);
      const created = await options.friendService.sendRequest(request.user.userId, body.username);
      fastify.wsGateway.notifyUsers([created.from.id, created.to.id], 'friend:request:new', {
        request: created,
      });
      reply.code(201).send({ request: created });
    },
  );

  fastify.post(
    '/friends/requests/:id/accept',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 25, timeWindow: 60_000 },
      },
    },
    async (request) => {
      const { id } = friendshipIdParamsSchema.parse(request.params);
      const accepted = await options.friendService.acceptRequest(request.user.userId, id);
      fastify.wsGateway.notifyUsers(accepted.userIds, 'friend:request:updated', {
        kind: 'accepted',
        requestId: accepted.requestId,
        friendship: accepted.friendship,
      });
      return { friendship: accepted.friendship };
    },
  );

  fastify.post(
    '/friends/requests/:id/decline',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 25, timeWindow: 60_000 },
      },
    },
    async (request, reply) => {
      const { id } = friendshipIdParamsSchema.parse(request.params);
      const declined = await options.friendService.declineRequest(request.user.userId, id);
      fastify.wsGateway.notifyUsers(declined.userIds, 'friend:request:updated', {
        kind: 'declined',
        requestId: declined.removedRequestId,
      });
      reply.code(204).send();
    },
  );

  fastify.post(
    '/friends/requests/:id/cancel',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 25, timeWindow: 60_000 },
      },
    },
    async (request, reply) => {
      const { id } = friendshipIdParamsSchema.parse(request.params);
      const cancelled = await options.friendService.cancelRequest(request.user.userId, id);
      fastify.wsGateway.notifyUsers(cancelled.userIds, 'friend:request:updated', {
        kind: 'cancelled',
        requestId: cancelled.removedRequestId,
      });
      reply.code(204).send();
    },
  );

  fastify.delete(
    '/friends/:id',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 20, timeWindow: 60_000 },
      },
    },
    async (request, reply) => {
      const { id } = friendshipIdParamsSchema.parse(request.params);
      const removed = await options.friendService.removeFriend(request.user.userId, id);
      fastify.wsGateway.notifyUsers(removed.userIds, 'friend:request:updated', {
        kind: 'removed',
        friendshipId: removed.removedFriendshipId,
      });
      reply.code(204).send();
    },
  );
};
