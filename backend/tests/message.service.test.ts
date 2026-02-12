import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type {
  MessageRepository,
  MessageWithAuthor,
} from '../src/repositories/message.repository.js';
import type { ChannelAccessService } from '../src/services/channel.service.js';
import { MessageService } from '../src/services/message.service.js';
import { AppError } from '../src/utils/app-error.js';

class InMemoryMessageRepo implements MessageRepository {
  private items: MessageWithAuthor[] = [];

  async listByChannel(params: { channelId: string; before?: Date; limit: number }) {
    return this.items
      .filter((item) => item.channelId === params.channelId)
      .filter((item) => (params.before ? item.createdAt < params.before : true))
      .slice(0, params.limit);
  }

  async create(params: {
    channelId: string;
    userId: string;
    content: string;
    attachment?: {
      url: string;
      name: string;
      type: string;
      size: number;
    };
  }) {
    const message: MessageWithAuthor = {
      id: randomUUID(),
      channelId: params.channelId,
      userId: params.userId,
      content: params.content,
      attachment: params.attachment ?? null,
      createdAt: new Date(),
      user: {
        id: params.userId,
        username: 'test-user',
      },
    };
    this.items.push(message);
    return message;
  }
}

describe('MessageService', () => {
  let repo: InMemoryMessageRepo;
  let channelService: ChannelAccessService;
  let service: MessageService;

  beforeEach(() => {
    repo = new InMemoryMessageRepo();
    channelService = {
      ensureChannelAccess: async (channelId: string) => channelId === 'known-channel',
    };
    service = new MessageService(repo, channelService, 2000);
  });

  it('creates messages for existing channels', async () => {
    const message = await service.createMessage({
      channelId: 'known-channel',
      userId: 'user-1',
      content: 'Hello MVP',
    });

    expect(message.content).toBe('Hello MVP');
    expect(message.channelId).toBe('known-channel');
  });

  it('rejects empty messages', async () => {
    await expect(
      service.createMessage({
        channelId: 'known-channel',
        userId: 'user-1',
        content: '   ',
      }),
    ).rejects.toMatchObject({ code: 'EMPTY_MESSAGE' } satisfies Partial<AppError>);
  });

  it('allows attachments without text', async () => {
    const message = await service.createMessage({
      channelId: 'known-channel',
      userId: 'user-1',
      content: '   ',
      attachment: {
        url: '/uploads/demo.png',
        name: 'demo.png',
        type: 'image/png',
        size: 1234,
      },
    });

    expect(message.content).toBe('');
    expect(message.attachment?.url).toBe('/uploads/demo.png');
  });

  it('rejects messages for unknown channels', async () => {
    await expect(
      service.createMessage({
        channelId: 'missing-channel',
        userId: 'user-1',
        content: 'Hello',
      }),
    ).rejects.toMatchObject({ code: 'CHANNEL_NOT_FOUND' } satisfies Partial<AppError>);
  });
});
