declare module 'mediasoup' {
  export namespace types {
    type AppData = Record<string, unknown>;
    type DtlsParameters = Record<string, unknown>;
    type IceCandidate = Record<string, unknown>;
    type IceParameters = Record<string, unknown>;
    type RtpCapabilities = Record<string, unknown>;
    type RtpParameters = Record<string, unknown>;
    type SctpParameters = Record<string, unknown>;

    type ProducerKind = 'audio' | 'video';

    type RouterRtpCodecCapability = {
      kind: ProducerKind;
      mimeType: string;
      clockRate: number;
      channels?: number;
      parameters?: Record<string, unknown>;
    };

    type Producer = {
      id: string;
      kind: ProducerKind;
      appData: AppData;
      close: () => void;
      on: (event: 'transportclose', cb: () => void) => void;
    };

    type Consumer = {
      id: string;
      producerId: string;
      kind: ProducerKind;
      rtpParameters: RtpParameters;
      type: string;
      producerPaused: boolean;
      close: () => void;
      resume: () => Promise<void>;
      on: (event: 'transportclose' | 'producerclose', cb: () => void) => void;
    };

    type WebRtcTransport = {
      id: string;
      appData: AppData;
      iceParameters: IceParameters;
      iceCandidates: IceCandidate[];
      dtlsParameters: DtlsParameters;
      sctpParameters?: SctpParameters;
      iceState: 'new' | 'connected' | 'completed' | 'disconnected' | 'closed';
      dtlsState: 'new' | 'connecting' | 'connected' | 'failed' | 'closed';
      sctpState?: string;
      connect: (params: { dtlsParameters: DtlsParameters }) => Promise<void>;
      produce: (params: {
        kind: ProducerKind;
        rtpParameters: RtpParameters;
        appData?: AppData;
      }) => Promise<Producer>;
      consume: (params: {
        producerId: string;
        rtpCapabilities: RtpCapabilities;
        paused?: boolean;
      }) => Promise<Consumer>;
      restartIce: () => Promise<IceParameters>;
      close: () => void;
      on: {
        (event: 'icestatechange', cb: (state: WebRtcTransport['iceState']) => void): void;
        (event: 'dtlsstatechange', cb: (state: WebRtcTransport['dtlsState']) => void): void;
      };
      observer: {
        on: (event: 'close', cb: () => void) => void;
      };
    };

    type Router = {
      rtpCapabilities: RtpCapabilities;
      createWebRtcTransport: (options: {
        listenIps: Array<{ ip: string; announcedIp?: string }>;
        enableUdp: boolean;
        enableTcp: boolean;
        preferUdp: boolean;
        preferTcp: boolean;
        appData?: AppData;
        initialAvailableOutgoingBitrate?: number;
        iceConsentTimeout?: number;
      }) => Promise<WebRtcTransport>;
      canConsume: (params: { producerId: string; rtpCapabilities: RtpCapabilities }) => boolean;
      close: () => void;
    };

    type Worker = {
      createRouter: (options: { mediaCodecs: RouterRtpCodecCapability[] }) => Promise<Router>;
      close: () => Promise<void>;
      on: (event: 'died', cb: () => void) => void;
    };
  }

  const mediasoup: {
    createWorker(options?: {
      rtcMinPort?: number;
      rtcMaxPort?: number;
      logLevel?: string;
    }): Promise<types.Worker>;
  };

  export default mediasoup;
}
