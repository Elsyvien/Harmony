export interface AdminSettings {
  allowRegistrations: boolean;
  readOnlyMode: boolean;
  slowModeSeconds: number;
}

const DEFAULT_SETTINGS: AdminSettings = {
  allowRegistrations: true,
  readOnlyMode: false,
  slowModeSeconds: 0,
};

function keyForUserChannel(userId: string, channelId: string) {
  return `${userId}:${channelId}`;
}

export class AdminSettingsService {
  private settings: AdminSettings = { ...DEFAULT_SETTINGS };
  private lastMessageAtMs = new Map<string, number>();

  getSettings(): AdminSettings {
    return { ...this.settings };
  }

  updateSettings(next: Partial<AdminSettings>): AdminSettings {
    if (typeof next.allowRegistrations === 'boolean') {
      this.settings.allowRegistrations = next.allowRegistrations;
    }
    if (typeof next.readOnlyMode === 'boolean') {
      this.settings.readOnlyMode = next.readOnlyMode;
    }
    if (typeof next.slowModeSeconds === 'number') {
      this.settings.slowModeSeconds = next.slowModeSeconds;
      if (next.slowModeSeconds <= 0) {
        this.lastMessageAtMs.clear();
      }
    }

    return this.getSettings();
  }

  getSlowModeRetrySeconds(userId: string, channelId: string): number {
    if (this.settings.slowModeSeconds <= 0) {
      return 0;
    }
    const key = keyForUserChannel(userId, channelId);
    const lastSent = this.lastMessageAtMs.get(key);
    if (!lastSent) {
      return 0;
    }

    const elapsedMs = Date.now() - lastSent;
    const remainingMs = this.settings.slowModeSeconds * 1000 - elapsedMs;
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
