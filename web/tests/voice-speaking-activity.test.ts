import { describe, expect, it } from 'vitest';
import {
  computeTimeDomainRms,
  getRemoteSpeakingThreshold,
  mergeSpeakingUserIds,
} from '../src/pages/chat/hooks/use-remote-speaking-activity';

describe('remote speaking helpers', () => {
  it('returns zero rms for silence samples', () => {
    const samples = new Uint8Array([128, 128, 128, 128, 128, 128]);
    expect(computeTimeDomainRms(samples)).toBe(0);
  });

  it('returns positive rms for non-silent samples', () => {
    const samples = new Uint8Array([128, 255, 0, 255, 0, 128]);
    expect(computeTimeDomainRms(samples)).toBeGreaterThan(0.5);
  });

  it('applies a minimum remote speaking threshold floor', () => {
    expect(getRemoteSpeakingThreshold(0)).toBe(0.008);
    expect(getRemoteSpeakingThreshold(Number.NaN)).toBe(0.008);
    expect(getRemoteSpeakingThreshold(0.2)).toBeCloseTo(0.15, 8);
  });

  it('keeps self and merges remote speakers in remote order', () => {
    const previous = ['self-id', 'remote-stale', 'remote-b'];
    const next = mergeSpeakingUserIds(
      previous,
      'self-id',
      ['remote-a', 'remote-b', 'remote-c'],
      new Set(['remote-c', 'remote-a']),
    );
    expect(next).toEqual(['self-id', 'remote-a', 'remote-c']);
  });
});
