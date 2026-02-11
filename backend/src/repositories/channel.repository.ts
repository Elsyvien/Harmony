import type { Channel } from '@prisma/client';
import { prisma } from './prisma.js';

export interface ChannelRepository {
  list(): Promise<Channel[]>;
  findById(id: string): Promise<Channel | null>;
  ensureByName(name: string): Promise<Channel>;
}

export class PrismaChannelRepository implements ChannelRepository {
  list() {
    return prisma.channel.findMany({ orderBy: { createdAt: 'asc' } });
  }

  findById(id: string) {
    return prisma.channel.findUnique({ where: { id } });
  }

  ensureByName(name: string) {
    return prisma.channel.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
}
