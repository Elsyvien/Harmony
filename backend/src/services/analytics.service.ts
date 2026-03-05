import type { AnalyticsCategory as PrismaAnalyticsCategory, AnalyticsLevel as PrismaAnalyticsLevel, AnalyticsSource as PrismaAnalyticsSource } from '@prisma/client';
import { prisma } from '../repositories/prisma.js';

export type AnalyticsWindow = '24h' | '7d' | '30d';
export type AnalyticsCategory = 'reliability' | 'usage' | 'moderation' | 'operations';
export type AnalyticsLevel = 'info' | 'warn' | 'error';
export type AnalyticsSource = 'web_client' | 'backend_http' | 'backend_ws' | 'backend_voice' | 'backend_system';

export interface AnalyticsEventEnvelope {
  name: string;
  category: AnalyticsCategory;
  level?: AnalyticsLevel;
  timestamp?: string;
  source?: AnalyticsSource;
  sessionId?: string;
  requestId?: string;
  channelId?: string;
  success?: boolean;
  durationMs?: number;
  statusCode?: number;
  context?: Record<string, unknown>;
}

export interface AdminAnalyticsOverview {
  window: AnalyticsWindow;
  range: {
    start: string;
    end: string;
  };
  totals: {
    events: number;
    errors: number;
    warnings: number;
    uniqueUsers: number;
  };
  reliability: {
    errorRatePercent: number;
    p95LatencyMs: number | null;
    voiceJoinSuccessRatePercent: number | null;
    wsReconnectSuccessRatePercent: number | null;
    topFailures: Array<{ name: string; count: number }>;
  };
  usage: {
    dau: number;
    wau: number;
    signupToFirstMessageRatePercent: number | null;
  };
  moderation: {
    totalActions: number;
    byEvent: Array<{ name: string; count: number }>;
  };
  operations: {
    eventsPerMinute: number;
  };
}

export interface AdminAnalyticsTimeseries {
  window: AnalyticsWindow;
  interval: 'hourly' | '6h' | 'daily';
  range: {
    start: string;
    end: string;
  };
  points: Array<{
    bucketStart: string;
    totalEvents: number;
    errorEvents: number;
    p95LatencyMs: number | null;
    moderationActions: number;
  }>;
  topEvents: Array<{ name: string; count: number }>;
  topFailures: Array<{ name: string; count: number }>;
}

type ContextValue = string | number | boolean | null;

type NormalizedAnalyticsEvent = {
  occurredAt: Date | null;
  source: PrismaAnalyticsSource;
  category: PrismaAnalyticsCategory;
  name: string;
  level: PrismaAnalyticsLevel;
  userId: string | null;
  sessionId: string | null;
  channelId: string | null;
  requestId: string | null;
  success: boolean | null;
  durationMs: number | null;
  statusCode: number | null;
  context?: Record<string, ContextValue>;
};

const EVENT_NAME_PATTERN = /^[a-z0-9]+(?:\.[a-z0-9]+){2,}$/;
const MAX_CONTEXT_STRING_LENGTH = 240;
const MAX_CONTEXT_FIELDS = 16;

const WINDOW_TO_MS: Record<AnalyticsWindow, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const WINDOW_TO_BUCKET_MS: Record<AnalyticsWindow, number> = {
  '24h': 60 * 60 * 1000,
  '7d': 6 * 60 * 60 * 1000,
  '30d': 24 * 60 * 60 * 1000,
};

const WINDOW_TO_INTERVAL_LABEL: Record<AnalyticsWindow, AdminAnalyticsTimeseries['interval']> = {
  '24h': 'hourly',
  '7d': '6h',
  '30d': 'daily',
};

const CATEGORY_TO_DB: Record<AnalyticsCategory, PrismaAnalyticsCategory> = {
  reliability: 'RELIABILITY',
  usage: 'USAGE',
  moderation: 'MODERATION',
  operations: 'OPERATIONS',
};

const LEVEL_TO_DB: Record<AnalyticsLevel, PrismaAnalyticsLevel> = {
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};

const SOURCE_TO_DB: Record<AnalyticsSource, PrismaAnalyticsSource> = {
  web_client: 'WEB_CLIENT',
  backend_http: 'BACKEND_HTTP',
  backend_ws: 'BACKEND_WS',
  backend_voice: 'BACKEND_VOICE',
  backend_system: 'BACKEND_SYSTEM',
};

