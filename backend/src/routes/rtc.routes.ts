import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createAuthGuard } from './guards.js';
import type { CloudflareRealtimeSfuApiClient } from '../services/cloudflare-realtime-sfu-api.client.js';

const sessionIdParamsSchema = z.object({
  sessionId: z.string().min(1),
});

const jsonObjectBodySchema = z.record(z.string(), z.unknown());

interface RtcRoutesOptions {
  cloudflareRealtimeSfuApi: CloudflareRealtimeSfuApiClient;
}

export const rtcRoutes: FastifyPluginAsync<RtcRoutesOptions> = async (fastify, options) => {
  const authPreHandler = createAuthGuard();

  fastify.post(
    '/rtc/cloudflare/sessions/new',
    {
      preHandler: [authPreHandler],
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const body = jsonObjectBodySchema.parse(request.body ?? {});
      const upstream = await options.cloudflareRealtimeSfuApi.createSession(body);
      reply.code(upstream.status).send(upstream.body);
    },
  );

  fastify.get(
    '/rtc/cloudflare/sessions/:sessionId',
    {
      preHandler: [authPreHandler],
      config: { rateLimit: { max: 120, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const { sessionId } = sessionIdParamsSchema.parse(request.params);
      const upstream = await options.cloudflareRealtimeSfuApi.getSession(sessionId);
      reply.code(upstream.status).send(upstream.body);
    },
  );

  fastify.post(
    '/rtc/cloudflare/sessions/:sessionId/tracks/new',
    {
      preHandler: [authPreHandler],
      config: { rateLimit: { max: 120, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const { sessionId } = sessionIdParamsSchema.parse(request.params);
      const body = jsonObjectBodySchema.parse(request.body ?? {});
      const upstream = await options.cloudflareRealtimeSfuApi.addTracks(sessionId, body);
      reply.code(upstream.status).send(upstream.body);
    },
  );

  fastify.put(
    '/rtc/cloudflare/sessions/:sessionId/renegotiate',
    {
      preHandler: [authPreHandler],
      config: { rateLimit: { max: 120, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const { sessionId } = sessionIdParamsSchema.parse(request.params);
      const body = jsonObjectBodySchema.parse(request.body ?? {});
      const upstream = await options.cloudflareRealtimeSfuApi.renegotiate(sessionId, body);
      reply.code(upstream.status).send(upstream.body);
    },
  );

  fastify.put(
    '/rtc/cloudflare/sessions/:sessionId/tracks/close',
    {
      preHandler: [authPreHandler],
      config: { rateLimit: { max: 120, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const { sessionId } = sessionIdParamsSchema.parse(request.params);
      const body = jsonObjectBodySchema.parse(request.body ?? {});
      const upstream = await options.cloudflareRealtimeSfuApi.closeTracks(sessionId, body);
      reply.code(upstream.status).send(upstream.body);
    },
  );
};