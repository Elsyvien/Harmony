import type { FastifyPluginAsync } from 'fastify';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import type { AdminService } from '../services/admin.service.js';
import type { AdminSettingsService } from '../services/admin-settings.service.js';
import type { AdminUserService } from '../services/admin-user.service.js';
import { prisma } from '../repositories/prisma.js';
import { AppError } from '../utils/app-error.js';
import { isAdminRole } from '../utils/roles.js';
import { isSuspensionActive } from '../utils/suspension.js';

interface AdminRoutesOptions {
  adminService: AdminService;
  adminSettingsService: AdminSettingsService;
  adminUserService: AdminUserService;
}

const updateAdminSettingsSchema = z
  .object({
    allowRegistrations: z.boolean().optional(),
    readOnlyMode: z.boolean().optional(),
    slowModeSeconds: z.coerce.number().int().min(0).max(60).optional(),
  })
  .refine(
    (value) =>
      value.allowRegistrations !== undefined ||
      value.readOnlyMode !== undefined ||
      value.slowModeSeconds !== undefined,
    { message: 'At least one setting must be provided' },
  );

const updateAdminUserParamsSchema = z.object({
  id: z.string().uuid(),
});

const updateAdminUserSchema = z
  .object({
    role: z.nativeEnum(UserRole).optional(),
    isSuspended: z.boolean().optional(),
    suspendedUntil: z
      .string()
      .datetime()
      .nullable()
      .optional()
      .transform((value) => (value === undefined || value === null ? value : new Date(value))),
  })
  .refine(
    (value) =>
      value.role !== undefined || value.isSuspended !== undefined || value.suspendedUntil !== undefined,
    { message: 'At least one field must be provided' },
  )
  .refine(
    (value) => !(value.isSuspended === false && value.suspendedUntil !== undefined && value.suspendedUntil !== null),
    { message: 'suspendedUntil must be null when isSuspended is false' },
  );

export const adminRoutes: FastifyPluginAsync<AdminRoutesOptions> = async (fastify, options) => {
  const authPreHandler = async (request: FastifyRequest) => {
    await request.jwtVerify();
    const user = await prisma.user.findUnique({
      where: { id: request.user.userId },
      select: { id: true, role: true, isSuspended: true, suspendedUntil: true },
    });
    if (!user) {
      throw new AppError('INVALID_SESSION', 401, 'Session is no longer valid. Please log in again.');
    }
    if (isSuspensionActive(user.isSuspended, user.suspendedUntil)) {
      throw new AppError('ACCOUNT_SUSPENDED', 403, 'Your account is currently suspended');
    }
    request.user.role = user.role;
    request.user.isAdmin = isAdminRole(user.role);
  };

  fastify.get(
    '/admin/stats',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 30, timeWindow: 60_000 },
      },
    },
    async (request) => {
      if (!isAdminRole(request.user.role)) {
        throw new AppError('FORBIDDEN', 403, 'Admin permission required');
      }

      const stats = await options.adminService.getServerStats();
      return { stats };
    },
  );

  fastify.get(
    '/admin/settings',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 30, timeWindow: 60_000 },
      },
    },
    async (request) => {
      if (!isAdminRole(request.user.role)) {
        throw new AppError('FORBIDDEN', 403, 'Admin permission required');
      }
      const settings = await options.adminSettingsService.getSettings();
      return { settings };
    },
  );

  fastify.put(
    '/admin/settings',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 20, timeWindow: 60_000 },
      },
    },
    async (request) => {
      if (!isAdminRole(request.user.role)) {
        throw new AppError('FORBIDDEN', 403, 'Admin permission required');
      }

      const body = updateAdminSettingsSchema.parse(request.body);
      const settings = await options.adminSettingsService.updateSettings(body);
      return { settings };
    },
  );

  fastify.get(
    '/admin/users',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 30, timeWindow: 60_000 },
      },
    },
    async (request) => {
      const users = await options.adminUserService.listUsers(request.user.role);
      return { users };
    },
  );

  fastify.patch(
    '/admin/users/:id',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 25, timeWindow: 60_000 },
      },
    },
    async (request) => {
      const { id } = updateAdminUserParamsSchema.parse(request.params);
      const body = updateAdminUserSchema.parse(request.body);

      const user = await options.adminUserService.updateUser(
        { id: request.user.userId, role: request.user.role },
        id,
        {
          role: body.role,
          isSuspended: body.isSuspended,
          suspendedUntil: body.suspendedUntil,
        },
      );

      return { user };
    },
  );
};
