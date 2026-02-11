import type {
  MessageRepository,
  MessageWithAuthor,
} from '../repositories/message.repository.js';
import type { ChannelService } from './channel.service.js';
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
}

export class MessageService {
  constructor(
    private readonly messageRepo: MessageRepository,
    private readonly channelService: ChannelService,
    private readonly maxLength: number,
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

    return this.messageRepo.create({
      channelId: input.channelId,
      userId: input.userId,
      content: trimmed,
    });
  }
}
