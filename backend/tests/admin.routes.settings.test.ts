import { describe, expect, it, vi } from 'vitest';
import type { AdminService } from '../src/services/admin.service.js';
import type { AdminSettingsService } from '../src/services/admin-settings.service.js';
import type { AdminUserService } from '../src/services/admin-user.service.js';
import { adminRoutes } from '../src/routes/admin.routes.js';

type RouteHandler = (request: any, reply: any) => Promise<unknown>;

interface CapturedRoute {
  method: 'GET' | 'PUT' | 'PATCH' | 'DELETE' | 'POST';
  path: string;
  options: { preHandler?: unknown[]; config?: unknown };
  handler: RouteHandler;
}

function makeSettings(overrides?: Partial<{
  allowRegistrations: boolean;
  readOnlyMode: boolean;
  slowModeSeconds: number;
  idleTimeoutMinutes: number;
}>) {
  return {
    allowRegistrations: true,
    readOnlyMode: false,
    slowModeSeconds: 0,
    idleTimeoutMinutes: 15,
    ...(overrides ?? {}),
  };
}

async function registerRoutes() {
  const routes: CapturedRoute[] = [];
  const getSettingsMock = vi.fn();
  const updateSettingsMock = vi.fn();
  const adminService = {
    getServerStats: vi.fn(),
  } as unknown as AdminService;
  const adminSettingsService = {
    getSettings: getSettingsMock,
    updateSettings: updateSettingsMock,
  } as unknown as AdminSettingsService;
  const adminUserService = {} as unknown as AdminUserService;
  const broadcastSystem = vi.fn();

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
      broadcastSystem,
      updateUserProfile: vi.fn(),
      notifyUsers: vi.fn(),
    },
  };

  await adminRoutes(fastify as never, {
    adminService,
    adminSettingsService,
    adminUserService,
  });

  const getSettingsRoute = routes.find((route) => route.method === 'GET' && route.path === '/admin/settings');
  const putSettingsRoute = routes.find((route) => route.method === 'PUT' && route.path === '/admin/settings');

  if (!getSettingsRoute || !putSettingsRoute) {
    throw new Error('Failed to register admin settings routes');
  }

  return {
    getSettingsRoute,
    putSettingsRoute,
    getSettingsMock,
    updateSettingsMock,
    broadcastSystem,
  };
}

describe('adminRoutes /admin/settings', () => {
  it('registers admin settings routes with auth pre-handler', async () => {
    const { getSettingsRoute, putSettingsRoute } = await registerRoutes();

    expect(Array.isArray(getSettingsRoute.options.preHandler)).toBe(true);
    expect(getSettingsRoute.options.preHandler).toHaveLength(1);
    expect(Array.isArray(putSettingsRoute.options.preHandler)).toBe(true);
    expect(putSettingsRoute.options.preHandler).toHaveLength(1);
  });

  it('returns current settings from service', async () => {
    const { getSettingsRoute, getSettingsMock } = await registerRoutes();
    const settings = makeSettings({ readOnlyMode: true, slowModeSeconds: 12 });
    getSettingsMock.mockResolvedValue(settings);

    const response = await getSettingsRoute.handler({}, {});

    expect(getSettingsMock).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ settings });
  });

  it('updates settings and broadcasts the update payload', async () => {
    const { putSettingsRoute, updateSettingsMock, broadcastSystem } = await registerRoutes();
    const updated = makeSettings({ idleTimeoutMinutes: 30, readOnlyMode: true });
    updateSettingsMock.mockResolvedValue(updated);

    const response = await putSettingsRoute.handler(
      {
        body: {
          readOnlyMode: true,
          idleTimeoutMinutes: 30,
        },
      },
      {},
    );

    expect(updateSettingsMock).toHaveBeenCalledWith({
      readOnlyMode: true,
      idleTimeoutMinutes: 30,
    });
    expect(broadcastSystem).toHaveBeenCalledWith('admin:settings:updated', { settings: updated });
    expect(response).toEqual({ settings: updated });
  });

  it('rejects empty update payloads', async () => {
    const { putSettingsRoute } = await registerRoutes();

    await expect(
      putSettingsRoute.handler(
        {
          body: {},
        },
        {},
      ),
    ).rejects.toThrow();
  });
});
