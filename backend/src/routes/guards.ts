import type { FastifyRequest } from 'fastify';
import { prisma } from '../repositories/prisma.js';
import { AppError } from '../utils/app-error.js';
import { isAdminRole, isPrivilegedRole } from '../utils/roles.js';
import { isSuspensionActive } from '../utils/suspension.js';

type RequiredRole = 'ADMIN' | 'PRIVILEGED';

interface AuthGuardOptions {
  requiredRole?: RequiredRole;
  enforceSuspension?: boolean;
}

export function createAuthGuard(options: AuthGuardOptions = {}) {
  const requiredRole = options.requiredRole;
  const enforceSuspension = options.enforceSuspension ?? true;

  return async (request: FastifyRequest) => {
    await request.jwtVerify();

    const user = await prisma.user.findUnique({
      where: { id: request.user.userId },
      select: { id: true, role: true, isSuspended: true, suspendedUntil: true },
    });
    if (!user) {
      throw new AppError('INVALID_SESSION', 401, 'Session is no longer valid. Please log in again.');
    }

    if (enforceSuspension && isSuspensionActive(user.isSuspended, user.suspendedUntil)) {
      throw new AppError('ACCOUNT_SUSPENDED', 403, 'Your account is currently suspended');
    }

    request.user.role = user.role;
    request.user.isAdmin = isAdminRole(user.role);

    if (requiredRole === 'ADMIN' && !isAdminRole(user.role)) {
      throw new AppError('FORBIDDEN', 403, 'Admin permission required');
    }
    if (requiredRole === 'PRIVILEGED' && !isPrivilegedRole(user.role)) {
      throw new AppError('FORBIDDEN', 403, 'Moderator permission required');
    }
  };
}

