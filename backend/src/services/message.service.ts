import type {
  MessageRepository,
  MessageWithAuthor,
} from '../repositories/message.repository.js';
import type { ChannelAccessService } from './channel.service.js';
import type { AdminSettingsService } from './admin-settings.service.js';
import { AppError } from '../utils/app-error.js';

export interface ListMessagesInput {
  channelId: string;
  userId: string;
  before?: Date;
  limit: number;
}

export interface CreateMessageInput {
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
  userIsAdmin?: boolean;
}

export interface UpdateMessageInput {
  channelId: string;
  messageId: string;
  userId: string;
  content: string;
  userIsAdmin?: boolean;
}

export interface DeleteMessageInput {
  channelId: string;
  messageId: string;
  userId: string;
  userIsAdmin?: boolean;
}

export interface ToggleReactionInput {
  channelId: string;
  messageId: string;
  userId: string;
  emoji: string;
}

export class MessageService {
  constructor(
    private readonly messageRepo: MessageRepository,
    private readonly channelService: ChannelAccessService,
    private readonly maxLength: number,
    private readonly adminSettingsService?: AdminSettingsService,
  ) {}

  async listMessages(input: ListMessagesInput): Promise<MessageWithAuthor[]> {
    const canAccessChannel = await this.channelService.ensureChannelAccess(input.channelId, input.userId);
    if (!canAccessChannel) {
      throw new AppError('CHANNEL_NOT_FOUND', 404, 'Channel not found');
    }

    return this.messageRepo.listByChannel({
      channelId: input.channelId,
      before: input.before,
      limit: input.limit,
    });
  }

  async createMessage(input: CreateMessageInput): Promise<MessageWithAuthor> {
    const settings = await this.adminSettingsService?.getSettings();
    if (settings?.readOnlyMode && !input.userIsAdmin) {
      throw new AppError('READ_ONLY_MODE', 403, 'Chat is currently in read-only mode');
    }

    if (settings && settings.slowModeSeconds > 0 && !input.userIsAdmin) {
      const retryAfterSec = this.adminSettingsService?.getSlowModeRetrySeconds(
        input.userId,
        input.channelId,
        settings.slowModeSeconds,
      ) ?? 0;
      if (retryAfterSec > 0) {
        throw new AppError(
          'SLOW_MODE_ACTIVE',
          429,
          `Slow mode is active. Please wait ${retryAfterSec}s before sending another message.`,
        );
      }
    }

    const canAccessChannel = await this.channelService.ensureChannelAccess(input.channelId, input.userId);
    if (!canAccessChannel) {
      throw new AppError('CHANNEL_NOT_FOUND', 404, 'Channel not found');
    }

    const trimmed = input.content.trim();
    const hasAttachment = Boolean(input.attachment);
    if (!trimmed && !hasAttachment) {
      throw new AppError('EMPTY_MESSAGE', 400, 'Message content cannot be empty');
    }
    if (trimmed.length > this.maxLength) {
      throw new AppError(
        'MESSAGE_TOO_LONG',
        400,
        `Message content exceeds ${this.maxLength} characters`,
      );
    }
    if (input.replyToMessageId) {
      const replyTarget = await this.messageRepo.findByIdInChannel({
        channelId: input.channelId,
        messageId: input.replyToMessageId,
      });
      if (!replyTarget) {
        throw new AppError('REPLY_TARGET_NOT_FOUND', 404, 'The replied-to message no longer exists');
      }
      if (replyTarget.deletedAt) {
        throw new AppError('REPLY_TARGET_DELETED', 400, 'You cannot reply to a deleted message');
      }
    }

    const created = await this.messageRepo.create({
      channelId: input.channelId,
      userId: input.userId,
      content: trimmed,
      replyToMessageId: input.replyToMessageId,
      attachment: input.attachment,
    });

    if (settings && settings.slowModeSeconds > 0 && !input.userIsAdmin) {
      this.adminSettingsService?.markMessageSent(input.userId, input.channelId);
    }

    return created;
  }

  async updateMessage(input: UpdateMessageInput): Promise<MessageWithAuthor> {
    const canAccessChannel = await this.channelService.ensureChannelAccess(input.channelId, input.userId);
    if (!canAccessChannel) {
      throw new AppError('CHANNEL_NOT_FOUND', 404, 'Channel not found');
    }

    const existing = await this.messageRepo.findByIdInChannel({
      channelId: input.channelId,
      messageId: input.messageId,
    });
    if (!existing) {
      throw new AppError('MESSAGE_NOT_FOUND', 404, 'Message not found');
    }
    if (existing.deletedAt) {
      throw new AppError('MESSAGE_DELETED', 400, 'Message was already deleted');
    }
    if (existing.userId !== input.userId && !input.userIsAdmin) {
      throw new AppError('FORBIDDEN', 403, 'You can only edit your own messages');
    }

    const trimmed = input.content.trim();
    if (!trimmed) {
      throw new AppError('EMPTY_MESSAGE', 400, 'Message content cannot be empty');
    }
    if (trimmed.length > this.maxLength) {
      throw new AppError(
        'MESSAGE_TOO_LONG',
        400,
        `Message content exceeds ${this.maxLength} characters`,
      );
    }

    return this.messageRepo.updateContent({
      messageId: input.messageId,
      content: trimmed,
    });
  }

  async deleteMessage(input: DeleteMessageInput): Promise<MessageWithAuthor> {
    const canAccessChannel = await this.channelService.ensureChannelAccess(input.channelId, input.userId);
    if (!canAccessChannel) {
      throw new AppError('CHANNEL_NOT_FOUND', 404, 'Channel not found');
    }

    const existing = await this.messageRepo.findByIdInChannel({
      channelId: input.channelId,
      messageId: input.messageId,
    });
    if (!existing) {
      throw new AppError('MESSAGE_NOT_FOUND', 404, 'Message not found');
    }
    if (existing.userId !== input.userId && !input.userIsAdmin) {
      throw new AppError('FORBIDDEN', 403, 'You can only delete your own messages');
    }
    if (existing.deletedAt) {
      return existing;
    }

    return this.messageRepo.softDelete({
      messageId: input.messageId,
    });
  }

  async toggleReaction(input: ToggleReactionInput): Promise<{ message: MessageWithAuthor; reacted: boolean }> {
    const canAccessChannel = await this.channelService.ensureChannelAccess(input.channelId, input.userId);
    if (!canAccessChannel) {
      throw new AppError('CHANNEL_NOT_FOUND', 404, 'Channel not found');
    }

    const existing = await this.messageRepo.findByIdInChannel({
      channelId: input.channelId,
      messageId: input.messageId,
    });
    if (!existing) {
      throw new AppError('MESSAGE_NOT_FOUND', 404, 'Message not found');
    }
    if (existing.deletedAt) {
      throw new AppError('MESSAGE_DELETED', 400, 'Deleted messages cannot be reacted to');
    }

    const emoji = input.emoji.trim();
    if (!emoji || emoji.length > 32) {
      throw new AppError('INVALID_REACTION', 400, 'Reaction emoji is invalid');
    }

    return this.messageRepo.toggleReaction({
      messageId: input.messageId,
      userId: input.userId,
      emoji,
    });
  }
}
