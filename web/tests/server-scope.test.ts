import { describe, expect, it } from 'vitest';
import type { Channel } from '../src/types/api';
import {
  filterChannelsForScope,
  isChannelVisibleInScope,
  isServerManagerRole,
  pickFallbackChannelId,
} from '../src/pages/chat/utils/server-scope';

function makeChannel(input: Partial<Channel> & Pick<Channel, 'id' | 'name'>): Channel {
  return {
    id: input.id,
    name: input.name,
    createdAt: input.createdAt ?? '2026-01-01T00:00:00.000Z',
    serverId: input.serverId ?? null,
    isDirect: input.isDirect ?? false,
    isVoice: input.isVoice ?? false,
    voiceBitrateKbps: input.voiceBitrateKbps ?? null,
    streamBitrateKbps: input.streamBitrateKbps ?? null,
    directUser: input.directUser ?? null,
  };
}

describe('server scope helpers', () => {
  const channels: Channel[] = [
    makeChannel({ id: 'dm-1', name: 'dm-a', isDirect: true }),
    makeChannel({ id: 'dm-2', name: 'dm-b', isDirect: true }),
    makeChannel({ id: 's1-text', name: 'general', serverId: 'server-1' }),
    makeChannel({ id: 's1-voice', name: 'voice', serverId: 'server-1', isVoice: true }),
    makeChannel({ id: 's2-text', name: 'general', serverId: 'server-2' }),
  ];

  it('filters home scope to direct channels only', () => {
    const scoped = filterChannelsForScope(channels, { kind: 'home' });
    expect(scoped.map((channel) => channel.id)).toEqual(['dm-1', 'dm-2']);
  });

  it('filters server scope to channels of selected server', () => {
    const scoped = filterChannelsForScope(channels, { kind: 'server', serverId: 'server-1' });
    expect(scoped.map((channel) => channel.id)).toEqual(['s1-text', 's1-voice']);
  });

  it('picks fallback channel id from current scope', () => {
    expect(pickFallbackChannelId(channels, { kind: 'home' })).toBe('dm-1');
    expect(pickFallbackChannelId(channels, { kind: 'server', serverId: 'server-2' })).toBe('s2-text');
    expect(pickFallbackChannelId(channels, { kind: 'server', serverId: 'missing' })).toBeNull();
  });

  it('evaluates channel visibility within scope', () => {
    const dmChannel = channels[0];
    const serverChannel = channels[2];
    expect(isChannelVisibleInScope(dmChannel, { kind: 'home' })).toBe(true);
    expect(isChannelVisibleInScope(dmChannel, { kind: 'server', serverId: 'server-1' })).toBe(false);
    expect(isChannelVisibleInScope(serverChannel, { kind: 'server', serverId: 'server-1' })).toBe(true);
  });

  it('detects server manager roles', () => {
    expect(isServerManagerRole('OWNER')).toBe(true);
    expect(isServerManagerRole('ADMIN')).toBe(true);
    expect(isServerManagerRole('MODERATOR')).toBe(true);
    expect(isServerManagerRole('MEMBER')).toBe(false);
    expect(isServerManagerRole(null)).toBe(false);
  });
});

