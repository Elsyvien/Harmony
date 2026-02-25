import type { VoiceSfuEventPayload } from '../../hooks/use-chat-socket';
import type { VoiceSfuClientLike } from './voice-sfu-client';

export class CloudflareVoiceSfuClient implements VoiceSfuClientLike {
  private connected = false;

  async start(_localAudioTrack: MediaStreamTrack | null): Promise<void> {
    this.connected = false;
    throw new Error('Cloudflare managed SFU browser client is not implemented yet');
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getDetailedStats(): Promise<any[]> {
    return [];
  }

  async replaceLocalAudioTrack(_track: MediaStreamTrack | null): Promise<void> {
    return;
  }

  async replaceLocalVideoTrack(_track: MediaStreamTrack | null, _source: 'screen' | 'camera' | null): Promise<void> {
    return;
  }

  async syncProducers(): Promise<void> {
    return;
  }

  async handleSfuEvent(_payload: VoiceSfuEventPayload): Promise<void> {
    return;
  }

  stop(): void {
    this.connected = false;
  }
}