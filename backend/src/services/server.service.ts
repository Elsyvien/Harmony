import { randomBytes } from 'node:crypto';
import type { ModerationActionType, Prisma, ServerVisibility, UserRole } from '@prisma/client';
import type { ChannelRepository } from '../repositories/channel.repository.js';
import type {
  AuditLogWithRelations,
  ModerationActionWithRelations,
  ServerInviteWithRelations,
  ServerAnalyticsSnapshot,
  ServerMemberWithUser,
  ServerRepository,
  ServerWithMembers,
} from '../repositories/server.repository.js';
import { AppError } from '../utils/app-error.js';
import { isPrivilegedRole } from '../utils/roles.js';

const DEFAULT_SERVER_SLUG = 'harmony-default';
const DEFAULT_SERVER_NAME = 'Harmony';
const DEFAULT_GLOBAL_CHANNEL = 'global';
const DEFAULT_NEW_SERVER_TEXT_CHANNEL = 'general';
const DEFAULT_NEW_SERVER_VOICE_CHANNEL = 'voice';

export interface ServerSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  visibility: ServerVisibility;
  createdAt: Date;
  owner: {
    id: string;
    username: string;
    avatarUrl: string | null;
  };
  memberRole: UserRole | null;
  memberCount: number;
}

export interface ServerInviteSummary {
  id: string;
  code: string;
  createdAt: Date;
  expiresAt: Date | null;
  maxUses: number | null;
  usesCount: number;
  revokedAt: Date | null;
  server: {
    id: string;
    slug: string;
    name: string;
  };
  createdBy: {
    id: string;
    username: string;
  };
}

export interface AuditLogSummary {
  id: string;
  action: string;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  actor: {
    id: string;
    username: string;
  } | null;
  targetUser: {
    id: string;
    username: string;
  } | null;
}

export interface ModerationActionSummary {
  id: string;
  type: ModerationActionType;
  reason: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  actor: {
    id: string;
    username: string;
  };
  targetUser: {
    id: string;
    username: string;
  };
}

export interface ServerAnalyticsSummary extends ServerAnalyticsSnapshot {}

export interface ServerMemberSummary {
  id: string;
  userId: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    username: string;
    avatarUrl: string | null;
  };
}

export class ServerService {
  constructor(
    private readonly serverRepo: ServerRepository,
    private readonly channelRepo: ChannelRepository,
  ) {}

  private toSummary(server: ServerWithMembers, userId: string): ServerSummary {
    const memberRole = server.members.find((member) => member.userId === userId)?.role ?? null;
    return {
      id: server.id,
      slug: server.slug,
      name: server.name,
      description: server.description,
      iconUrl: server.iconUrl,
      visibility: server.visibility,
      createdAt: server.createdAt,
      owner: server.owner,
      memberRole,
      memberCount: server.members.length,
    };
  }

  private toInviteSummary(invite: ServerInviteWithRelations): ServerInviteSummary {
    return {
      id: invite.id,
      code: invite.code,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      maxUses: invite.maxUses,
      usesCount: invite.usesCount,
      revokedAt: invite.revokedAt,
      server: {
        id: invite.server.id,
        slug: invite.server.slug,
        name: invite.server.name,
      },
      createdBy: invite.createdBy,
    };
  }

