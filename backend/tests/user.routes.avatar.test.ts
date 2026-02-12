import { describe, expect, it, vi } from 'vitest';
import type { MultipartFile } from '@fastify/multipart';
import type { UserService } from '../src/services/user.service.js';
import { userRoutes } from '../src/routes/user.routes.js';

type AvatarRouteHandler = (request: any, reply: any) => Promise<unknown>;

function createReplyMock() {
  const reply = {
    code: vi.fn(),
    send: vi.fn(),
  };
  reply.code.mockReturnValue(reply);
  return reply;
}

async function registerAvatarRoute() {
  let registeredPath = '';
  let routeOptions: { preHandler?: unknown[] } | undefined;
  let handler: AvatarRouteHandler | undefined;
  const updateUserProfile = vi.fn();
  const updateAvatar = vi.fn();
  const userService = {
    updateAvatar,
  } as unknown as UserService;

  const fastify = {
    post: vi.fn((path: string, options: { preHandler?: unknown[] }, nextHandler: AvatarRouteHandler) => {
      registeredPath = path;
      routeOptions = options;
      handler = nextHandler;
    }),
    wsGateway: {
      updateUserProfile,
    },
  };

  await userRoutes(fastify as never, { userService });

  return {
    registeredPath,
    routeOptions,
    handler,
    updateAvatar,
    updateUserProfile,
  };
}

describe('userRoutes /users/me/avatar', () => {
  it('registers the route with auth pre-handler', async () => {
    const route = await registerAvatarRoute();

    expect(route.registeredPath).toBe('/users/me/avatar');
    expect(Array.isArray(route.routeOptions?.preHandler)).toBe(true);
    expect(route.routeOptions?.preHandler).toHaveLength(1);
    expect(typeof route.routeOptions?.preHandler?.[0]).toBe('function');
  });

  it('returns 400 when no file is uploaded', async () => {
    const route = await registerAvatarRoute();
    const reply = createReplyMock();

    await route.handler?.(
      {
        file: vi.fn().mockResolvedValue(undefined),
        user: { userId: 'user-1' },
      },
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({
      code: 'BAD_REQUEST',
      message: 'No file uploaded',
    });
    expect(route.updateAvatar).not.toHaveBeenCalled();
  });

  it('uploads avatar and broadcasts profile update', async () => {
    const route = await registerAvatarRoute();
    const reply = createReplyMock();
    const fakeFile = { filename: 'avatar.png', mimetype: 'image/png' } as MultipartFile;
    route.updateAvatar.mockResolvedValue({
      id: 'user-1',
      username: 'max',
      avatarUrl: '/uploads/avatars/user-1-new.png',
    });

    const response = await route.handler?.(
      {
        file: vi.fn().mockResolvedValue(fakeFile),
        user: { userId: 'user-1' },
      },
      reply,
    );

    expect(route.updateAvatar).toHaveBeenCalledWith('user-1', fakeFile);
    expect(route.updateUserProfile).toHaveBeenCalledWith('user-1', {
      username: 'max',
      avatarUrl: '/uploads/avatars/user-1-new.png',
    });
    expect(response).toEqual({
      user: {
        id: 'user-1',
        username: 'max',
        avatarUrl: '/uploads/avatars/user-1-new.png',
      },
    });
  });
});
