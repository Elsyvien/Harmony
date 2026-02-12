import { randomUUID } from 'node:crypto';
import type { FriendshipStatus, User, UserRole } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  FriendshipRepository,
  FriendshipWithUsers,
} from '../src/repositories/friendship.repository.js';
import type { UserRepository } from '../src/repositories/user.repository.js';
import { FriendService } from '../src/services/friend.service.js';
import { AppError } from '../src/utils/app-error.js';

function createUser(params: { id: string; username: string; role?: UserRole; suspended?: boolean }): User {
  return {
    id: params.id,
    username: params.username,
    email: `${params.username}@example.com`,
    passwordHash: 'hash',
    role: params.role ?? 'MEMBER',
    isAdmin: (params.role ?? 'MEMBER') === 'OWNER' || (params.role ?? 'MEMBER') === 'ADMIN',
    isSuspended: Boolean(params.suspended),
    suspendedUntil: params.suspended ? null : null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    avatarUrl: null,
  };
}

class InMemoryUserRepo implements UserRepository {
  constructor(private readonly users: User[]) {}

  async findById(id: string) {
    return this.users.find((user) => user.id === id) ?? null;
  }

  async findByEmail(email: string) {
    return this.users.find((user) => user.email === email) ?? null;
  }

  async findByUsername(username: string) {
    return this.users.find((user) => user.username === username) ?? null;
  }

  async create(params: {
    username: string;
    email: string;
    passwordHash: string;
    role?: UserRole;
    isAdmin?: boolean;
  }) {
    const created = createUser({
      id: randomUUID(),
      username: params.username,
      role: params.role,
    });
    created.email = params.email;
    created.passwordHash = params.passwordHash;
    created.isAdmin = Boolean(params.isAdmin);
    this.users.push(created);
    return created;
  }
}

class InMemoryFriendshipRepo implements FriendshipRepository {
  private records: Array<{
    id: string;
    status: FriendshipStatus;
    acceptedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    userAId: string;
    userBId: string;
    requestedById: string;
  }> = [];

  constructor(private readonly users: User[]) {}

  private hydrate(record: {
    id: string;
    status: FriendshipStatus;
    acceptedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    userAId: string;
    userBId: string;
    requestedById: string;
  }): FriendshipWithUsers {
    const userA = this.users.find((user) => user.id === record.userAId);
    const userB = this.users.find((user) => user.id === record.userBId);
    const requestedBy = this.users.find((user) => user.id === record.requestedById);
    if (!userA || !userB || !requestedBy) {
      throw new Error('Invalid in-memory friendship references');
    }

    return {
      ...record,
      userA: { id: userA.id, username: userA.username, role: userA.role, avatarUrl: userA.avatarUrl },
      userB: { id: userB.id, username: userB.username, role: userB.role, avatarUrl: userB.avatarUrl },
      requestedBy: {
        id: requestedBy.id,
        username: requestedBy.username,
        role: requestedBy.role,
        avatarUrl: requestedBy.avatarUrl,
      },
    };
  }

  async findByPair(userAId: string, userBId: string) {
    const found = this.records.find((record) => record.userAId === userAId && record.userBId === userBId);
    return found ? this.hydrate(found) : null;
  }

  async findById(id: string) {
    const found = this.records.find((record) => record.id === id);
    return found ? this.hydrate(found) : null;
  }

  async listByUser(userId: string, status: FriendshipStatus) {
    return this.records
      .filter(
        (record) => record.status === status && (record.userAId === userId || record.userBId === userId),
      )
      .map((record) => this.hydrate(record));
  }

  async createPending(params: { userAId: string; userBId: string; requestedById: string }) {
    const record = {
      id: randomUUID(),
      status: 'PENDING' as const,
      acceptedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      userAId: params.userAId,
      userBId: params.userBId,
      requestedById: params.requestedById,
    };
    this.records.push(record);
    return this.hydrate(record);
  }

  async accept(id: string) {
    const idx = this.records.findIndex((record) => record.id === id);
    if (idx < 0) {
      throw new Error('Record not found');
    }
    const now = new Date();
    this.records[idx] = {
      ...this.records[idx],
      status: 'ACCEPTED',
      acceptedAt: now,
      updatedAt: now,
    };
    return this.hydrate(this.records[idx]);
  }

  async deleteById(id: string) {
    this.records = this.records.filter((record) => record.id !== id);
  }
}

