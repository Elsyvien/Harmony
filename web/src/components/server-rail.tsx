import type { ServerSummary } from '../types/api';
import type { RailScope } from '../pages/chat/utils/server-scope';
import { resolveMediaUrl } from '../utils/media-url';

interface ServerRailProps {
  servers: ServerSummary[];
  scope: RailScope;
  onSelectHome: () => void;
  onSelectServer: (serverId: string) => void;
  onCreateServer: () => void;
  onJoinServer: () => void;
  creatingServer: boolean;
  joiningServer: boolean;
}

function initialsFromName(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part.slice(0, 1))
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function ServerRail({
  servers,
  scope,
  onSelectHome,
  onSelectServer,
  onCreateServer,
  onJoinServer,
  creatingServer,
  joiningServer,
}: ServerRailProps) {
  return (
    <aside className="server-rail" aria-label="Servers">
      <button
        className={scope.kind === 'home' ? 'server-rail-item active home' : 'server-rail-item home'}
        onClick={onSelectHome}
        title="Home"
        aria-label="Home"
      >
        H
      </button>
      <div className="server-rail-divider" />
      <div className="server-rail-list">
        {servers.map((server) => {
          const iconUrl = resolveMediaUrl(server.iconUrl);
          return (
            <button
              key={server.id}
              className={
                scope.kind === 'server' && scope.serverId === server.id
                  ? 'server-rail-item active'
                  : 'server-rail-item'
              }
              onClick={() => onSelectServer(server.id)}
              title={server.name}
              aria-label={server.name}
            >
              {iconUrl ? (
                <img src={iconUrl} alt={server.name} />
              ) : (
                <span>{initialsFromName(server.name) || 'S'}</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="server-rail-actions">
        <button
          className="server-rail-item action"
          onClick={onCreateServer}
          disabled={creatingServer}
          title="Create server"
          aria-label="Create server"
        >
          +
        </button>
        <button
          className="server-rail-item action"
          onClick={onJoinServer}
          disabled={joiningServer}
          title="Join server by invite"
          aria-label="Join server by invite"
        >
          #
        </button>
      </div>
    </aside>
  );
}

