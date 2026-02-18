import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaAppSettingsMock } = vi.hoisted(() => ({
  prismaAppSettingsMock: {
    upsert: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../src/repositories/prisma.js', () => ({
  prisma: {
    appSettings: prismaAppSettingsMock,
  },
}));

import { AdminSettingsService } from '../src/services/admin-settings.service.js';

const SLOW_MODE_TRACKING_MAX_ENTRIES = 10_000;

function buildSettingsRow(overrides?: Partial<{
  allowRegistrations: boolean;
  readOnlyMode: boolean;
  slowModeSeconds: number;
  idleTimeoutMinutes: number;
}>) {
  return {
    allowRegistrations: true,
    readOnlyMode: false,
    slowModeSeconds: 0,
    idleTimeoutMinutes: 15,
    ...(overrides ?? {}),
  };
}

describe('AdminSettingsService slow mode tracking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    prismaAppSettingsMock.upsert.mockReset();
    prismaAppSettingsMock.update.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads settings from the singleton app-settings row', async () => {
    prismaAppSettingsMock.upsert.mockResolvedValue(buildSettingsRow({
      readOnlyMode: true,
      slowModeSeconds: 9,
      idleTimeoutMinutes: 45,
    }));
    const service = new AdminSettingsService();

    const settings = await service.getSettings();

    expect(prismaAppSettingsMock.upsert).toHaveBeenCalledWith({
      where: { id: 'global' },
      update: {},
      create: { id: 'global' },
    });
    expect(settings).toEqual({
      allowRegistrations: true,
      readOnlyMode: true,
      slowModeSeconds: 9,
      idleTimeoutMinutes: 45,
    });
  });

  it('persists partial admin settings updates including idle timeout', async () => {
    prismaAppSettingsMock.upsert.mockResolvedValue(buildSettingsRow());
    prismaAppSettingsMock.update.mockResolvedValue(buildSettingsRow({
      allowRegistrations: false,
      idleTimeoutMinutes: 30,
    }));
    const service = new AdminSettingsService();

    const updated = await service.updateSettings({
      allowRegistrations: false,
      idleTimeoutMinutes: 30,
    });

    expect(prismaAppSettingsMock.update).toHaveBeenCalledWith({
      where: { id: 'global' },
      data: {
        allowRegistrations: false,
        idleTimeoutMinutes: 30,
      },
    });
    expect(updated).toEqual({
      allowRegistrations: false,
      readOnlyMode: false,
      slowModeSeconds: 0,
      idleTimeoutMinutes: 30,
    });
  });

  it('clears slow-mode tracking when slow mode is disabled via settings', async () => {
    prismaAppSettingsMock.upsert.mockResolvedValue(buildSettingsRow());
    prismaAppSettingsMock.update.mockResolvedValue(buildSettingsRow({
      slowModeSeconds: 0,
    }));
    const service = new AdminSettingsService();
    service.markMessageSent('user-1', 'channel-1');

    await service.updateSettings({ slowModeSeconds: 0 });

    expect(service.getSlowModeRetrySeconds('user-1', 'channel-1', 60)).toBe(0);
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
