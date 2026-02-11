import type { User } from '@prisma/client';
import { prisma } from './prisma.js';

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  create(params: { username: string; email: string; passwordHash: string }): Promise<User>;
}

export class PrismaUserRepository implements UserRepository {
  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  }

  findByUsername(username: string) {
    return prisma.user.findUnique({ where: { username } });
  }

  create(params: { username: string; email: string; passwordHash: string }) {
    return prisma.user.create({ data: params });
  }
}