const CLIENT_CONTEXT_ALLOWLIST: Record<string, readonly string[]> = {
  'api.request.succeeded': ['method', 'path', 'statusCode'],
  'api.request.failed': ['method', 'path', 'statusCode', 'code'],
  'auth.login.succeeded': ['method'],
  'auth.login.failed': ['method', 'code'],
  'auth.register.succeeded': ['method'],
  'auth.register.failed': ['method', 'code'],
  'avatar.upload.blocked': [],
  'avatar.upload.invalid': ['mimeType'],
  'avatar.upload.rejected': ['sizeBytes'],
  'avatar.upload.succeeded': ['sizeBytes', 'mimeType'],
  'avatar.upload.failed': ['sizeBytes', 'mimeType', 'code'],
  'message.send.attempted': ['channelId', 'hasAttachment', 'hasReply'],
  'message.send.acked': ['channelId', 'transport', 'hasAttachment', 'hasReply', 'statusCode'],
  'message.send.failed': ['channelId', 'transport', 'hasAttachment', 'hasReply', 'code', 'statusCode'],
  'message.retry.attempted': ['channelId', 'hasAttachment', 'hasReply'],
  'message.retry.succeeded': ['channelId', 'hasAttachment', 'hasReply'],
  'message.retry.failed': ['channelId', 'hasAttachment', 'hasReply', 'code'],
  'friends.request.sent': ['fromView'],
  'friends.request.failed': ['fromView', 'code'],
  'channel.opened.succeeded': ['channelId', 'channelType', 'isDirect'],
  'settings.updated.succeeded': ['field'],
  'voice.join.attempted': ['channelId', 'muted', 'deafened'],
  'voice.join.succeeded': ['channelId', 'muted', 'deafened'],
  'voice.join.failed': ['channelId', 'muted', 'deafened', 'code'],
  'voice.leave.succeeded': ['channelId'],
  'voice.signal.offer.failed': ['channelId', 'targetUserId', 'code'],
  'voice.signal.answer.failed': ['channelId', 'targetUserId', 'code'],
  'ws.connect.attempted': ['url'],
  'ws.connect.succeeded': ['url'],
  'ws.connect.failed': ['url', 'reason'],
  'ws.disconnected.warn': ['code', 'reason'],
  'ws.reconnect.attempted': ['attempt'],
  'ws.reconnect.succeeded': ['attempt'],
  'ws.reconnect.failed': ['attempt', 'reason'],
  'moderation.user.suspended': ['targetUserId', 'suspensionHours'],
  'moderation.user.unsuspended': ['targetUserId'],
  'moderation.user.deleted': ['targetUserId'],
  'moderation.users.cleared': ['deletedCount'],
  'moderation.role.updated': ['targetUserId', 'role'],
  'stream.constraints.failed': ['presetLabel', 'source', 'code'],
  'video.share.failed': ['source', 'qualityPreset', 'code'],
  'client.error.reported': ['feature', 'code'],
};

const SERVER_CONTEXT_ALLOWLIST: Record<string, readonly string[]> = {
  'backend.http.request': ['method', 'path', 'statusCode'],
  'backend.ws.error': ['eventType', 'code'],
  'backend.ws.event': ['eventType'],
  'backend.voice.failure': ['stage', 'action', 'code'],
  'voice.signal.rate_limited': ['channelId'],
  'sfu.request.failed': ['stage', 'action', 'code'],
};

function isAnalyticsCategory(value: unknown): value is AnalyticsCategory {
  return value === 'reliability' || value === 'usage' || value === 'moderation' || value === 'operations';
}

function isAnalyticsLevel(value: unknown): value is AnalyticsLevel {
  return value === 'info' || value === 'warn' || value === 'error';
}

function isAnalyticsSource(value: unknown): value is AnalyticsSource {
  return (
    value === 'web_client' ||
    value === 'backend_http' ||
    value === 'backend_ws' ||
    value === 'backend_voice' ||
    value === 'backend_system'
  );
}

function sanitizeContextValue(value: unknown): ContextValue | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return value.slice(0, MAX_CONTEXT_STRING_LENGTH);
  }
  return undefined;
}

function sanitizeContext(name: string, context: Record<string, unknown> | undefined, source: 'client' | 'server') {
  if (!context) {
    return undefined;
  }
  const allowlist = source === 'client' ? CLIENT_CONTEXT_ALLOWLIST[name] : SERVER_CONTEXT_ALLOWLIST[name];
  if (!allowlist || allowlist.length === 0) {
    return undefined;
  }

  const next: Record<string, ContextValue> = {};
  for (const key of allowlist) {
    if (!Object.prototype.hasOwnProperty.call(context, key)) {
      continue;
    }
    const sanitized = sanitizeContextValue(context[key]);
    if (sanitized === undefined) {
      continue;
    }
    next[key] = sanitized;
    if (Object.keys(next).length >= MAX_CONTEXT_FIELDS) {
      break;
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeOccurredAt(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed);
}

function normalizeStatusCode(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value);
  if (rounded < 100 || rounded > 599) {
    return null;
  }
  return rounded;
}

function normalizeDurationMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value);
  if (rounded < 0 || rounded > 10 * 60 * 1000) {
    return null;
  }
  return rounded;
}

