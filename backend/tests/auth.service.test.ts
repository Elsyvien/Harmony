import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
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
    createdAt: Date;
  }> = [];

  async findById(id: string) {
    return this.users.find((user) => user.id === id) ?? null;
  }

  async findByEmail(email: string) {
    return this.users.find((user) => user.email === email) ?? null;
  }

  async findByUsername(username: string) {
    return this.users.find((user) => user.username === username) ?? null;
  }

  async create(params: { username: string; email: string; passwordHash: string }) {
    const user = {
      id: randomUUID(),
      username: params.username,
      email: params.email,
      passwordHash: params.passwordHash,
      isAdmin: false,
      createdAt: now,
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

    const stored = await repo.findByEmail('alice@example.com');
    expect(stored).not.toBeNull();
    expect(stored?.passwordHash).not.toBe('SuperSecret12');
  });

  it('rejects duplicate emails', async () => {
    await service.register({
      username: 'first_user',
      email: 'dup@example.com',
      password: 'Password123',
    });

    await expect(
      service.register({
        username: 'second_user',
        email: 'dup@example.com',
        password: 'Password123',
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_EXISTS' } satisfies Partial<AppError>);
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
});
