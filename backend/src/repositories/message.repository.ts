import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

export interface MessageReactionSummary {
  emoji: string;
  userIds: string[];
}

export interface MessageReplyPreview {
  id: string;
  userId: string;
  content: string;
  createdAt: Date;
  deletedAt: Date | null;
  user: {
    id: string;
    username: string;
    avatarUrl: string | null;
  };
}

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
  editedAt: Date | null;
  deletedAt: Date | null;
  replyToMessageId: string | null;
  replyTo: MessageReplyPreview | null;
  reactions: MessageReactionSummary[];
  deliveredUserIds: string[];
  readUserIds: string[];
  createdAt: Date;
  user: {
    id: string;
    username: string;
    avatarUrl: string | null;
  };
}

export interface ChannelReceiptUpdateResult {
  updated: boolean;
  upToMessageId: string | null;
  at: Date;
}

const messageInclude = {
  user: {
    select: {
      id: true,
      username: true,
      avatarUrl: true,
    },
  },
  replyTo: {
    select: {
      id: true,
      userId: true,
      content: true,
      createdAt: true,
      deletedAt: true,
      user: {
        select: {
          id: true,
          username: true,
          avatarUrl: true,
        },
      },
    },
  },
  reactions: {
    select: {
      emoji: true,
      userId: true,
    },
  },
  receipts: {
    select: {
      userId: true,
      deliveredAt: true,
      readAt: true,
    },
  },
} satisfies Prisma.MessageInclude;

type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

function sortedUniqueUserIds(userIds: string[]) {
  return Array.from(new Set(userIds)).sort((a, b) => a.localeCompare(b));
}

