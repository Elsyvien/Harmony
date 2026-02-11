import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { loadEnv } from './config/env.js';
import { wsPlugin } from './plugins/ws.plugin.js';
import { PrismaChannelRepository } from './repositories/channel.repository.js';
import { PrismaMessageRepository } from './repositories/message.repository.js';
import { PrismaUserRepository } from './repositories/user.repository.js';
import { authRoutes } from './routes/auth.routes.js';
import { channelRoutes } from './routes/channel.routes.js';
import { AuthService } from './services/auth.service.js';
import { ChannelService } from './services/channel.service.js';
import { MessageService } from './services/message.service.js';
import { AppError } from './utils/app-error.js';

export async function buildApp() {
  const env = loadEnv();

  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'development' ? 'debug' : 'info',
      redact: ['req.headers.authorization', 'req.body.password', 'req.body.token'],
    },
  });

  await app.register(cors, {
    origin: env.CLIENT_ORIGIN,
    credentials: true,
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
  });

  await app.register(jwt, {
    secret: env.JWT_SECRET,
  });

  const userRepo = new PrismaUserRepository();
  const channelRepo = new PrismaChannelRepository();
  const messageRepo = new PrismaMessageRepository();

  const authService = new AuthService(userRepo, env.BCRYPT_SALT_ROUNDS);
  const channelService = new ChannelService(channelRepo);
  const messageService = new MessageService(messageRepo, channelService, env.MESSAGE_MAX_LENGTH);

  await channelService.ensureDefaultChannel();

  await app.register(wsPlugin, { channelService, messageService });
  await app.register(authRoutes, { authService, env });
  await app.register(channelRoutes, { channelService, messageService });

  app.get('/health', async () => ({ ok: true }));

  app.setErrorHandler((error, _, reply) => {
    if (error instanceof AppError) {
      reply.code(error.statusCode).send({ code: error.code, message: error.message });
      return;
    }

    if (error instanceof ZodError) {
      const issue = error.issues[0];
      reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: issue?.message ?? 'Invalid request payload',
      });
      return;
    }

    if ((error as { statusCode?: number }).statusCode === 401) {
      reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
      return;
    }

    app.log.error(error);
    reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  return app;
}
