import { describe, expect, it } from 'vitest';
import {
  isVoiceSignalData,
  shouldInitiateOffer,
} from '../src/pages/chat/utils/voice-signaling';

describe('voice signaling helpers', () => {
  it('uses deterministic initiator ordering for offer creation', () => {
    expect(shouldInitiateOffer('a-user', 'b-user')).toBe(true);
    expect(shouldInitiateOffer('b-user', 'a-user')).toBe(false);
  });

  it('accepts valid signaling payloads', () => {
    expect(isVoiceSignalData({ kind: 'offer', sdp: { type: 'offer', sdp: 'x' } })).toBe(true);
    expect(isVoiceSignalData({ kind: 'answer', sdp: { type: 'answer', sdp: 'x' } })).toBe(true);
    expect(
      isVoiceSignalData({
        kind: 'ice',
        candidate: {
          candidate: 'candidate:0 1 UDP 2122252543 10.0.0.1 12345 typ host',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
      }),
    ).toBe(true);
    expect(isVoiceSignalData({ kind: 'renegotiate' })).toBe(true);
    expect(isVoiceSignalData({ kind: 'video-source', source: 'screen' })).toBe(true);
    expect(isVoiceSignalData({ kind: 'video-source', source: null })).toBe(true);
  });

  it('rejects malformed signaling payloads', () => {
    expect(isVoiceSignalData(null)).toBe(false);
    expect(isVoiceSignalData({})).toBe(false);
    expect(isVoiceSignalData({ kind: 'offer' })).toBe(false);
    expect(isVoiceSignalData({ kind: 'ice' })).toBe(false);
    expect(isVoiceSignalData({ kind: 'video-source', source: 'desktop' })).toBe(false);
  });
});
