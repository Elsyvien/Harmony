import { describe, expect, it, vi } from 'vitest';
import type { AdminService } from '../src/services/admin.service.js';
import type { AdminSettingsService } from '../src/services/admin-settings.service.js';
import type { AdminUserService } from '../src/services/admin-user.service.js';
import type { AnalyticsService } from '../src/services/analytics.service.js';
import { adminRoutes } from '../src/routes/admin.routes.js';

type RouteHandler = (request: any, reply: any) => Promise<unknown>;

interface CapturedRoute {
  method: 'GET' | 'PUT' | 'PATCH' | 'DELETE' | 'POST';
  path: string;
  options: { preHandler?: unknown[]; config?: unknown };
  handler: RouteHandler;
}

async function registerRoutes() {
  const routes: CapturedRoute[] = [];
  const getOverview = vi.fn().mockResolvedValue({ ok: true });
  const getTimeseries = vi.fn().mockResolvedValue({ ok: true });

  const analyticsService = {
    getOverview,
    getTimeseries,
  } as unknown as AnalyticsService;

  const adminService = {
    getServerStats: vi.fn(),
  } as unknown as AdminService;
  const adminSettingsService = {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
  } as unknown as AdminSettingsService;
  const adminUserService = {} as unknown as AdminUserService;

  const fastify = {
    get: vi.fn((path: string, options: CapturedRoute['options'], handler: RouteHandler) => {
      routes.push({ method: 'GET', path, options, handler });
    }),
    put: vi.fn((path: string, options: CapturedRoute['options'], handler: RouteHandler) => {
      routes.push({ method: 'PUT', path, options, handler });
    }),
    patch: vi.fn((path: string, options: CapturedRoute['options'], handler: RouteHandler) => {
      routes.push({ method: 'PATCH', path, options, handler });
    }),
    delete: vi.fn((path: string, options: CapturedRoute['options'], handler: RouteHandler) => {
      routes.push({ method: 'DELETE', path, options, handler });
    }),
    post: vi.fn((path: string, options: CapturedRoute['options'], handler: RouteHandler) => {
      routes.push({ method: 'POST', path, options, handler });
    }),
    wsGateway: {
      broadcastSystem: vi.fn(),
      updateUserProfile: vi.fn(),
      notifyUsers: vi.fn(),
    },
  };

  await adminRoutes(fastify as never, {
    adminService,
    adminSettingsService,
    adminUserService,
    analyticsService,
  });

  const overviewRoute = routes.find((route) => route.method === 'GET' && route.path === '/admin/analytics/overview');
  const timeseriesRoute = routes.find((route) => route.method === 'GET' && route.path === '/admin/analytics/timeseries');
  if (!overviewRoute || !timeseriesRoute) {
    throw new Error('Analytics routes were not registered');
  }

  return {
    overviewRoute,
    timeseriesRoute,
    getOverview,
    getTimeseries,
  };
}

describe('adminRoutes analytics routes', () => {
  it('registers analytics routes with auth pre-handler', async () => {
    const { overviewRoute, timeseriesRoute } = await registerRoutes();
    expect(Array.isArray(overviewRoute.options.preHandler)).toBe(true);
    expect(overviewRoute.options.preHandler).toHaveLength(1);
    expect(Array.isArray(timeseriesRoute.options.preHandler)).toBe(true);
    expect(timeseriesRoute.options.preHandler).toHaveLength(1);
  });

  it('loads overview and timeseries using parsed query', async () => {
    const { overviewRoute, timeseriesRoute, getOverview, getTimeseries } = await registerRoutes();

    const overviewResponse = await overviewRoute.handler({
      query: {
        window: '7d',
        category: 'reliability',
        name: 'voice.join.failed',
      },
    }, {});

    const timeseriesResponse = await timeseriesRoute.handler({
      query: {
        window: '30d',
      },
    }, {});

    expect(getOverview).toHaveBeenCalledWith({
      window: '7d',
      category: 'reliability',
      name: 'voice.join.failed',
    });
    expect(getTimeseries).toHaveBeenCalledWith({
      window: '30d',
      category: undefined,
      name: undefined,
    });
    expect(overviewResponse).toEqual({ overview: { ok: true } });
    expect(timeseriesResponse).toEqual({ timeseries: { ok: true } });
  });
});
