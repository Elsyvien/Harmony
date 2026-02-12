import { useRef, useState, useEffect, memo } from 'react';
import { DropdownSelect } from './dropdown-select';
import { resolveMediaUrl } from '../utils/media-url';

export interface VoiceDetailedMediaStats {
  bitrateKbps: number | null;
  packets: number | null;
  packetsLost: number | null;
  jitterMs: number | null;
  framesPerSecond: number | null;
  frameWidth: number | null;
  frameHeight: number | null;
}

export interface VoiceDetailedConnectionStats {
  userId: string;
  username: string;
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  signalingState: RTCSignalingState;
  currentRttMs: number | null;
  availableOutgoingBitrateKbps: number | null;
  localCandidateType: string | null;
  remoteCandidateType: string | null;
  outboundAudio: VoiceDetailedMediaStats;
  inboundAudio: VoiceDetailedMediaStats;
  outboundVideo: VoiceDetailedMediaStats;
  inboundVideo: VoiceDetailedMediaStats;
}

interface VoiceChannelPanelProps {
  channelName: string;
  participants: Array<{
    userId: string;
    username: string;
    avatarUrl?: string;
    muted?: boolean;
    deafened?: boolean;
  }>;
  currentUserId: string;
  localAudioReady: boolean;
  remoteAudioUsers: Array<{ userId: string; username: string; stream: MediaStream }>;
  voiceBitrateKbps: number;
  streamBitrateKbps: number;
  onVoiceBitrateChange: (bitrateKbps: number) => void;
  onStreamBitrateChange: (bitrateKbps: number) => void;
  canEditChannelBitrate: boolean;
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
    participant: { userId: string; username: string; avatarUrl?: string },
    position: { x: number; y: number },
  ) => void;
  getParticipantAudioState?: (userId: string) => { volume: number; muted: boolean } | null;
  localScreenShareStream: MediaStream | null;
  localStreamSource: 'screen' | 'camera' | null;
  remoteScreenShares: Record<string, MediaStream>;
  onToggleVideoShare: (source: 'screen' | 'camera') => void;
  streamQualityLabel: string;
  onStreamQualityChange: (value: string) => void;
  showDetailedStats: boolean;
  onToggleDetailedStats: () => void;
  connectionStats: VoiceDetailedConnectionStats[];
  statsUpdatedAt: number | null;
}

function stringToColor(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const c = (hash & 0x00ffffff).toString(16).toUpperCase();
  return `#${'00000'.substring(0, 6 - c.length)}${c}`;
}

function formatMetric(value: number | null, digits = 1) {
  if (value === null || Number.isNaN(value)) {
    return '--';
  }
  return value.toFixed(digits);
}

const VOICE_BITRATE_OPTIONS = [
  24, 40, 64, 96, 128, 192, 256, 320, 384, 500, 640, 700, 768, 896, 1024, 1280, 1411, 1536,
];

const STREAM_BITRATE_OPTIONS = [500, 1000, 1500, 2500, 4000, 6000, 8000, 10000];

const STREAM_QUALITY_OPTIONS = [
  '360p 15fps',
  '360p 30fps',
  '480p 15fps',
  '480p 30fps',
  '720p 15fps',
  '720p 30fps',
  '720p 60fps',
  '900p 30fps',
  '1080p 30fps',
  '1080p 60fps',
  '1440p 30fps',
  '1440p 60fps',
  '2160p 30fps',
];

function formatVoiceBitrateOption(bitrateKbps: number) {
  if (bitrateKbps === 24) {
    return '24 kbps (Low)';
  }
  if (bitrateKbps === 64) {
    return '64 kbps (Default)';
  }
  if (bitrateKbps === 128) {
    return '128 kbps (High)';
  }
  if (bitrateKbps === 1411) {
    return '1411 kbps (CD Quality)';
  }
  if (bitrateKbps === 1536) {
    return '1536 kbps (Hi-Res Max)';
  }
  return `${bitrateKbps} kbps`;
}

