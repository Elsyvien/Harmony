import { describe, expect, it } from 'vitest';
import { getVoiceReconnectDelayMs } from '../src/pages/chat/utils/voice-reconnect';

describe('voice reconnect backoff', () => {
  it('uses exponential backoff from the base delay', () => {
    expect(getVoiceReconnectDelayMs(0)).toBe(500);
    expect(getVoiceReconnectDelayMs(1)).toBe(1000);
    expect(getVoiceReconnectDelayMs(2)).toBe(2000);
    expect(getVoiceReconnectDelayMs(3)).toBe(4000);
  });

  it('caps reconnect delay at max value', () => {
    expect(getVoiceReconnectDelayMs(10)).toBe(15000);
    expect(getVoiceReconnectDelayMs(100)).toBe(15000);
  });

  it('handles invalid input defensively', () => {
    expect(getVoiceReconnectDelayMs(-1)).toBe(500);
    expect(getVoiceReconnectDelayMs(Number.NaN)).toBe(500);
  });
});