describe('FriendService', () => {
  let alice: User;
  let bob: User;
  let charlie: User;
  let userRepo: InMemoryUserRepo;
  let friendshipRepo: InMemoryFriendshipRepo;
  let service: FriendService;

  beforeEach(() => {
    alice = createUser({ id: 'user-a', username: 'alice' });
    bob = createUser({ id: 'user-b', username: 'bob' });
    charlie = createUser({ id: 'user-c', username: 'charlie' });

    userRepo = new InMemoryUserRepo([alice, bob, charlie]);
    friendshipRepo = new InMemoryFriendshipRepo([alice, bob, charlie]);
    service = new FriendService(friendshipRepo, userRepo);
  });

  it('creates friend request and shows incoming/outgoing correctly', async () => {
    const request = await service.sendRequest(alice.id, bob.username);

    expect(request.from.id).toBe(alice.id);
    expect(request.to.id).toBe(bob.id);
    expect(request.status).toBe('PENDING');

    const aliceRequests = await service.listRequests(alice.id);
    const bobRequests = await service.listRequests(bob.id);

    expect(aliceRequests.outgoing).toHaveLength(1);
    expect(aliceRequests.incoming).toHaveLength(0);
    expect(bobRequests.incoming).toHaveLength(1);
    expect(bobRequests.outgoing).toHaveLength(0);
  });

  it('rejects duplicate pending requests in either direction', async () => {
    await service.sendRequest(alice.id, bob.username);

    await expect(service.sendRequest(alice.id, bob.username)).rejects.toMatchObject({
      code: 'REQUEST_ALREADY_SENT',
    } satisfies Partial<AppError>);

    await expect(service.sendRequest(bob.id, alice.username)).rejects.toMatchObject({
      code: 'REQUEST_ALREADY_RECEIVED',
    } satisfies Partial<AppError>);
  });

  it('accepts a request and both users see friendship', async () => {
    const request = await service.sendRequest(alice.id, bob.username);
    const accepted = await service.acceptRequest(bob.id, request.id);

    expect(accepted.userIds.sort()).toEqual([alice.id, bob.id].sort());
    expect(accepted.friendship.user.id).toBe(alice.id);

    const aliceFriends = await service.listFriends(alice.id);
    const bobFriends = await service.listFriends(bob.id);

    expect(aliceFriends).toHaveLength(1);
    expect(aliceFriends[0].user.id).toBe(bob.id);
    expect(bobFriends).toHaveLength(1);
    expect(bobFriends[0].user.id).toBe(alice.id);
  });

  it('enforces request ownership for accept/decline/cancel', async () => {
    const request = await service.sendRequest(alice.id, bob.username);

    await expect(service.acceptRequest(alice.id, request.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    } satisfies Partial<AppError>);

    await expect(service.declineRequest(alice.id, request.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    } satisfies Partial<AppError>);

    await expect(service.cancelRequest(bob.id, request.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    } satisfies Partial<AppError>);
  });

  it('declines, cancels, and removes friendships correctly', async () => {
    const declineRequest = await service.sendRequest(alice.id, bob.username);
    const declined = await service.declineRequest(bob.id, declineRequest.id);
    expect(declined.removedRequestId).toBe(declineRequest.id);

    const cancelRequest = await service.sendRequest(alice.id, bob.username);
    const cancelled = await service.cancelRequest(alice.id, cancelRequest.id);
    expect(cancelled.removedRequestId).toBe(cancelRequest.id);

    const acceptRequest = await service.sendRequest(alice.id, bob.username);
    const accepted = await service.acceptRequest(bob.id, acceptRequest.id);
    const removed = await service.removeFriend(alice.id, accepted.friendship.id);
    expect(removed.removedFriendshipId).toBe(accepted.friendship.id);

    const aliceFriends = await service.listFriends(alice.id);
    expect(aliceFriends).toHaveLength(0);
  });

  it('rejects invalid operations (self add, missing target, suspended actor)', async () => {
    await expect(service.sendRequest(alice.id, alice.username)).rejects.toMatchObject({
      code: 'CANNOT_FRIEND_SELF',
    } satisfies Partial<AppError>);

    await expect(service.sendRequest(alice.id, 'does_not_exist')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    } satisfies Partial<AppError>);

    const suspendedAlice = createUser({ id: alice.id, username: alice.username, suspended: true });
    const suspendedRepo = new InMemoryUserRepo([suspendedAlice, bob, charlie]);
    const suspendedService = new FriendService(friendshipRepo, suspendedRepo);
    await expect(suspendedService.sendRequest(alice.id, bob.username)).rejects.toMatchObject({
      code: 'ACCOUNT_SUSPENDED',
    } satisfies Partial<AppError>);
  });
});
