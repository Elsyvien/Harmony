import type { Channel } from '@prisma/client';
import { prisma } from './prisma.js';

interface ChannelMemberPreview {
  userId: string;
  user: {
    id: string;
    username: string;
  };
}

interface ChannelServerPreview {
  id: string;
  name: string;
}

export interface ChannelWithMembers extends Channel {
  members: ChannelMemberPreview[];
  server: ChannelServerPreview | null;
}

export interface ChannelRepository {
  listForUser(userId: string): Promise<ChannelWithMembers[]>;
  listByServerForUser(serverId: string, userId: string): Promise<ChannelWithMembers[]>;
  findById(id: string): Promise<ChannelWithMembers | null>;
  findByIdForUser(id: string, userId: string): Promise<ChannelWithMembers | null>;
  findByNameInServer(params: { serverId: string; name: string }): Promise<ChannelWithMembers | null>;
  countPublicChannels(serverId: string): Promise<number>;
  deleteById(id: string): Promise<void>;
  createPublic(params: { name: string; serverId: string }): Promise<ChannelWithMembers>;
  createVoice(params: { name: string; serverId: string }): Promise<ChannelWithMembers>;
  updateVoiceSettings(params: {
    id: string;
    voiceBitrateKbps?: number;
    streamBitrateKbps?: number;
  }): Promise<ChannelWithMembers>;
  ensurePublicByName(params: { name: string; serverId: string }): Promise<ChannelWithMembers>;
  attachLegacyChannelsToServer(serverId: string): Promise<number>;
  findDirectByDmKey(dmKey: string): Promise<ChannelWithMembers | null>;
  createDirect(params: {
    name: string;
    dmKey: string;
    memberUserIds: [string, string];
  }): Promise<ChannelWithMembers>;
}

const includeMembers = {
  server: {
    select: {
      id: true,
      name: true,
    },
  },
  members: {
    select: {
      userId: true,
      user: {
        select: {
          id: true,
          username: true,
        },
      },
    },
  },
} as const;

export class PrismaChannelRepository implements ChannelRepository {
  listForUser(userId: string) {
    return prisma.channel.findMany({
      where: {
        OR: [
          { type: 'DIRECT', members: { some: { userId } } },
          {
            type: { in: ['PUBLIC', 'VOICE'] },
            server: { members: { some: { userId } } },
          },
        ],
      },
      orderBy: [{ createdAt: 'asc' }],
      include: includeMembers,
    });
  }

  listByServerForUser(serverId: string, userId: string) {
    return prisma.channel.findMany({
      where: {
        serverId,
        type: { in: ['PUBLIC', 'VOICE'] },
        server: { members: { some: { userId } } },
      },
      orderBy: [{ createdAt: 'asc' }],
      include: includeMembers,
    });
  }

  findById(id: string) {
    return prisma.channel.findUnique({
      where: { id },
      include: includeMembers,
    });
  }

  findByIdForUser(id: string, userId: string) {
    return prisma.channel.findFirst({
      where: {
        id,
        OR: [
          { type: 'DIRECT', members: { some: { userId } } },
          {
            type: { in: ['PUBLIC', 'VOICE'] },
            server: { members: { some: { userId } } },
          },
        ],
      },
      include: includeMembers,
    });
  }

  findByNameInServer(params: { serverId: string; name: string }) {
    return prisma.channel.findFirst({
      where: {
        serverId: params.serverId,
        name: params.name,
      },
      include: includeMembers,
    });
  }

  countPublicChannels(serverId: string) {
    return prisma.channel.count({
      where: {
        serverId,
        type: 'PUBLIC',
      },
    });
  }

  async deleteById(id: string) {
    await prisma.channel.delete({
      where: { id },
    });
  }

  createPublic(params: { name: string; serverId: string }) {
    return prisma.channel.create({
      data: {
        name: params.name,
        type: 'PUBLIC',
        serverId: params.serverId,
        voiceBitrateKbps: null,
        streamBitrateKbps: null,
      },
      include: includeMembers,
    });
  }

  createVoice(params: { name: string; serverId: string }) {
    return prisma.channel.create({
      data: {
        name: params.name,
        type: 'VOICE',
        serverId: params.serverId,
        voiceBitrateKbps: 64,
        streamBitrateKbps: 2500,
      },
      include: includeMembers,
    });
  }

  updateVoiceSettings(params: {
    id: string;
    voiceBitrateKbps?: number;
    streamBitrateKbps?: number;
  }) {
    return prisma.channel.update({
      where: { id: params.id },
      data: {
        voiceBitrateKbps: params.voiceBitrateKbps,
        streamBitrateKbps: params.streamBitrateKbps,
      },
      include: includeMembers,
    });
  }

  async ensurePublicByName(params: { name: string; serverId: string }) {
    const existing = await prisma.channel.findFirst({
      where: {
        serverId: params.serverId,
        name: params.name,
      },
      include: includeMembers,
    });
    if (existing) {
      if (existing.type !== 'PUBLIC') {
        return prisma.channel.update({
          where: { id: existing.id },
          data: {
            type: 'PUBLIC',
            dmKey: null,
            voiceBitrateKbps: null,
            streamBitrateKbps: null,
          },
          include: includeMembers,
        });
      }
      return existing;
    }

    return prisma.channel.create({
      data: {
        serverId: params.serverId,
        name: params.name,
        type: 'PUBLIC',
        voiceBitrateKbps: null,
        streamBitrateKbps: null,
      },
      include: includeMembers,
    });
  }

  async attachLegacyChannelsToServer(serverId: string) {
    const updated = await prisma.channel.updateMany({
      where: {
        serverId: null,
        type: {
          in: ['PUBLIC', 'VOICE'],
        },
      },
      data: {
        serverId,
      },
    });
    return updated.count;
  }

  findDirectByDmKey(dmKey: string) {
    return prisma.channel.findUnique({
      where: { dmKey },
      include: includeMembers,
    });
  }

  async createDirect(params: { name: string; dmKey: string; memberUserIds: [string, string] }) {
    return prisma.$transaction(async (tx) => {
      const channel = await tx.channel.create({
        data: {
          name: params.name,
          type: 'DIRECT',
          dmKey: params.dmKey,
          serverId: null,
          voiceBitrateKbps: null,
          streamBitrateKbps: null,
        },
      });
      await tx.channelMember.createMany({
        data: params.memberUserIds.map((userId) => ({ channelId: channel.id, userId })),
      });
      return tx.channel.findUniqueOrThrow({
        where: { id: channel.id },
        include: includeMembers,
      });
    });
  }
}
