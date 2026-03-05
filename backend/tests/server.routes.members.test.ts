import { describe, expect, it, vi } from 'vitest';
import type { ChannelService } from '../src/services/channel.service.js';
import type { ServerService } from '../src/services/server.service.js';
import { serverRoutes } from '../src/routes/server.routes.js';

type RouteHandler = (request: any, reply: any) => Promise<unknown>;

interface CapturedRoute {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  options: { preHandler?: unknown[]; config?: unknown };
  handler: RouteHandler;
}

async function registerRoutes() {
  const routes: CapturedRoute[] = [];
  const listMembers = vi.fn();

  const channelService = {
    listServerChannels: vi.fn(),
  } as unknown as ChannelService;
  const serverService = {
    listServers: vi.fn(),
    createServer: vi.fn(),
    getServerForUser: vi.fn(),
    listMembers,
    getAnalytics: vi.fn(),
    listAuditLogs: vi.fn(),
    moderateUser: vi.fn(),
    listInvites: vi.fn(),
    createInvite: vi.fn(),
    revokeInvite: vi.fn(),
    joinByInvite: vi.fn(),
  } as unknown as ServerService;

  const fastify = {
    get: vi.fn((path: string, options: CapturedRoute['options'], handler: RouteHandler) => {
      routes.push({ method: 'GET', path, options, handler });
    }),
    post: vi.fn((path: string, options: CapturedRoute['options'], handler: RouteHandler) => {
      routes.push({ method: 'POST', path, options, handler });
    }),
    delete: vi.fn((path: string, options: CapturedRoute['options'], handler: RouteHandler) => {
      routes.push({ method: 'DELETE', path, options, handler });
    }),
  };

  await serverRoutes(fastify as never, {
    channelService,
    serverService,
  });

  const membersRoute = routes.find(
    (route) => route.method === 'GET' && route.path === '/servers/:serverId/members',
  );
  if (!membersRoute) {
    throw new Error('members route was not registered');
  }

  return {
    membersRoute,
    listMembers,
  };
}

describe('serverRoutes /servers/:serverId/members', () => {
  it('registers members route with auth pre-handler', async () => {
    const { membersRoute } = await registerRoutes();

    expect(Array.isArray(membersRoute.options.preHandler)).toBe(true);
    expect(membersRoute.options.preHandler).toHaveLength(1);
  });

  it('returns server members for managing users', async () => {
    const { membersRoute, listMembers } = await registerRoutes();
    const members = [
      {
        id: 'a4c9b6a2-13f6-45a3-bc69-d9f267f8af53',
        userId: '8dc6be31-7df5-4021-bce5-1f4dcb5cd771',
        role: 'MEMBER',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        user: {
          id: '8dc6be31-7df5-4021-bce5-1f4dcb5cd771',
          username: 'alice',
          avatarUrl: null,
        },
      },
    ];
    listMembers.mockResolvedValue(members);

    const response = await membersRoute.handler(
      {
        params: {
          serverId: 'a78e3d9d-893a-4eec-b233-6191cfce53fb',
        },
        user: {
          userId: '6e71d5ce-f616-4e2a-b655-7d80e1c1f8aa',
        },
      },
      {},
    );

    expect(listMembers).toHaveBeenCalledWith(
      '6e71d5ce-f616-4e2a-b655-7d80e1c1f8aa',
      'a78e3d9d-893a-4eec-b233-6191cfce53fb',
    );
    expect(response).toEqual({ members });
  });
});

