declare module 'mediasoup' {
  export namespace types {
    type Consumer = any;
    type DtlsParameters = any;
    type IceCandidate = any;
    type IceParameters = any;
    type Producer = any;
    type Router = any;
    type RouterRtpCodecCapability = any;
    type RtpCapabilities = any;
    type RtpParameters = any;
    type SctpParameters = any;
    type WebRtcTransport = any;
    type Worker = any;
  }

  const mediasoup: {
    createWorker(options?: {
      rtcMinPort?: number;
      rtcMaxPort?: number;
      logLevel?: string;
    }): Promise<any>;
  };

  export default mediasoup;
}