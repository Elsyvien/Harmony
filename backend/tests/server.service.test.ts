import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelRepository } from '../src/repositories/channel.repository.js';
import type { ServerRepository, ServerWithMembers } from '../src/repositories/server.repository.js';
import { ServerService } from '../src/services/server.service.js';
import { AppError } from '../src/utils/app-error.js';

function buildServer(params: Partial<ServerWithMembers> & Pick<ServerWithMembers, 'id' | 'slug' | 'name'>): ServerWithMembers {
  return {
    id: params.id,
    slug: params.slug,
    name: params.name,
    description: params.description ?? null,
    iconUrl: params.iconUrl ?? null,
    tags: params.tags ?? [],
    visibility: params.visibility ?? 'INVITE_ONLY',
    createdAt: params.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: params.updatedAt ?? new Date('2026-01-01T00:00:00.000Z'),
    ownerId: params.ownerId ?? 'owner-1',
    owner: params.owner ?? {
      id: 'owner-1',
      username: 'owner',
      avatarUrl: null,
    },
    members: params.members ?? [
      {
        userId: 'owner-1',
        role: 'OWNER',
        user: {
          id: 'owner-1',
          username: 'owner',
          avatarUrl: null,
          role: 'OWNER',
        },
      },
    ],
  };
}

function buildServerRepo(overrides: Partial<ServerRepository>): ServerRepository {
  const notImplemented = () => {
    throw new Error('not implemented');
  };
  return {
    resolveServerOwnerId: overrides.resolveServerOwnerId ?? (async () => null),
    listForUser: overrides.listForUser ?? (async () => []),
    findById: overrides.findById ?? (async () => null),
    findByIdForUser: overrides.findByIdForUser ?? (async () => null),
    findBySlug: overrides.findBySlug ?? (async () => null),
    create: overrides.create ?? notImplemented,
    upsertDefault: overrides.upsertDefault ?? notImplemented,
    ensureAllUsersAreMembers: overrides.ensureAllUsersAreMembers ?? (async () => 0),
    findMember: overrides.findMember ?? (async () => null),
    ensureMember: overrides.ensureMember ?? notImplemented,
    createInvite: overrides.createInvite ?? notImplemented,
    listInvites: overrides.listInvites ?? (async () => []),
    findInviteByCode: overrides.findInviteByCode ?? (async () => null),
    consumeInvite: overrides.consumeInvite ?? (async () => undefined),
    revokeInvite: overrides.revokeInvite ?? (async () => undefined),
    createAuditLog: overrides.createAuditLog ?? (async () => undefined),
    listAuditLogs: overrides.listAuditLogs ?? (async () => []),
    createModerationAction: overrides.createModerationAction ?? notImplemented,
    getAnalytics: overrides.getAnalytics ?? (async () => ({
      memberCount: 0,
      channelCount: 0,
      messageCount24h: 0,
      messageCount7d: 0,
      activeMembers24h: 0,
      moderationActions30d: 0,
      inviteJoins30d: 0,
    })),
  };
}

function buildChannelRepo(overrides: Partial<ChannelRepository>): ChannelRepository {
  const notImplemented = () => {
    throw new Error('not implemented');
  };
  return {
    listForUser: overrides.listForUser ?? (async () => []),
    listByServerForUser: overrides.listByServerForUser ?? (async () => []),
    findById: overrides.findById ?? (async () => null),
    findByIdForUser: overrides.findByIdForUser ?? (async () => null),
    findByNameInServer: overrides.findByNameInServer ?? (async () => null),
    countPublicChannels: overrides.countPublicChannels ?? (async () => 0),
    deleteById: overrides.deleteById ?? (async () => undefined),
    createPublic: overrides.createPublic ?? notImplemented,
    createVoice: overrides.createVoice ?? notImplemented,
    updateVoiceSettings: overrides.updateVoiceSettings ?? notImplemented,
    ensurePublicByName: overrides.ensurePublicByName ?? notImplemented,
    attachLegacyChannelsToServer: overrides.attachLegacyChannelsToServer ?? (async () => 0),
    findDirectByDmKey: overrides.findDirectByDmKey ?? (async () => null),
    createDirect: overrides.createDirect ?? notImplemented,
  };
}

