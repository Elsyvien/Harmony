import { describe, expect, it, vi } from 'vitest';
import { analyticsRoutes } from '../src/routes/analytics.routes.js';
import type { AnalyticsService } from '../src/services/analytics.service.js';

type RouteHandler = (request: any, reply: any) => Promise<unknown>;

interface CapturedRoute {
  method: 'POST';
  path: string;
  options: Record<string, unknown>;
  handler: RouteHandler;
}

async function registerRoutes() {
  const routes: CapturedRoute[] = [];
  const ingestClientEvents = vi.fn().mockResolvedValue({ accepted: 1, dropped: 0 });
  const analyticsService = {
    ingestClientEvents,
  } as unknown as AnalyticsService;

  const fastify = {
    post: vi.fn((path: string, options: CapturedRoute['options'], handler: RouteHandler) => {
      routes.push({ method: 'POST', path, options, handler });
    }),
  };

  await analyticsRoutes(fastify as never, { analyticsService });

  const postRoute = routes.find((route) => route.path === '/analytics/events');
  if (!postRoute) {
    throw new Error('Failed to register analytics ingestion route');
  }

  return {
    postRoute,
    ingestClientEvents,
  };
}

describe('analyticsRoutes', () => {
  it('registers ingestion route with body/rate limits', async () => {
    const { postRoute } = await registerRoutes();

    expect(postRoute.options.bodyLimit).toBe(64 * 1024);
    expect(postRoute.options.config).toEqual({
      rateLimit: { max: 120, timeWindow: 60_000 },
    });
  });

  it('passes parsed events and optional authenticated user id to service', async () => {
    const { postRoute, ingestClientEvents } = await registerRoutes();

    const response = await postRoute.handler(
      {
        body: {
          events: [
            {
              name: 'api.request.failed',
              category: 'reliability',
              level: 'warn',
              context: {
                method: 'GET',
                path: '/channels',
                statusCode: 503,
                code: 'REQUEST_FAILED',
              },
            },
          ],
        },
        headers: {
          authorization: 'Bearer token',
        },
        jwtVerify: vi.fn().mockResolvedValue(undefined),
        user: {
          userId: 'user-1',
        },
      },
      {},
    );

    expect(ingestClientEvents).toHaveBeenCalledWith({
      events: [
        {
          name: 'api.request.failed',
          category: 'reliability',
          level: 'warn',
          context: {
            method: 'GET',
            path: '/channels',
            statusCode: 503,
            code: 'REQUEST_FAILED',
          },
        },
      ],
      authenticatedUserId: 'user-1',
    });
    expect(response).toEqual({ accepted: 1, dropped: 0 });
  });

  it('rejects invalid event payloads', async () => {
    const { postRoute } = await registerRoutes();

    await expect(
      postRoute.handler(
        {
          body: {
            events: [
              {
                name: 'invalid',
                category: 'reliability',
              },
            ],
          },
          headers: {},
          jwtVerify: vi.fn(),
          user: {},
        },
        {},
      ),
    ).rejects.toThrow();
  });
});
