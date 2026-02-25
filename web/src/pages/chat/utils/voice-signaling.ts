type StreamSource = 'screen' | 'camera';

export type VoiceSignalData =
  | { kind: 'offer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }
  | { kind: 'renegotiate' }
  | { kind: 'request-offer' }
  | { kind: 'video-source'; source: StreamSource | null }
  | { kind: 'cloudflare-sfu-session'; sessionId: string }
  | { kind: 'cloudflare-sfu-track'; op: 'upsert' | 'remove'; sessionId: string; trackName: string; mediaKind: 'audio' | 'video'; source: StreamSource | null };

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
  if (kind === 'cloudflare-sfu-session') {
    return typeof (value as { sessionId?: unknown }).sessionId === 'string';
  }
  if (kind === 'cloudflare-sfu-track') {
    const track = value as { op?: unknown; sessionId?: unknown; trackName?: unknown; mediaKind?: unknown; source?: unknown };
    const validOp = track.op === 'upsert' || track.op === 'remove';
    const validMediaKind = track.mediaKind === 'audio' || track.mediaKind === 'video';
    const validSource = track.source === 'screen' || track.source === 'camera' || track.source === null;
    return validOp && validMediaKind && validSource && typeof track.sessionId === 'string' && typeof track.trackName === 'string';
  }
  return false;
}

export function shouldInitiateOffer(localUserId: string, remoteUserId: string) {
  return localUserId < remoteUserId;
}
