import type { FastifyPluginAsync } from 'fastify';
import { loginBodySchema, registerBodySchema } from '../schemas/auth.schema.js';
import type { Env } from '../config/env.js';
import type { AuthService } from '../services/auth.service.js';

interface AuthRoutesOptions {
  authService: AuthService;
  env: Env;
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (fastify, options) => {
  fastify.post(
    '/auth/register',
    {
      config: {
        rateLimit: { max: 8, timeWindow: 60_000 },
      },
    },
    async (request, reply) => {
      const body = registerBodySchema.parse(request.body);
      const user = await options.authService.register(body);
      const token = fastify.jwt.sign(
        {
          userId: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          isAdmin: user.isAdmin,
        },
        { expiresIn: options.env.JWT_EXPIRES_IN },
      );

      reply.code(201).send({ token, user });
    },
  );

  fastify.post(
    '/auth/login',
    {
      config: {
        rateLimit: { max: 12, timeWindow: 60_000 },
      },
    },
    async (request) => {
      const body = loginBodySchema.parse(request.body);
      const user = await options.authService.login(body);
      const token = fastify.jwt.sign(
        {
          userId: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          isAdmin: user.isAdmin,
        },
        { expiresIn: options.env.JWT_EXPIRES_IN },
      );
      return { token, user };
    },
  );

  fastify.post(
    '/auth/logout',
    {
      preHandler: [
        async (request) => {
          await request.jwtVerify();
        },
      ],
    },
    async (_, reply) => {
      reply.code(204).send();
    },
  );

  fastify.get(
    '/me',
    {
      preHandler: [
        async (request) => {
          await request.jwtVerify();
        },
      ],
    },
    async (request) => {
      const user = await options.authService.getById(request.user.userId);
      return { user };
    },
  );
};
