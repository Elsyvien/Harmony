import { useRef, useState, useEffect, memo } from 'react';
import { DropdownSelect } from './dropdown-select';

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
  onScreenShareQualityChange?: (height: number, frameRate: number) => void;
}

const ScreenShareItem = memo(function ScreenShareItem({
  stream,
  label,
  isLocal,
  isMaximized,
  onMaximize,
  onPopOut,
}: {
  stream: MediaStream;
  label: string;
  isLocal: boolean;
  isMaximized: boolean;
  onMaximize: () => void;
  onPopOut: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // When not maximized but another stream IS maximized, this component might differ visually 
  // (processed by parent classNames), but we keep the video playing.
  // To "minimize traffic" effectively in P2P without signaling, we can't do much,
  // but we can ensure we aren't using high-res rendering resources.

  return (
    <div className={`voice-screen-share-item ${isMaximized ? 'maximized' : ''}`} onClick={onMaximize}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ cursor: 'pointer' }}
      />
      <div className="voice-screen-share-overlay">
        <div className="voice-screen-share-label">{label}</div>
        <div className="voice-screen-share-controls">
          <button
            className="screen-share-control-btn"
            onClick={(e) => {
              e.stopPropagation();
              onPopOut();
            }}
            title="Pop out"
          >
            ↗
          </button>
        </div>
      </div>
    </div>
  );
});

export function VoiceChannelPanel(props: VoiceChannelPanelProps) {
  const speakingSet = new Set(props.speakingUserIds);
  const longPressTimeoutRef = useRef<number | null>(null);
  const [maximizedStreamId, setMaximizedStreamId] = useState<string | null>(null);
  // Default quality label to match initial state
  const [qualityLabel, setQualityLabel] = useState('720p 30fps');

  const clearLongPress = () => {
    if (!longPressTimeoutRef.current) {
      return;
    }
    window.clearTimeout(longPressTimeoutRef.current);
    longPressTimeoutRef.current = null;
  };

  const handlePopOut = (stream: MediaStream, title: string) => {
    const win = window.open('', '', 'width=800,height=600,menubar=no,toolbar=no,location=no,status=no');
    if (win) {
      win.document.title = title;
      win.document.body.style.margin = '0';
      win.document.body.style.backgroundColor = '#000';
      win.document.body.style.display = 'flex';
      win.document.body.style.justifyContent = 'center';
      win.document.body.style.alignItems = 'center';
      win.document.body.style.height = '100vh';

      const video = win.document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.controls = true;
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'contain';

      win.document.body.appendChild(video);
    }
  };

  const handleQualityChange = (val: string) => {
    setQualityLabel(val);
    const [res, fpsStr] = val.split(' ');
    const height = parseInt(res.replace('p', ''), 10);
    const fps = parseInt(fpsStr.replace('fps', ''), 10);
    props.onScreenShareQualityChange?.(height, fps);
  };

  const hasScreenShares = props.localScreenShareStream || Object.keys(props.remoteScreenShares).length > 0;

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

      {/* Quality Controls Section */}
      {props.joined && (
        <div className="voice-settings-grid">
          <div className="voice-setting-col">
            <label className="voice-quality-label">Voice Quality</label>
            <DropdownSelect
              options={['24 kbps (Low)', '40 kbps', '64 kbps (Default)', '96 kbps', '128 kbps (High)', '192 kbps', '256 kbps', '320 kbps', '384 kbps', '500 kbps', '640 kbps', '700 kbps', '768 kbps', '896 kbps', '1024 kbps', '1280 kbps', '1411 kbps (CD Quality)', '1536 kbps (Hi-Res Max)']}
              value={`${props.bitrateKbps} kbps${props.bitrateKbps === 24 ? ' (Low)' : props.bitrateKbps === 64 ? ' (Default)' : props.bitrateKbps === 128 ? ' (High)' : ''}`}
              onChange={(val) => {
                if (!props.canEditQuality || props.qualityBusy) {
                  return;
                }
                const bitrate = parseInt(val.split(' ')[0], 10);
                props.onBitrateChange(bitrate);
              }}
            />
            {props.qualityBusy ? <small>Saving...</small> : null}
          </div>

          {props.localScreenShareStream && (
            <div className="voice-setting-col">
              <label className="voice-quality-label">Stream Quality</label>
              <DropdownSelect
                options={['480p 15fps', '720p 30fps', '1080p 30fps', '1080p 60fps']}
                value={qualityLabel}
                onChange={handleQualityChange}
              />
            </div>
          )}
        </div>
      )}

      {/* Screen Share Layout */}
      {hasScreenShares && (
        <div className={`voice-screen-shares ${maximizedStreamId ? 'has-maximized' : 'grid-layout'}`}>
          {props.localScreenShareStream ? (
            <ScreenShareItem
              stream={props.localScreenShareStream}
              label="You are sharing"
              isLocal={true}
              isMaximized={maximizedStreamId === 'local'}
              onMaximize={() => setMaximizedStreamId(maximizedStreamId === 'local' ? null : 'local')}
              onPopOut={() => handlePopOut(props.localScreenShareStream!, 'My Screen Share')}
            />
          ) : null}
          {Object.entries(props.remoteScreenShares).map(([userId, stream]) => {
            const participant = props.participants.find((p) => p.userId === userId);
            const name = participant?.username ?? 'Unknown';
            return (
              <ScreenShareItem
                key={userId}
                stream={stream}
                label={`${name}'s Screen`}
                isLocal={false}
                isMaximized={maximizedStreamId === userId}
                onMaximize={() => setMaximizedStreamId(maximizedStreamId === userId ? null : userId)}
                onPopOut={() => handlePopOut(stream, `${name}'s Screen`)}
              />
            );
          })}
        </div>
      )}

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
