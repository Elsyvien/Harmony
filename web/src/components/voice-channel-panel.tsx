import { useRef } from 'react';

interface VoiceChannelPanelProps {
  channelName: string;
  participants: Array<{ userId: string; username: string }>;
  currentUserId: string;
  localAudioReady: boolean;
  remoteAudioUsers: Array<{ userId: string; username: string; stream: MediaStream }>;
  bitrateKbps: number;
  onBitrateChange: (bitrateKbps: number) => void;
  canEditQuality: boolean;
  qualityBusy: boolean;
  joined: boolean;
  busy: boolean;
  wsConnected: boolean;
  isMuted: boolean;
  onToggleMute: () => void;
  speakingUserIds: string[];
  showVoiceActivity: boolean;
  onJoin: () => Promise<void> | void;
  onLeave: () => Promise<void> | void;
  onParticipantContextMenu?: (
    participant: { userId: string; username: string },
    position: { x: number; y: number },
  ) => void;
  getParticipantAudioState?: (userId: string) => { volume: number; muted: boolean } | null;
  localScreenShareStream: MediaStream | null;
  remoteScreenShares: Record<string, MediaStream>;
  onToggleScreenShare: () => void;
}

export function VoiceChannelPanel(props: VoiceChannelPanelProps) {
  const speakingSet = new Set(props.speakingUserIds);
  const longPressTimeoutRef = useRef<number | null>(null);

  const clearLongPress = () => {
    if (!longPressTimeoutRef.current) {
      return;
    }
    window.clearTimeout(longPressTimeoutRef.current);
    longPressTimeoutRef.current = null;
  };

  return (
    <section className="voice-panel">
      <header className="voice-panel-header">
        <h2>Voice Channel: {props.channelName}</h2>
        <div className="voice-panel-header-actions">
          <button
            className={props.isMuted ? 'ghost-btn small danger' : 'ghost-btn small'}
            disabled={!props.joined}
            onClick={props.onToggleMute}
          >
            {props.isMuted ? 'Mic Muted' : 'Mic Live'}
          </button>
          <button
            className={props.joined ? 'ghost-btn danger' : 'ghost-btn'}
            disabled={props.busy || !props.wsConnected}
            onClick={() => {
              if (props.joined) {
                void props.onLeave();
                return;
              }
              void props.onJoin();
            }}
          >
            {props.busy ? 'Working...' : props.joined ? 'Leave Voice' : 'Join Voice'}
          </button>
          {props.joined ? (
            <button
              className={props.localScreenShareStream ? 'ghost-btn danger small' : 'ghost-btn small'}
              onClick={props.onToggleScreenShare}
              disabled={props.busy || !props.wsConnected}
              title="Share your screen"
            >
              {props.localScreenShareStream ? 'Stop Sharing' : 'Share Screen'}
            </button>
          ) : null}
        </div>
      </header>

      <p className="setting-hint">
        {props.joined
          ? props.localAudioReady
            ? props.isMuted
              ? 'Connected. Your mic is muted.'
              : 'Mic stream active. WebRTC peer transport is running.'
            : 'Joining voice... requesting microphone access.'
          : 'Join the channel to establish WebRTC voice transport.'}
      </p>

      <div className="voice-quality-row">
        <label htmlFor="voice-quality-select">Voice Quality</label>
        <select
          id="voice-quality-select"
          value={props.bitrateKbps}
          disabled={!props.canEditQuality || props.qualityBusy}
          onChange={(event) => props.onBitrateChange(Number(event.target.value))}
        >
          <option value={24}>24 kbps (Low)</option>
          <option value={40}>40 kbps</option>
          <option value={64}>64 kbps (Default)</option>
          <option value={96}>96 kbps</option>
          <option value={128}>128 kbps (High)</option>
          <option value={192}>192 kbps</option>
          <option value={256}>256 kbps</option>
          <option value={320}>320 kbps</option>
          <option value={384}>384 kbps</option>
          <option value={500}>500 kbps</option>
          <option value={640}>640 kbps</option>
          <option value={700}>700 kbps</option>
          <option value={768}>768 kbps</option>
          <option value={896}>896 kbps</option>
          <option value={1024}>1024 kbps</option>
          <option value={1280}>1280 kbps</option>
          <option value={1411}>1411 kbps (CD Quality)</option>
          <option value={1536}>1536 kbps (Hi-Res Max)</option>
        </select>
        {props.qualityBusy ? <small>Saving...</small> : null}
      </div>

      {(props.localScreenShareStream || Object.keys(props.remoteScreenShares).length > 0) ? (
        <div className="voice-screen-shares">
          {props.localScreenShareStream ? (
            <div className="voice-screen-share-item">
              <video
                autoPlay
                playsInline
                muted
                ref={(node) => {
                  if (node && node.srcObject !== props.localScreenShareStream) {
                    node.srcObject = props.localScreenShareStream;
                  }
                }}
              />
              <div className="voice-screen-share-label">You are sharing</div>
            </div>
          ) : null}
          {Object.entries(props.remoteScreenShares).map(([userId, stream]) => {
            const participant = props.participants.find((p) => p.userId === userId);
            const name = participant?.username ?? 'Unknown';
            return (
              <div key={userId} className="voice-screen-share-item">
                <video
                  autoPlay
                  playsInline
                  // Muted to avoid echo/feedback, since audio is handled by the separate voice connection.
                  // If screen-share audio is needed, it should be mixed or handled explicitly elsewhere.
                  muted
                  ref={(node) => {
                    if (node && node.srcObject !== stream) {
                      node.srcObject = stream;
                    }
                  }}
                />
                <div className="voice-screen-share-label">{name}'s Screen</div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="voice-participant-list">
        {props.participants.length === 0 ? <p className="muted">No one in this voice channel yet.</p> : null}
        {props.participants.map((participant) => {
          const isSelf = participant.userId === props.currentUserId;
          const hasAudio = props.remoteAudioUsers.some((user) => user.userId === participant.userId);
          const isSpeaking = props.showVoiceActivity && speakingSet.has(participant.userId);
          const localAudioState = !isSelf ? props.getParticipantAudioState?.(participant.userId) : null;
          return (
            <div
              key={participant.userId}
              className={`voice-participant-item ${isSpeaking ? 'speaking' : ''}`}
              onContextMenu={(event) => {
                if (!props.onParticipantContextMenu) {
                  return;
                }
                event.preventDefault();
                props.onParticipantContextMenu(participant, {
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              onTouchStart={(event) => {
                if (!props.onParticipantContextMenu) {
                  return;
                }
                const touch = event.touches[0];
                if (!touch) {
                  return;
                }
                clearLongPress();
                longPressTimeoutRef.current = window.setTimeout(() => {
                  props.onParticipantContextMenu?.(participant, {
                    x: touch.clientX,
                    y: touch.clientY,
                  });
                }, 440);
              }}
              onTouchEnd={clearLongPress}
              onTouchCancel={clearLongPress}
              onTouchMove={clearLongPress}
            >
              <span>
                {participant.username}
                {props.showVoiceActivity ? (
                  <em className={`voice-speaking-dot ${isSpeaking ? 'active' : ''}`} aria-hidden="true" />
                ) : null}
              </span>
              <small>
                {isSelf
                  ? props.joined
                    ? props.localAudioReady
                      ? props.isMuted
                        ? 'You (Muted)'
                        : isSpeaking
                          ? 'You (Speaking)'
                          : 'You (Mic Active)'
                      : 'You (Connecting)'
                    : 'You'
                  : hasAudio
                    ? isSpeaking
                      ? 'Speaking'
                      : 'Audio Connected'
                    : 'Signaling'}
                {!isSelf && localAudioState
                  ? localAudioState.muted
                    ? ' • Muted locally'
                    : ` • ${localAudioState.volume}%`
                  : ''}
              </small>
            </div>
          );
        })}
      </div>
    </section>
  );
}
