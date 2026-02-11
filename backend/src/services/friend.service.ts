import type { FriendshipStatus } from '@prisma/client';
import type { FriendshipWithUsers, FriendshipRepository } from '../repositories/friendship.repository.js';
import type { UserRepository } from '../repositories/user.repository.js';
import { AppError } from '../utils/app-error.js';
import { isSuspensionActive } from '../utils/suspension.js';

export interface FriendUserSummary {
  id: string;
  username: string;
}

export interface FriendSummary {
  id: string;
  user: FriendUserSummary;
  friendsSince: Date;
}

export interface FriendRequestSummary {
  id: string;
  status: FriendshipStatus;
  from: FriendUserSummary;
  to: FriendUserSummary;
  requestedById: string;
  createdAt: Date;
}

export interface FriendRequestsPayload {
  incoming: FriendRequestSummary[];
  outgoing: FriendRequestSummary[];
}

function normalizePair(userOneId: string, userTwoId: string): { userAId: string; userBId: string } {
  return userOneId < userTwoId
    ? { userAId: userOneId, userBId: userTwoId }
    : { userAId: userTwoId, userBId: userOneId };
}

function counterpart(record: FriendshipWithUsers, viewerId: string): FriendUserSummary {
  const user = record.userAId === viewerId ? record.userB : record.userA;
  return {
    id: user.id,
    username: user.username,
  };
}

function requestSummary(record: FriendshipWithUsers): FriendRequestSummary {
  return {
    id: record.id,
    status: record.status,
    from: {
      id: record.requestedBy.id,
      username: record.requestedBy.username,
    },
    to:
      record.requestedById === record.userAId
        ? { id: record.userB.id, username: record.userB.username }
        : { id: record.userA.id, username: record.userA.username },
    requestedById: record.requestedById,
    createdAt: record.createdAt,
  };
}

function friendSummary(record: FriendshipWithUsers, viewerId: string): FriendSummary {
  return {
    id: record.id,
    user: counterpart(record, viewerId),
    friendsSince: record.acceptedAt ?? record.updatedAt,
  };
}

export class FriendService {
  constructor(
    private readonly friendshipRepo: FriendshipRepository,
    private readonly userRepo: UserRepository,
  ) {}

  private async resolveUserByUsername(usernameInput: string) {
    const targetUsername = usernameInput.trim();
    if (!targetUsername) {
      throw new AppError('VALIDATION_ERROR', 400, 'Username is required');
    }

    const direct = await this.userRepo.findByUsername(targetUsername);
    if (direct) {
      return direct;
    }

    // Lightweight fallback for users entering different letter case.
    const lower = targetUsername.toLowerCase();
    if (lower !== targetUsername) {
      const loweredMatch = await this.userRepo.findByUsername(lower);
      if (loweredMatch) {
        return loweredMatch;
      }
    }

    const upper = targetUsername.toUpperCase();
    if (upper !== targetUsername) {
      const upperMatch = await this.userRepo.findByUsername(upper);
      if (upperMatch) {
        return upperMatch;
      }
    }

    throw new AppError('USER_NOT_FOUND', 404, 'User not found');
  }

  private assertUserCanAct(user: {
    id: string;
    isSuspended: boolean;
    suspendedUntil: Date | null;
  }) {
    if (isSuspensionActive(user.isSuspended, user.suspendedUntil)) {
      throw new AppError('ACCOUNT_SUSPENDED', 403, 'Your account is currently suspended');
    }
  }

  async listFriends(userId: string): Promise<FriendSummary[]> {
    const rows = await this.friendshipRepo.listByUser(userId, 'ACCEPTED');
    return rows.map((row) => friendSummary(row, userId));
  }

  async listRequests(userId: string): Promise<FriendRequestsPayload> {
    const rows = await this.friendshipRepo.listByUser(userId, 'PENDING');
    const incoming = rows
      .filter((row) => row.requestedById !== userId)
      .map((row) => requestSummary(row));
    const outgoing = rows
      .filter((row) => row.requestedById === userId)
      .map((row) => requestSummary(row));
    return { incoming, outgoing };
  }

