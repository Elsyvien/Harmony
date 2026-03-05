import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaAnalyticsEventMock } = vi.hoisted(() => ({
  prismaAnalyticsEventMock: {
    createMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock('../src/repositories/prisma.js', () => ({
  prisma: {
    analyticsEvent: prismaAnalyticsEventMock,
  },
}));

import { AnalyticsService } from '../src/services/analytics.service.js';

describe('AnalyticsService', () => {
  beforeEach(() => {
    prismaAnalyticsEventMock.createMany.mockReset();
    prismaAnalyticsEventMock.create.mockReset();
    prismaAnalyticsEventMock.deleteMany.mockReset();
    prismaAnalyticsEventMock.findMany.mockReset();
  });

  it('sanitizes client context with per-event allowlist and drops unknown events', async () => {
    prismaAnalyticsEventMock.createMany.mockResolvedValue({ count: 1 });
    const service = new AnalyticsService();

    const result = await service.ingestClientEvents({
      authenticatedUserId: 'user-123',
      events: [
        {
          name: 'api.request.failed',
          category: 'reliability',
          level: 'warn',
          context: {
            method: 'GET',
            path: '/channels',
            statusCode: 503,
            code: 'REQUEST_FAILED',
            email: 'sensitive@example.com',
            content: 'secret message',
          },
        },
        {
          name: 'unknown.event.type',
          category: 'operations',
          level: 'info',
        },
      ],
    });

    expect(result).toEqual({ accepted: 1, dropped: 1 });
    expect(prismaAnalyticsEventMock.createMany).toHaveBeenCalledTimes(1);
    expect(prismaAnalyticsEventMock.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          name: 'api.request.failed',
          userId: 'user-123',
          category: 'RELIABILITY',
          level: 'WARN',
          source: 'WEB_CLIENT',
          context: {
            method: 'GET',
            path: '/channels',
            statusCode: 503,
            code: 'REQUEST_FAILED',
          },
        }),
      ],
    });
  });

  it('deletes events older than retention threshold', async () => {
    prismaAnalyticsEventMock.deleteMany.mockResolvedValue({ count: 12 });
    const service = new AnalyticsService();

    const result = await service.cleanupExpiredEvents(30);

    expect(result).toEqual({ deletedCount: 12 });
    expect(prismaAnalyticsEventMock.deleteMany).toHaveBeenCalledWith({
      where: {
        receivedAt: {
          lt: expect.any(Date),
        },
      },
    });
  });

  it('aggregates overview and timeseries metrics from stored analytics', async () => {
    const now = new Date('2026-03-05T10:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      prismaAnalyticsEventMock.findMany
        .mockResolvedValueOnce([
          {
            name: 'voice.join.succeeded',
            level: 'INFO',
            userId: 'user-a',
            durationMs: 210,
            success: true,
            category: 'RELIABILITY',
          },
          {
            name: 'voice.join.failed',
            level: 'ERROR',
            userId: 'user-b',
            durationMs: 480,
            success: false,
            category: 'RELIABILITY',
          },
          {
            name: 'auth.register.succeeded',
            level: 'INFO',
            userId: 'user-c',
            durationMs: 120,
            success: true,
            category: 'USAGE',
          },
          {
            name: 'message.send.acked',
            level: 'INFO',
            userId: 'user-c',
            durationMs: 100,
            success: true,
            category: 'RELIABILITY',
          },
        ])
        .mockResolvedValueOnce([{ userId: 'user-a' }, { userId: 'user-b' }])
        .mockResolvedValueOnce([{ userId: 'user-a' }, { userId: 'user-b' }, { userId: 'user-c' }])
        .mockResolvedValueOnce([
          {
            name: 'voice.join.succeeded',
            category: 'RELIABILITY',
            level: 'INFO',
            success: true,
            durationMs: 210,
            receivedAt: new Date('2026-03-05T08:00:00.000Z'),
          },
          {
            name: 'voice.join.failed',
            category: 'RELIABILITY',
            level: 'ERROR',
            success: false,
            durationMs: 480,
            receivedAt: new Date('2026-03-05T09:00:00.000Z'),
          },
        ]);

      const service = new AnalyticsService();
      const overview = await service.getOverview({ window: '24h' });
      const timeseries = await service.getTimeseries({ window: '24h' });

      expect(overview.reliability.voiceJoinSuccessRatePercent).toBe(50);
      expect(overview.reliability.errorRatePercent).toBe(25);
      expect(overview.usage.signupToFirstMessageRatePercent).toBe(100);
      expect(overview.usage.dau).toBe(2);
      expect(overview.usage.wau).toBe(3);

      expect(timeseries.interval).toBe('hourly');
      expect(timeseries.points.some((point) => point.totalEvents > 0)).toBe(true);
      expect(timeseries.topFailures[0]).toEqual({ name: 'voice.join.failed', count: 1 });
    } finally {
      vi.useRealTimers();
    }
  });
});
