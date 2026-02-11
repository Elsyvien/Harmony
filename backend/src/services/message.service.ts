import type {
  MessageRepository,
  MessageWithAuthor,
} from '../repositories/message.repository.js';
import type { ChannelService } from './channel.service.js';
import type { AdminSettingsService } from './admin-settings.service.js';
import { AppError } from '../utils/app-error.js';

export interface ListMessagesInput {
  channelId: string;
  before?: Date;
  limit: number;
}

export interface CreateMessageInput {
  channelId: string;
  userId: string;
  content: string;
  userIsAdmin?: boolean;
}

export class MessageService {
  constructor(
    private readonly messageRepo: MessageRepository,
    private readonly channelService: ChannelService,
    private readonly maxLength: number,
    private readonly adminSettingsService?: AdminSettingsService,
  ) {}

  async listMessages(input: ListMessagesInput): Promise<MessageWithAuthor[]> {
    const channelExists = await this.channelService.ensureChannelExists(input.channelId);
    if (!channelExists) {
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

    const channelExists = await this.channelService.ensureChannelExists(input.channelId);
    if (!channelExists) {
      throw new AppError('CHANNEL_NOT_FOUND', 404, 'Channel not found');
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

    const created = await this.messageRepo.create({
      channelId: input.channelId,
      userId: input.userId,
      content: trimmed,
    });

    if (settings && settings.slowModeSeconds > 0 && !input.userIsAdmin) {
      this.adminSettingsService?.markMessageSent(input.userId, input.channelId);
    }

    return created;
  }
}
