import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import type { AdminService } from '../services/admin.service.js';
import type { AdminSettingsService } from '../services/admin-settings.service.js';
import type { AdminUserService } from '../services/admin-user.service.js';
import { createAuthGuard } from './guards.js';

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
    idleTimeoutMinutes: z.coerce.number().int().min(1).max(120).optional(),
  })
  .refine(
    (value) =>
      value.allowRegistrations !== undefined ||
      value.readOnlyMode !== undefined ||
      value.slowModeSeconds !== undefined ||
      value.idleTimeoutMinutes !== undefined,
    { message: 'At least one setting must be provided' },
  );

const updateAdminUserParamsSchema = z.object({
  id: z.string().uuid(),
});

const updateAdminUserSchema = z
  .object({
    role: z.nativeEnum(UserRole).optional(),
    avatarUrl: z.union([z.string().max(1024), z.null()]).optional(),
    isSuspended: z.boolean().optional(),
    suspensionHours: z.coerce.number().int().min(1).max(24 * 30).optional(),
  })
  .refine(
    (value) =>
      value.role !== undefined ||
      value.avatarUrl !== undefined ||
      value.isSuspended !== undefined ||
      value.suspensionHours !== undefined,
    { message: 'At least one field must be provided' },
  );

export const adminRoutes: FastifyPluginAsync<AdminRoutesOptions> = async (fastify, options) => {
  const authPreHandler = createAuthGuard({ requiredRole: 'ADMIN' });

  fastify.get(
    '/admin/stats',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 30, timeWindow: 60_000 },
      },
    },
    async () => {
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
    async () => {
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
      const body = updateAdminSettingsSchema.parse(request.body);
      const settings = await options.adminSettingsService.updateSettings(body);
      fastify.wsGateway.broadcastSystem('admin:settings:updated', { settings });
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
          avatarUrl: body.avatarUrl,
          isSuspended: body.isSuspended,
          suspensionHours: body.suspensionHours,
        },
      );
      fastify.wsGateway.updateUserProfile(user.id, {
        username: user.username,
        avatarUrl: user.avatarUrl,
      });

      return { user };
    },
  );

  fastify.delete(
    '/admin/users/:id',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 15, timeWindow: 60_000 },
      },
    },
    async (request, reply) => {
      const { id } = updateAdminUserParamsSchema.parse(request.params);
      const result = await options.adminUserService.deleteUser(
        { id: request.user.userId, role: request.user.role },
        id,
      );
      reply.code(200).send({ deletedUserId: result.id });
    },
  );

  fastify.post(
    '/admin/users/clear-others',
    {
      preHandler: [authPreHandler],
      config: {
        rateLimit: { max: 5, timeWindow: 60_000 },
      },
    },
    async (request) => {
      const result = await options.adminUserService.deleteAllUsersExceptCurrent({
        id: request.user.userId,
        role: request.user.role,
      });
      return { deletedCount: result.deletedCount };
    },
  );
};
