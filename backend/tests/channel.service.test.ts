import { beforeEach, describe, expect, it } from 'vitest';
import type { Channel, UserRole } from '@prisma/client';
import type { ChannelRepository, ChannelWithMembers } from '../src/repositories/channel.repository.js';
import type { FriendshipRepository } from '../src/repositories/friendship.repository.js';
import type { UserRepository } from '../src/repositories/user.repository.js';
import { ChannelService } from '../src/services/channel.service.js';
import { AppError } from '../src/utils/app-error.js';

function buildChannel(input: Partial<Channel> & Pick<Channel, 'id' | 'name'>): ChannelWithMembers {
  return {
    id: input.id,
    name: input.name,
    type: input.type ?? 'PUBLIC',
    dmKey: input.dmKey ?? null,
    voiceBitrateKbps: input.voiceBitrateKbps ?? (input.type === 'VOICE' ? 64 : null),
    createdAt: input.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
    members: [],
  };
}

class InMemoryChannelRepo implements ChannelRepository {
  constructor(private channels: ChannelWithMembers[]) {}

  async listForUser() {
    return this.channels;
  }

  async findById(id: string) {
    return this.channels.find((channel) => channel.id === id) ?? null;
  }

  async findByIdForUser(id: string) {
    return this.channels.find((channel) => channel.id === id) ?? null;
  }

  async findByName(name: string) {
    return this.channels.find((channel) => channel.name === name) ?? null;
  }

  async countPublicChannels() {
    return this.channels.filter((channel) => channel.type === 'PUBLIC').length;
  }

  async deleteById(id: string) {
    this.channels = this.channels.filter((channel) => channel.id !== id);
  }

  async createPublic(params: { name: string }) {
    const created = buildChannel({
      id: `channel-${this.channels.length + 1}`,
      name: params.name,
      type: 'PUBLIC',
    });
    this.channels.push(created);
    return created;
  }

  async createVoice(params: { name: string }) {
    const created = buildChannel({
      id: `channel-${this.channels.length + 1}`,
      name: params.name,
      type: 'VOICE',
    });
    this.channels.push(created);
    return created;
  }

  async updateVoiceBitrate(params: { id: string; voiceBitrateKbps: number }) {
    const channel = this.channels.find((item) => item.id === params.id);
    if (!channel) {
      throw new Error('Channel not found');
    }
    channel.voiceBitrateKbps = params.voiceBitrateKbps;
    return channel;
  }

  async ensurePublicByName(name: string) {
    const existing = this.channels.find((channel) => channel.name === name && channel.type === 'PUBLIC');
    if (existing) {
      return existing;
    }
    return this.createPublic({ name });
  }

  async findDirectByDmKey(dmKey: string) {
    return this.channels.find((channel) => channel.dmKey === dmKey) ?? null;
  }

  async createDirect(params: { name: string; dmKey: string; memberUserIds: [string, string] }) {
    const created: ChannelWithMembers = {
      ...buildChannel({
        id: `channel-${this.channels.length + 1}`,
        name: params.name,
        type: 'DIRECT',
        dmKey: params.dmKey,
      }),
      members: params.memberUserIds.map((userId) => ({
        userId,
        user: {
          id: userId,
          username: `user-${userId}`,
          avatarUrl: null,
        },
      })),
    };
    this.channels.push(created);
    return created;
  }
}

const noOpUserRepo: UserRepository = {
  async findById() {
    return null;
  },
  async findByEmail() {
    return null;
  },
  async findByUsername() {
    return null;
  },
  async create(params: {
    username: string;
    email: string;
    passwordHash: string;
    role?: UserRole;
    isAdmin?: boolean;
  }) {
    return {
      id: 'user-created',
      username: params.username,
      email: params.email,
      passwordHash: params.passwordHash,
      role: params.role ?? 'MEMBER',
      isAdmin: Boolean(params.isAdmin),
      isSuspended: false,
      suspendedUntil: null,
      createdAt: new Date(),
      avatarUrl: null,
    };
  },
};

const noOpFriendshipRepo: FriendshipRepository = {
  async findByPair() {
    return null;
  },
  async findById() {
    return null;
  },
  async listByUser() {
    return [];
  },
  async createPending() {
    throw new Error('not needed in test');
  },
  async accept() {
    throw new Error('not needed in test');
  },
  async deleteById() {},
};

describe('ChannelService deleteChannel', () => {
  let repo: InMemoryChannelRepo;
  let service: ChannelService;

  beforeEach(() => {
    repo = new InMemoryChannelRepo([
      buildChannel({ id: 'global-id', name: 'global', type: 'PUBLIC' }),
      buildChannel({ id: 'general-id', name: 'general', type: 'PUBLIC' }),
      buildChannel({ id: 'voice-id', name: 'party', type: 'VOICE' }),
      buildChannel({ id: 'dm-id', name: 'dm-a-b', type: 'DIRECT', dmKey: 'dm:a:b' }),
    ]);
    service = new ChannelService(repo, noOpUserRepo, noOpFriendshipRepo);
  });

  it('deletes regular public channels', async () => {
    const result = await service.deleteChannel('general-id');

    expect(result.deletedChannelId).toBe('general-id');
    await expect(service.deleteChannel('general-id')).rejects.toMatchObject({
      code: 'CHANNEL_NOT_FOUND',
    } satisfies Partial<AppError>);
  });

  it('rejects deleting the global channel', async () => {
    await expect(service.deleteChannel('global-id')).rejects.toMatchObject({
      code: 'CHANNEL_DELETE_FORBIDDEN',
    } satisfies Partial<AppError>);
  });

  it('rejects deleting direct channels', async () => {
    await expect(service.deleteChannel('dm-id')).rejects.toMatchObject({
      code: 'CHANNEL_DELETE_FORBIDDEN',
    } satisfies Partial<AppError>);
  });

  it('allows deleting voice channels', async () => {
    const result = await service.deleteChannel('voice-id');
    expect(result.deletedChannelId).toBe('voice-id');
  });

  it('updates voice bitrate on voice channels', async () => {
    const result = await service.updateVoiceChannelBitrate('voice-id', 96);
    expect(result.voiceBitrateKbps).toBe(96);
  });

  it('rejects bitrate updates on non-voice channels', async () => {
    await expect(service.updateVoiceChannelBitrate('general-id', 96)).rejects.toMatchObject({
      code: 'INVALID_VOICE_CHANNEL',
    } satisfies Partial<AppError>);
  });
});
