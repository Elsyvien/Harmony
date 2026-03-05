import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AnalyticsService } from '../services/analytics.service.js';

interface AnalyticsRoutesOptions {
  analyticsService: AnalyticsService;
}

const analyticsContextValueSchema = z.union([
  z.string().max(240),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const analyticsEventSchema = z.object({
  name: z
    .string()
    .trim()
    .min(5)
    .max(120)
    .regex(/^[a-z0-9]+(?:\.[a-z0-9]+){2,}$/),
  category: z.enum(['reliability', 'usage', 'moderation', 'operations']),
  level: z.enum(['info', 'warn', 'error']).optional(),
  timestamp: z.string().max(64).optional(),
  source: z.enum(['web_client']).optional(),
  sessionId: z.string().trim().max(120).optional(),
  requestId: z.string().trim().max(120).optional(),
  channelId: z.string().trim().max(120).optional(),
  success: z.boolean().optional(),
  durationMs: z.number().int().min(0).max(10 * 60 * 1000).optional(),
  statusCode: z.number().int().min(100).max(599).optional(),
  context: z.record(analyticsContextValueSchema).optional(),
});

const analyticsBatchSchema = z.object({
  events: z.array(analyticsEventSchema).min(1).max(50),
});

async function resolveAuthenticatedUserIdFromBearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (!authorization || !authorization.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  try {
    await request.jwtVerify();
    return request.user.userId;
  } catch {
    return null;
  }
}

export const analyticsRoutes: FastifyPluginAsync<AnalyticsRoutesOptions> = async (
  fastify,
  options,
) => {
  fastify.post(
    '/analytics/events',
    {
      bodyLimit: 64 * 1024,
      config: {
        rateLimit: { max: 120, timeWindow: 60_000 },
      },
    },
    async (request) => {
      const body = analyticsBatchSchema.parse(request.body);
      const authenticatedUserId = await resolveAuthenticatedUserIdFromBearerToken(request);

      const result = await options.analyticsService.ingestClientEvents({
        events: body.events,
        authenticatedUserId,
      });

      return result;
    },
  );
};
