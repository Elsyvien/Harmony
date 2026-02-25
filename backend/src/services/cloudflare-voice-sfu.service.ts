import { AppError } from '../utils/app-error.js';
import type {
  VoiceSfuConsumerOptions,
  VoiceSfuIceRestartResult,
  VoiceSfuProducerInfo,
  VoiceSfuProvider,
  VoiceSfuTransportDirection,
  VoiceSfuTransportOptions,
  VoiceSfuTransportStats,
} from './voice-sfu-provider.js';
import type { VoiceSfuService } from './voice-sfu.service.js';

export interface CloudflareVoiceSfuConfig {
  enabled: boolean;
  audioOnly: boolean;
  appId: string;
  appSecret: string;
  accountId: string;
  apiBaseUrl: string;
}

export class CloudflareVoiceSfuService implements VoiceSfuProvider {
  private readonly config: CloudflareVoiceSfuConfig;

  constructor(config: CloudflareVoiceSfuConfig) {
    this.config = config;
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  get audioOnly(): boolean {
    return this.config.audioOnly;
  }

  async init(): Promise<void> {
    if (!this.config.enabled) return;
    if (!this.config.appId.trim() || !this.config.appSecret.trim()) {
      throw new Error('Cloudflare SFU is enabled but CLOUDFLARE_SFU_APP_ID/CLOUDFLARE_SFU_APP_SECRET are missing');
    }
  }

  async close(): Promise<void> {
    // No persistent resources yet.
  }

  async getRouterRtpCapabilities(_channelId: string): Promise<unknown> {
    throw this.notImplemented();
  }

  async createTransport(
    _channelId: string,
    _userId: string,
    _direction: VoiceSfuTransportDirection,
  ): Promise<VoiceSfuTransportOptions> {
    throw this.notImplemented();
  }

  async connectTransport(
    _channelId: string,
    _userId: string,
    _transportId: string,
    _dtlsParameters: Parameters<VoiceSfuService['connectTransport']>[3],
  ): Promise<void> {
    throw this.notImplemented();
  }

  closeTransport(_channelId: string, _userId: string, _transportId: string): boolean {
    return false;
  }

  async produce(
    _channelId: string,
    _userId: string,
    _transportId: string,
    _kind: 'audio' | 'video',
    _rtpParameters: Parameters<VoiceSfuService['produce']>[4],
    _appData?: Record<string, unknown>,
  ): Promise<VoiceSfuProducerInfo> {
    throw this.notImplemented();
  }

  closeProducer(_channelId: string, _userId: string, _producerId: string): boolean {
    return false;
  }

  getProducerInfos(_channelId: string, _options?: { excludeUserId?: string }): VoiceSfuProducerInfo[] {
    return [];
  }

  async consume(
    _channelId: string,
    _userId: string,
    _transportId: string,
    _producerId: string,
    _rtpCapabilities: Parameters<VoiceSfuService['consume']>[4],
  ): Promise<VoiceSfuConsumerOptions> {
    throw this.notImplemented();
  }

  async resumeConsumer(_channelId: string, _userId: string, _consumerId: string): Promise<boolean> {
    throw this.notImplemented();
  }

  async restartIce(
    _channelId: string,
    _userId: string,
    _transportId: string,
  ): Promise<VoiceSfuIceRestartResult> {
    throw this.notImplemented();
  }

  getTransportStats(_channelId: string, _userId: string): VoiceSfuTransportStats[] {
    return [];
  }

  removePeer(_channelId: string, _userId: string): VoiceSfuProducerInfo[] {
    return [];
  }

  private notImplemented(): AppError {
    return new AppError(
      'SFU_PROVIDER_NOT_IMPLEMENTED',
      501,
      'Cloudflare managed SFU provider is configured but not implemented yet',
    );
  }
}
