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
  createdAt: Date;
  user: {
    id: string;
    username: string;
    avatarUrl: string | null;
  };
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
} satisfies Prisma.MessageInclude;

type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

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
}
