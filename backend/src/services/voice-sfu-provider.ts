import type {
  VoiceSfuConsumerOptions,
  VoiceSfuIceRestartResult,
  VoiceSfuProducerInfo,
  VoiceSfuService,
  VoiceSfuTransportDirection,
  VoiceSfuTransportOptions,
  VoiceSfuTransportStats,
} from './voice-sfu.service.js';

export type {
  VoiceSfuConsumerOptions,
  VoiceSfuIceRestartResult,
  VoiceSfuProducerInfo,
  VoiceSfuTransportDirection,
  VoiceSfuTransportOptions,
  VoiceSfuTransportStats,
};

export interface VoiceSfuProvider {
  readonly enabled: boolean;
  readonly audioOnly: boolean;
  init(): Promise<void>;
  close(): Promise<void>;
  getRouterRtpCapabilities(channelId: string): Promise<unknown>;
  createTransport(
    channelId: string,
    userId: string,
    direction: VoiceSfuTransportDirection,
  ): Promise<VoiceSfuTransportOptions>;
  connectTransport(
    channelId: string,
    userId: string,
    transportId: string,
    dtlsParameters: Parameters<VoiceSfuService['connectTransport']>[3],
  ): Promise<void>;
  closeTransport(channelId: string, userId: string, transportId: string): boolean;
  produce(
    channelId: string,
    userId: string,
    transportId: string,
    kind: 'audio' | 'video',
    rtpParameters: Parameters<VoiceSfuService['produce']>[4],
    appData?: Record<string, unknown>,
  ): Promise<VoiceSfuProducerInfo>;
  closeProducer(channelId: string, userId: string, producerId: string): boolean;
  getProducerInfos(channelId: string, options?: { excludeUserId?: string }): VoiceSfuProducerInfo[];
  consume(
    channelId: string,
    userId: string,
    transportId: string,
    producerId: string,
    rtpCapabilities: Parameters<VoiceSfuService['consume']>[4],
  ): Promise<VoiceSfuConsumerOptions>;
  resumeConsumer(channelId: string, userId: string, consumerId: string): Promise<boolean>;
  restartIce(channelId: string, userId: string, transportId: string): Promise<VoiceSfuIceRestartResult>;
  getTransportStats(channelId: string, userId: string): VoiceSfuTransportStats[];
  removePeer(channelId: string, userId: string): VoiceSfuProducerInfo[];
}
