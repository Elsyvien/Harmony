import type { Channel } from '../types/api';

interface ChannelSidebarProps {
  channels: Channel[];
  activeChannelId: string | null;
  onSelect: (channelId: string) => void;
  onLogout: () => Promise<void>;
  username: string;
}

export function ChannelSidebar(props: ChannelSidebarProps) {
  return (
    <aside className="channel-sidebar">
      <header>
        <h2>Channels</h2>
      </header>

      <nav>
        {props.channels.map((channel) => (
          <button
            key={channel.id}
            className={channel.id === props.activeChannelId ? 'channel-item active' : 'channel-item'}
            onClick={() => props.onSelect(channel.id)}
          >
            # {channel.name}
          </button>
        ))}
      </nav>

      <footer>
        <p className="username-pill">{props.username}</p>
        <button className="ghost-btn" onClick={() => void props.onLogout()}>
          Logout
        </button>
      </footer>
    </aside>
  );
}