function normalizeWindow(window: AnalyticsWindow): { start: Date; end: Date; spanMs: number } {
  const spanMs = WINDOW_TO_MS[window];
  const end = new Date();
  const start = new Date(end.getTime() - spanMs);
  return { start, end, spanMs };
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? null;
}

function asPercent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function toSortedCounts(source: Map<string, number>, limit = 10) {
  return [...source.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    })
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function categoryFromDb(value: PrismaAnalyticsCategory): AnalyticsCategory {
  if (value === 'USAGE') {
    return 'usage';
  }
  if (value === 'MODERATION') {
    return 'moderation';
  }
  if (value === 'OPERATIONS') {
    return 'operations';
  }
  return 'reliability';
}

export class AnalyticsService {
  async ingestClientEvents(input: {
    events: AnalyticsEventEnvelope[];
    authenticatedUserId?: string | null;
  }) {
    const rows: NormalizedAnalyticsEvent[] = [];
    let dropped = 0;

    for (const event of input.events) {
      const normalized = this.normalizeClientEvent(event, input.authenticatedUserId ?? null);
      if (!normalized) {
        dropped += 1;
        continue;
      }
      rows.push(normalized);
    }

    if (rows.length > 0) {
      await prisma.analyticsEvent.createMany({ data: rows });
    }

    return {
      accepted: rows.length,
      dropped,
    };
  }

  async trackServerEvent(event: {
    name: string;
    category: AnalyticsCategory;
    level?: AnalyticsLevel;
    source: Exclude<AnalyticsSource, 'web_client'>;
    userId?: string | null;
    sessionId?: string | null;
    channelId?: string | null;
    requestId?: string | null;
    success?: boolean;
    durationMs?: number;
    statusCode?: number;
    context?: Record<string, unknown>;
    timestamp?: string;
  }): Promise<void> {
    try {
      const normalized = this.normalizeServerEvent(event);
      if (!normalized) {
        return;
      }
      await prisma.analyticsEvent.create({
        data: normalized,
      });
    } catch {
      // Best-effort telemetry should never impact core application behavior.
    }
  }

