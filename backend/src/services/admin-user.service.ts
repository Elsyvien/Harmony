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
  avatarUrl: string | null;
  isSuspended: boolean;
  suspendedUntil: Date | null;
  createdAt: Date;
}

export interface UpdateAdminUserInput {
  role?: UserRole;
  avatarUrl?: string | null;
  isSuspended?: boolean;
  suspensionHours?: number;
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

function normalizeAvatarUrl(
  avatarUrl: string | null | undefined,
): string | null | undefined {
  if (avatarUrl === undefined) {
    return undefined;
  }
  if (avatarUrl === null) {
    return null;
  }

  const normalized = avatarUrl.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > 1024) {
    throw new AppError('VALIDATION_ERROR', 400, 'Avatar URL is too long');
  }

  if (normalized.startsWith('/uploads/avatars/')) {
    return normalized;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new AppError('VALIDATION_ERROR', 400, 'Avatar URL must be a valid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError('VALIDATION_ERROR', 400, 'Avatar URL must use http or https');
  }

  return normalized;
}

function resolveSuspensionUpdate(
  input: UpdateAdminUserInput,
): { isSuspended: boolean; suspendedUntil: Date | null } | undefined {
  if (input.isSuspended === undefined && input.suspensionHours === undefined) {
    return undefined;
  }

  if (input.isSuspended === false) {
    if (input.suspensionHours !== undefined) {
      throw new AppError(
        'VALIDATION_ERROR',
        400,
        'Suspension hours can only be set when suspending a user',
      );
    }
    return { isSuspended: false, suspendedUntil: null };
  }

  if (input.isSuspended === undefined) {
    throw new AppError('VALIDATION_ERROR', 400, 'isSuspended must be true to apply suspension hours');
  }

  if (input.suspensionHours === undefined) {
    return { isSuspended: true, suspendedUntil: null };
  }

  return {
    isSuspended: true,
    suspendedUntil: new Date(Date.now() + input.suspensionHours * 60 * 60 * 1000),
  };
}

function toSummary(user: {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  avatarUrl: string | null;
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
    avatarUrl: user.avatarUrl,
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
        avatarUrl: true,
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
        avatarUrl: true,
        isSuspended: true,
        suspendedUntil: true,
        createdAt: true,
      },
    });

    if (!target) {
      throw new AppError('USER_NOT_FOUND', 404, 'User not found');
    }

    assertActorCanManageTarget(actor, target, { role: input.role });

    const updateData: {
      role?: UserRole;
      isAdmin?: boolean;
      avatarUrl?: string | null;
      isSuspended?: boolean;
      suspendedUntil?: Date | null;
    } = {};

    if (input.role !== undefined) {
      updateData.role = input.role;
      updateData.isAdmin = isAdminRole(input.role);
    }

    const normalizedAvatarUrl = normalizeAvatarUrl(input.avatarUrl);
    if (normalizedAvatarUrl !== undefined) {
      updateData.avatarUrl = normalizedAvatarUrl;
    }

    const suspensionUpdate = resolveSuspensionUpdate(input);
    if (suspensionUpdate) {
      updateData.isSuspended = suspensionUpdate.isSuspended;
      updateData.suspendedUntil = suspensionUpdate.suspendedUntil;
    }

    if (Object.keys(updateData).length === 0) {
      return toSummary(target);
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: updateData,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        avatarUrl: true,
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

  async deleteAllUsersExceptCurrent(actor: { id: string; role: UserRole }): Promise<{ deletedCount: number }> {
    assertRoleCanManageUsers(actor.role);
    if (actor.role !== 'OWNER') {
      throw new AppError('FORBIDDEN', 403, 'Only owner can clear all other users');
    }

    const actorExists = await prisma.user.findUnique({
      where: { id: actor.id },
      select: { id: true },
    });
    if (!actorExists) {
      throw new AppError('INVALID_SESSION', 401, 'Session is no longer valid. Please log in again.');
    }

    const result = await prisma.user.deleteMany({
      where: {
        id: {
          not: actor.id,
        },
      },
    });
    return { deletedCount: result.count };
  }
}
