import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { Prisma } from '@prisma/client';
import Fastify from 'fastify';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { ZodError } from 'zod';
import { publicIpv4 } from 'public-ip';
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
import { rtcRoutes } from './routes/rtc.routes.js';
import { AdminService } from './services/admin.service.js';
import { AdminSettingsService } from './services/admin-settings.service.js';
import { AdminUserService } from './services/admin-user.service.js';
import { AuthService } from './services/auth.service.js';
import { UserService } from './services/user.service.js';
import { userRoutes } from './routes/user.routes.js';
import { ChannelService } from './services/channel.service.js';
import { MessageService } from './services/message.service.js';
import { FriendService } from './services/friend.service.js';
import { CloudflareVoiceSfuService } from './services/cloudflare-voice-sfu.service.js';
import { CloudflareRealtimeSfuApiClient } from './services/cloudflare-realtime-sfu-api.client.js';
import type { VoiceSfuProvider } from './services/voice-sfu-provider.js';
import { VoiceSfuService } from './services/voice-sfu.service.js';
import { AppError } from './utils/app-error.js';

export async function buildApp() {
  const env = loadEnv();
  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  await mkdir(uploadsDir, { recursive: true });
  const isLoopbackOrPlaceholderHost = (value: string | null) => {
    if (!value) return false;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    return (
      normalized === 'localhost' ||
      normalized === '0.0.0.0' ||
      normalized === '127.0.0.1' ||
      normalized === '::1' ||
      normalized === '[::1]' ||
      normalized.startsWith('127.')
    );
  };

  const configuredOrigins = env.CLIENT_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const wildcardToRegex = (pattern: string) =>
    new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  const corsOrigins = configuredOrigins.map((origin) =>
    origin.includes('*') ? wildcardToRegex(origin) : origin,
  );

  const app = Fastify({
    trustProxy: true,
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

  const usingMediasoupSfu = env.SFU_ENABLED && env.SFU_PROVIDER === 'mediasoup';
  const usingCloudflareManagedSfu = env.SFU_ENABLED && env.SFU_PROVIDER === 'cloudflare';

  // Auto-detect a routable IP for mediasoup ICE candidates when SFU_ANNOUNCED_IP is not set.
  // Without this, mediasoup generates candidates with 0.0.0.0 which browsers cannot reach.
  let sfuAnnouncedIp: string | null = env.SFU_ANNOUNCED_IP.trim() || null;
  if (!sfuAnnouncedIp && usingMediasoupSfu) {
    try {
      sfuAnnouncedIp = await publicIpv4();
    } catch {
      // Fallback
      const ifaces = networkInterfaces();
      for (const entries of Object.values(ifaces)) {
        if (!entries) continue;
        for (const entry of entries) {
          if (entry.family === 'IPv4' && !entry.internal) {
            sfuAnnouncedIp = entry.address;
            break;
          }
        }
        if (sfuAnnouncedIp) break;
      }
    }
    // In production, a loopback fallback breaks ICE candidates for remote clients.
    if (!sfuAnnouncedIp && env.NODE_ENV !== 'production') {
      sfuAnnouncedIp = '127.0.0.1';
    }
    if (sfuAnnouncedIp) {
      app.log.info(`SFU_ANNOUNCED_IP not set – auto-detected ${sfuAnnouncedIp}`);
    } else {
      app.log.warn(
        'SFU_ENABLED=true (mediasoup) but SFU_ANNOUNCED_IP could not be auto-detected. Set SFU_ANNOUNCED_IP to a public IP or DNS name for remote audio to work reliably.',
      );
    }
  }

  if (usingMediasoupSfu && env.NODE_ENV === 'production') {
    if (!sfuAnnouncedIp) {
      throw new Error(
        'SFU_ENABLED=true (mediasoup) in production but SFU_ANNOUNCED_IP could not be resolved. Set SFU_ANNOUNCED_IP to a public IP or DNS name before starting the server.',
      );
    }

    if (isLoopbackOrPlaceholderHost(sfuAnnouncedIp)) {
      throw new Error(
        `SFU_ENABLED=true (mediasoup) in production but SFU_ANNOUNCED_IP resolved to an unreachable loopback/placeholder value (${sfuAnnouncedIp}). Set SFU_ANNOUNCED_IP to a public IP or DNS name before starting the server.`,
      );
    }
  }

  if (
    usingMediasoupSfu &&
    env.NODE_ENV === 'production' &&
    env.SFU_WEBRTC_UDP &&
    !env.SFU_PREFER_TCP
  ) {
    app.log.warn(
      'SFU is using UDP-first mediasoup transports in production. On platforms with restricted UDP (including common PaaS setups), set SFU_WEBRTC_UDP=false and SFU_PREFER_TCP=true.',
    );
  }

  if (usingCloudflareManagedSfu) {
    if (!env.CLOUDFLARE_SFU_APP_ID.trim() || !env.CLOUDFLARE_SFU_APP_SECRET.trim()) {
      app.log.warn(
        'SFU_PROVIDER=cloudflare but CLOUDFLARE_SFU_APP_ID/CLOUDFLARE_SFU_APP_SECRET are missing. Managed SFU requests will fail until configured.',
      );
    }
  }

  const cloudflareTurnKeyId = env.CLOUDFLARE_TURN_KEY_ID.trim();
  const cloudflareTurnApiToken = env.CLOUDFLARE_TURN_API_TOKEN.trim();
  const hasCloudflareTurn = cloudflareTurnKeyId.length > 0 && cloudflareTurnApiToken.length > 0;

  if ((cloudflareTurnKeyId.length > 0 || cloudflareTurnApiToken.length > 0) && !hasCloudflareTurn) {
    app.log.warn(
      'Cloudflare TURN is partially configured. Set both CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN to enable ephemeral Cloudflare ICE servers.',
    );
  }

  if (env.NODE_ENV === 'production' && env.TURN_URLS.trim().length === 0 && !hasCloudflareTurn) {
    app.log.warn(
      'TURN_URLS is empty in production and Cloudflare TURN is not configured. Voice calls may fail for users behind restrictive NAT/firewalls.',
    );
  }

  const voiceSfuService: VoiceSfuProvider = env.SFU_PROVIDER === 'cloudflare'
    ? new CloudflareVoiceSfuService({
        enabled: env.SFU_ENABLED,
        audioOnly: env.SFU_AUDIO_ONLY,
        appId: env.CLOUDFLARE_SFU_APP_ID,
        appSecret: env.CLOUDFLARE_SFU_APP_SECRET,
        accountId: env.CLOUDFLARE_SFU_ACCOUNT_ID,
        apiBaseUrl: env.CLOUDFLARE_SFU_API_BASE_URL,
      })
    : new VoiceSfuService({
        enabled: env.SFU_ENABLED,
        audioOnly: env.SFU_AUDIO_ONLY,
        listenIp: env.SFU_LISTEN_IP,
        announcedIp: sfuAnnouncedIp,
        minPort: env.SFU_MIN_PORT,
        maxPort: env.SFU_MAX_PORT,
        enableUdp: env.SFU_WEBRTC_UDP,
        enableTcp: env.SFU_WEBRTC_TCP,
        preferTcp: env.SFU_PREFER_TCP,
      });
  await voiceSfuService.init();

  const cloudflareRealtimeSfuApi = new CloudflareRealtimeSfuApiClient({
    enabled: env.SFU_ENABLED && env.SFU_PROVIDER === 'cloudflare',
    appId: env.CLOUDFLARE_SFU_APP_ID,
    appSecret: env.CLOUDFLARE_SFU_APP_SECRET,
    apiBaseUrl: env.CLOUDFLARE_SFU_API_BASE_URL,
  });

  await channelService.ensureDefaultChannel();

  await app.register(wsPlugin, { channelService, messageService, voiceSfuService });
  await app.register(authRoutes, { authService, env });
  await app.register(channelRoutes, { channelService, messageService });
  await app.register(friendRoutes, { friendService });
  await app.register(userRoutes, { userService });
  await app.register(adminRoutes, { adminService, adminSettingsService, adminUserService });
  await app.register(rtcRoutes, { cloudflareRealtimeSfuApi });

  const parseTurnUrls = (value: string) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith('turn:') || entry.startsWith('turns:'))
      .slice(0, 6);

  type IceServerConfig = { urls: string | string[]; username?: string; credential?: string };

  const hasTurnUrl = (urls: string | string[]) =>
    (Array.isArray(urls) ? urls : [urls]).some(
      (url) => url.startsWith('turn:') || url.startsWith('turns:'),
    );

  const isPort53IceUrl = (url: string) => /:53(?:[/?]|$)/i.test(url);

  const normalizeIceServerUrls = (value: unknown): string[] => {
    const rawUrls = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    return rawUrls
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  };

  const normalizeIceServer = (value: unknown): IceServerConfig | null => {
    if (!value || typeof value !== 'object') return null;

    const candidate = value as { urls?: unknown; username?: unknown; credential?: unknown };
    const urls = normalizeIceServerUrls(candidate.urls);
    if (urls.length === 0) return null;

    const server: IceServerConfig = { urls };
    if (typeof candidate.username === 'string' && candidate.username.length > 0) {
      server.username = candidate.username;
    }
    if (typeof candidate.credential === 'string' && candidate.credential.length > 0) {
      server.credential = candidate.credential;
    }
    return server;
  };

  const maybeFilterPort53IceUrls = (server: IceServerConfig): IceServerConfig | null => {
    if (!env.CLOUDFLARE_TURN_FILTER_PORT_53) {
      return server;
    }

    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(
      (url) => !isPort53IceUrl(url),
    );
    if (urls.length === 0) {
      return null;
    }

    return {
      ...server,
      urls,
    };
  };

  const createTurnRestCredentials = (sharedSecret: string, ttlSeconds: number, principal: string) => {
    const expiryUnixSeconds = Math.floor(Date.now() / 1000) + ttlSeconds;
    const username = `${expiryUnixSeconds}:${principal}`;
    const credential = createHmac('sha1', sharedSecret).update(username).digest('base64');
    return { username, credential };
  };

  const fetchCloudflareTurnIceServers = async (): Promise<IceServerConfig[] | null> => {
    if (!hasCloudflareTurn) {
      return null;
    }

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), 5_000);
    timeoutHandle.unref?.();

    try {
      const response = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(cloudflareTurnKeyId)}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${cloudflareTurnApiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl: env.TURN_CREDENTIAL_TTL_SECONDS }),
          signal: abortController.signal,
        },
      );

      if (!response.ok) {
        const responseBody = await response.text().catch(() => '');
        app.log.warn(
          {
            statusCode: response.status,
            statusText: response.statusText,
            body: responseBody.slice(0, 500),
          },
          'Cloudflare TURN ICE server request failed; falling back to configured TURN providers.',
        );
        return null;
      }

      const payload = (await response.json().catch(() => null)) as { iceServers?: unknown } | null;
      if (!payload || !Array.isArray(payload.iceServers)) {
        app.log.warn(
          'Cloudflare TURN ICE server response was missing an iceServers array; falling back to configured TURN providers.',
        );
        return null;
      }

      const iceServers = payload.iceServers
        .map((server) => normalizeIceServer(server))
        .filter((server): server is IceServerConfig => server !== null)
        .map((server) => maybeFilterPort53IceUrls(server))
        .filter((server): server is IceServerConfig => server !== null);

      if (!iceServers.some((server) => hasTurnUrl(server.urls))) {
        app.log.warn(
          'Cloudflare TURN ICE server response did not include any TURN URLs after filtering; falling back to configured TURN providers.',
        );
        return null;
      }

      return iceServers;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        app.log.warn(
          'Cloudflare TURN ICE server request timed out after 5000ms; falling back to configured TURN providers.',
        );
      } else {
        app.log.warn(
          { err: error },
          'Cloudflare TURN ICE server request threw an error; falling back to configured TURN providers.',
        );
      }
      return null;
    } finally {
      clearTimeout(timeoutHandle);
    }
  };

  app.get('/rtc/config', async () => {
    const turnUrls = parseTurnUrls(env.TURN_URLS);
    const hasConfiguredTurn = turnUrls.length > 0;
    const hasStaticTurnCredentials = Boolean(env.TURN_USERNAME && env.TURN_CREDENTIAL);
    const hasEphemeralTurnSecret = Boolean(env.TURN_SHARED_SECRET);

    const iceServers: IceServerConfig[] = [{ urls: [env.RTC_STUN_URL] }];

    const cloudflareIceServers = await fetchCloudflareTurnIceServers();
    if (cloudflareIceServers && cloudflareIceServers.length > 0) {
      iceServers.push(...cloudflareIceServers);
    } else if (hasConfiguredTurn && hasEphemeralTurnSecret) {
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

    const hasRelayIceServer = iceServers.some((server) => hasTurnUrl(server.urls));
    const allowPublicFallbackTurn =
      env.RTC_ENABLE_PUBLIC_FALLBACK_TURN &&
      env.NODE_ENV !== 'production' &&
      !hasRelayIceServer;
    if (allowPublicFallbackTurn) {
      iceServers.push({
        urls: ['turn:openrelay.metered.ca:80'],
        username: 'openrelayproject',
        credential: 'openrelayproject',
      });
    }

    let voiceDefaults = {
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
    };
    try {
      const settings = await adminSettingsService.getSettings();
      voiceDefaults = {
        noiseSuppression: settings.voiceNoiseSuppressionDefault,
        echoCancellation: settings.voiceEchoCancellationDefault,
        autoGainControl: settings.voiceAutoGainControlDefault,
      };
    } catch (error) {
      app.log.warn(
        { err: error },
        'Failed to load admin voice defaults for /rtc/config; using built-in defaults.',
      );
    }

    return {
      rtc: {
        iceServers,
        iceTransportPolicy: env.RTC_FORCE_RELAY ? 'relay' : 'all',
        iceCandidatePoolSize: 2,
      },
      sfu: {
        enabled: env.SFU_ENABLED,
        provider: env.SFU_PROVIDER,
        audioOnly: env.SFU_AUDIO_ONLY,
        preferTcp: env.SFU_PREFER_TCP,
      },
      voiceDefaults,
    };
  });

  app.get('/health', async () => ({ ok: true }));

  app.addHook('onClose', async () => {
    await voiceSfuService.close();
  });

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