  async cleanupExpiredEvents(retentionDays = 30): Promise<{ deletedCount: number }> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await prisma.analyticsEvent.deleteMany({
      where: {
        receivedAt: {
          lt: cutoff,
        },
      },
    });
    return { deletedCount: result.count };
  }

  async getOverview(input: {
    window: AnalyticsWindow;
    category?: AnalyticsCategory;
    name?: string;
  }): Promise<AdminAnalyticsOverview> {
    const range = normalizeWindow(input.window);

    const where = {
      receivedAt: {
        gte: range.start,
        lte: range.end,
      },
      ...(input.category ? { category: CATEGORY_TO_DB[input.category] } : {}),
      ...(input.name ? { name: input.name } : {}),
    };

    const events = await prisma.analyticsEvent.findMany({
      where,
      select: {
        name: true,
        level: true,
        userId: true,
        durationMs: true,
        success: true,
        category: true,
      },
    });

    const totalEvents = events.length;
    const errorEvents = events.filter((event) => event.level === 'ERROR').length;
    const warningEvents = events.filter((event) => event.level === 'WARN').length;
    const uniqueUsers = new Set(events.map((event) => event.userId).filter((userId): userId is string => Boolean(userId))).size;

    const durations = events
      .map((event) => event.durationMs)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);

    const voiceJoinSucceeded = events.filter((event) => event.name === 'voice.join.succeeded').length;
    const voiceJoinFailed = events.filter((event) => event.name === 'voice.join.failed').length;
    const wsReconnectSucceeded = events.filter((event) => event.name === 'ws.reconnect.succeeded').length;
    const wsReconnectFailed = events.filter((event) => event.name === 'ws.reconnect.failed').length;

    const failuresByName = new Map<string, number>();
    for (const event of events) {
      const isFailure = event.level === 'ERROR' || event.success === false;
      if (!isFailure) {
        continue;
      }
      failuresByName.set(event.name, (failuresByName.get(event.name) ?? 0) + 1);
    }

    const moderationByName = new Map<string, number>();
    for (const event of events) {
      if (event.category !== 'MODERATION') {
        continue;
      }
      moderationByName.set(event.name, (moderationByName.get(event.name) ?? 0) + 1);
    }

    const registeredUsers = new Set(
      events
        .filter((event) => event.name === 'auth.register.succeeded' && event.userId)
        .map((event) => event.userId as string),
    );
    const usersWithMessageAck = new Set(
      events
        .filter((event) => event.name === 'message.send.acked' && event.userId)
        .map((event) => event.userId as string),
    );
    let signupToFirstMessageCount = 0;
    for (const userId of registeredUsers) {
      if (usersWithMessageAck.has(userId)) {
        signupToFirstMessageCount += 1;
      }
    }

    const [dauRows, wauRows] = await Promise.all([
      prisma.analyticsEvent.findMany({
        where: {
          receivedAt: {
            gte: new Date(range.end.getTime() - WINDOW_TO_MS['24h']),
            lte: range.end,
          },
          userId: { not: null },
        },
        select: { userId: true },
        distinct: ['userId'],
      }),
      prisma.analyticsEvent.findMany({
        where: {
          receivedAt: {
            gte: new Date(range.end.getTime() - WINDOW_TO_MS['7d']),
            lte: range.end,
          },
          userId: { not: null },
        },
        select: { userId: true },
        distinct: ['userId'],
      }),
    ]);

    return {
      window: input.window,
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
      totals: {
        events: totalEvents,
        errors: errorEvents,
        warnings: warningEvents,
        uniqueUsers,
      },
      reliability: {
        errorRatePercent: Number((asPercent(errorEvents, totalEvents) ?? 0).toFixed(2)),
        p95LatencyMs: percentile(durations, 95),
        voiceJoinSuccessRatePercent: asPercent(
          voiceJoinSucceeded,
          voiceJoinSucceeded + voiceJoinFailed,
        ),
        wsReconnectSuccessRatePercent: asPercent(
          wsReconnectSucceeded,
          wsReconnectSucceeded + wsReconnectFailed,
        ),
        topFailures: toSortedCounts(failuresByName),
      },
      usage: {
        dau: dauRows.length,
        wau: wauRows.length,
        signupToFirstMessageRatePercent: asPercent(
          signupToFirstMessageCount,
          registeredUsers.size,
        ),
      },
      moderation: {
        totalActions: [...moderationByName.values()].reduce((sum, count) => sum + count, 0),
        byEvent: toSortedCounts(moderationByName),
      },
      operations: {
        eventsPerMinute: Number((totalEvents / Math.max(1, range.spanMs / 60_000)).toFixed(2)),
      },
    };
  }

  async getTimeseries(input: {
    window: AnalyticsWindow;
    category?: AnalyticsCategory;
    name?: string;
  }): Promise<AdminAnalyticsTimeseries> {
    const range = normalizeWindow(input.window);
    const bucketSizeMs = WINDOW_TO_BUCKET_MS[input.window];
    const bucketCount = Math.max(1, Math.ceil(range.spanMs / bucketSizeMs));
    const buckets = Array.from({ length: bucketCount }, (_, index) => ({
      bucketStart: new Date(range.start.getTime() + index * bucketSizeMs),
      totalEvents: 0,
      errorEvents: 0,
      moderationActions: 0,
      latencies: [] as number[],
    }));

    const where = {
      receivedAt: {
        gte: range.start,
        lte: range.end,
      },
      ...(input.category ? { category: CATEGORY_TO_DB[input.category] } : {}),
      ...(input.name ? { name: input.name } : {}),
    };

    const events = await prisma.analyticsEvent.findMany({
      where,
      select: {
        name: true,
        category: true,
        level: true,
        success: true,
        durationMs: true,
        receivedAt: true,
      },
    });

    const topEvents = new Map<string, number>();
    const topFailures = new Map<string, number>();

    for (const event of events) {
      const index = Math.min(
        bucketCount - 1,
        Math.max(0, Math.floor((event.receivedAt.getTime() - range.start.getTime()) / bucketSizeMs)),
      );
      const bucket = buckets[index];
      if (!bucket) {
        continue;
      }

      bucket.totalEvents += 1;
      topEvents.set(event.name, (topEvents.get(event.name) ?? 0) + 1);

      const isFailure = event.level === 'ERROR' || event.success === false;
      if (isFailure) {
        bucket.errorEvents += 1;
        topFailures.set(event.name, (topFailures.get(event.name) ?? 0) + 1);
      }

      if (event.category === 'MODERATION') {
        bucket.moderationActions += 1;
      }

      if (typeof event.durationMs === 'number' && Number.isFinite(event.durationMs) && event.durationMs >= 0) {
        bucket.latencies.push(event.durationMs);
      }
    }

    return {
      window: input.window,
      interval: WINDOW_TO_INTERVAL_LABEL[input.window],
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
      points: buckets.map((bucket) => ({
        bucketStart: bucket.bucketStart.toISOString(),
        totalEvents: bucket.totalEvents,
        errorEvents: bucket.errorEvents,
        moderationActions: bucket.moderationActions,
        p95LatencyMs: percentile(bucket.latencies, 95),
      })),
      topEvents: toSortedCounts(topEvents, 12),
      topFailures: toSortedCounts(topFailures, 12),
    };
  }

  private normalizeClientEvent(
    event: AnalyticsEventEnvelope,
    authenticatedUserId: string | null,
  ): NormalizedAnalyticsEvent | null {
    const name = event.name.trim().toLowerCase();
    if (!EVENT_NAME_PATTERN.test(name) || !Object.prototype.hasOwnProperty.call(CLIENT_CONTEXT_ALLOWLIST, name)) {
      return null;
    }
    if (!isAnalyticsCategory(event.category)) {
      return null;
    }

    const level = isAnalyticsLevel(event.level) ? event.level : 'info';
    const source = isAnalyticsSource(event.source) ? event.source : 'web_client';
    if (source !== 'web_client') {
      return null;
    }

    return {
      occurredAt: normalizeOccurredAt(event.timestamp),
      source: SOURCE_TO_DB[source],
      category: CATEGORY_TO_DB[event.category],
      name,
      level: LEVEL_TO_DB[level],
      userId: authenticatedUserId,
      sessionId: typeof event.sessionId === 'string' ? event.sessionId.slice(0, 120) : null,
      channelId: typeof event.channelId === 'string' ? event.channelId.slice(0, 120) : null,
      requestId: typeof event.requestId === 'string' ? event.requestId.slice(0, 120) : null,
      success: typeof event.success === 'boolean' ? event.success : null,
      durationMs: normalizeDurationMs(event.durationMs),
      statusCode: normalizeStatusCode(event.statusCode),
      context: sanitizeContext(name, event.context, 'client'),
    };
  }

  private normalizeServerEvent(event: {
    name: string;
    category: AnalyticsCategory;
    level?: AnalyticsLevel;
    source: Exclude<AnalyticsSource, 'web_client'>;
    userId?: string | null;
    sessionId?: string | null;
    channelId?: string | null;
    requestId?: string | null;
    success?: boolean;
    durationMs?: number;
    statusCode?: number;
    context?: Record<string, unknown>;
    timestamp?: string;
  }): NormalizedAnalyticsEvent | null {
    const name = event.name.trim().toLowerCase();
    if (!EVENT_NAME_PATTERN.test(name) || !Object.prototype.hasOwnProperty.call(SERVER_CONTEXT_ALLOWLIST, name)) {
      return null;
    }
    if (!isAnalyticsCategory(event.category) || !isAnalyticsSource(event.source)) {
      return null;
    }
    const level = isAnalyticsLevel(event.level) ? event.level : event.success === false ? 'error' : 'info';

    return {
      occurredAt: normalizeOccurredAt(event.timestamp),
      source: SOURCE_TO_DB[event.source],
      category: CATEGORY_TO_DB[event.category],
      name,
      level: LEVEL_TO_DB[level],
      userId: event.userId ?? null,
      sessionId: event.sessionId ?? null,
      channelId: event.channelId ?? null,
      requestId: event.requestId ?? null,
      success: typeof event.success === 'boolean' ? event.success : null,
      durationMs: normalizeDurationMs(event.durationMs),
      statusCode: normalizeStatusCode(event.statusCode),
      context: sanitizeContext(name, event.context, 'server'),
    };
  }
}

export function parseAnalyticsCategory(value: string | undefined): AnalyticsCategory | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return isAnalyticsCategory(normalized) ? normalized : undefined;
}

export function parseAnalyticsWindow(value: string | undefined): AnalyticsWindow | undefined {
  if (!value) {
    return undefined;
  }
  if (value === '24h' || value === '7d' || value === '30d') {
    return value;
  }
  return undefined;
}

export function parseAnalyticsName(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!EVENT_NAME_PATTERN.test(normalized)) {
    return undefined;
  }
  return normalized;
}

export function categoryFromDbEnum(value: PrismaAnalyticsCategory): AnalyticsCategory {
  return categoryFromDb(value);
}
