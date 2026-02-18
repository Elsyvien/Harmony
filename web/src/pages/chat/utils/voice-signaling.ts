type StreamSource = 'screen' | 'camera';

export type VoiceSignalData =
  | { kind: 'offer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }
  | { kind: 'renegotiate' }
  | { kind: 'request-offer' }
  | { kind: 'video-source'; source: StreamSource | null };

export function isVoiceSignalData(value: unknown): value is VoiceSignalData {
  if (!value || typeof value !== 'object' || !('kind' in value)) {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'offer' || kind === 'answer') {
    return Boolean((value as { sdp?: unknown }).sdp);
  }
  if (kind === 'ice') {
    return Boolean((value as { candidate?: unknown }).candidate);
  }
  if (kind === 'renegotiate' || kind === 'request-offer') {
    return true;
  }
  if (kind === 'video-source') {
    const source = (value as { source?: unknown }).source;
    return source === 'screen' || source === 'camera' || source === null;
  }
  return false;
}

export function shouldInitiateOffer(localUserId: string, remoteUserId: string) {
  return localUserId < remoteUserId;
}
