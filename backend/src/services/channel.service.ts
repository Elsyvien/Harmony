import { Prisma } from '@prisma/client';
import type { ChannelWithMembers, ChannelRepository } from '../repositories/channel.repository.js';
import type { FriendshipRepository } from '../repositories/friendship.repository.js';
import type { UserRepository } from '../repositories/user.repository.js';
import type { ServerService } from './server.service.js';
import { AppError } from '../utils/app-error.js';

export interface ChannelSummary {
  id: string;
  name: string;
  createdAt: Date;
  serverId: string | null;
  isDirect: boolean;
  isVoice: boolean;
  voiceBitrateKbps: number | null;
  streamBitrateKbps: number | null;
  directUser: {
    id: string;
    username: string;
  } | null;
}

export interface OpenDirectChannelResult {
  channel: ChannelSummary;
  isNew: boolean;
}

export interface ChannelAccessService {
  ensureChannelAccess(channelId: string, userId: string): Promise<boolean>;
}

function normalizePair(userOneId: string, userTwoId: string): { userAId: string; userBId: string } {
  return userOneId < userTwoId
    ? { userAId: userOneId, userBId: userTwoId }
    : { userAId: userTwoId, userBId: userOneId };
}

export class ChannelService {
  constructor(
    private readonly channelRepo: ChannelRepository,
    private readonly userRepo: UserRepository,
    private readonly friendshipRepo: FriendshipRepository,
    private readonly serverService: ServerService,
  ) {}

  private toSummary(channel: ChannelWithMembers, viewerUserId: string): ChannelSummary {
    if (channel.type !== 'DIRECT') {
      return {
        id: channel.id,
        name: channel.name,
        createdAt: channel.createdAt,
        serverId: channel.serverId,
        isDirect: false,
        isVoice: channel.type === 'VOICE',
        voiceBitrateKbps:
          channel.type === 'VOICE' ? (channel.voiceBitrateKbps ?? 64) : null,
        streamBitrateKbps:
          channel.type === 'VOICE' ? (channel.streamBitrateKbps ?? 2500) : null,
        directUser: null,
      };
    }

    const directUser = channel.members.find((member) => member.userId !== viewerUserId)?.user ?? null;
    return {
      id: channel.id,
      name: channel.name,
      createdAt: channel.createdAt,
      serverId: null,
      isDirect: true,
      isVoice: false,
      voiceBitrateKbps: null,
      streamBitrateKbps: null,
      directUser: directUser
        ? {
            id: directUser.id,
            username: directUser.username,
          }
        : null,
    };
  }

  async ensureDefaultChannel(preferredOwnerUserId?: string) {
    await this.serverService.bootstrapDefaultServer(preferredOwnerUserId);
  }

  async listChannels(userId: string): Promise<ChannelSummary[]> {
    const channels = await this.channelRepo.listForUser(userId);
    return channels.map((channel) => this.toSummary(channel, userId));
  }

  async listServerChannels(serverId: string, userId: string): Promise<ChannelSummary[]> {
    await this.serverService.getServerForUser(serverId, userId);
    const channels = await this.channelRepo.listByServerForUser(serverId, userId);
    return channels.map((channel) => this.toSummary(channel, userId));
  }

  async createChannel(input: {
    name: string;
    type?: 'TEXT' | 'VOICE';
    actorUserId: string;
    serverId?: string;
  }) {
    const normalizedName = input.name.trim().toLowerCase();
    const serverId = input.serverId ?? (await this.serverService.ensureDefaultServerForUser(input.actorUserId));
    await this.serverService.assertCanManageServer(serverId, input.actorUserId);

    const existing = await this.channelRepo.findByNameInServer({ serverId, name: normalizedName });
    if (existing) {
      throw new AppError('CHANNEL_EXISTS', 409, 'Channel already exists');
    }
    const created =
      input.type === 'VOICE'
        ? await this.channelRepo.createVoice({ name: normalizedName, serverId })
        : await this.channelRepo.createPublic({ name: normalizedName, serverId });
    return this.toSummary(created, input.actorUserId);
  }

