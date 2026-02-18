import type { ComponentProps, Dispatch, ReactNode, RefObject, SetStateAction } from 'react';
import { AdminSettingsPanel } from '../../../components/admin-settings-panel';
import { ChannelSidebar } from '../../../components/channel-sidebar';
import { ChatView } from '../../../components/chat-view';
import { FriendsPanel } from '../../../components/friends-panel';
import { MessageComposer } from '../../../components/message-composer';
import { SettingsPanel } from '../../../components/settings-panel';
import { UserSidebar } from '../../../components/user-sidebar';
import { VoiceChannelPanel } from '../../../components/voice-channel-panel';

type MainView = 'chat' | 'friends' | 'settings' | 'admin';
type MobilePane = 'none' | 'channels' | 'users';

type StreamStatusBanner = {
  type: 'error' | 'info';
  message: string;
};

type ActiveVoiceSession = {
  channelName: string;
  isViewingJoinedVoiceChannel: boolean;
  isDisconnecting: boolean;
  status: string;
  voiceBitrateKbps: number;
  streamBitrateKbps: number;
  remoteStreamCount: number;
  onDisconnect: () => void;
};

type ChatPageShellProps = {
  chatLayoutClassName: string;
  sidebarProps: ComponentProps<typeof ChannelSidebar>;
  activeView: MainView;
  activeChannelIsVoice: boolean;
  setMobilePane: Dispatch<SetStateAction<MobilePane>>;
  panelTitle: string;
  error: string | null;
  notice: string | null;
  streamStatusBanner: StreamStatusBanner | null;
  messageSearchInputRef: RefObject<HTMLInputElement | null>;
  messageQuery: string;
  onMessageQueryChange: (value: string) => void;
  onClearMessageQuery: () => void;
  activeVoiceSession: ActiveVoiceSession | null;
  voicePanelProps: ComponentProps<typeof VoiceChannelPanel> | null;
  chatViewProps: ComponentProps<typeof ChatView>;
  composerProps: ComponentProps<typeof MessageComposer>;
  friendsPanelProps: ComponentProps<typeof FriendsPanel>;
  settingsPanelProps: ComponentProps<typeof SettingsPanel>;
  adminPanelProps: ComponentProps<typeof AdminSettingsPanel> | null;
  userSidebarProps: ComponentProps<typeof UserSidebar>;
  children?: ReactNode;
};

export function ChatPageShell({
  chatLayoutClassName,
  sidebarProps,
  activeView,
  activeChannelIsVoice,
  setMobilePane,
  panelTitle,
  error,
  notice,
  streamStatusBanner,
  messageSearchInputRef,
  messageQuery,
  onMessageQueryChange,
  onClearMessageQuery,
  activeVoiceSession,
  voicePanelProps,
  chatViewProps,
  composerProps,
  friendsPanelProps,
  settingsPanelProps,
  adminPanelProps,
  userSidebarProps,
  children,
}: ChatPageShellProps) {
  return (
    <main className={chatLayoutClassName}>
      <ChannelSidebar {...sidebarProps} />

      <section className="chat-panel">
        <header className="panel-header">
          <div className="panel-header-main">
            {activeView === 'chat' ? (
              <button
                className="mobile-pane-toggle"
                onClick={() =>
                  setMobilePane((current) => (current === 'channels' ? 'none' : 'channels'))
                }
              >
                Channels
              </button>
            ) : null}
            <h1>{panelTitle}</h1>
            {activeView === 'chat' ? (
              <button
                className="mobile-pane-toggle"
                onClick={() => setMobilePane((current) => (current === 'users' ? 'none' : 'users'))}
              >
                Online
              </button>
            ) : null}
            {error ? <p className="error-banner">{error}</p> : null}
            {!error && notice ? <p className="info-banner">{notice}</p> : null}
            {streamStatusBanner ? (
              <p className={streamStatusBanner.type === 'error' ? 'error-banner' : 'info-banner'}>
                {streamStatusBanner.message}
              </p>
            ) : null}
          </div>
          {activeView === 'chat' && !activeChannelIsVoice ? (
            <div className="panel-tools">
              <input
                ref={messageSearchInputRef}
                className="panel-search-input"
                value={messageQuery}
                onChange={(event) => onMessageQueryChange(event.target.value)}
                placeholder="Search messages"
                aria-label="Search messages"
              />
              <span className="panel-search-hint">Ctrl/Cmd+K</span>
              {messageQuery ? (
                <button className="ghost-btn small" onClick={onClearMessageQuery}>
                  Clear
                </button>
              ) : null}
            </div>
          ) : null}
        </header>

        {activeVoiceSession && !activeVoiceSession.isViewingJoinedVoiceChannel ? (
          <div className="voice-session-bar" role="status" aria-live="polite">
            <div className="voice-session-main">
              <strong>Voice: ~{activeVoiceSession.channelName}</strong>
              <span className={`voice-session-state ${activeVoiceSession.isDisconnecting ? 'danger' : ''}`}>
                {activeVoiceSession.status}
              </span>
              <small>
                Voice {activeVoiceSession.voiceBitrateKbps} kbps • Stream {activeVoiceSession.streamBitrateKbps} kbps • {activeVoiceSession.remoteStreamCount} remote stream(s)
              </small>
            </div>
            <button
              className="ghost-btn danger small"
              disabled={activeVoiceSession.isDisconnecting}
              onClick={activeVoiceSession.onDisconnect}
            >
              {activeVoiceSession.isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        ) : null}

        {activeView === 'chat' ? (
          <>
            {activeChannelIsVoice && voicePanelProps ? (
              <VoiceChannelPanel {...voicePanelProps} />
            ) : (
              <>
                <ChatView {...chatViewProps} />
                <MessageComposer {...composerProps} />
              </>
            )}
          </>
        ) : null}

        {activeView === 'friends' ? <FriendsPanel {...friendsPanelProps} /> : null}

        {activeView === 'settings' ? <SettingsPanel {...settingsPanelProps} /> : null}

        {activeView === 'admin' && adminPanelProps ? (
          <AdminSettingsPanel {...adminPanelProps} />
        ) : null}
      </section>

      {activeView === 'chat' ? <UserSidebar {...userSidebarProps} /> : null}

      {children}
    </main>
  );
}
