import { prisma } from '../repositories/prisma.js';

export interface AdminSettings {
  allowRegistrations: boolean;
  readOnlyMode: boolean;
  slowModeSeconds: number;
  idleTimeoutMinutes: number;
}

const SETTINGS_ID = 'global';
const SLOW_MODE_TRACKING_MAX_ENTRIES = 10_000;
const SLOW_MODE_TRACKING_TTL_MS = 60 * 60 * 1000;
const SLOW_MODE_TRACKING_CLEANUP_INTERVAL_MS = 60 * 1000;

function keyForUserChannel(userId: string, channelId: string) {
  return `${userId}:${channelId}`;
}

export class AdminSettingsService {
  private lastMessageAtMs = new Map<string, number>();
  private lastSlowModeCleanupAtMs = 0;

  private cleanupSlowModeTracking(nowMs: number, force = false): void {
    const shouldCleanup =
      force ||
      this.lastMessageAtMs.size > SLOW_MODE_TRACKING_MAX_ENTRIES ||
      nowMs - this.lastSlowModeCleanupAtMs >= SLOW_MODE_TRACKING_CLEANUP_INTERVAL_MS;

    if (!shouldCleanup) {
      return;
    }

    this.lastSlowModeCleanupAtMs = nowMs;

    for (const [key, lastSentMs] of this.lastMessageAtMs.entries()) {
      if (nowMs - lastSentMs > SLOW_MODE_TRACKING_TTL_MS) {
        this.lastMessageAtMs.delete(key);
      }
    }

    while (this.lastMessageAtMs.size > SLOW_MODE_TRACKING_MAX_ENTRIES) {
      const oldestKey = this.lastMessageAtMs.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.lastMessageAtMs.delete(oldestKey);
    }
  }

  private async ensureSettingsRow() {
    return prisma.appSettings.upsert({
      where: { id: SETTINGS_ID },
      update: {},
      create: {
        id: SETTINGS_ID,
      },
    });
  }

  private toSettings(row: {
    allowRegistrations: boolean;
    readOnlyMode: boolean;
    slowModeSeconds: number;
    idleTimeoutMinutes: number;
  }): AdminSettings {
    return {
      allowRegistrations: row.allowRegistrations,
      readOnlyMode: row.readOnlyMode,
      slowModeSeconds: row.slowModeSeconds,
      idleTimeoutMinutes: row.idleTimeoutMinutes,
    };
  }

  async getSettings(): Promise<AdminSettings> {
    const row = await this.ensureSettingsRow();
    return this.toSettings(row);
  }

  async updateSettings(next: Partial<AdminSettings>): Promise<AdminSettings> {
    await this.ensureSettingsRow();

    const updated = await prisma.appSettings.update({
      where: { id: SETTINGS_ID },
      data: {
        ...(typeof next.allowRegistrations === 'boolean'
          ? { allowRegistrations: next.allowRegistrations }
          : {}),
        ...(typeof next.readOnlyMode === 'boolean' ? { readOnlyMode: next.readOnlyMode } : {}),
        ...(typeof next.slowModeSeconds === 'number'
          ? { slowModeSeconds: next.slowModeSeconds }
          : {}),
        ...(typeof next.idleTimeoutMinutes === 'number'
          ? { idleTimeoutMinutes: next.idleTimeoutMinutes }
          : {}),
      },
    });

    if (typeof next.slowModeSeconds === 'number' && next.slowModeSeconds <= 0) {
      this.lastMessageAtMs.clear();
      this.lastSlowModeCleanupAtMs = 0;
    }

    return this.toSettings(updated);
  }

  getSlowModeRetrySeconds(userId: string, channelId: string, slowModeSeconds: number): number {
    if (slowModeSeconds <= 0) {
      return 0;
    }
    const nowMs = Date.now();
    this.cleanupSlowModeTracking(nowMs);

    const key = keyForUserChannel(userId, channelId);
    const lastSent = this.lastMessageAtMs.get(key);
    if (!lastSent) {
      return 0;
    }

    const elapsedMs = nowMs - lastSent;
    const remainingMs = slowModeSeconds * 1000 - elapsedMs;
    if (remainingMs <= 0) {
      this.lastMessageAtMs.delete(key);
      return 0;
    }
    return Math.ceil(remainingMs / 1000);
  }

  markMessageSent(userId: string, channelId: string): void {
    const nowMs = Date.now();
    this.cleanupSlowModeTracking(nowMs);

    const key = keyForUserChannel(userId, channelId);
    if (this.lastMessageAtMs.has(key)) {
      this.lastMessageAtMs.delete(key);
    }
    this.lastMessageAtMs.set(key, nowMs);

    if (this.lastMessageAtMs.size > SLOW_MODE_TRACKING_MAX_ENTRIES) {
      this.cleanupSlowModeTracking(nowMs, true);
    }
  }
}
