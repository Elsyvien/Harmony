import { Device, type types as mediasoupTypes } from 'mediasoup-client';
import type { VoiceSfuEventPayload, VoiceSfuRequestAction } from '../../hooks/use-chat-socket';

type VoiceSfuRequest = <TData = unknown>(
  action: VoiceSfuRequestAction,
  data?: unknown,
  timeoutMs?: number,
) => Promise<TData>;

type VoiceSfuProducerInfo = {
  producerId: string;
  userId: string;
  kind: 'audio' | 'video';
  appData?: Record<string, unknown>;
};

type VoiceSfuConsumerInfo = {
  consumerId: string;
  producerId: string;
  kind: 'audio' | 'video';
  rtpParameters: mediasoupTypes.RtpParameters;
};

type VoiceSfuCallbacks = {
  onRemoteAudio: (userId: string, stream: MediaStream) => void;
  onRemoteAudioRemoved: (userId: string) => void;
  onStateChange?: (state: mediasoupTypes.ConnectionState) => void;
};

export class VoiceSfuClient {
  private readonly selfUserId: string;
  private readonly request: VoiceSfuRequest;
  private readonly callbacks: VoiceSfuCallbacks;

  private device: Device | null = null;
  private sendTransport: mediasoupTypes.Transport | null = null;
  private recvTransport: mediasoupTypes.Transport | null = null;
  private audioProducer: mediasoupTypes.Producer | null = null;
  private closed = false;

  private readonly consumerByProducerId = new Map<string, mediasoupTypes.Consumer>();
  private readonly producerOwnerById = new Map<string, string>();
  private readonly remoteStreamByUserId = new Map<string, MediaStream>();

  constructor(params: {
    selfUserId: string;
    request: VoiceSfuRequest;
    callbacks: VoiceSfuCallbacks;
  }) {
    this.selfUserId = params.selfUserId;
    this.request = params.request;
    this.callbacks = params.callbacks;
  }

  async start(localAudioTrack: MediaStreamTrack | null): Promise<void> {
    this.closed = false;
    const capabilitiesResponse = await this.request<{
      rtpCapabilities?: mediasoupTypes.RtpCapabilities;
    }>('get-rtp-capabilities');
    if (!capabilitiesResponse?.rtpCapabilities) {
      throw new Error('Missing SFU RTP capabilities');
    }

    const device = new Device();
    await device.load({ routerRtpCapabilities: capabilitiesResponse.rtpCapabilities });
    this.device = device;

    this.sendTransport = await this.createTransport('send');
    this.recvTransport = await this.createTransport('recv');

    if (localAudioTrack && device.canProduce('audio')) {
      this.audioProducer = await this.sendTransport.produce({
        track: localAudioTrack,
        appData: { type: 'voice-audio' },
      });
      this.audioProducer.on('transportclose', () => {
        this.audioProducer = null;
      });
    }

    await this.syncProducers();
  }

  async replaceLocalAudioTrack(track: MediaStreamTrack | null): Promise<void> {
    if (this.closed || !this.sendTransport || !this.device) {
      return;
    }
    if (!track) {
      if (this.audioProducer) {
        const producerId = this.audioProducer.id;
        this.audioProducer.close();
        this.audioProducer = null;
        void this.request('close-producer', { producerId }).catch(() => {});
      }
      return;
    }
    if (!this.device.canProduce('audio')) {
      return;
    }
    if (this.audioProducer) {
      await this.audioProducer.replaceTrack({ track });
      return;
    }
    this.audioProducer = await this.sendTransport.produce({
      track,
      appData: { type: 'voice-audio' },
    });
  }

  async syncProducers(): Promise<void> {
    if (this.closed) {
      return;
    }
    const response = await this.request<{
      producers?: VoiceSfuProducerInfo[];
    }>('list-producers');
    const producers = response?.producers ?? [];
    const activeProducerIds = new Set<string>();

    for (const producer of producers) {
      if (producer.userId === this.selfUserId || producer.kind !== 'audio') {
        continue;
      }
      activeProducerIds.add(producer.producerId);
      this.producerOwnerById.set(producer.producerId, producer.userId);
      await this.consumeProducer(producer.producerId, producer.userId);
    }

    for (const producerId of Array.from(this.consumerByProducerId.keys())) {
      if (activeProducerIds.has(producerId)) {
        continue;
      }
      this.removeConsumerByProducerId(producerId);
    }
  }