  private normalizeSlug(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40);
  }

  private toAuditSummary(log: AuditLogWithRelations): AuditLogSummary {
    return {
      id: log.id,
      action: log.action,
      metadata: log.metadata,
      createdAt: log.createdAt,
      actor: log.actor,
      targetUser: log.targetUser,
    };
  }

  private toModerationSummary(action: ModerationActionWithRelations): ModerationActionSummary {
    return {
      id: action.id,
      type: action.type,
      reason: action.reason,
      expiresAt: action.expiresAt,
      createdAt: action.createdAt,
      actor: action.actor,
      targetUser: action.targetUser,
    };
  }

  private toMemberSummary(member: ServerMemberWithUser): ServerMemberSummary {
    return {
      id: member.id,
      userId: member.userId,
      role: member.role,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
      user: {
        id: member.user.id,
        username: member.user.username,
        avatarUrl: member.user.avatarUrl,
      },
    };
  }

  private async assertServerMember(serverId: string, userId: string) {
    const member = await this.serverRepo.findMember(serverId, userId);
    if (!member) {
      throw new AppError('SERVER_FORBIDDEN', 403, 'You are not a member of this server');
    }
    return member;
  }

  async assertCanManageServer(serverId: string, userId: string) {
    const member = await this.assertServerMember(serverId, userId);
    if (!isPrivilegedRole(member.role)) {
      throw new AppError('FORBIDDEN', 403, 'Moderator permission required');
    }
    return member;
  }

  async bootstrapDefaultServer(preferredOwnerUserId?: string) {
    const ownerId = await this.serverRepo.resolveServerOwnerId(preferredOwnerUserId);
    if (!ownerId) {
      return {
        serverId: null as string | null,
        created: false,
        backfilledMemberCount: 0,
        backfilledChannelCount: 0,
      };
    }

    const existing = await this.serverRepo.findBySlug(DEFAULT_SERVER_SLUG);
    const server = await this.serverRepo.upsertDefault({
      slug: DEFAULT_SERVER_SLUG,
      name: DEFAULT_SERVER_NAME,
      ownerId,
    });

    const backfilledMemberCount = await this.serverRepo.ensureAllUsersAreMembers(server.id);
    const backfilledChannelCount = await this.channelRepo.attachLegacyChannelsToServer(server.id);
    await this.channelRepo.ensurePublicByName({
      name: DEFAULT_GLOBAL_CHANNEL,
      serverId: server.id,
    });

    if (!existing) {
      await this.serverRepo.createAuditLog({
        serverId: server.id,
        actorId: ownerId,
        action: 'server.default.bootstrap',
      });
    }

    return {
      serverId: server.id,
      created: !existing,
      backfilledMemberCount,
      backfilledChannelCount,
    };
  }

  async ensureDefaultServerForUser(userId: string) {
    let server = await this.serverRepo.findBySlug(DEFAULT_SERVER_SLUG);
    if (!server) {
      const bootstrap = await this.bootstrapDefaultServer(userId);
      if (!bootstrap.serverId) {
        throw new AppError('SERVER_UNAVAILABLE', 503, 'No server is available yet');
      }
      server = await this.serverRepo.findById(bootstrap.serverId);
    }
    if (!server) {
      throw new AppError('SERVER_UNAVAILABLE', 503, 'No server is available yet');
    }

    await this.serverRepo.ensureMember({
      serverId: server.id,
      userId,
      role: 'MEMBER',
    });
    return server.id;
  }

  async listServers(userId: string): Promise<ServerSummary[]> {
    const servers = await this.serverRepo.listForUser(userId);
    return servers.map((server) => this.toSummary(server, userId));
  }

  async getServerForUser(serverId: string, userId: string): Promise<ServerSummary> {
    const server = await this.serverRepo.findByIdForUser(serverId, userId);
    if (!server) {
      throw new AppError('SERVER_NOT_FOUND', 404, 'Server not found');
    }
    return this.toSummary(server, userId);
  }

  async createServer(
    userId: string,
    input: { name: string; description?: string; iconUrl?: string; metadata?: Prisma.InputJsonValue },
  ): Promise<ServerSummary> {
    const trimmedName = input.name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 80) {
      throw new AppError('INVALID_SERVER_NAME', 400, 'Server name must be between 2 and 80 characters');
    }

    const baseSlug = this.normalizeSlug(trimmedName) || 'server';
    let slug = baseSlug;
    let suffix = 2;
    while (await this.serverRepo.findBySlug(slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    const created = await this.serverRepo.create({
      name: trimmedName,
      slug,
      ownerId: userId,
      description: input.description,
      iconUrl: input.iconUrl,
    });
    await this.serverRepo.createAuditLog({
      serverId: created.id,
      actorId: userId,
      action: 'server.create',
      metadata: input.metadata,
    });

    await this.channelRepo.ensurePublicByName({
      name: DEFAULT_NEW_SERVER_TEXT_CHANNEL,
      serverId: created.id,
    });
    const existingVoiceChannel = await this.channelRepo.findByNameInServer({
      serverId: created.id,
      name: DEFAULT_NEW_SERVER_VOICE_CHANNEL,
    });
    if (!existingVoiceChannel) {
      await this.channelRepo.createVoice({
        name: DEFAULT_NEW_SERVER_VOICE_CHANNEL,
        serverId: created.id,
      });
    }

    return this.toSummary(created, userId);
  }

  async listMembers(userId: string, serverId: string): Promise<ServerMemberSummary[]> {
    await this.assertCanManageServer(serverId, userId);
    const members = await this.serverRepo.listMembers(serverId);
    return members.map((member) => this.toMemberSummary(member));
  }

  async createInvite(
    userId: string,
    input: { serverId: string; maxUses?: number; expiresInHours?: number },
  ): Promise<ServerInviteSummary> {
    await this.assertCanManageServer(input.serverId, userId);

    const expiresAt =
      input.expiresInHours && input.expiresInHours > 0
        ? new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000)
        : undefined;
    const invite = await this.serverRepo.createInvite({
      serverId: input.serverId,
      createdById: userId,
      code: randomBytes(5).toString('hex').toUpperCase(),
      expiresAt,
      maxUses: input.maxUses,
    });
    await this.serverRepo.createAuditLog({
      serverId: input.serverId,
      actorId: userId,
      action: 'server.invite.create',
      metadata: {
        inviteId: invite.id,
        code: invite.code,
      },
    });
    return this.toInviteSummary(invite);
  }

  async listInvites(userId: string, serverId: string): Promise<ServerInviteSummary[]> {
    await this.assertCanManageServer(serverId, userId);
    const invites = await this.serverRepo.listInvites(serverId);
    return invites.map((invite) => this.toInviteSummary(invite));
  }

  async revokeInvite(userId: string, serverId: string, inviteId: string): Promise<void> {
    await this.assertCanManageServer(serverId, userId);
    const invites = await this.serverRepo.listInvites(serverId);
    const invite = invites.find((item) => item.id === inviteId);
    if (!invite) {
      throw new AppError('INVITE_NOT_FOUND', 404, 'Invite not found');
    }
    await this.serverRepo.revokeInvite(invite.id);
    await this.serverRepo.createAuditLog({
      serverId,
      actorId: userId,
      action: 'server.invite.revoke',
      metadata: {
        inviteId: invite.id,
        code: invite.code,
      },
    });
  }

  async joinByInvite(userId: string, inviteCode: string): Promise<ServerSummary> {
    const normalizedCode = inviteCode.trim().toUpperCase();
    if (!normalizedCode) {
      throw new AppError('INVALID_INVITE', 400, 'Invite code is required');
    }

    const invite = await this.serverRepo.findInviteByCode(normalizedCode);
    if (!invite) {
      throw new AppError('INVITE_NOT_FOUND', 404, 'Invite was not found');
    }
    if (invite.revokedAt) {
      throw new AppError('INVITE_REVOKED', 410, 'Invite is no longer active');
    }
    if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) {
      throw new AppError('INVITE_EXPIRED', 410, 'Invite has expired');
    }
    if (invite.maxUses !== null && invite.usesCount >= invite.maxUses) {
      throw new AppError('INVITE_EXHAUSTED', 410, 'Invite has reached max uses');
    }

    const existingMember = await this.serverRepo.findMember(invite.serverId, userId);
    if (!existingMember) {
      await this.serverRepo.ensureMember({
        serverId: invite.serverId,
        userId,
        role: 'MEMBER',
      });
      await this.serverRepo.consumeInvite(invite.id);
      await this.serverRepo.createAuditLog({
        serverId: invite.serverId,
        actorId: userId,
        action: 'server.member.join',
        metadata: {
          viaInviteCode: invite.code,
        },
      });
    }

    const server = await this.serverRepo.findByIdForUser(invite.serverId, userId);
    if (!server) {
      throw new AppError('SERVER_NOT_FOUND', 404, 'Server not found');
    }
    return this.toSummary(server, userId);
  }

  async listAuditLogs(userId: string, serverId: string, limit = 50): Promise<AuditLogSummary[]> {
    await this.assertCanManageServer(serverId, userId);
    const logs = await this.serverRepo.listAuditLogs(serverId, Math.max(1, Math.min(limit, 200)));
    return logs.map((log) => this.toAuditSummary(log));
  }

  async moderateUser(
    userId: string,
    input: {
      serverId: string;
      targetUserId: string;
      type: ModerationActionType;
      reason?: string;
      durationHours?: number;
    },
  ): Promise<ModerationActionSummary> {
    await this.assertCanManageServer(input.serverId, userId);
    if (input.targetUserId === userId) {
      throw new AppError('FORBIDDEN', 403, 'You cannot moderate yourself');
    }

    const targetMember = await this.serverRepo.findMember(input.serverId, input.targetUserId);
    if (!targetMember) {
      throw new AppError('SERVER_MEMBER_NOT_FOUND', 404, 'Target user is not a server member');
    }

    const expiresAt =
      input.durationHours && input.durationHours > 0
        ? new Date(Date.now() + input.durationHours * 60 * 60 * 1000)
        : undefined;
    const action = await this.serverRepo.createModerationAction({
      serverId: input.serverId,
      actorId: userId,
      targetUserId: input.targetUserId,
      type: input.type,
      reason: input.reason,
      expiresAt,
    });
    await this.serverRepo.createAuditLog({
      serverId: input.serverId,
      actorId: userId,
      targetUserId: input.targetUserId,
      action: `server.moderation.${input.type.toLowerCase()}`,
      metadata: {
        moderationActionId: action.id,
        durationHours: input.durationHours ?? null,
      },
    });
    return this.toModerationSummary(action);
  }

  async getAnalytics(userId: string, serverId: string): Promise<ServerAnalyticsSummary> {
    await this.assertCanManageServer(serverId, userId);
    return this.serverRepo.getAnalytics(serverId);
  }
}
