import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminSettingsService } from '../src/services/admin-settings.service.js';

const SLOW_MODE_TRACKING_MAX_ENTRIES = 10_000;

describe('AdminSettingsService slow mode tracking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns retry seconds and expires naturally', () => {
    const service = new AdminSettingsService();
    service.markMessageSent('user-1', 'channel-1');

    expect(service.getSlowModeRetrySeconds('user-1', 'channel-1', 10)).toBe(10);

    vi.advanceTimersByTime(4500);
    expect(service.getSlowModeRetrySeconds('user-1', 'channel-1', 10)).toBe(6);

    vi.advanceTimersByTime(6000);
    expect(service.getSlowModeRetrySeconds('user-1', 'channel-1', 10)).toBe(0);
  });

  it('removes stale entries during cleanup', () => {
    const service = new AdminSettingsService();
    service.markMessageSent('stale-user', 'channel-1');

    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    service.markMessageSent('fresh-user', 'channel-1');

    const tracked = (service as unknown as { lastMessageAtMs: Map<string, number> }).lastMessageAtMs;
    expect(tracked.size).toBe(1);
    expect(service.getSlowModeRetrySeconds('stale-user', 'channel-1', 60)).toBe(0);
    expect(service.getSlowModeRetrySeconds('fresh-user', 'channel-1', 60)).toBe(60);
  });

  it('keeps tracking map bounded under heavy churn', () => {
    const service = new AdminSettingsService();

    for (let i = 0; i < SLOW_MODE_TRACKING_MAX_ENTRIES + 250; i += 1) {
      service.markMessageSent(`user-${i}`, 'channel-1');
    }

    const tracked = (service as unknown as { lastMessageAtMs: Map<string, number> }).lastMessageAtMs;
    expect(tracked.size).toBeLessThanOrEqual(SLOW_MODE_TRACKING_MAX_ENTRIES);
  });
});