  async handleSfuEvent(payload: VoiceSfuEventPayload): Promise<void> {
    if (this.closed) {
      return;
    }
    if (payload.event === 'producer-added') {
      if (payload.producer.userId === this.selfUserId || payload.producer.kind !== 'audio') {
        return;
      }
      this.producerOwnerById.set(payload.producer.producerId, payload.producer.userId);
      await this.consumeProducer(payload.producer.producerId, payload.producer.userId);
      return;
    }
    this.removeConsumerByProducerId(payload.producerId);
  }

  stop() {
    this.closed = true;
    if (this.audioProducer) {
      const producerId = this.audioProducer.id;
      this.audioProducer.close();
      this.audioProducer = null;
      void this.request('close-producer', { producerId }).catch(() => {});
    }
    for (const producerId of Array.from(this.consumerByProducerId.keys())) {
      this.removeConsumerByProducerId(producerId);
    }
    this.consumerByProducerId.clear();
    this.producerOwnerById.clear();
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
  }

  private async createTransport(
    direction: 'send' | 'recv',
  ): Promise<mediasoupTypes.Transport> {
    const response = await this.request<{
      transport?: mediasoupTypes.TransportOptions;
    }>('create-transport', { direction });
    if (!response?.transport || !this.device) {
      throw new Error('Missing SFU transport options');
    }

    const transport =
      direction === 'send'
        ? this.device.createSendTransport(response.transport)
        : this.device.createRecvTransport(response.transport);

    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      void this.request('connect-transport', {
        transportId: transport.id,
        dtlsParameters,
      })
        .then(() => callback())
        .catch((err) => errback(err instanceof Error ? err : new Error(String(err))));
    });

    transport.on('connectionstatechange', (state) => {
      this.callbacks.onStateChange?.(state);
    });

    transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
      void this.request<{ producer?: VoiceSfuProducerInfo }>('produce', {
        transportId: transport.id,
        kind,
        rtpParameters,
        appData,
      })
        .then((produceResponse) => {
          const producerId = produceResponse?.producer?.producerId;
          if (!producerId) {
            throw new Error('Missing producer id');
          }
          callback({ id: producerId });
        })
        .catch((err) => errback(err instanceof Error ? err : new Error(String(err))));
    });

    return transport;
  }

  private async consumeProducer(producerId: string, userId: string): Promise<void> {
    if (this.consumerByProducerId.has(producerId) || this.closed) {
      return;
    }
    if (!this.recvTransport || !this.device) {
      return;
    }

    const response = await this.request<{
      consumer?: VoiceSfuConsumerInfo;
    }>('consume', {
      transportId: this.recvTransport.id,
      producerId,
      rtpCapabilities: this.device.rtpCapabilities,
    });
    const consumerInfo = response?.consumer;
    if (!consumerInfo) {
      return;
    }

    const consumer = await this.recvTransport.consume({
      id: consumerInfo.consumerId,
      producerId: consumerInfo.producerId,
      kind: consumerInfo.kind,
      rtpParameters: consumerInfo.rtpParameters,
      appData: {
        userId,
        producerId,
      },
    });

    this.consumerByProducerId.set(producerId, consumer);
    this.producerOwnerById.set(producerId, userId);

    consumer.on('transportclose', () => {
      this.removeConsumerByProducerId(producerId);
    });
    consumer.on('trackended', () => {
      this.removeConsumerByProducerId(producerId);
    });

    await this.request('resume-consumer', {
      consumerId: consumer.id,
    });

    const stream = new MediaStream([consumer.track]);
    this.remoteStreamByUserId.set(userId, stream);
    this.callbacks.onRemoteAudio(userId, stream);
  }

  private removeConsumerByProducerId(producerId: string) {
    const consumer = this.consumerByProducerId.get(producerId);
    if (consumer) {
      consumer.close();
      this.consumerByProducerId.delete(producerId);
    }
    const ownerUserId = this.producerOwnerById.get(producerId);
    if (!ownerUserId) {
      return;
    }
    this.producerOwnerById.delete(producerId);

    const hasRemainingProducerForUser = Array.from(this.producerOwnerById.values()).some(
      (userId) => userId === ownerUserId,
    );
    if (hasRemainingProducerForUser) {
      return;
    }

    this.remoteStreamByUserId.delete(ownerUserId);
    this.callbacks.onRemoteAudioRemoved(ownerUserId);
  }
}
