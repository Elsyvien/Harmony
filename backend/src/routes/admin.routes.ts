import type { FastifyPluginAsync } from 'fastify';
import type { FastifyRequest } from 'fastify';
import type { AdminService } from '../services/admin.service.js';
import { AppError } from '../utils/app-error.js';

interface AdminRoutesOptions {
  adminService: AdminService;
}

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
};
