import type { UserRole } from '@prisma/client';

export interface ApiErrorResponse {
  code: string;
  message: string;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  isAdmin: boolean;
  createdAt: Date;
}