  async deleteChannel(channelId: string, actorUserId: string) {
    const channel = await this.channelRepo.findById(channelId);
    if (!channel) {
      throw new AppError('CHANNEL_NOT_FOUND', 404, 'Channel not found');
    }
    if (channel.type === 'DIRECT') {
      throw new AppError('CHANNEL_DELETE_FORBIDDEN', 400, 'Direct channels cannot be deleted');
    }
    if (!channel.serverId) {
      throw new AppError('CHANNEL_DELETE_FORBIDDEN', 400, 'Server-scoped channel is required');
    }
    await this.serverService.assertCanManageServer(channel.serverId, actorUserId);

    if (channel.type === 'PUBLIC') {
      const publicChannels = await this.channelRepo.countPublicChannels(channel.serverId);
      if (publicChannels <= 1) {
        throw new AppError('CHANNEL_DELETE_FORBIDDEN', 400, 'At least one public channel must remain');
      }
    }

    await this.channelRepo.deleteById(channelId);
    return { deletedChannelId: channelId };
  }

  async updateVoiceChannelSettings(
    channelId: string,
    actorUserId: string,
    input: { voiceBitrateKbps?: number; streamBitrateKbps?: number },
  ) {
    const channel = await this.channelRepo.findById(channelId);
    if (!channel) {
      throw new AppError('CHANNEL_NOT_FOUND', 404, 'Channel not found');
    }
    if (channel.type !== 'VOICE') {
      throw new AppError('INVALID_VOICE_CHANNEL', 400, 'Channel is not a voice channel');
    }
    if (!channel.serverId) {
      throw new AppError('INVALID_VOICE_CHANNEL', 400, 'Direct channels do not support voice settings');
    }
    await this.serverService.assertCanManageServer(channel.serverId, actorUserId);

    const updated = await this.channelRepo.updateVoiceSettings({
      id: channelId,
      voiceBitrateKbps: input.voiceBitrateKbps,
      streamBitrateKbps: input.streamBitrateKbps,
    });
    return this.toSummary(updated, actorUserId);
  }

  async updateVoiceChannelBitrate(channelId: string, actorUserId: string, voiceBitrateKbps: number) {
    return this.updateVoiceChannelSettings(channelId, actorUserId, { voiceBitrateKbps });
  }

  async ensureChannelExists(channelId: string) {
    const channel = await this.channelRepo.findById(channelId);
    return Boolean(channel);
  }

  async ensureChannelAccess(channelId: string, userId: string) {
    const channel = await this.channelRepo.findByIdForUser(channelId, userId);
    return Boolean(channel);
  }

  async getChannelSummaryForUser(channelId: string, userId: string): Promise<ChannelSummary | null> {
    const channel = await this.channelRepo.findByIdForUser(channelId, userId);
    if (!channel) {
      return null;
    }
    return this.toSummary(channel, userId);
  }

  async openDirectChannel(userId: string, targetUserId: string): Promise<OpenDirectChannelResult> {
    if (userId === targetUserId) {
      throw new AppError('CANNOT_DM_SELF', 400, 'You cannot start a direct message with yourself');
    }

    const [actor, target] = await Promise.all([
      this.userRepo.findById(userId),
      this.userRepo.findById(targetUserId),
    ]);
    if (!actor) {
      throw new AppError('INVALID_SESSION', 401, 'Session is no longer valid. Please log in again.');
    }
    if (!target) {
      throw new AppError('USER_NOT_FOUND', 404, 'User not found');
    }

    const pair = normalizePair(actor.id, target.id);
    const friendship = await this.friendshipRepo.findByPair(pair.userAId, pair.userBId);
    if (!friendship || friendship.status !== 'ACCEPTED') {
      throw new AppError('DM_REQUIRES_FRIENDSHIP', 403, 'You can only DM users who are your friends');
    }

    const dmKey = `dm:${pair.userAId}:${pair.userBId}`;
    const existing = await this.channelRepo.findDirectByDmKey(dmKey);
    if (existing) {
      return {
        channel: this.toSummary(existing, userId),
        isNew: false,
      };
    }

    const channelName = `dm-${pair.userAId}-${pair.userBId}`;
    try {
      const created = await this.channelRepo.createDirect({
        name: channelName,
        dmKey,
        memberUserIds: [pair.userAId, pair.userBId],
      });
      return {
        channel: this.toSummary(created, userId),
        isNew: true,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const concurrent = await this.channelRepo.findDirectByDmKey(dmKey);
        if (concurrent) {
          return {
            channel: this.toSummary(concurrent, userId),
            isNew: false,
          };
        }
      }
      throw error;
    }
  }
}
