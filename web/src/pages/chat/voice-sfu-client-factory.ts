import { CloudflareVoiceSfuClient } from './cloudflare-voice-sfu-client';
import { VoiceSfuClient, type VoiceSfuClientLike } from './voice-sfu-client';

export type VoiceSfuProviderName = 'mediasoup' | 'cloudflare';

type CreateVoiceSfuClientParams = ConstructorParameters<typeof VoiceSfuClient>[0] & {
  provider?: VoiceSfuProviderName;
};

export function createVoiceSfuClient(params: CreateVoiceSfuClientParams): VoiceSfuClientLike {
  if (params.provider === 'cloudflare') {
    return new CloudflareVoiceSfuClient();
  }
  const { provider: _provider, ...mediasoupParams } = params;
  return new VoiceSfuClient(mediasoupParams);
}