function formatStreamBitrateOption(bitrateKbps: number) {
  if (bitrateKbps === 500) {
    return '500 kbps (Low)';
  }
  if (bitrateKbps === 2500) {
    return '2500 kbps (Default)';
  }
  if (bitrateKbps === 6000) {
    return '6000 kbps (High)';
  }
  if (bitrateKbps === 10000) {
    return '10000 kbps (Max)';
  }
  return `${bitrateKbps} kbps`;
}

const ScreenShareItem = memo(function ScreenShareItem({
  stream,
  label,
  isMaximized,
  onMaximize,
}: {
  stream: MediaStream;
  label: string;
  isMaximized: boolean;
  onMaximize: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }
    if (videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
    }
    void videoRef.current.play().catch(() => {
      // Best effort: some browsers delay autoplay until gesture.
    });

    // Re-trigger play() when a video track unmutes (e.g. after replaceTrack
    // propagates media) so the element doesn't stay paused/black.
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      const onUnmute = () => {
        if (videoRef.current && videoRef.current.paused) {
          void videoRef.current.play().catch(() => {});
        }
      };
      videoTrack.addEventListener('unmute', onUnmute);
      return () => {
        videoTrack.removeEventListener('unmute', onUnmute);
      };
    }
  }, [stream]);

  // When not maximized but another stream IS maximized, this component might differ visually 
  // (processed by parent classNames), but we keep the video playing.
  // To "minimize traffic" effectively in P2P without signaling, we can't do much,
  // but we can ensure we aren't using high-res rendering resources.

  const requestFullscreen = async () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    try {
      if (video.requestFullscreen) {
        await video.requestFullscreen();
        return;
      }
      const legacyVideo = video as HTMLVideoElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
      };
      legacyVideo.webkitRequestFullscreen?.();
    } catch {
      // Best effort only. Some environments or policies block fullscreen.
    }
  };

  return (
    <div
      className={`voice-screen-share-item ${isMaximized ? 'maximized' : ''}`}
      onClick={onMaximize}
      onDoubleClick={() => {
        void requestFullscreen();
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        disablePictureInPicture
        style={{ cursor: 'pointer' }}
      />
      <div className="voice-screen-share-overlay">
        <div className="voice-screen-share-label">{label}</div>
        <div className="voice-screen-share-controls">
          <button
            className="screen-share-control-btn"
            onClick={(e) => {
              e.stopPropagation();
              void requestFullscreen();
            }}
            title="Fullscreen"
            aria-label="Open stream in fullscreen"
          >
            ⛶
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

  const clearLongPress = () => {
    if (!longPressTimeoutRef.current) {
      return;
    }
    window.clearTimeout(longPressTimeoutRef.current);
    longPressTimeoutRef.current = null;
  };

  const hasScreenShares =
    (props.localStreamSource === 'screen' && props.localScreenShareStream !== null) ||
    Object.keys(props.remoteScreenShares).length > 0;
  const canEditBitrates = props.canEditChannelBitrate && !props.qualityBusy;
  const localShareTitle =
    props.localStreamSource === 'camera' ? 'You are sharing your camera' : 'You are sharing your screen';

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
            <div className="voice-share-controls">
              <button
                className={props.localStreamSource === 'screen' ? 'ghost-btn danger small' : 'ghost-btn small'}
                onClick={() => props.onToggleVideoShare('screen')}
                disabled={props.busy || !props.wsConnected}
                title="Share your screen"
              >
                {props.localStreamSource === 'screen' ? 'Stop Screen' : 'Share Screen'}
              </button>
              <button
                className={props.localStreamSource === 'camera' ? 'ghost-btn danger small' : 'ghost-btn small'}
                onClick={() => props.onToggleVideoShare('camera')}
                disabled={props.busy || !props.wsConnected}
                title="Share your camera"
              >
                {props.localStreamSource === 'camera' ? 'Stop Camera' : 'Share Camera'}
              </button>
            </div>
          ) : null}
          <button
            className={props.showDetailedStats ? 'ghost-btn small active' : 'ghost-btn small'}
            disabled={!props.joined}
            onClick={props.onToggleDetailedStats}
            title="Detailed connection statistics"
          >
            Detailed Statistics
          </button>
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
              options={VOICE_BITRATE_OPTIONS.map(formatVoiceBitrateOption)}
              value={formatVoiceBitrateOption(props.voiceBitrateKbps)}
              disabled={!canEditBitrates}
              onChange={(val) => {
                if (!canEditBitrates) {
                  return;
                }
                const bitrate = parseInt(val.split(' ')[0], 10);
                props.onVoiceBitrateChange(bitrate);
              }}
            />
            {props.qualityBusy ? <small>Saving...</small> : <small>Channel-wide setting</small>}
          </div>

          <div className="voice-setting-col">
            <label className="voice-quality-label">Stream Bitrate</label>
            <DropdownSelect
              options={STREAM_BITRATE_OPTIONS.map(formatStreamBitrateOption)}
              value={formatStreamBitrateOption(props.streamBitrateKbps)}
              disabled={!canEditBitrates}
              onChange={(val) => {
                if (!canEditBitrates) {
                  return;
                }
                const bitrate = parseInt(val.split(' ')[0], 10);
                props.onStreamBitrateChange(bitrate);
              }}
            />
            {props.qualityBusy ? <small>Saving...</small> : <small>Channel-wide setting</small>}
          </div>

          <div className="voice-setting-col">
            <label className="voice-quality-label">Live Stream Resolution</label>
            <DropdownSelect
              options={STREAM_QUALITY_OPTIONS}
              value={props.streamQualityLabel}
              disabled={!props.localScreenShareStream}
              onChange={props.onStreamQualityChange}
            />
            <small>
              {props.localScreenShareStream
                ? props.localStreamSource === 'camera'
                  ? 'Applies to your camera stream'
                  : 'Applies to your screen stream'
                : 'Start a stream to apply this preset'}
            </small>
          </div>
        </div>
      )}

      {/* Screen Share Layout */}
      {hasScreenShares && (
        <div className={`voice-screen-shares ${maximizedStreamId ? 'has-maximized' : 'grid-layout'}`}>
          {props.localStreamSource === 'screen' && props.localScreenShareStream ? (
            <ScreenShareItem
              stream={props.localScreenShareStream}
              label={localShareTitle}
              isMaximized={maximizedStreamId === 'local'}
              onMaximize={() => setMaximizedStreamId(maximizedStreamId === 'local' ? null : 'local')}
            />
          ) : null}
          {Object.entries(props.remoteScreenShares).map(([userId, stream]) => {
            const participant = props.participants.find((p) => p.userId === userId);
            const name = participant?.username ?? 'Unknown';
            return (
              <ScreenShareItem
                key={userId}
                stream={stream}
                label={`${name}'s Stream`}
                isMaximized={maximizedStreamId === userId}
                onMaximize={() => setMaximizedStreamId(maximizedStreamId === userId ? null : userId)}
              />
            );
          })}
        </div>
      )}

      {props.showDetailedStats ? (
        <section className="voice-detailed-stats">
          <header className="voice-detailed-stats-header">
            <strong>Detailed Connection Statistics</strong>
            <small>
              {props.statsUpdatedAt
                ? `Updated ${new Date(props.statsUpdatedAt).toLocaleTimeString()}`
                : 'Waiting for samples...'}
            </small>
          </header>
          {props.connectionStats.length === 0 ? (
            <p className="muted">No active peer connection stats yet.</p>
          ) : (
            <div className="voice-detailed-stats-grid">
              {props.connectionStats.map((stats) => (
                <article key={stats.userId} className="voice-detailed-stat-card">
                  <header>
                    <strong>{stats.username}</strong>
                    <small>
                      {stats.connectionState} • {stats.iceConnectionState} • {stats.signalingState}
                    </small>
                  </header>
                  <div className="voice-detailed-metrics">
                    <div>
                      <label>RTT</label>
                      <span>{formatMetric(stats.currentRttMs, 1)} ms</span>
                    </div>
                    <div>
                      <label>Available Out</label>
                      <span>{formatMetric(stats.availableOutgoingBitrateKbps, 1)} kbps</span>
                    </div>
                    <div>
                      <label>Local Candidate</label>
                      <span>{stats.localCandidateType ?? '--'}</span>
                    </div>
                    <div>
                      <label>Remote Candidate</label>
                      <span>{stats.remoteCandidateType ?? '--'}</span>
                    </div>
                    <div>
                      <label>Outbound Audio</label>
                      <span>{formatMetric(stats.outboundAudio.bitrateKbps, 1)} kbps</span>
                    </div>
                    <div>
                      <label>Inbound Audio</label>
                      <span>{formatMetric(stats.inboundAudio.bitrateKbps, 1)} kbps</span>
                    </div>
                    <div>
                      <label>Inbound Audio Loss</label>
                      <span>{formatMetric(stats.inboundAudio.packetsLost, 0)}</span>
                    </div>
                    <div>
                      <label>Inbound Audio Jitter</label>
                      <span>{formatMetric(stats.inboundAudio.jitterMs, 2)} ms</span>
                    </div>
                    <div>
                      <label>Outbound Video</label>
                      <span>{formatMetric(stats.outboundVideo.bitrateKbps, 1)} kbps</span>
                    </div>
                    <div>
                      <label>Inbound Video</label>
                      <span>{formatMetric(stats.inboundVideo.bitrateKbps, 1)} kbps</span>
                    </div>
                    <div>
                      <label>Inbound Video FPS</label>
                      <span>{formatMetric(stats.inboundVideo.framesPerSecond, 1)}</span>
                    </div>
                    <div>
                      <label>Inbound Video Size</label>
                      <span>
                        {stats.inboundVideo.frameWidth && stats.inboundVideo.frameHeight
                          ? `${formatMetric(stats.inboundVideo.frameWidth, 0)}x${formatMetric(stats.inboundVideo.frameHeight, 0)}`
                          : '--'}
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <div className="voice-participant-list">
        {props.participants.length === 0 ? <p className="muted">No one in this voice channel yet.</p> : null}
        {props.participants.map((participant) => {
          const isSelf = participant.userId === props.currentUserId;
          const hasAudio = props.remoteAudioUsers.some((user) => user.userId === participant.userId);
          const isSpeaking = props.showVoiceActivity && speakingSet.has(participant.userId);
          const localAudioState = !isSelf ? props.getParticipantAudioState?.(participant.userId) : null;
          const avatarUrl = resolveMediaUrl(participant.avatarUrl);
          const remoteVoiceState = participant.deafened
            ? 'Deafened'
            : participant.muted
              ? 'Muted'
              : hasAudio
                ? isSpeaking
                  ? 'Speaking'
                  : 'Audio Connected'
                : 'Signaling';
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
              <div className="voice-participant-main">
                <div
                  className="voice-participant-avatar"
                  style={{
                    backgroundColor: avatarUrl ? 'transparent' : stringToColor(participant.username),
                  }}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={participant.username} />
                  ) : (
                    participant.username.slice(0, 1).toUpperCase()
                  )}
                </div>
                <span>
                  {participant.username}
                  {props.showVoiceActivity ? (
                    <em className={`voice-speaking-dot ${isSpeaking ? 'active' : ''}`} aria-hidden="true" />
                  ) : null}
                </span>
              </div>
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
                  : remoteVoiceState}
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
