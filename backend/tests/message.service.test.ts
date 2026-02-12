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

  async findByIdInChannel(params: { channelId: string; messageId: string }) {
    return this.items.find((item) => item.channelId === params.channelId && item.id === params.messageId) ?? null;
  }

  async create(params: {
    channelId: string;
    userId: string;
    content: string;
    replyToMessageId?: string;
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
      editedAt: null,
      deletedAt: null,
      replyToMessageId: params.replyToMessageId ?? null,
      replyTo:
        params.replyToMessageId
          ? this.items.find((item) => item.id === params.replyToMessageId)
            ? {
                id: params.replyToMessageId,
                userId: params.userId,
                content: 'reply-target',
                createdAt: new Date(),
                deletedAt: null,
                user: {
                  id: params.userId,
                  username: 'test-user',
                  avatarUrl: null,
                },
              }
            : null
          : null,
      reactions: [],
      createdAt: new Date(),
      user: {
        id: params.userId,
        username: 'test-user',
        avatarUrl: null,
      },
    };
    this.items.push(message);
    return message;
  }

  async updateContent(params: { messageId: string; content: string }) {
    const existing = this.items.find((item) => item.id === params.messageId);
    if (!existing) {
      throw new Error('not found');
    }
    existing.content = params.content;
    existing.editedAt = new Date();
    return existing;
  }

  async softDelete(params: { messageId: string }) {
    const existing = this.items.find((item) => item.id === params.messageId);
    if (!existing) {
      throw new Error('not found');
    }
    existing.content = '';
    existing.attachment = null;
    existing.deletedAt = new Date();
    existing.editedAt = null;
    return existing;
  }

  async toggleReaction(params: { messageId: string; userId: string; emoji: string }) {
    const existing = this.items.find((item) => item.id === params.messageId);
    if (!existing) {
      throw new Error('not found');
    }
    const reaction = existing.reactions.find((item) => item.emoji === params.emoji);
    const hasExisting = Boolean(reaction?.userIds.includes(params.userId));
    if (hasExisting) {
      if (reaction) {
        reaction.userIds = reaction.userIds.filter((userId) => userId !== params.userId);
      }
      existing.reactions = existing.reactions.filter((item) => item.userIds.length > 0);
      return { message: existing, reacted: false };
    }
    if (reaction) {
      reaction.userIds.push(params.userId);
    } else {
      existing.reactions.push({ emoji: params.emoji, userIds: [params.userId] });
    }
    return { message: existing, reacted: true };
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

  it('edits own message', async () => {
    const created = await service.createMessage({
      channelId: 'known-channel',
      userId: 'user-1',
      content: 'before',
    });

    const updated = await service.updateMessage({
      channelId: 'known-channel',
      messageId: created.id,
      userId: 'user-1',
      content: 'after',
    });

    expect(updated.content).toBe('after');
    expect(updated.editedAt).toBeTruthy();
  });

  it('deletes own message', async () => {
    const created = await service.createMessage({
      channelId: 'known-channel',
      userId: 'user-1',
      content: 'bye',
    });

    const deleted = await service.deleteMessage({
      channelId: 'known-channel',
      messageId: created.id,
      userId: 'user-1',
    });

    expect(deleted.deletedAt).toBeTruthy();
    expect(deleted.content).toBe('');
  });

  it('toggles reactions', async () => {
    const created = await service.createMessage({
      channelId: 'known-channel',
      userId: 'user-1',
      content: 'react me',
    });

    const first = await service.toggleReaction({
      channelId: 'known-channel',
      messageId: created.id,
      userId: 'user-2',
      emoji: '👍',
    });
    expect(first.reacted).toBe(true);
    expect(first.message.reactions).toEqual([{ emoji: '👍', userIds: ['user-2'] }]);

    const second = await service.toggleReaction({
      channelId: 'known-channel',
      messageId: created.id,
      userId: 'user-2',
      emoji: '👍',
    });
    expect(second.reacted).toBe(false);
    expect(second.message.reactions).toEqual([]);
  });
});