  async sendRequest(userId: string, targetUsername: string): Promise<FriendRequestSummary> {
    const actor = await this.userRepo.findById(userId);
    if (!actor) {
      throw new AppError('INVALID_SESSION', 401, 'Session is no longer valid. Please log in again.');
    }
    this.assertUserCanAct(actor);

    const target = await this.resolveUserByUsername(targetUsername);
    if (target.id === actor.id) {
      throw new AppError('CANNOT_FRIEND_SELF', 400, 'You cannot add yourself');
    }

    const pair = normalizePair(actor.id, target.id);
    const existing = await this.friendshipRepo.findByPair(pair.userAId, pair.userBId);
    if (existing) {
      if (existing.status === 'ACCEPTED') {
        throw new AppError('ALREADY_FRIENDS', 409, 'You are already friends');
      }
      if (existing.requestedById === actor.id) {
        throw new AppError('REQUEST_ALREADY_SENT', 409, 'Friend request already sent');
      }
      throw new AppError(
        'REQUEST_ALREADY_RECEIVED',
        409,
        'This user already sent you a friend request. Accept it from incoming requests.',
      );
    }

    const created = await this.friendshipRepo.createPending({
      userAId: pair.userAId,
      userBId: pair.userBId,
      requestedById: actor.id,
    });
    return requestSummary(created);
  }

  async acceptRequest(
    userId: string,
    requestId: string,
  ): Promise<{ friendship: FriendSummary; userIds: string[]; requestId: string }> {
    const existing = await this.friendshipRepo.findById(requestId);
    if (!existing || existing.status !== 'PENDING') {
      throw new AppError('FRIEND_REQUEST_NOT_FOUND', 404, 'Friend request not found');
    }

    const isParticipant = existing.userAId === userId || existing.userBId === userId;
    if (!isParticipant) {
      throw new AppError('FORBIDDEN', 403, 'You cannot access this friend request');
    }
    if (existing.requestedById === userId) {
      throw new AppError('FORBIDDEN', 403, 'Only recipient can accept this request');
    }

    const updated = await this.friendshipRepo.accept(existing.id);
    return {
      friendship: friendSummary(updated, userId),
      userIds: [updated.userAId, updated.userBId],
      requestId: updated.id,
    };
  }

  async declineRequest(
    userId: string,
    requestId: string,
  ): Promise<{ removedRequestId: string; userIds: string[] }> {
    const existing = await this.friendshipRepo.findById(requestId);
    if (!existing || existing.status !== 'PENDING') {
      throw new AppError('FRIEND_REQUEST_NOT_FOUND', 404, 'Friend request not found');
    }

    const isParticipant = existing.userAId === userId || existing.userBId === userId;
    if (!isParticipant) {
      throw new AppError('FORBIDDEN', 403, 'You cannot access this friend request');
    }
    if (existing.requestedById === userId) {
      throw new AppError('FORBIDDEN', 403, 'Sender cannot decline this request');
    }

    await this.friendshipRepo.deleteById(existing.id);
    return {
      removedRequestId: existing.id,
      userIds: [existing.userAId, existing.userBId],
    };
  }

  async cancelRequest(
    userId: string,
    requestId: string,
  ): Promise<{ removedRequestId: string; userIds: string[] }> {
    const existing = await this.friendshipRepo.findById(requestId);
    if (!existing || existing.status !== 'PENDING') {
      throw new AppError('FRIEND_REQUEST_NOT_FOUND', 404, 'Friend request not found');
    }

    const isParticipant = existing.userAId === userId || existing.userBId === userId;
    if (!isParticipant) {
      throw new AppError('FORBIDDEN', 403, 'You cannot access this friend request');
    }
    if (existing.requestedById !== userId) {
      throw new AppError('FORBIDDEN', 403, 'Only sender can cancel this request');
    }

    await this.friendshipRepo.deleteById(existing.id);
    return {
      removedRequestId: existing.id,
      userIds: [existing.userAId, existing.userBId],
    };
  }

  async removeFriend(
    userId: string,
    friendshipId: string,
  ): Promise<{ removedFriendshipId: string; userIds: string[] }> {
    const existing = await this.friendshipRepo.findById(friendshipId);
    if (!existing || existing.status !== 'ACCEPTED') {
      throw new AppError('FRIENDSHIP_NOT_FOUND', 404, 'Friendship not found');
    }

    const isParticipant = existing.userAId === userId || existing.userBId === userId;
    if (!isParticipant) {
      throw new AppError('FORBIDDEN', 403, 'You cannot access this friendship');
    }

    await this.friendshipRepo.deleteById(existing.id);
    return {
      removedFriendshipId: existing.id,
      userIds: [existing.userAId, existing.userBId],
    };
  }
}
