import type { Channel } from '@prisma/client';
import { prisma } from './prisma.js';

interface ChannelMemberPreview {
  userId: string;
  user: {
    id: string;
    username: string;
  };
}

export interface ChannelWithMembers extends Channel {
  members: ChannelMemberPreview[];
}

export interface ChannelRepository {
  listForUser(userId: string): Promise<ChannelWithMembers[]>;
  findById(id: string): Promise<ChannelWithMembers | null>;
  findByIdForUser(id: string, userId: string): Promise<ChannelWithMembers | null>;
  findByName(name: string): Promise<ChannelWithMembers | null>;
  countPublicChannels(): Promise<number>;
  deleteById(id: string): Promise<void>;
  createPublic(params: { name: string }): Promise<ChannelWithMembers>;
  ensurePublicByName(name: string): Promise<ChannelWithMembers>;
  findDirectByDmKey(dmKey: string): Promise<ChannelWithMembers | null>;
  createDirect(params: {
    name: string;
    dmKey: string;
    memberUserIds: [string, string];
  }): Promise<ChannelWithMembers>;
}

const includeMembers = {
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
        OR: [{ type: 'PUBLIC' }, { members: { some: { userId } } }],
      },
      orderBy: { createdAt: 'asc' },
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
        OR: [{ type: 'PUBLIC' }, { members: { some: { userId } } }],
      },
      include: includeMembers,
    });
  }

  findByName(name: string) {
    return prisma.channel.findUnique({
      where: { name },
      include: includeMembers,
    });
  }

  countPublicChannels() {
    return prisma.channel.count({
      where: { type: 'PUBLIC' },
    });
  }

  async deleteById(id: string) {
    await prisma.channel.delete({
      where: { id },
    });
  }

  createPublic(params: { name: string }) {
    return prisma.channel.create({
      data: {
        name: params.name,
        type: 'PUBLIC',
      },
      include: includeMembers,
    });
  }

  ensurePublicByName(name: string) {
    return prisma.channel.upsert({
      where: { name },
      update: {
        type: 'PUBLIC',
        dmKey: null,
      },
      create: {
        name,
        type: 'PUBLIC',
      },
      include: includeMembers,
    });
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
