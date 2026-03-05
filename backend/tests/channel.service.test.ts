import { beforeEach, describe, expect, it } from 'vitest';
import type { Channel, UserRole } from '@prisma/client';
import type { ChannelRepository, ChannelWithMembers } from '../src/repositories/channel.repository.js';
import type { FriendshipRepository } from '../src/repositories/friendship.repository.js';
import type { ServerService } from '../src/services/server.service.js';
import type { UserRepository } from '../src/repositories/user.repository.js';
import { ChannelService } from '../src/services/channel.service.js';
import { AppError } from '../src/utils/app-error.js';

function buildChannel(input: Partial<Channel> & Pick<Channel, 'id' | 'name'>): ChannelWithMembers {
  return {
    id: input.id,
    name: input.name,
    type: input.type ?? 'PUBLIC',
    dmKey: input.dmKey ?? null,
    serverId: input.serverId ?? (input.type === 'DIRECT' ? null : 'server-1'),
    voiceBitrateKbps: input.voiceBitrateKbps ?? (input.type === 'VOICE' ? 64 : null),
    streamBitrateKbps: input.streamBitrateKbps ?? (input.type === 'VOICE' ? 2500 : null),
    createdAt: input.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
    server:
      input.type === 'DIRECT'
        ? null
        : {
            id: input.serverId ?? 'server-1',
            name: 'Harmony',
          },
    members: [],
  };
}

class InMemoryChannelRepo implements ChannelRepository {
  constructor(private channels: ChannelWithMembers[]) {}

  async listForUser() {
    return this.channels;
  }

  async listByServerForUser(serverId: string) {
    return this.channels.filter((channel) => channel.serverId === serverId && channel.type !== 'DIRECT');
  }

  async findById(id: string) {
    return this.channels.find((channel) => channel.id === id) ?? null;
  }

  async findByIdForUser(id: string) {
    return this.channels.find((channel) => channel.id === id) ?? null;
  }

  async findByNameInServer(params: { serverId: string; name: string }) {
    return this.channels.find(
      (channel) => channel.serverId === params.serverId && channel.name === params.name,
    ) ?? null;
  }

  async countPublicChannels(serverId: string) {
    return this.channels.filter(
      (channel) => channel.type === 'PUBLIC' && channel.serverId === serverId,
    ).length;
  }

  async deleteById(id: string) {
    this.channels = this.channels.filter((channel) => channel.id !== id);
  }

  async createPublic(params: { name: string; serverId: string }) {
    const created = buildChannel({
      id: `channel-${this.channels.length + 1}`,
      name: params.name,
      type: 'PUBLIC',
      serverId: params.serverId,
    });
    this.channels.push(created);
    return created;
  }

  async createVoice(params: { name: string; serverId: string }) {
    const created = buildChannel({
      id: `channel-${this.channels.length + 1}`,
      name: params.name,
      type: 'VOICE',
      serverId: params.serverId,
    });
    this.channels.push(created);
    return created;
  }

  async updateVoiceSettings(params: {
    id: string;
    voiceBitrateKbps?: number;
    streamBitrateKbps?: number;
  }) {
    const channel = this.channels.find((item) => item.id === params.id);
    if (!channel) {
      throw new Error('Channel not found');
    }
    if (params.voiceBitrateKbps !== undefined) {
      channel.voiceBitrateKbps = params.voiceBitrateKbps;
    }
    if (params.streamBitrateKbps !== undefined) {
      channel.streamBitrateKbps = params.streamBitrateKbps;
    }
    return channel;
  }

  async ensurePublicByName(params: { name: string; serverId: string }) {
    const existing = this.channels.find(
      (channel) =>
        channel.name === params.name &&
        channel.serverId === params.serverId &&
        channel.type === 'PUBLIC',
    );
    if (existing) {
      return existing;
    }
    return this.createPublic({ name: params.name, serverId: params.serverId });
  }

  async attachLegacyChannelsToServer(serverId: string) {
    let count = 0;
    for (const channel of this.channels) {
      if (!channel.serverId && channel.type !== 'DIRECT') {
        channel.serverId = serverId;
        channel.server = { id: serverId, name: 'Harmony' };
        count += 1;
      }
    }
    return count;
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

const noOpServerService: Partial<ServerService> = {
  async bootstrapDefaultServer() {
    return {
      serverId: 'server-1',
      created: false,
      backfilledChannelCount: 0,
      backfilledMemberCount: 0,
    };
  },
  async ensureDefaultServerForUser() {
    return 'server-1';
  },
  async assertCanManageServer() {
    return {
      id: 'member-1',
      serverId: 'server-1',
      userId: 'admin-1',
      role: 'OWNER',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  },
  async getServerForUser() {
    return {
      id: 'server-1',
      slug: 'harmony-default',
      name: 'Harmony',
      description: null,
      iconUrl: null,
      visibility: 'INVITE_ONLY',
      createdAt: new Date(),
      owner: {
        id: 'admin-1',
        username: 'max',
        avatarUrl: null,
      },
      memberRole: 'OWNER',
      memberCount: 1,
    };
  },
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
    service = new ChannelService(
      repo,
      noOpUserRepo,
      noOpFriendshipRepo,
      noOpServerService as ServerService,
    );
  });

  it('deletes regular public channels', async () => {
    const result = await service.deleteChannel('general-id', 'admin-1');

    expect(result.deletedChannelId).toBe('general-id');
    await expect(service.deleteChannel('general-id', 'admin-1')).rejects.toMatchObject({
      code: 'CHANNEL_NOT_FOUND',
    } satisfies Partial<AppError>);
  });

  it('rejects deleting the last remaining public channel in a server', async () => {
    await service.deleteChannel('general-id', 'admin-1');
    await expect(service.deleteChannel('global-id', 'admin-1')).rejects.toMatchObject({
      code: 'CHANNEL_DELETE_FORBIDDEN',
    } satisfies Partial<AppError>);
  });

  it('rejects deleting direct channels', async () => {
    await expect(service.deleteChannel('dm-id', 'admin-1')).rejects.toMatchObject({
      code: 'CHANNEL_DELETE_FORBIDDEN',
    } satisfies Partial<AppError>);
  });

  it('allows deleting voice channels', async () => {
    const result = await service.deleteChannel('voice-id', 'admin-1');
    expect(result.deletedChannelId).toBe('voice-id');
  });

  it('updates voice bitrate on voice channels', async () => {
    const result = await service.updateVoiceChannelBitrate('voice-id', 'admin-1', 96);
    expect(result.voiceBitrateKbps).toBe(96);
  });

  it('updates stream bitrate on voice channels', async () => {
    const result = await service.updateVoiceChannelSettings('voice-id', 'admin-1', {
      streamBitrateKbps: 4200,
    });
    expect(result.streamBitrateKbps).toBe(4200);
  });

  it('rejects bitrate updates on non-voice channels', async () => {
    await expect(service.updateVoiceChannelBitrate('general-id', 'admin-1', 96)).rejects.toMatchObject({
      code: 'INVALID_VOICE_CHANNEL',
    } satisfies Partial<AppError>);
  });
});
