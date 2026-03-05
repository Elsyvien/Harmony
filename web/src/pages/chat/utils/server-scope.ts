import type { Channel, ServerSummary, UserRole } from '../../../types/api';

export type RailScope =
  | { kind: 'home' }
  | {
      kind: 'server';
      serverId: string;
    };

export function isServerManagerRole(role: UserRole | null | undefined) {
  return role === 'OWNER' || role === 'ADMIN' || role === 'MODERATOR';
}

export function findServerByScope(servers: ServerSummary[], scope: RailScope): ServerSummary | null {
  if (scope.kind !== 'server') {
    return null;
  }
  return servers.find((server) => server.id === scope.serverId) ?? null;
}

export function filterChannelsForScope(channels: Channel[], scope: RailScope): Channel[] {
  if (scope.kind === 'home') {
    return channels.filter((channel) => channel.isDirect);
  }
  return channels.filter((channel) => !channel.isDirect && channel.serverId === scope.serverId);
}

export function isChannelVisibleInScope(channel: Channel | null | undefined, scope: RailScope) {
  if (!channel) {
    return false;
  }
  if (scope.kind === 'home') {
    return channel.isDirect;
  }
  return !channel.isDirect && channel.serverId === scope.serverId;
}

export function pickFallbackChannelId(channels: Channel[], scope: RailScope): string | null {
  const inScope = filterChannelsForScope(channels, scope);
  return inScope[0]?.id ?? null;
}

