import bcrypt from 'bcryptjs';
import type { UserRole } from '@prisma/client';
import type { UserRepository } from '../repositories/user.repository.js';
import type { AuthUser } from '../types/api.js';
import type { AdminSettingsService } from './admin-settings.service.js';
import { AppError } from '../utils/app-error.js';
import { isAdminRole } from '../utils/roles.js';
import { isSuspensionActive } from '../utils/suspension.js';

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function bootstrapRoleForUsername(username: string): UserRole {
  return normalizeUsername(username) === 'max' ? 'OWNER' : 'MEMBER';
}

export class AuthService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly saltRounds: number,
    private readonly adminSettingsService?: AdminSettingsService,
  ) {}

  async register(input: RegisterInput): Promise<AuthUser> {
    const settings = await this.adminSettingsService?.getSettings();
    if (settings && !settings.allowRegistrations) {
      throw new AppError('REGISTRATION_DISABLED', 403, 'Registration is currently disabled');
    }

    const existingEmail = await this.userRepo.findByEmail(input.email);
    if (existingEmail) {
      throw new AppError('EMAIL_EXISTS', 409, 'Email already in use');
    }

    const existingUsername = await this.userRepo.findByUsername(input.username);
    if (existingUsername) {
      throw new AppError('USERNAME_EXISTS', 409, 'Username already in use');
    }

    const passwordHash = await bcrypt.hash(input.password, this.saltRounds);
    const role = bootstrapRoleForUsername(input.username);
    const user = await this.userRepo.create({
      username: input.username,
      email: input.email,
      passwordHash,
      role,
      isAdmin: isAdminRole(role),
    });

    return this.toAuthUser(user);
  }

  async login(input: LoginInput): Promise<AuthUser> {
    const user = await this.userRepo.findByEmail(input.email);
    if (!user) {
      throw new AppError('INVALID_CREDENTIALS', 401, 'Invalid credentials');
    }

    const isValid = await bcrypt.compare(input.password, user.passwordHash);
    if (!isValid) {
      throw new AppError('INVALID_CREDENTIALS', 401, 'Invalid credentials');
    }

    if (isSuspensionActive(Boolean(user.isSuspended), user.suspendedUntil ?? null)) {
      throw new AppError('ACCOUNT_SUSPENDED', 403, 'Your account is currently suspended');
    }

    return this.toAuthUser(user);
  }

  async getById(userId: string): Promise<AuthUser> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new AppError('USER_NOT_FOUND', 404, 'User not found');
    }
    return this.toAuthUser(user);
  }

  private toAuthUser(user: {
    id: string;
    username: string;
    email: string;
    role: UserRole;
    createdAt: Date;
  }): AuthUser {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      isAdmin: isAdminRole(user.role),
      createdAt: user.createdAt,
    };
  }
}
