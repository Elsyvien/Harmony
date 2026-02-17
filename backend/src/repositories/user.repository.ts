import type { User, UserRole } from '@prisma/client';
import { prisma } from './prisma.js';

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  create(params: {
    username: string;
    email: string;
    passwordHash: string;
    role?: UserRole;
    isAdmin?: boolean;
  }): Promise<User>;
}

export class PrismaUserRepository implements UserRepository {
  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string) {
    return prisma.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
      },
    });
  }

  findByUsername(username: string) {
    return prisma.user.findFirst({
      where: {
        username: {
          equals: username,
          mode: 'insensitive',
        },
      },
    });
  }

  create(params: {
    username: string;
    email: string;
    passwordHash: string;
    role?: UserRole;
    isAdmin?: boolean;
  }) {
    return prisma.user.create({ data: params });
  }
}