describe('ServerService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('bootstraps default server and ensures membership for users', async () => {
    const defaultServer = buildServer({ id: 'server-1', slug: 'harmony-default', name: 'Harmony' });
    const upsertDefault = vi.fn().mockResolvedValue(defaultServer);
    const ensureAllUsersAreMembers = vi.fn().mockResolvedValue(2);
    const attachLegacyChannelsToServer = vi.fn().mockResolvedValue(3);
    const ensurePublicByName = vi.fn().mockResolvedValue({});

    const service = new ServerService(
      buildServerRepo({
        resolveServerOwnerId: async () => 'owner-1',
        findBySlug: async () => null,
        upsertDefault,
        ensureAllUsersAreMembers,
      }),
      buildChannelRepo({
        attachLegacyChannelsToServer,
        ensurePublicByName,
      }),
    );

    const result = await service.bootstrapDefaultServer();

    expect(result.serverId).toBe('server-1');
    expect(result.created).toBe(true);
    expect(ensureAllUsersAreMembers).toHaveBeenCalledWith('server-1');
    expect(attachLegacyChannelsToServer).toHaveBeenCalledWith('server-1');
    expect(ensurePublicByName).toHaveBeenCalledWith({ name: 'global', serverId: 'server-1' });
    expect(upsertDefault).toHaveBeenCalledWith({
      slug: 'harmony-default',
      name: 'Harmony',
      ownerId: 'owner-1',
    });
  });

  it('deduplicates slugs when creating servers', async () => {
    const created = buildServer({ id: 'server-2', slug: 'my-server-2', name: 'My Server' });
    const service = new ServerService(
      buildServerRepo({
        findBySlug: vi
          .fn()
          .mockResolvedValueOnce(buildServer({ id: 'server-1', slug: 'my-server', name: 'My Server' }))
          .mockResolvedValueOnce(null),
        create: vi.fn().mockResolvedValue(created),
      }),
      buildChannelRepo({}),
    );

    const server = await service.createServer('owner-1', { name: 'My Server' });
    expect(server.slug).toBe('my-server-2');
  });

  it('rejects expired invites', async () => {
    const service = new ServerService(
      buildServerRepo({
        findInviteByCode: async () => ({
          id: 'invite-1',
          code: 'ABC123',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          expiresAt: new Date(Date.now() - 1000),
          maxUses: null,
          usesCount: 0,
          revokedAt: null,
          serverId: 'server-1',
          createdById: 'owner-1',
          server: { id: 'server-1', slug: 'harmony-default', name: 'Harmony' },
          createdBy: { id: 'owner-1', username: 'owner' },
        }),
      }),
      buildChannelRepo({}),
    );

    await expect(service.joinByInvite('user-2', 'ABC123')).rejects.toMatchObject({
      code: 'INVITE_EXPIRED',
    } satisfies Partial<AppError>);
  });

  it('consumes invite when a new member joins', async () => {
    const consumeInvite = vi.fn().mockResolvedValue(undefined);
    const ensureMember = vi.fn().mockResolvedValue({
      id: 'membership-1',
      serverId: 'server-1',
      userId: 'user-2',
      role: 'MEMBER',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const service = new ServerService(
      buildServerRepo({
        findInviteByCode: async () => ({
          id: 'invite-1',
          code: 'ABC123',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          expiresAt: null,
          maxUses: null,
          usesCount: 0,
          revokedAt: null,
          serverId: 'server-1',
          createdById: 'owner-1',
          server: { id: 'server-1', slug: 'harmony-default', name: 'Harmony' },
          createdBy: { id: 'owner-1', username: 'owner' },
        }),
        findMember: async () => null,
        ensureMember,
        consumeInvite,
        findByIdForUser: async () =>
          buildServer({
            id: 'server-1',
            slug: 'harmony-default',
            name: 'Harmony',
            members: [
              {
                userId: 'user-2',
                role: 'MEMBER',
                user: {
                  id: 'user-2',
                  username: 'user',
                  avatarUrl: null,
                  role: 'MEMBER',
                },
              },
            ],
          }),
      }),
      buildChannelRepo({}),
    );

    const joined = await service.joinByInvite('user-2', 'ABC123');
    expect(joined.id).toBe('server-1');
    expect(ensureMember).toHaveBeenCalledWith({
      serverId: 'server-1',
      userId: 'user-2',
      role: 'MEMBER',
    });
    expect(consumeInvite).toHaveBeenCalledWith('invite-1');
  });

  it('rejects self moderation actions', async () => {
    const service = new ServerService(
      buildServerRepo({
        findMember: vi.fn().mockResolvedValue({
          id: 'member-1',
          serverId: 'server-1',
          userId: 'owner-1',
          role: 'OWNER',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      }),
      buildChannelRepo({}),
    );

    await expect(
      service.moderateUser('owner-1', {
        serverId: 'server-1',
        targetUserId: 'owner-1',
        type: 'WARN',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    } satisfies Partial<AppError>);
  });
});
