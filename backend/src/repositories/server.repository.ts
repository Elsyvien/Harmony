import type {
  ModerationAction,
  ModerationActionType,
  Prisma,
  Server,
  ServerInvite,
  ServerMember,
  UserRole,
} from '@prisma/client';
import { prisma } from './prisma.js';

interface ServerOwnerPreview {
  id: string;
  username: string;
  avatarUrl: string | null;
}

interface ServerMemberUserPreview {
  id: string;
  username: string;
  avatarUrl: string | null;
  role: UserRole;
}

interface ServerMemberPreview {
  userId: string;
  role: UserRole;
  user: ServerMemberUserPreview;
}

interface ServerMemberListUserPreview {
  id: string;
  username: string;
  avatarUrl: string | null;
}

export interface ServerMemberWithUser extends ServerMember {
  user: ServerMemberListUserPreview;
}

export interface ServerWithMembers extends Server {
  owner: ServerOwnerPreview;
  members: ServerMemberPreview[];
}

interface ServerInviteServerPreview {
  id: string;
  name: string;
  slug: string;
}

interface ServerInviteCreatorPreview {
  id: string;
  username: string;
}

export interface ServerInviteWithRelations extends ServerInvite {
  server: ServerInviteServerPreview;
  createdBy: ServerInviteCreatorPreview;
}

interface AuditActorPreview {
  id: string;
  username: string;
}

interface AuditTargetPreview {
  id: string;
  username: string;
}

export interface AuditLogWithRelations {
  id: string;
  action: string;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  actor: AuditActorPreview | null;
  targetUser: AuditTargetPreview | null;
}

interface ModerationActorPreview {
  id: string;
  username: string;
}

interface ModerationTargetPreview {
  id: string;
  username: string;
}

export interface ModerationActionWithRelations extends ModerationAction {
  actor: ModerationActorPreview;
  targetUser: ModerationTargetPreview;
}

export interface ServerAnalyticsSnapshot {
  memberCount: number;
  channelCount: number;
  messageCount24h: number;
  messageCount7d: number;
  activeMembers24h: number;
  moderationActions30d: number;
  inviteJoins30d: number;
}

const includeServerMembers = {
  owner: {
    select: {
      id: true,
      username: true,
      avatarUrl: true,
    },
  },
  members: {
    select: {
      userId: true,
      role: true,
      user: {
        select: {
          id: true,
          username: true,
          avatarUrl: true,
          role: true,
        },
      },
    },
  },
} as const satisfies Prisma.ServerInclude;

const includeInviteRelations = {
  server: {
    select: {
      id: true,
      name: true,
      slug: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      username: true,
    },
  },
} as const satisfies Prisma.ServerInviteInclude;

