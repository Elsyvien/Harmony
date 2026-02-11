import type { Channel } from '../types/api';
import { useState } from 'react';

interface ChannelSidebarProps {
  channels: Channel[];
  activeChannelId: string | null;
  onSelect: (channelId: string) => void;
  activeView: 'chat' | 'settings' | 'admin';
  onChangeView: (view: 'chat' | 'settings' | 'admin') => void;
  onLogout: () => Promise<void>;
  username: string;
  isAdmin: boolean;
  onCreateChannel: (name: string) => Promise<void>;
}

export function ChannelSidebar(props: ChannelSidebarProps) {
  const [channelName, setChannelName] = useState('');
  const [creating, setCreating] = useState(false);
  const [channelFilter, setChannelFilter] = useState('');
  const userTag = `${props.username.length}${props.username
    .split('')
    .reduce((sum, char) => sum + char.charCodeAt(0), 0) % 10000}`
    .padStart(4, '0');
  const filteredChannels = props.channels.filter((channel) =>
    channel.name.toLowerCase().includes(channelFilter.trim().toLowerCase()),
  );

  return (
    <aside className="channel-sidebar">
      <header>
        <h2>Channels</h2>
      </header>

      <nav>
        <div className="channel-filter-wrap">
          <input
            className="channel-filter-input"
            value={channelFilter}
            onChange={(event) => setChannelFilter(event.target.value)}
            placeholder="Search channels"
          />
          <small className="channel-count">
            {filteredChannels.length} / {props.channels.length}
          </small>
        </div>

        {filteredChannels.map((channel) => (
          <button
            key={channel.id}
            className={channel.id === props.activeChannelId ? 'channel-item active' : 'channel-item'}
            onClick={() => props.onSelect(channel.id)}
          >
            # {channel.name}
          </button>
        ))}
        {filteredChannels.length === 0 ? <p className="muted">No channels match.</p> : null}
      </nav>

      {props.isAdmin ? (
        <section className="admin-menu">
          <h3>Admin Menu</h3>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (creating) {
                return;
              }
              const trimmed = channelName.trim();
              if (!trimmed) {
                return;
              }
              setCreating(true);
              try {
                await props.onCreateChannel(trimmed);
                setChannelName('');
              } finally {
                setCreating(false);
              }
            }}
          >
            <input
              value={channelName}
              onChange={(event) => setChannelName(event.target.value)}
              placeholder="new-channel"
              minLength={2}
              maxLength={64}
              disabled={creating}
            />
            <button className="ghost-btn" type="submit" disabled={creating}>
              Add channel
            </button>
          </form>
        </section>
      ) : null}

      <footer>
        <div className="user-panel">
          <div className="user-info">
             <div className="user-avatar-small">
               {props.username.slice(0, 1).toUpperCase()}
               <div className="status-dot online"></div>
             </div>
             <div className="name-tag">
               <span className="username">{props.username}</span>
               <span className="user-id">#{userTag}</span>
             </div>
          </div>
          <div className="user-controls">
            <button className="control-btn" aria-label="Mute">
              <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"></path><path fill="currentColor" d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"></path></svg>
            </button>
            <button className="control-btn" aria-label="Deafen">
              <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9zM7 15v4H5v-4h2zm12 4h-2v-4h2v4z"></path></svg>
            </button>
            <button
              className={props.activeView === 'settings' ? 'control-btn active' : 'control-btn'}
              aria-label="Settings"
              title="Settings"
              onClick={() => props.onChangeView('settings')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.58 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"></path></svg>
            </button>
          </div>
        </div>
      </footer>
    </aside>
  );
}
