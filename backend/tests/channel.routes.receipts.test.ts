import { describe, expect, it, vi } from 'vitest';
import type { ChannelService } from '../src/services/channel.service.js';
import type { MessageService } from '../src/services/message.service.js';
import { channelRoutes } from '../src/routes/channel.routes.js';

type RouteHandler = (request: any, reply: any) => Promise<unknown>;

interface CapturedRoute {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  options: { preHandler?: unknown[]; config?: unknown };
  handler: RouteHandler;
}

const channelId = '11111111-1111-4111-8111-111111111111';
const readerUserId = '44444444-4444-4444-8444-444444444444';
const upToMessageId = '22222222-2222-4222-8222-222222222222';
const olderMessageId = '33333333-3333-4333-8333-333333333333';

function createFastifyAndRoutes() {
  const routes: CapturedRoute[] = [];
  const wsGateway = {
    broadcastSystem: vi.fn(),
    broadcastMessage: vi.fn(),
    broadcastMessageUpdated: vi.fn(),
    broadcastMessageDeleted: vi.fn(),
    broadcastMessageReaction: vi.fn(),
    broadcastMessageDelivered: vi.fn(),
    broadcastMessageRead: vi.fn(),
    notifyUsers: vi.fn(),
    updateUserProfile: vi.fn(),
  };
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
    wsGateway,
  };

  return { fastify, routes, wsGateway };
}

async function registerRoutes(messageService: Partial<MessageService>) {
  const { fastify, routes, wsGateway } = createFastifyAndRoutes();
  await channelRoutes(fastify as never, {
    channelService: {} as ChannelService,
    messageService: messageService as MessageService,
  });

  const messagesRoute = routes.find(
    (route) => route.method === 'GET' && route.path === '/channels/:id/messages',
  );
  const readRoute = routes.find(
    (route) => route.method === 'POST' && route.path === '/channels/:id/read',
  );
  if (!messagesRoute || !readRoute) {
    throw new Error('Failed to register receipt routes');
  }

  return {
    messagesHandler: messagesRoute.handler,
    readHandler: readRoute.handler,
    wsGateway,
  };
}

describe('channelRoutes receipt broadcasts', () => {
  it('broadcasts delivered receipts for message loads even when no new DB changes occur', async () => {
    const at = new Date('2026-03-04T19:00:00.000Z');
    const listMessages = vi.fn().mockResolvedValue([{ id: olderMessageId }, { id: upToMessageId }]);
    const markChannelDelivered = vi.fn().mockResolvedValue({
      changed: false,
      upToMessageId,
      at,
    });
    const route = await registerRoutes({
      listMessages,
      markChannelDelivered,
    });

    const result = await route.messagesHandler({
      params: { id: channelId },
      query: {},
      user: { userId: readerUserId },
    }, {});

    expect(markChannelDelivered).toHaveBeenCalledWith({
      channelId,
      userId: readerUserId,
      upToMessageId,
    });
    expect(route.wsGateway.broadcastMessageDelivered).toHaveBeenCalledWith(channelId, {
      channelId,
      userId: readerUserId,
      upToMessageId,
      at: at.toISOString(),
    });
    expect(result).toEqual({ messages: [{ id: olderMessageId }, { id: upToMessageId }] });
  });

  it('broadcasts read receipts even when markChannelRead reports unchanged', async () => {
    const at = new Date('2026-03-04T19:02:00.000Z');
    const markChannelRead = vi.fn().mockResolvedValue({
      changed: false,
      upToMessageId,
      at,
    });
    const route = await registerRoutes({
      markChannelRead,
    });

    const result = await route.readHandler({
      params: { id: channelId },
      body: { upToMessageId },
      user: { userId: readerUserId },
    }, {});

    expect(markChannelRead).toHaveBeenCalledWith({
      channelId,
      userId: readerUserId,
      upToMessageId,
    });
    expect(route.wsGateway.broadcastMessageRead).toHaveBeenCalledWith(channelId, {
      channelId,
      userId: readerUserId,
      upToMessageId,
      at: at.toISOString(),
    });
    expect(result).toEqual({
      receipt: {
        channelId,
        userId: readerUserId,
        upToMessageId,
        at: at.toISOString(),
      },
    });
  });
});
