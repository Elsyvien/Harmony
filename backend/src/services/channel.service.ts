import type { ChannelRepository } from '../repositories/channel.repository.js';

export class ChannelService {
  constructor(private readonly channelRepo: ChannelRepository) {}

  async ensureDefaultChannel() {
    await this.channelRepo.ensureByName('global');
  }

  listChannels() {
    return this.channelRepo.list();
  }

  async ensureChannelExists(channelId: string) {
    const channel = await this.channelRepo.findById(channelId);
    return Boolean(channel);
  }
}
