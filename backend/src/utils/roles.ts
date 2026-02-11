import type { UserRole } from '@prisma/client';

export function isAdminRole(role: UserRole | undefined | null): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export function isPrivilegedRole(role: UserRole | undefined | null): boolean {
  return isAdminRole(role) || role === 'MODERATOR';
}
