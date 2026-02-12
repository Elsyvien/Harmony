import type { Channel } from '../types/api';
import { useState } from 'react';
import harmonyLogo from '../../ressources/logos/logo.png';

interface ChannelSidebarProps {
  channels: Channel[];
  activeChannelId: string | null;
  onSelect: (channelId: string) => void;
  unreadChannelCounts: Record<string, number>;
  activeView: 'chat' | 'friends' | 'settings' | 'admin';
  onChangeView: (view: 'chat' | 'friends' | 'settings' | 'admin') => void;
  onLogout: () => Promise<void>;
  username: string;
  isAdmin: boolean;
  onCreateChannel: (name: string, type: 'TEXT' | 'VOICE') => Promise<void>;
  onDeleteChannel: (channelId: string) => Promise<void>;
  deletingChannelId: string | null;
  activeVoiceChannelId: string | null;
  voiceParticipantCounts: Record<string, number>;
  onJoinVoice: (channelId: string) => Promise<void> | void;
  onLeaveVoice: () => Promise<void> | void;
  isSelfMuted: boolean;
  isSelfDeafened: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  joiningVoiceChannelId: string | null;
  incomingFriendRequests: number;
  avatarUrl?: string;
  ping: number | null;
}

export function ChannelSidebar(props: ChannelSidebarProps) {
  const [channelName, setChannelName] = useState('');
  const [channelType, setChannelType] = useState<'TEXT' | 'VOICE'>('TEXT');
  const [creating, setCreating] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [channelFilter, setChannelFilter] = useState('');
  const userTag = `${props.username.length}${props.username
    .split('')
    .reduce((sum, char) => sum + char.charCodeAt(0), 0) % 10000}`
    .padStart(4, '0');
  const query = channelFilter.trim().toLowerCase();
  const filteredChannels = props.channels.filter((channel) => {
    if (!query) {
      return true;
    }
    const searchableLabel = channel.isDirect
      ? (channel.directUser?.username ?? channel.name)
      : channel.name;
    return searchableLabel.toLowerCase().includes(query);
  });
  const directChannels = filteredChannels.filter((channel) => channel.isDirect);
  const textChannels = filteredChannels.filter((channel) => !channel.isDirect && !channel.isVoice);
  const voiceChannels = filteredChannels.filter((channel) => !channel.isDirect && channel.isVoice);
  const hasUnread = (channelId: string) => (props.unreadChannelCounts[channelId] ?? 0) > 0;

  return (
    <aside className="channel-sidebar">
      <header>
        <div className="channel-header-row">
          <div className="channel-brand">
            <img className="channel-brand-logo" src={harmonyLogo} alt="Harmony logo" />
            <h2>Harmony</h2>
          </div>
          {props.isAdmin ? (
            <button
              className={showCreateChannel ? 'channel-add-btn active' : 'channel-add-btn'}
              aria-label="Create channel"
              title="Create channel"
              onClick={() => setShowCreateChannel((open) => !open)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z"
                />
              </svg>
            </button>
          ) : null}
        </div>
      </header>

      <nav>
        {props.isAdmin && showCreateChannel ? (
          <form
            className="channel-create-form"
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
                await props.onCreateChannel(trimmed, channelType);
                setChannelName('');
                setChannelType('TEXT');
                setShowCreateChannel(false);
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
              {creating ? 'Adding...' : 'Add'}
            </button>
            <select
              value={channelType}
              onChange={(event) => setChannelType(event.target.value as 'TEXT' | 'VOICE')}
              disabled={creating}
            >
              <option value="TEXT">Text</option>
              <option value="VOICE">Voice</option>
            </select>
          </form>
        ) : null}

        <div className="channel-filter-wrap">
          <div className="channel-search-box">
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M15.5 14h-.79l-.28-.27A6.5 6.5 0 1 0 14 15.5l.27.28v.79L20 21.49 21.49 20zM10 15a5 5 0 1 1 0-10 5 5 0 0 1 0 10"
              />
            </svg>
            <input
              className="channel-filter-input"
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value)}
              placeholder="Search or jump to channel"
            />
          </div>
          <small className="channel-count">
            {filteredChannels.length} / {props.channels.length}
          </small>
        </div>

        {directChannels.length > 0 ? <p className="channel-group-label">Direct Messages</p> : null}
        {directChannels.map((channel) => (
          <button
            key={channel.id}
            className={
              channel.id === props.activeChannelId
                ? 'channel-item direct-channel-item active'
                : 'channel-item direct-channel-item'
            }
            onClick={() => props.onSelect(channel.id)}
          >
            <span>@{channel.directUser?.username ?? channel.name}</span>
            {hasUnread(channel.id) ? <span className="channel-unread-dot" aria-hidden="true"></span> : null}
          </button>
        ))}

        {textChannels.length > 0 ? <p className="channel-group-label">Text Channels</p> : null}
        {textChannels.map((channel) => {
          const isDeleting = props.deletingChannelId === channel.id;
          const canDelete = props.isAdmin && channel.name !== 'global';
          return (
            <div key={channel.id} className="channel-row">
              <button
                className={channel.id === props.activeChannelId ? 'channel-item active' : 'channel-item'}
                onClick={() => props.onSelect(channel.id)}
              >
                <span>#{channel.name}</span>
                {hasUnread(channel.id) ? <span className="channel-unread-dot" aria-hidden="true"></span> : null}
              </button>
              {canDelete ? (
                <button
                  className="channel-delete-btn"
                  title={`Delete #${channel.name}`}
                  aria-label={`Delete #${channel.name}`}
                  disabled={Boolean(props.deletingChannelId)}
                  onClick={async () => {
                    if (props.deletingChannelId) {
                      return;
                    }
                    const confirmed = window.confirm(
                      `Delete #${channel.name}? This will remove all channel messages.`,
                    );
                    if (!confirmed) {
                      return;
                    }
                    await props.onDeleteChannel(channel.id);
                  }}
                >
                  {isDeleting ? '...' : 'x'}
                </button>
              ) : null}
            </div>
          );
        })}

        {voiceChannels.length > 0 ? <p className="channel-group-label">Voice Channels</p> : null}
        {voiceChannels.map((channel) => {
          const isDeleting = props.deletingChannelId === channel.id;
          const canDelete = props.isAdmin;
          const isJoined = props.activeVoiceChannelId === channel.id;
          const participants = props.voiceParticipantCounts[channel.id] ?? 0;
          const isTransitioning = props.joiningVoiceChannelId === channel.id;
          const isOtherTransition =
            Boolean(props.joiningVoiceChannelId) && props.joiningVoiceChannelId !== channel.id;
          return (
            <div key={channel.id} className="channel-row">
              <button
                className={channel.id === props.activeChannelId ? 'channel-item active' : 'channel-item'}
                onClick={() => props.onSelect(channel.id)}
              >
                <span>~{channel.name}</span>
                <span className="channel-item-meta">
                  {hasUnread(channel.id) ? <span className="channel-unread-dot" aria-hidden="true"></span> : null}
                  <span className="channel-voice-count">{participants}</span>
                </span>
              </button>
              <button
                className={isJoined ? 'channel-voice-btn leave' : 'channel-voice-btn'}
                disabled={isTransitioning || isOtherTransition}
                onClick={async () => {
                  if (isJoined) {
                    await props.onLeaveVoice();
                    return;
                  }
                  await props.onJoinVoice(channel.id);
                }}
              >
                {isTransitioning ? '...' : isJoined ? 'Leave' : 'Join'}
              </button>
              {canDelete ? (
                <button
                  className="channel-delete-btn"
                  title={`Delete ~${channel.name}`}
                  aria-label={`Delete ~${channel.name}`}
                  disabled={Boolean(props.deletingChannelId)}
                  onClick={async () => {
                    if (props.deletingChannelId) {
                      return;
                    }
                    const confirmed = window.confirm(
                      `Delete ~${channel.name}? This will remove the voice channel.`,
                    );
                    if (!confirmed) {
                      return;
                    }
                    await props.onDeleteChannel(channel.id);
                  }}
                >
                  {isDeleting ? '...' : 'x'}
                </button>
              ) : null}
            </div>
          );
        })}
        {filteredChannels.length === 0 ? <p className="muted">No channels match.</p> : null}
      </nav>

      <footer>
        <div className="user-panel">
          <div className="user-info">
            <div className="user-avatar-small">
              {props.username.slice(0, 1).toUpperCase()}
              <div className="status-dot online"></div>
            </div>
            <div className="name-tag">
              <span className="username">{props.username}</span>
              {props.activeVoiceChannelId && props.ping !== null ? (
                <span className="user-ping" title={`${props.ping}ms ping`}>
                  <span className={`ping-dot ${props.ping < 100 ? 'good' : props.ping < 200 ? 'fair' : 'bad'}`}></span>
                  {props.ping}ms
                </span>
              ) : (
                <span className="user-id">#{userTag}</span>
              )}
            </div>
          </div>
          <div className="user-controls">
            <button
              className={props.isSelfMuted ? 'control-btn control-btn-mute active' : 'control-btn control-btn-mute'}
              aria-label={props.isSelfMuted ? 'Unmute microphone' : 'Mute microphone'}
              title={props.isSelfMuted ? 'Unmute' : 'Mute'}
              aria-pressed={props.isSelfMuted}
              disabled={props.isSelfDeafened}
              onClick={props.onToggleMute}
            >
              <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"></path><path fill="currentColor" d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"></path></svg>
            </button>
            <button
              className={props.isSelfDeafened ? 'control-btn control-btn-deafen active' : 'control-btn control-btn-deafen'}
              aria-label={props.isSelfDeafened ? 'Undeafen' : 'Deafen'}
              title={props.isSelfDeafened ? 'Undeafen' : 'Deafen'}
              aria-pressed={props.isSelfDeafened}
              onClick={props.onToggleDeafen}
            >
              <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9zM7 15v4H5v-4h2zm12 4h-2v-4h2v4z"></path></svg>
            </button>
            {props.isAdmin ? (
              <button
                className={props.activeView === 'admin' ? 'control-btn active' : 'control-btn'}
                aria-label="Admin settings"
                title="Admin Settings"
                onClick={() => props.onChangeView('admin')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4Zm0 4.18 5 2.22V11c0 3.87-2.47 7.63-5 8.87-2.53-1.24-5-5-5-8.87V7.4l5-2.22Z"></path></svg>
              </button>
            ) : null}
            <button
              className={props.activeView === 'friends' ? 'control-btn active' : 'control-btn'}
              aria-label="Friends"
              title="Friends"
              onClick={() => props.onChangeView('friends')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3Zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13Zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.96 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z"></path></svg>
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
