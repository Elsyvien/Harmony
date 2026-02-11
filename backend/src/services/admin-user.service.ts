import type { UserRole } from '@prisma/client';
import { prisma } from '../repositories/prisma.js';
import { AppError } from '../utils/app-error.js';
import { isAdminRole } from '../utils/roles.js';
import { isSuspensionActive } from '../utils/suspension.js';

export interface AdminUserSummary {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  isAdmin: boolean;
  isSuspended: boolean;
  suspendedUntil: Date | null;
  createdAt: Date;
}

export interface UpdateAdminUserInput {
  role?: UserRole;
}

function canRoleManageUsers(role: UserRole): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

function assertRoleCanManageUsers(role: UserRole) {
  if (!canRoleManageUsers(role)) {
    throw new AppError('FORBIDDEN', 403, 'Admin permission required');
  }
}

function assertActorCanManageTarget(
  actor: { id: string; role: UserRole },
  target: { id: string; role: UserRole },
  input?: { role?: UserRole },
) {
  if (target.id === actor.id) {
    throw new AppError('SELF_UPDATE_FORBIDDEN', 400, 'You cannot modify your own account');
  }

  if (actor.role !== 'OWNER') {
    if (target.role === 'OWNER') {
      throw new AppError('FORBIDDEN', 403, 'Only owner can modify owner accounts');
    }

    if (input?.role === 'OWNER' || input?.role === 'ADMIN') {
      throw new AppError('FORBIDDEN', 403, 'Only owner can grant owner/admin role');
    }

    if (target.role === 'ADMIN') {
      throw new AppError('FORBIDDEN', 403, 'Only owner can modify admin accounts');
    }
  }
}

function toSummary(user: {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  isSuspended: boolean;
  suspendedUntil: Date | null;
  createdAt: Date;
}): AdminUserSummary {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    isAdmin: isAdminRole(user.role),
    isSuspended: isSuspensionActive(user.isSuspended, user.suspendedUntil),
    suspendedUntil: user.suspendedUntil,
    createdAt: user.createdAt,
  };
}

export class AdminUserService {
  async listUsers(actorRole: UserRole): Promise<AdminUserSummary[]> {
    assertRoleCanManageUsers(actorRole);
    const users = await prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isSuspended: true,
        suspendedUntil: true,
        createdAt: true,
      },
    });
    return users.map(toSummary);
  }

  async updateUser(
    actor: { id: string; role: UserRole },
    targetUserId: string,
    input: UpdateAdminUserInput,
  ): Promise<AdminUserSummary> {
    assertRoleCanManageUsers(actor.role);

    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isSuspended: true,
        suspendedUntil: true,
        createdAt: true,
      },
    });

    if (!target) {
      throw new AppError('USER_NOT_FOUND', 404, 'User not found');
    }

    assertActorCanManageTarget(actor, target, { role: input.role });

    const nextRole = input.role ?? target.role;
    const updated = await prisma.user.update({
      where: { id: target.id },
      data: {
        role: nextRole,
        isAdmin: isAdminRole(nextRole),
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isSuspended: true,
        suspendedUntil: true,
        createdAt: true,
      },
    });

    return toSummary(updated);
  }

  async deleteUser(actor: { id: string; role: UserRole }, targetUserId: string): Promise<{ id: string }> {
    assertRoleCanManageUsers(actor.role);

    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        role: true,
      },
    });

    if (!target) {
      throw new AppError('USER_NOT_FOUND', 404, 'User not found');
    }

    assertActorCanManageTarget(actor, target);
    await prisma.user.delete({ where: { id: target.id } });
    return { id: target.id };
  }
}