function toMessageWithAuthor(row: MessageRow): MessageWithAuthor {
  const groupedReactions = new Map<string, Set<string>>();
  for (const reaction of row.reactions) {
    const bucket = groupedReactions.get(reaction.emoji) ?? new Set<string>();
    bucket.add(reaction.userId);
    groupedReactions.set(reaction.emoji, bucket);
  }

  const reactions: MessageReactionSummary[] = Array.from(groupedReactions.entries())
    .map(([emoji, users]) => ({
      emoji,
      userIds: Array.from(users).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.emoji.localeCompare(b.emoji));

  const deliveredUserIds = sortedUniqueUserIds(
    row.receipts.filter((receipt) => Boolean(receipt.deliveredAt)).map((receipt) => receipt.userId),
  );
  const readUserIds = sortedUniqueUserIds(
    row.receipts.filter((receipt) => Boolean(receipt.readAt)).map((receipt) => receipt.userId),
  );

  return {
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
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
    replyToMessageId: row.replyToMessageId,
    replyTo: row.replyTo
      ? {
          id: row.replyTo.id,
          userId: row.replyTo.userId,
          content: row.replyTo.content,
          createdAt: row.replyTo.createdAt,
          deletedAt: row.replyTo.deletedAt,
          user: row.replyTo.user,
        }
      : null,
    reactions,
    deliveredUserIds,
    readUserIds,
    createdAt: row.createdAt,
    user: row.user,
  };
}

export interface MessageRepository {
  listByChannel(params: { channelId: string; before?: Date; limit: number }): Promise<MessageWithAuthor[]>;
  findByIdInChannel(params: { channelId: string; messageId: string }): Promise<MessageWithAuthor | null>;
  create(params: {
    channelId: string;
    userId: string;
    content: string;
    replyToMessageId?: string;
    attachment?: {
      url: string;
      name: string;
      type: string;
      size: number;
    };
  }): Promise<MessageWithAuthor>;
  updateContent(params: { messageId: string; content: string }): Promise<MessageWithAuthor>;
  softDelete(params: { messageId: string }): Promise<MessageWithAuthor>;
  toggleReaction(params: {
    messageId: string;
    userId: string;
    emoji: string;
  }): Promise<{ message: MessageWithAuthor; reacted: boolean }>;
  markDeliveredInChannel(params: {
    channelId: string;
    userId: string;
    upToCreatedAt?: Date;
  }): Promise<ChannelReceiptUpdateResult>;
  markReadInChannel(params: {
    channelId: string;
    userId: string;
    upToCreatedAt?: Date;
  }): Promise<ChannelReceiptUpdateResult>;
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
      include: messageInclude,
    });

    return rows.reverse().map((row) => toMessageWithAuthor(row));
  }

  async findByIdInChannel(params: { channelId: string; messageId: string }) {
    const row = await prisma.message.findFirst({
      where: {
        id: params.messageId,
        channelId: params.channelId,
      },
      include: messageInclude,
    });
    return row ? toMessageWithAuthor(row) : null;
  }

  async create(params: {
    channelId: string;
    userId: string;
    content: string;
    replyToMessageId?: string;
    attachment?: {
      url: string;
      name: string;
      type: string;
      size: number;
    };
  }) {
    const now = new Date();
    const created = await prisma.message.create({
      data: {
        channelId: params.channelId,
        userId: params.userId,
        content: params.content,
        replyToMessageId: params.replyToMessageId ?? null,
        attachmentUrl: params.attachment?.url ?? null,
        attachmentName: params.attachment?.name ?? null,
        attachmentType: params.attachment?.type ?? null,
        attachmentSize: params.attachment?.size ?? null,
        receipts: {
          create: {
            userId: params.userId,
            deliveredAt: now,
            readAt: now,
          },
        },
      },
      include: messageInclude,
    });

    return toMessageWithAuthor(created);
  }

  async updateContent(params: { messageId: string; content: string }) {
    const updated = await prisma.message.update({
      where: { id: params.messageId },
      data: {
        content: params.content,
        editedAt: new Date(),
      },
      include: messageInclude,
    });

    return toMessageWithAuthor(updated);
  }

  async softDelete(params: { messageId: string }) {
    const deleted = await prisma.message.update({
      where: { id: params.messageId },
      data: {
        content: '',
        editedAt: null,
        deletedAt: new Date(),
        attachmentUrl: null,
        attachmentName: null,
        attachmentType: null,
        attachmentSize: null,
      },
      include: messageInclude,
    });

    return toMessageWithAuthor(deleted);
  }

  async toggleReaction(params: {
    messageId: string;
    userId: string;
    emoji: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.messageReaction.findUnique({
        where: {
          messageId_userId_emoji: {
            messageId: params.messageId,
            userId: params.userId,
            emoji: params.emoji,
          },
        },
      });

      const reacted = !existing;
      if (existing) {
        await tx.messageReaction.delete({
          where: { id: existing.id },
        });
      } else {
        await tx.messageReaction.create({
          data: {
            messageId: params.messageId,
            userId: params.userId,
            emoji: params.emoji,
          },
        });
      }

      const message = await tx.message.findUniqueOrThrow({
        where: { id: params.messageId },
        include: messageInclude,
      });

      return {
        message: toMessageWithAuthor(message),
        reacted,
      };
    });
  }

  async markDeliveredInChannel(params: {
    channelId: string;
    userId: string;
    upToCreatedAt?: Date;
  }): Promise<ChannelReceiptUpdateResult> {
    const at = new Date();
    const targets = await prisma.message.findMany({
      where: {
        channelId: params.channelId,
        userId: {
          not: params.userId,
        },
        ...(params.upToCreatedAt ? { createdAt: { lte: params.upToCreatedAt } } : {}),
      },
      select: {
        id: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (targets.length === 0) {
      return {
        updated: false,
        upToMessageId: null,
        at,
      };
    }

    const messageIds = targets.map((item) => item.id);
    const created = await prisma.messageReceipt.createMany({
      data: messageIds.map((messageId) => ({
        messageId,
        userId: params.userId,
        deliveredAt: at,
      })),
      skipDuplicates: true,
    });

    const updated = await prisma.messageReceipt.updateMany({
      where: {
        messageId: {
          in: messageIds,
        },
        userId: params.userId,
        deliveredAt: null,
      },
      data: {
        deliveredAt: at,
      },
    });

    return {
      updated: created.count + updated.count > 0,
      upToMessageId: messageIds[messageIds.length - 1] ?? null,
      at,
    };
  }

  async markReadInChannel(params: {
    channelId: string;
    userId: string;
    upToCreatedAt?: Date;
  }): Promise<ChannelReceiptUpdateResult> {
    const at = new Date();
    const targets = await prisma.message.findMany({
      where: {
        channelId: params.channelId,
        userId: {
          not: params.userId,
        },
        ...(params.upToCreatedAt ? { createdAt: { lte: params.upToCreatedAt } } : {}),
      },
      select: {
        id: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (targets.length === 0) {
      return {
        updated: false,
        upToMessageId: null,
        at,
      };
    }

    const messageIds = targets.map((item) => item.id);
    const created = await prisma.messageReceipt.createMany({
      data: messageIds.map((messageId) => ({
        messageId,
        userId: params.userId,
        deliveredAt: at,
        readAt: at,
      })),
      skipDuplicates: true,
    });

    const deliveredUpdated = await prisma.messageReceipt.updateMany({
      where: {
        messageId: {
          in: messageIds,
        },
        userId: params.userId,
        deliveredAt: null,
      },
      data: {
        deliveredAt: at,
      },
    });

    const readUpdated = await prisma.messageReceipt.updateMany({
      where: {
        messageId: {
          in: messageIds,
        },
        userId: params.userId,
        readAt: null,
      },
      data: {
        readAt: at,
      },
    });

    return {
      updated: created.count + deliveredUpdated.count + readUpdated.count > 0,
      upToMessageId: messageIds[messageIds.length - 1] ?? null,
      at,
    };
  }
}
