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

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3.2 3.5 9.8v10.7h6.1v-6.4h4.8v6.4h6.1V9.8L12 3.2Zm0 2.5 6.1 4.8v8h-1.7v-6.4H7.6v6.4H5.9v-8L12 5.7Z"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
    </svg>
  );
}

function JoinIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M14.7 4.8a7.5 7.5 0 1 1-5.5 13.9l1.5-1.5A5.4 5.4 0 1 0 9.2 6.7L7.7 5.2a7.5 7.5 0 0 1 7-0.4Zm-8.2 6.1h6.2V8.4l4 3.6-4 3.6v-2.5H6.5v-2.2Z"
      />
    </svg>
  );
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
        <HomeIcon />
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
          <PlusIcon />
        </button>
        <button
          className="server-rail-item action"
          onClick={onJoinServer}
          disabled={joiningServer}
          title="Join server by invite"
          aria-label="Join server by invite"
        >
          <JoinIcon />
        </button>
      </div>
    </aside>
  );
}
