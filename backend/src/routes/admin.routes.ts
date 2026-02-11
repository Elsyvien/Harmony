import type { FastifyPluginAsync } from 'fastify';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AdminService } from '../services/admin.service.js';
import type { AdminSettingsService } from '../services/admin-settings.service.js';
import { AppError } from '../utils/app-error.js';

interface AdminRoutesOptions {
  adminService: AdminService;
  adminSettingsService: AdminSettingsService;
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

export const adminRoutes: FastifyPluginAsync<AdminRoutesOptions> = async (fastify, options) => {
  const authPreHandler = async (request: FastifyRequest) => {
    await request.jwtVerify();
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
      if (!request.user.isAdmin) {
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
      if (!request.user.isAdmin) {
        throw new AppError('FORBIDDEN', 403, 'Admin permission required');
      }
      return { settings: options.adminSettingsService.getSettings() };
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
      if (!request.user.isAdmin) {
        throw new AppError('FORBIDDEN', 403, 'Admin permission required');
      }

      const body = updateAdminSettingsSchema.parse(request.body);
      const settings = options.adminSettingsService.updateSettings(body);
      return { settings };
    },
  );
};
