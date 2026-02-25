import { AppError } from '../utils/app-error.js';

export interface CloudflareRealtimeSfuApiClientConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  apiBaseUrl: string;
  timeoutMs?: number;
}

export interface CloudflareRealtimeProxyResponse<T = unknown> {
  status: number;
  body: T;
}

export class CloudflareRealtimeSfuApiClient {
  private readonly config: CloudflareRealtimeSfuApiClientConfig;

  constructor(config: CloudflareRealtimeSfuApiClientConfig) {
    this.config = config;
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  get configured(): boolean {
    return Boolean(this.config.appId.trim() && this.config.appSecret.trim());
  }

  async createSession(body: Record<string, unknown>): Promise<CloudflareRealtimeProxyResponse> {
    return this.request('POST', '/sessions/new', body);
  }

  async getSession(sessionId: string): Promise<CloudflareRealtimeProxyResponse> {
    return this.request('GET', `/sessions/${encodeURIComponent(sessionId)}`);
  }

  async addTracks(sessionId: string, body: Record<string, unknown>): Promise<CloudflareRealtimeProxyResponse> {
    return this.request('POST', `/sessions/${encodeURIComponent(sessionId)}/tracks/new`, body);
  }

  async renegotiate(sessionId: string, body: Record<string, unknown>): Promise<CloudflareRealtimeProxyResponse> {
    return this.request('PUT', `/sessions/${encodeURIComponent(sessionId)}/renegotiate`, body);
  }

  async closeTracks(sessionId: string, body: Record<string, unknown>): Promise<CloudflareRealtimeProxyResponse> {
    return this.request('PUT', `/sessions/${encodeURIComponent(sessionId)}/tracks/close`, body);
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<CloudflareRealtimeProxyResponse> {
    this.assertReady();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 10_000);
    const url = `${this.config.apiBaseUrl.replace(/\/+$/, '')}/apps/${encodeURIComponent(this.config.appId)}/sessions${path.replace(/^\/sessions/, '')}`;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.appSecret}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      let parsed: unknown = null;
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text) as unknown;
        } catch {
          parsed = { raw: text };
        }
      }

      return {
        status: response.status,
        body: parsed ?? {},
      };
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new AppError('CLOUDFLARE_SFU_TIMEOUT', 504, 'Cloudflare Serverless SFU request timed out');
      }
      throw new AppError('CLOUDFLARE_SFU_REQUEST_FAILED', 502, 'Cloudflare Serverless SFU request failed');
    } finally {
      clearTimeout(timeout);
    }
  }

  private assertReady(): void {
    if (!this.enabled) {
      throw new AppError('SFU_DISABLED', 400, 'Server-side voice transport is disabled');
    }
    if (!this.configured) {
      throw new AppError(
        'CLOUDFLARE_SFU_NOT_CONFIGURED',
        503,
        'Cloudflare Serverless SFU is not configured on the backend',
      );
    }
  }
}