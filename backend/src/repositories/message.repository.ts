import { prisma } from './prisma.js';

export interface MessageWithAuthor {
  id: string;
  channelId: string;
  userId: string;
  content: string;
  attachment: {
    url: string;
    name: string;
    type: string;
    size: number;
  } | null;
  createdAt: Date;
  user: {
    id: string;
    username: string;
  };
}

export interface MessageRepository {
  listByChannel(params: { channelId: string; before?: Date; limit: number }): Promise<MessageWithAuthor[]>;
  create(params: {
    channelId: string;
    userId: string;
    content: string;
    attachment?: {
      url: string;
      name: string;
      type: string;
      size: number;
    };
  }): Promise<MessageWithAuthor>;
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

    return rows
      .reverse()
      .map((row) => ({
        id: row.id,
        channelId: row.channelId,
        userId: row.userId,
        content: row.content,
        attachment:
          row.attachmentUrl && row.attachmentName && row.attachmentType && row.attachmentSize
            ? {
                url: row.attachmentUrl,
                name: row.attachmentName,
                type: row.attachmentType,
                size: row.attachmentSize,
              }
            : null,
        createdAt: row.createdAt,
        user: row.user,
      }));
  }

  async create(params: {
    channelId: string;
    userId: string;
    content: string;
    attachment?: {
      url: string;
      name: string;
      type: string;
      size: number;
    };
  }) {
    const created = await prisma.message.create({
      data: {
        channelId: params.channelId,
        userId: params.userId,
        content: params.content,
        attachmentUrl: params.attachment?.url ?? null,
        attachmentName: params.attachment?.name ?? null,
        attachmentType: params.attachment?.type ?? null,
        attachmentSize: params.attachment?.size ?? null,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });

    return {
      id: created.id,
      channelId: created.channelId,
      userId: created.userId,
      content: created.content,
      attachment:
        created.attachmentUrl &&
        created.attachmentName &&
        created.attachmentType &&
        created.attachmentSize
          ? {
              url: created.attachmentUrl,
              name: created.attachmentName,
              type: created.attachmentType,
              size: created.attachmentSize,
            }
          : null,
      createdAt: created.createdAt,
      user: created.user,
    };
  }
}
