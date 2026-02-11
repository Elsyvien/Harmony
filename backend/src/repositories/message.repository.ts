import { prisma } from './prisma.js';

export interface MessageWithAuthor {
  id: string;
  channelId: string;
  userId: string;
  content: string;
  createdAt: Date;
  user: {
    id: string;
    username: string;
  };
}

export interface MessageRepository {
  listByChannel(params: { channelId: string; before?: Date; limit: number }): Promise<MessageWithAuthor[]>;
  create(params: { channelId: string; userId: string; content: string }): Promise<MessageWithAuthor>;
}

export class PrismaMessageRepository implements MessageRepository {
  async listByChannel(params: { channelId: string; before?: Date; limit: number }) {
    const rows = await prisma.message.findMany({
      where: {
        channelId: params.channelId,
        ...(params.before ? { createdAt: { lt: params.before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: params.limit,
      include: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });

    return rows.reverse();
  }

  create(params: { channelId: string; userId: string; content: string }) {
    return prisma.message.create({
      data: params,
      include: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });
  }
}
