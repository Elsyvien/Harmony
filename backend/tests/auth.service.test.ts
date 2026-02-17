import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { UserRole } from '@prisma/client';
import type { UserRepository } from '../src/repositories/user.repository.js';
import { AuthService } from '../src/services/auth.service.js';
import { AppError } from '../src/utils/app-error.js';

const now = new Date('2026-01-01T00:00:00.000Z');

class InMemoryUserRepo implements UserRepository {
  private users: Array<{
    id: string;
    username: string;
    email: string;
    passwordHash: string;
    isAdmin: boolean;
    role: UserRole;
    isSuspended: boolean;
    suspendedUntil: Date | null;
    createdAt: Date;
    avatarUrl: string | null;
  }> = [];

  async findById(id: string) {
    return this.users.find((user) => user.id === id) ?? null;
  }

  async findByEmail(email: string) {
    const normalized = email.toLowerCase();
    return this.users.find((user) => user.email.toLowerCase() === normalized) ?? null;
  }

  async findByUsername(username: string) {
    const normalized = username.toLowerCase();
    return this.users.find((user) => user.username.toLowerCase() === normalized) ?? null;
  }

  async create(params: {
    username: string;
    email: string;
    passwordHash: string;
    role?: UserRole;
    isAdmin?: boolean;
  }) {
    const user = {
      id: randomUUID(),
      username: params.username,
      email: params.email,
      passwordHash: params.passwordHash,
      role: params.role ?? 'MEMBER',
      isAdmin: Boolean(params.isAdmin),
      isSuspended: false,
      suspendedUntil: null,
      createdAt: now,
      avatarUrl: null,
    };
    this.users.push(user);
    return user;
  }
}

describe('AuthService', () => {
  let repo: InMemoryUserRepo;
  let service: AuthService;

  beforeEach(() => {
    repo = new InMemoryUserRepo();
    service = new AuthService(repo, 8);
  });

  it('registers a new user and never stores cleartext passwords', async () => {
    const user = await service.register({
      username: 'alice_1',
      email: 'alice@example.com',
      password: 'SuperSecret12',
    });

    expect(user.username).toBe('alice_1');
    expect(user.role).toBe('MEMBER');
    expect(user.isAdmin).toBe(false);

    const stored = await repo.findByEmail('alice@example.com');
    expect(stored).not.toBeNull();
    expect(stored?.passwordHash).not.toBe('SuperSecret12');
  });

  it('rejects duplicate emails ignoring case', async () => {
    await service.register({
      username: 'first_user',
      email: 'Dup@Example.com',
      password: 'Password123',
    });

    await expect(
      service.register({
        username: 'second_user',
        email: ' dup@example.com ',
        password: 'Password123',
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_EXISTS' } satisfies Partial<AppError>);
  });

  it('rejects duplicate usernames ignoring case', async () => {
    await service.register({
      username: 'First_User',
      email: 'first@example.com',
      password: 'Password123',
    });

    await expect(
      service.register({
        username: ' first_user ',
        email: 'second@example.com',
        password: 'Password123',
      }),
    ).rejects.toMatchObject({ code: 'USERNAME_EXISTS' } satisfies Partial<AppError>);
  });

  it('rejects invalid login credentials', async () => {
    await service.register({
      username: 'demo_user',
      email: 'demo@example.com',
      password: 'Password123',
    });

    await expect(
      service.login({
        email: 'demo@example.com',
        password: 'WrongPassword',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' } satisfies Partial<AppError>);
  });

  it('allows login with mixed-case email input', async () => {
    const registered = await service.register({
      username: 'mixed_case_login',
      email: 'Mixed.Case@Example.com',
      password: 'Password123',
    });

    const loggedIn = await service.login({
      email: '  mIxEd.cAsE@example.COM  ',
      password: 'Password123',
    });

    expect(loggedIn.id).toBe(registered.id);
  });

  it('assigns owner role for cased max username variants', async () => {
    const mixedCase = await service.register({
      username: 'Max',
      email: 'max-mixed@example.com',
      password: 'Password123',
    });

    expect(mixedCase.role).toBe('OWNER');
    expect(mixedCase.isAdmin).toBe(true);
  });

  it('rejects max-variant username duplicates ignoring case', async () => {
    await service.register({
      username: 'max',
      email: 'max@example.com',
      password: 'Password123',
    });

    await expect(
      service.register({
        username: 'MAX',
        email: 'max-variant@example.com',
        password: 'Password123',
      }),
    ).rejects.toMatchObject({ code: 'USERNAME_EXISTS' } satisfies Partial<AppError>);
  });
});
