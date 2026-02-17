declare module 'mediasoup-client' {
  export namespace types {
    type AppData = Record<string, unknown>;
    type RtpCapabilities = unknown;
    type RtpParameters = unknown;
    type DtlsParameters = unknown;
    type IceParameters = unknown;
    type ConnectionState = 'new' | 'connecting' | 'connected' | 'failed' | 'disconnected' | 'closed';

    type Producer = {
      id: string;
      track: MediaStreamTrack | null;
      close: () => void;
      on: (event: 'transportclose', cb: () => void) => void;
      replaceTrack: (params: { track: MediaStreamTrack | null }) => Promise<void>;
    };

    type Consumer = {
      id: string;
      producerId: string;
      track: MediaStreamTrack;
      close: () => void;
      on: (event: 'transportclose' | 'producerclose' | 'trackended', cb: () => void) => void;
    };

    type TransportOptions = Record<string, unknown>;

    type Transport = {
      id: string;
      close: () => void;
      consume: (options: {
        id: string;
        producerId: string;
        kind: 'audio' | 'video';
        rtpParameters: RtpParameters;
        appData?: AppData;
      }) => Promise<Consumer>;
      produce: (options: {
        track: MediaStreamTrack;
        codecOptions?: Record<string, unknown>;
        appData?: AppData;
      }) => Promise<Producer>;
      restartIce: (params: { iceParameters: IceParameters }) => Promise<void>;
      on: (event: string, cb: (...args: any[]) => void) => void;
    };
  }

  export class Device {
    readonly rtpCapabilities: types.RtpCapabilities;
    load(options: { routerRtpCapabilities: unknown }): Promise<void>;
    canProduce(kind: 'audio' | 'video'): boolean;
    createSendTransport(options: types.TransportOptions): types.Transport;
    createRecvTransport(options: types.TransportOptions): types.Transport;
  }
}