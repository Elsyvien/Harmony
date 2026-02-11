import type { Friendship, FriendshipStatus, UserRole } from '@prisma/client';
import { prisma } from './prisma.js';

interface UserPreview {
  id: string;
  username: string;
  role: UserRole;
}

export interface FriendshipWithUsers extends Friendship {
  userA: UserPreview;
  userB: UserPreview;
  requestedBy: UserPreview;
}

export interface FriendshipRepository {
  findByPair(userAId: string, userBId: string): Promise<FriendshipWithUsers | null>;
  findById(id: string): Promise<FriendshipWithUsers | null>;
  listByUser(userId: string, status: FriendshipStatus): Promise<FriendshipWithUsers[]>;
  createPending(params: {
    userAId: string;
    userBId: string;
    requestedById: string;
  }): Promise<FriendshipWithUsers>;
  accept(id: string): Promise<FriendshipWithUsers>;
  deleteById(id: string): Promise<void>;
}

const userPreviewSelect = {
  id: true,
  username: true,
  role: true,
} as const;

const includeUsers = {
  userA: { select: userPreviewSelect },
  userB: { select: userPreviewSelect },
  requestedBy: { select: userPreviewSelect },
} as const;

export class PrismaFriendshipRepository implements FriendshipRepository {
  findByPair(userAId: string, userBId: string) {
    return prisma.friendship.findUnique({
      where: {
        userAId_userBId: { userAId, userBId },
      },
      include: includeUsers,
    });
  }

  findById(id: string) {
    return prisma.friendship.findUnique({
      where: { id },
      include: includeUsers,
    });
  }

  listByUser(userId: string, status: FriendshipStatus) {
    return prisma.friendship.findMany({
      where: {
        status,
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      orderBy: { createdAt: 'desc' },
      include: includeUsers,
    });
  }

  createPending(params: { userAId: string; userBId: string; requestedById: string }) {
    return prisma.friendship.create({
      data: {
        userAId: params.userAId,
        userBId: params.userBId,
        requestedById: params.requestedById,
        status: 'PENDING',
      },
      include: includeUsers,
    });
  }

  accept(id: string) {
    return prisma.friendship.update({
      where: { id },
      data: {
        status: 'ACCEPTED',
        acceptedAt: new Date(),
      },
      include: includeUsers,
    });
  }

  async deleteById(id: string) {
    await prisma.friendship.delete({ where: { id } });
  }
}
