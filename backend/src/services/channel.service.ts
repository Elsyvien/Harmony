import type { ChannelRepository } from '../repositories/channel.repository.js';
import { AppError } from '../utils/app-error.js';

export class ChannelService {
  constructor(private readonly channelRepo: ChannelRepository) {}

  async ensureDefaultChannel() {
    await this.channelRepo.ensureByName('global');
  }

  listChannels() {
    return this.channelRepo.list();
  }

  async createChannel(name: string) {
    const normalizedName = name.trim().toLowerCase();
    const existing = await this.channelRepo.findByName(normalizedName);
    if (existing) {
      throw new AppError('CHANNEL_EXISTS', 409, 'Channel already exists');
    }
    return this.channelRepo.create({ name: normalizedName });
  }

  async ensureChannelExists(channelId: string) {
    const channel = await this.channelRepo.findById(channelId);
    return Boolean(channel);
  }
}
