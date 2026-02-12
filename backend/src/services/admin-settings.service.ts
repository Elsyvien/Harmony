import { prisma } from '../repositories/prisma.js';

export interface AdminSettings {
  allowRegistrations: boolean;
  readOnlyMode: boolean;
  slowModeSeconds: number;
  idleTimeoutMinutes: number;
}

const SETTINGS_ID = 'global';

function keyForUserChannel(userId: string, channelId: string) {
  return `${userId}:${channelId}`;
}

export class AdminSettingsService {
  private lastMessageAtMs = new Map<string, number>();

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
    }

    return this.toSettings(updated);
  }

  getSlowModeRetrySeconds(userId: string, channelId: string, slowModeSeconds: number): number {
    if (slowModeSeconds <= 0) {
      return 0;
    }
    const key = keyForUserChannel(userId, channelId);
    const lastSent = this.lastMessageAtMs.get(key);
    if (!lastSent) {
      return 0;
    }

    const elapsedMs = Date.now() - lastSent;
    const remainingMs = slowModeSeconds * 1000 - elapsedMs;
    if (remainingMs <= 0) {
      return 0;
    }
    return Math.ceil(remainingMs / 1000);
  }

  markMessageSent(userId: string, channelId: string): void {
    const key = keyForUserChannel(userId, channelId);
    this.lastMessageAtMs.set(key, Date.now());
  }
}
