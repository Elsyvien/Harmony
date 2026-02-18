import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ChannelService } from '../src/services/channel.service.js';
import type { MessageService } from '../src/services/message.service.js';
import { channelRoutes } from '../src/routes/channel.routes.js';
import { AppError } from '../src/utils/app-error.js';

type RouteHandler = (request: any, reply: any) => Promise<unknown>;

interface CapturedRoute {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  options: { preHandler?: unknown[]; config?: unknown };
  handler: RouteHandler;
}

async function registerUploadsRoute() {
  const routes: CapturedRoute[] = [];
  const fastify = {
    get: vi.fn((path: string, options: CapturedRoute['options'], handler: RouteHandler) => {
      routes.push({ method: 'GET', path, options, handler });
    }),
    post: vi.fn((path: string, options: CapturedRoute['options'], handler: RouteHandler) => {
      routes.push({ method: 'POST', path, options, handler });
    }),
    patch: vi.fn((path: string, options: CapturedRoute['options'], handler: RouteHandler) => {
      routes.push({ method: 'PATCH', path, options, handler });
    }),
    delete: vi.fn((path: string, options: CapturedRoute['options'], handler: RouteHandler) => {
      routes.push({ method: 'DELETE', path, options, handler });
    }),
    wsGateway: {
      broadcastSystem: vi.fn(),
      broadcastMessage: vi.fn(),
      broadcastMessageUpdated: vi.fn(),
      broadcastMessageDeleted: vi.fn(),
      broadcastMessageReaction: vi.fn(),
      notifyUsers: vi.fn(),
      updateUserProfile: vi.fn(),
    },
  };

  await channelRoutes(fastify as never, {
    channelService: {} as ChannelService,
    messageService: {} as MessageService,
  });

  const uploadsRoute = routes.find((route) => route.method === 'POST' && route.path === '/uploads');
  if (!uploadsRoute) {
    throw new Error('Failed to register uploads route');
  }
  return uploadsRoute.handler;
}

describe('channelRoutes /uploads', () => {
  const originalCwd = process.cwd();
  let testCwd = '';

  beforeEach(async () => {
    testCwd = await mkdtemp(path.join(tmpdir(), 'harmony-upload-route-'));
    process.chdir(testCwd);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(testCwd, { recursive: true, force: true });
  });

  it('cleans up file artifacts when upload validation fails after write', async () => {
    const uploadsHandler = await registerUploadsRoute();

    await expect(
      uploadsHandler(
        {
          file: vi.fn().mockResolvedValue({
            filename: 'empty.txt',
            mimetype: 'text/plain',
            file: Readable.from([]),
          }),
        },
        {
          code: vi.fn().mockReturnThis(),
          send: vi.fn().mockReturnThis(),
        },
      ),
    ).rejects.toMatchObject({ code: 'EMPTY_ATTACHMENT' } satisfies Partial<AppError>);

    const uploadsDir = path.join(testCwd, 'uploads');
    const entries = await readdir(uploadsDir).catch(() => []);
    expect(entries).toHaveLength(0);
  });
});