export interface ServerRepository {
  resolveServerOwnerId(preferredUserId?: string): Promise<string | null>;
  listForUser(userId: string): Promise<ServerWithMembers[]>;
  findById(serverId: string): Promise<ServerWithMembers | null>;
  findByIdForUser(serverId: string, userId: string): Promise<ServerWithMembers | null>;
  findBySlug(slug: string): Promise<ServerWithMembers | null>;
  create(params: {
    name: string;
    slug: string;
    ownerId: string;
    description?: string;
    iconUrl?: string;
  }): Promise<ServerWithMembers>;
  upsertDefault(params: { slug: string; name: string; ownerId: string }): Promise<ServerWithMembers>;
  ensureAllUsersAreMembers(serverId: string): Promise<number>;
  findMember(serverId: string, userId: string): Promise<ServerMember | null>;
  listMembers(serverId: string): Promise<ServerMemberWithUser[]>;
  ensureMember(params: { serverId: string; userId: string; role?: UserRole }): Promise<ServerMember>;
  createInvite(params: {
    serverId: string;
    createdById: string;
    code: string;
    expiresAt?: Date;
    maxUses?: number;
  }): Promise<ServerInviteWithRelations>;
  listInvites(serverId: string): Promise<ServerInviteWithRelations[]>;
  findInviteByCode(code: string): Promise<ServerInviteWithRelations | null>;
  consumeInvite(inviteId: string): Promise<void>;
  revokeInvite(inviteId: string): Promise<void>;
  createAuditLog(params: {
    serverId: string;
    action: string;
    actorId?: string;
    targetUserId?: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<void>;
  listAuditLogs(serverId: string, limit: number): Promise<AuditLogWithRelations[]>;
  createModerationAction(params: {
    serverId: string;
    actorId: string;
    targetUserId: string;
    type: ModerationActionType;
    reason?: string;
    expiresAt?: Date;
  }): Promise<ModerationActionWithRelations>;
  getAnalytics(serverId: string): Promise<ServerAnalyticsSnapshot>;
}

export class PrismaServerRepository implements ServerRepository {
  async resolveServerOwnerId(preferredUserId?: string) {
    if (preferredUserId) {
      const preferred = await prisma.user.findUnique({
        where: { id: preferredUserId },
        select: { id: true },
      });
      if (preferred) {
        return preferred.id;
      }
    }

    const owner = await prisma.user.findFirst({
      where: {
        role: {
          in: ['OWNER', 'ADMIN'],
        },
      },
      orderBy: [{ createdAt: 'asc' }],
      select: { id: true },
    });
    if (owner) {
      return owner.id;
    }

    const user = await prisma.user.findFirst({
      orderBy: [{ createdAt: 'asc' }],
      select: { id: true },
    });
    return user?.id ?? null;
  }

  listForUser(userId: string) {
    return prisma.server.findMany({
      where: {
        members: {
          some: {
            userId,
          },
        },
      },
      include: includeServerMembers,
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  findById(serverId: string) {
    return prisma.server.findUnique({
      where: { id: serverId },
      include: includeServerMembers,
    });
  }

  findByIdForUser(serverId: string, userId: string) {
    return prisma.server.findFirst({
      where: {
        id: serverId,
        members: {
          some: {
            userId,
          },
        },
      },
      include: includeServerMembers,
    });
  }

  findBySlug(slug: string) {
    return prisma.server.findUnique({
      where: { slug },
      include: includeServerMembers,
    });
  }

  create(params: {
    name: string;
    slug: string;
    ownerId: string;
    description?: string;
    iconUrl?: string;
  }) {
    return prisma.server.create({
      data: {
        name: params.name,
        slug: params.slug,
        description: params.description ?? null,
        iconUrl: params.iconUrl ?? null,
        ownerId: params.ownerId,
        members: {
          create: {
            userId: params.ownerId,
            role: 'OWNER',
          },
        },
      },
      include: includeServerMembers,
    });
  }

  async upsertDefault(params: { slug: string; name: string; ownerId: string }) {
    const existing = await prisma.server.findUnique({
      where: { slug: params.slug },
      include: includeServerMembers,
    });
    if (existing) {
      return existing;
    }
    return this.create({
      name: params.name,
      slug: params.slug,
      ownerId: params.ownerId,
    });
  }

  async ensureAllUsersAreMembers(serverId: string) {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        role: true,
      },
    });
    if (users.length === 0) {
      return 0;
    }
    const result = await prisma.serverMember.createMany({
      data: users.map((user) => ({
        serverId,
        userId: user.id,
        role: user.role === 'OWNER' || user.role === 'ADMIN' ? user.role : 'MEMBER',
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  findMember(serverId: string, userId: string) {
    return prisma.serverMember.findUnique({
      where: {
        serverId_userId: {
          serverId,
          userId,
        },
      },
    });
  }

  listMembers(serverId: string): Promise<ServerMemberWithUser[]> {
    return prisma.serverMember.findMany({
      where: {
        serverId,
      },
      orderBy: [{ createdAt: 'asc' }],
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  ensureMember(params: { serverId: string; userId: string; role?: UserRole }) {
    return prisma.serverMember.upsert({
      where: {
        serverId_userId: {
          serverId: params.serverId,
          userId: params.userId,
        },
      },
      update: {},
      create: {
        serverId: params.serverId,
        userId: params.userId,
        role: params.role ?? 'MEMBER',
      },
    });
  }

  createInvite(params: {
    serverId: string;
    createdById: string;
    code: string;
    expiresAt?: Date;
    maxUses?: number;
  }) {
    return prisma.serverInvite.create({
      data: {
        serverId: params.serverId,
        createdById: params.createdById,
        code: params.code,
        expiresAt: params.expiresAt ?? null,
        maxUses: params.maxUses ?? null,
      },
      include: includeInviteRelations,
    });
  }

  listInvites(serverId: string) {
    return prisma.serverInvite.findMany({
      where: {
        serverId,
      },
      include: includeInviteRelations,
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  findInviteByCode(code: string) {
    return prisma.serverInvite.findUnique({
      where: { code },
      include: includeInviteRelations,
    });
  }

  async consumeInvite(inviteId: string) {
    await prisma.serverInvite.update({
      where: { id: inviteId },
      data: {
        usesCount: {
          increment: 1,
        },
      },
    });
  }

  async revokeInvite(inviteId: string) {
    await prisma.serverInvite.update({
      where: { id: inviteId },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  async createAuditLog(params: {
    serverId: string;
    action: string;
    actorId?: string;
    targetUserId?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    await prisma.auditLog.create({
      data: {
        serverId: params.serverId,
        action: params.action,
        actorId: params.actorId ?? null,
        targetUserId: params.targetUserId ?? null,
        metadata: params.metadata,
      },
    });
  }

  async listAuditLogs(serverId: string, limit: number): Promise<AuditLogWithRelations[]> {
    const rows = await prisma.auditLog.findMany({
      where: {
        serverId,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        action: true,
        metadata: true,
        createdAt: true,
        actor: {
          select: {
            id: true,
            username: true,
          },
        },
        targetUser: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      metadata: row.metadata,
      createdAt: row.createdAt,
      actor: row.actor,
      targetUser: row.targetUser,
    }));
  }

  async createModerationAction(params: {
    serverId: string;
    actorId: string;
    targetUserId: string;
    type: ModerationActionType;
    reason?: string;
    expiresAt?: Date;
  }): Promise<ModerationActionWithRelations> {
    const action = await prisma.moderationAction.create({
      data: {
        serverId: params.serverId,
        actorId: params.actorId,
        targetUserId: params.targetUserId,
        type: params.type,
        reason: params.reason ?? null,
        expiresAt: params.expiresAt ?? null,
      },
      include: {
        actor: {
          select: {
            id: true,
            username: true,
          },
        },
        targetUser: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });
    return action;
  }

  async getAnalytics(serverId: string): Promise<ServerAnalyticsSnapshot> {
    const now = Date.now();
    const in24h = new Date(now - 24 * 60 * 60 * 1000);
    const in7d = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const in30d = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const [memberCount, channelCount, messageCount24h, messageCount7d, activeUsers, moderationActions30d, inviteJoins30d] =
      await Promise.all([
        prisma.serverMember.count({
          where: { serverId },
        }),
        prisma.channel.count({
          where: {
            serverId,
            type: {
              in: ['PUBLIC', 'VOICE'],
            },
          },
        }),
        prisma.message.count({
          where: {
            channel: {
              serverId,
            },
            createdAt: {
              gte: in24h,
            },
          },
        }),
        prisma.message.count({
          where: {
            channel: {
              serverId,
            },
            createdAt: {
              gte: in7d,
            },
          },
        }),
        prisma.message.findMany({
          where: {
            channel: {
              serverId,
            },
            createdAt: {
              gte: in24h,
            },
          },
          select: {
            userId: true,
          },
          distinct: ['userId'],
        }),
        prisma.moderationAction.count({
          where: {
            serverId,
            createdAt: {
              gte: in30d,
            },
          },
        }),
        prisma.auditLog.count({
          where: {
            serverId,
            action: 'server.member.join',
            createdAt: {
              gte: in30d,
            },
          },
        }),
      ]);

    return {
      memberCount,
      channelCount,
      messageCount24h,
      messageCount7d,
      activeMembers24h: activeUsers.length,
      moderationActions30d,
      inviteJoins30d,
    };
  }
}
