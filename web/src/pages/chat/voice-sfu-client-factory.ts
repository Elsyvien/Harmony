import { CloudflareVoiceSfuClient } from './cloudflare-voice-sfu-client';
import type { VoiceSignalData } from './utils/voice-signaling';
import { VoiceSfuClient, type VoiceSfuClientLike } from './voice-sfu-client';

export type VoiceSfuProviderName = 'mediasoup' | 'cloudflare';

type MediasoupVoiceSfuClientParams = ConstructorParameters<typeof VoiceSfuClient>[0];

type CreateVoiceSfuClientParams = MediasoupVoiceSfuClientParams & {
  provider?: VoiceSfuProviderName;
  authToken?: string | null;
  channelId?: string | null;
  rtcConfiguration?: RTCConfiguration;
  sendVoiceSignalToPeer?: (targetUserId: string, data: VoiceSignalData) => boolean;
  getTargetPeerUserIds?: () => string[];
};

export function createVoiceSfuClient(params: CreateVoiceSfuClientParams): VoiceSfuClientLike {
  if (params.provider === 'cloudflare') {
    if (!params.authToken) throw new Error('Cloudflare SFU requires auth token');
    if (!params.channelId) throw new Error('Cloudflare SFU requires active channel id');
    if (!params.rtcConfiguration) throw new Error('Cloudflare SFU requires RTC configuration');
    if (!params.sendVoiceSignalToPeer || !params.getTargetPeerUserIds) {
      throw new Error('Cloudflare SFU requires voice signaling helpers');
    }
    return new CloudflareVoiceSfuClient({
      selfUserId: params.selfUserId,
      channelId: params.channelId,
      authToken: params.authToken,
      rtcConfiguration: params.rtcConfiguration,
      callbacks: params.callbacks,
      sendVoiceSignalToPeer: params.sendVoiceSignalToPeer,
      getTargetPeerUserIds: params.getTargetPeerUserIds,
    });
  }

  const {
    provider: _provider,
    authToken: _authToken,
    channelId: _channelId,
    rtcConfiguration: _rtcConfiguration,
    sendVoiceSignalToPeer: _sendVoiceSignalToPeer,
    getTargetPeerUserIds: _getTargetPeerUserIds,
    ...mediasoupParams
  } = params;
  return new VoiceSfuClient(mediasoupParams);
}