import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { Prisma } from '@prisma/client';
import Fastify from 'fastify';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ZodError } from 'zod';
import { loadEnv } from './config/env.js';
import { wsPlugin } from './plugins/ws.plugin.js';
import { PrismaChannelRepository } from './repositories/channel.repository.js';
import { PrismaFriendshipRepository } from './repositories/friendship.repository.js';
import { PrismaMessageRepository } from './repositories/message.repository.js';
import { PrismaUserRepository } from './repositories/user.repository.js';
import { authRoutes } from './routes/auth.routes.js';
import { channelRoutes } from './routes/channel.routes.js';
import { friendRoutes } from './routes/friend.routes.js';
import { adminRoutes } from './routes/admin.routes.js';
import { AdminService } from './services/admin.service.js';
import { AdminSettingsService } from './services/admin-settings.service.js';
import { AdminUserService } from './services/admin-user.service.js';
import { AuthService } from './services/auth.service.js';
import { UserService } from './services/user.service.js';
import { userRoutes } from './routes/user.routes.js';
import { ChannelService } from './services/channel.service.js';
import { MessageService } from './services/message.service.js';
import { FriendService } from './services/friend.service.js';
import { AppError } from './utils/app-error.js';

export async function buildApp() {
  const env = loadEnv();
  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  await mkdir(uploadsDir, { recursive: true });

  const configuredOrigins = env.CLIENT_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const wildcardToRegex = (pattern: string) =>
    new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  const corsOrigins = configuredOrigins.map((origin) =>
    origin.includes('*') ? wildcardToRegex(origin) : origin,
  );

  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'development' ? 'debug' : 'info',
      redact: ['req.headers.authorization', 'req.body.password', 'req.body.token'],
    },
  });

  await app.register(cors, {
    origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
  });

  await app.register(jwt, {
    secret: env.JWT_SECRET,
  });

  await app.register(multipart, {
    limits: {
      fileSize: 8 * 1024 * 1024,
      files: 1,
    },
  });

  await app.register(fastifyStatic, {
    root: uploadsDir,
    prefix: '/uploads/',
    setHeaders(res) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  });

  const userRepo = new PrismaUserRepository();
  const channelRepo = new PrismaChannelRepository();
  const messageRepo = new PrismaMessageRepository();
  const friendshipRepo = new PrismaFriendshipRepository();
  const adminSettingsService = new AdminSettingsService();

  const authService = new AuthService(userRepo, env.BCRYPT_SALT_ROUNDS, adminSettingsService);
  const channelService = new ChannelService(channelRepo, userRepo, friendshipRepo);
  const messageService = new MessageService(
    messageRepo,
    channelService,
    env.MESSAGE_MAX_LENGTH,
    adminSettingsService,
  );
  const friendService = new FriendService(friendshipRepo, userRepo);
  const userService = new UserService();
  const adminService = new AdminService();
  const adminUserService = new AdminUserService();

  await channelService.ensureDefaultChannel();

  await app.register(wsPlugin, { channelService, messageService });
  await app.register(authRoutes, { authService, env });
  await app.register(channelRoutes, { channelService, messageService });
  await app.register(friendRoutes, { friendService });
  await app.register(userRoutes, { userService });
  await app.register(adminRoutes, { adminService, adminSettingsService, adminUserService });

  const parseTurnUrls = (value: string) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith('turn:') || entry.startsWith('turns:'))
      .slice(0, 6);

  const createTurnRestCredentials = (sharedSecret: string, ttlSeconds: number, principal: string) => {
    const expiryUnixSeconds = Math.floor(Date.now() / 1000) + ttlSeconds;
    const username = `${expiryUnixSeconds}:${principal}`;
    const credential = createHmac('sha1', sharedSecret).update(username).digest('base64');
    return { username, credential };
  };

  app.get('/rtc/config', async () => {
    const turnUrls = parseTurnUrls(env.TURN_URLS);
    const hasConfiguredTurn = turnUrls.length > 0;
    const hasStaticTurnCredentials = Boolean(env.TURN_USERNAME && env.TURN_CREDENTIAL);
    const hasEphemeralTurnSecret = Boolean(env.TURN_SHARED_SECRET);

    const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
      { urls: [env.RTC_STUN_URL] },
    ];

    if (hasConfiguredTurn && hasEphemeralTurnSecret) {
      const restCredentials = createTurnRestCredentials(
        env.TURN_SHARED_SECRET,
        env.TURN_CREDENTIAL_TTL_SECONDS,
        randomUUID(),
      );
      iceServers.push({
        urls: turnUrls,
        username: restCredentials.username,
        credential: restCredentials.credential,
      });
    } else if (hasConfiguredTurn && hasStaticTurnCredentials) {
      iceServers.push({
        urls: turnUrls,
        username: env.TURN_USERNAME,
        credential: env.TURN_CREDENTIAL,
      });
    }

    const allowPublicFallbackTurn =
      env.RTC_ENABLE_PUBLIC_FALLBACK_TURN &&
      env.NODE_ENV !== 'production' &&
      iceServers.length === 1;
    if (allowPublicFallbackTurn) {
      iceServers.push({
        urls: ['turn:openrelay.metered.ca:80'],
        username: 'openrelayproject',
        credential: 'openrelayproject',
      });
    }

    return {
      rtc: {
        iceServers,
        iceTransportPolicy: env.RTC_FORCE_RELAY ? 'relay' : 'all',
        iceCandidatePoolSize: 2,
      },
      sfu: {
        enabled: env.SFU_ENABLED,
        audioOnly: env.SFU_AUDIO_ONLY,
        preferTcp: env.SFU_PREFER_TCP,
      },
    };
  });

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

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2003') {
        reply.code(401).send({
          code: 'INVALID_SESSION',
          message: 'Session is no longer valid. Please log in again.',
        });
        return;
      }
      if (error.code === 'P2002') {
        reply.code(409).send({
          code: 'CONFLICT',
          message: 'Resource already exists.',
        });
        return;
      }
    }

    app.log.error(error);
    reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  return app;
}
