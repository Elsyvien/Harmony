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


const EMPTY_MEDIA_STATS: VoiceDetailedMediaStats = {
  bitrateKbps: null,
  packets: null,
  packetsLost: null,
  jitterMs: null,
  framesPerSecond: null,
  frameWidth: null,
  frameHeight: null,
};

function normalizeMediaStats(stats: VoiceDetailedMediaStats | null | undefined): VoiceDetailedMediaStats {
  return {
    ...EMPTY_MEDIA_STATS,
    ...(stats ?? {}),
  };
}

function formatMetricWithUnit(value: number | null, unit: string, digits = 1) {
  const formatted = formatMetric(value, digits);
  return formatted === '--' ? formatted : `${formatted} ${unit}`;
}

function formatResolutionLabel(stats: VoiceDetailedMediaStats | null | undefined) {
  const media = normalizeMediaStats(stats);
  if (!media.frameWidth || !media.frameHeight) {
    return '--';
  }
  const fps = media.framesPerSecond ? ` @ ${Math.round(media.framesPerSecond)}fps` : '';
  return `${media.frameWidth}x${media.frameHeight}${fps}`;
}

function getConnectionStatusTone(connectionState: RTCPeerConnectionState, iceState: RTCIceConnectionState) {
  if (connectionState === 'failed' || iceState === 'failed') return 'bad';
  if (connectionState === 'disconnected' || iceState === 'disconnected') return 'warn';
  if (connectionState === 'connecting' || connectionState === 'new' || iceState === 'checking' || iceState === 'new') return 'pending';
  return 'good';
}

function getConnectionStatusLabel(connectionState: RTCPeerConnectionState, iceState: RTCIceConnectionState) {
  if (connectionState === 'failed' || iceState === 'failed') return 'Failed';
  if (connectionState === 'disconnected' || iceState === 'disconnected') return 'Reconnecting';
  if (connectionState === 'connecting' || connectionState === 'new' || iceState === 'checking' || iceState === 'new') return 'Connecting';
  return 'Connected';
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
  if (bitrateKbps === 24) return '24 kbps (Low)';
  if (bitrateKbps === 64) return '64 kbps (Default)';
  if (bitrateKbps === 128) return '128 kbps (High)';
  if (bitrateKbps === 1411) return '1411 kbps (CD Quality)';
  if (bitrateKbps === 1536) return '1536 kbps (Hi-Res Max)';
  return `${bitrateKbps} kbps`;
}

function formatStreamBitrateOption(bitrateKbps: number) {
  if (bitrateKbps === 500) return '500 kbps (Low)';
  if (bitrateKbps === 2500) return '2500 kbps (Default)';
  if (bitrateKbps === 6000) return '6000 kbps (High)';
  if (bitrateKbps === 10000) return '10000 kbps (Max)';
  return `${bitrateKbps} kbps`;
}

const SignalStrength = ({ quality }: { quality: 'good' | 'fair' | 'bad' | 'pending' }) => {
  const bars = [
    { height: 4, opacity: quality === 'pending' ? 0.3 : 1 },
    { height: 7, opacity: quality === 'bad' || quality === 'pending' ? 0.3 : 1 },
    { height: 10, opacity: quality === 'bad' || quality === 'fair' || quality === 'pending' ? 0.3 : 1 },
    { height: 13, opacity: quality !== 'good' ? 0.3 : 1 },
  ];

  if (quality === 'fair') {
    bars[1].opacity = 1;
    bars[2].opacity = 1;
  }

  return (
    <svg width="16" height="14" viewBox="0 0 16 14" fill="none" style={{ display: 'block' }}>
      {bars.map((bar, i) => (
        <rect
          key={i}
          x={1 + i * 4}
          y={14 - bar.height}
          width="2.5"
          height={bar.height}
          fill="currentColor"
          fillOpacity={bar.opacity}
          rx="0.5"
        />
      ))}
    </svg>
  );
};

const ScreenShareItem = memo(function ScreenShareItem({
  stream,
  label,
  isMaximized,
  onMaximize,
  onCinema,
}: {
  stream: MediaStream;
  label: string;
  isMaximized: boolean;
  onMaximize: () => void;
  onCinema?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isStalled, setIsStalled] = useState(false);
  const [isAutoplayBlocked, setIsAutoplayBlocked] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const ensurePlayback = (forceReattach = false) => {
      const node = videoRef.current;
      if (!node) return;
      if (forceReattach || node.srcObject !== stream) {
        node.srcObject = stream;
      }
      const playAttempt = node.play();
      if (playAttempt && typeof playAttempt.then === 'function') {
        void playAttempt.then(() => {
          setIsAutoplayBlocked(false);
        }).catch(() => {
          setIsAutoplayBlocked(true);
        });
      } else {
        setIsAutoplayBlocked(false);
      }
    };

    ensurePlayback();
    const onLoadedMetadata = () => ensurePlayback();
    const onCanPlay = () => {
      ensurePlayback();
      setIsStalled(false);
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('canplay', onCanPlay);

    const trackCleanup: Array<() => void> = [];
    for (const track of stream.getVideoTracks()) {
      const onUnmute = () => {
        ensurePlayback();
        setIsStalled(false);
      };
      const onEnded = () => ensurePlayback(true);
      track.addEventListener('unmute', onUnmute);
      track.addEventListener('ended', onEnded);
      trackCleanup.push(() => {
        track.removeEventListener('unmute', onUnmute);
        track.removeEventListener('ended', onEnded);
      });
    }

    const onAddTrack = () => ensurePlayback(true);
    const onRemoveTrack = () => ensurePlayback(true);
    stream.addEventListener('addtrack', onAddTrack);
    stream.addEventListener('removetrack', onRemoveTrack);

    let staleTicks = 0;
    let lastObservedTime = -1;
    const watchdog = window.setInterval(() => {
      const node = videoRef.current;
      if (!node) return;
      const hasLiveVideoTrack = stream.getVideoTracks().length > 0;
      if (!hasLiveVideoTrack) return;

      const hasRenderableFrame = node.videoWidth > 0 && node.videoHeight > 0;
      if (hasRenderableFrame && !node.paused && node.currentTime !== lastObservedTime) {
        staleTicks = 0;
        lastObservedTime = node.currentTime;
        setIsStalled(false);
        return;
      }

      staleTicks++;
      if (staleTicks >= 2) {
        setIsStalled(true);
        ensurePlayback(true);
        staleTicks = 0;
      }
    }, 1000);

    return () => {
      window.clearInterval(watchdog);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('canplay', onCanPlay);
      stream.removeEventListener('addtrack', onAddTrack);
      stream.removeEventListener('removetrack', onRemoveTrack);
      trackCleanup.forEach(c => c());
    };
  }, [stream]);

  const requestFullscreen = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (video.requestFullscreen) await video.requestFullscreen();
      else (video as any).webkitRequestFullscreen?.();
    } catch {
      return;
    }
  };

  return (
    <div
      className={`voice-screen-share-item ${isMaximized ? 'maximized' : ''} ${isAutoplayBlocked ? 'autoplay-blocked' : ''}`}
      onClick={() => {
        const video = videoRef.current;
        if (video) {
          const playAttempt = video.play();
          if (playAttempt && typeof playAttempt.then === 'function') {
            void playAttempt.then(() => setIsAutoplayBlocked(false)).catch(() => setIsAutoplayBlocked(true));
          }
        }
        onMaximize();
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
      {isStalled && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.4)',
          color: '#fff',
          fontSize: '12px',
          fontWeight: 'bold',
          backdropFilter: 'blur(4px)',
          zIndex: 5
        }}>
          Reconnecting stream...
        </div>
      )}
      <div className="voice-screen-share-overlay">
        <div className="voice-screen-share-top">
          <span className="voice-live-badge">Live</span>
          <span className="voice-screen-share-tap-hint">Zum Starten klicken</span>
        </div>
        {isAutoplayBlocked && (
          <div className="voice-screen-share-click-hint" role="status" aria-live="polite">
            Wiedergabe blockiert. Klicke auf den Stream, um ihn zu starten.
          </div>
        )}
        <div className="voice-screen-share-bottom">
          <div className="voice-screen-share-label">
            <span style={{ opacity: 0.8 }}>📺</span> {label}
          </div>
          <div className="voice-screen-share-controls">
            {onCinema && (
              <button
                className="screen-share-control-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onCinema();
                }}
                title="Cinema Mode"
                style={{ marginRight: '4px' }}
              >
                🎬
              </button>
            )}
            <button
              className="screen-share-control-btn"
              onClick={(e) => {
                e.stopPropagation();
                void requestFullscreen();
              }}
              title="Fullscreen"
            >
              ⛶
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export function VoiceChannelPanel(props: VoiceChannelPanelProps) {
  const [maximizedStreamId, setMaximizedStreamId] = useState<string | null>(null);
  const [isCinemaMode, setIsCinemaMode] = useState(false);
  const [activeTab, setActiveTab] = useState<'settings' | 'stats'>('settings');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  useEffect(() => {
    const shouldShowDetailedStats = props.joined && isDrawerOpen && activeTab === 'stats';
    if (props.showDetailedStats !== shouldShowDetailedStats) {
      props.onToggleDetailedStats();
    }
  }, [activeTab, isDrawerOpen, props.joined, props.showDetailedStats, props.onToggleDetailedStats]);

  const speakingSet = new Set(props.speakingUserIds);

  const hasLiveVideoTrack = (stream: MediaStream | null | undefined) =>
    Boolean(stream && stream.getVideoTracks().length > 0);

  const hasLocalShare =
    props.localStreamSource !== null &&
    props.localScreenShareStream !== null &&
    hasLiveVideoTrack(props.localScreenShareStream);

  const visibleRemoteScreenShares = Object.entries(props.remoteScreenShares).filter(([, stream]) =>
    hasLiveVideoTrack(stream),
  );

  const hasScreenShares = hasLocalShare || visibleRemoteScreenShares.length > 0;
  const localShareTitle = props.localStreamSource === 'camera' ? 'Your Camera' : 'Your Screen';

  return (
    <section className={`voice-stage ${isDrawerOpen ? 'drawer-open' : ''}`}>
      <header className="voice-stage-header">
        <div className="voice-stage-header-left">
          <h2><span className="channel-hash">~</span>{props.channelName}</h2>
        </div>

        <div className="voice-stage-header-center">
        </div>

        <div className="voice-stage-header-right">
          {!props.joined ? (
            <button className="primary-btn" disabled={props.busy || !props.wsConnected} onClick={() => void props.onJoin()}>
              {props.busy ? '...' : 'Join Voice'}
            </button>
          ) : (
            <div className="voice-quick-actions">
              <button className="icon-action-btn" onClick={() => props.onToggleVideoShare('screen')} title="Share Screen">
                <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M21 16V4H3v12h18zm0-14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7v2h4v2H6v-2h4v-2H3a2 2 0 0 1-2-2V4c0-1.1.9-2 2-2h18z"></path></svg>
              </button>
              <button className="icon-action-btn" onClick={() => props.onToggleVideoShare('camera')} title="Share Camera">
                <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M15 8v8H5V8h10m1-2H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4V7c0-.55-.45-1-1-1z"></path></svg>
              </button>
              <button className={`icon-action-btn ${props.isMuted ? 'danger-active' : ''}`} onClick={props.onToggleMute} title={props.isMuted ? 'Unmute' : 'Mute'}>
                <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"></path><path fill="currentColor" d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"></path></svg>
              </button>
              <button className="icon-action-btn danger-action" onClick={() => void props.onLeave()} title="Disconnect">
                <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"></path></svg>
              </button>
              <div className="header-divider"></div>
              <button className={`icon-action-btn ${isDrawerOpen ? 'active' : ''}`} onClick={() => setIsDrawerOpen(!isDrawerOpen)} title="Voice Settings & Stats">
                <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.58 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"></path></svg>
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="voice-stage-body">
        <div className="voice-stage-main">
          {hasScreenShares ? (
            <>
              {!isCinemaMode && (
                <div className="voice-stream-watch-hint" role="note">
                  Live-Streams starten bei manchen Browsern erst nach einem Klick auf die Stream-Kachel.
                </div>
              )}
              <div className={`voice-screen-shares ${isCinemaMode ? 'cinema-mode' : maximizedStreamId ? 'has-maximized' : 'grid-layout'}`}>
              {isCinemaMode && (
                <button
                  style={{
                    position: 'fixed',
                    top: '20px',
                    right: '20px',
                    zIndex: 101,
                    background: 'rgba(0,0,0,0.5)',
                    color: '#fff',
                    border: '1px solid rgba(255,255,255,0.2)',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer'
                  }}
                  onClick={() => setIsCinemaMode(false)}
                >
                  ✕ Exit Cinema Mode
                </button>
              )}
              {hasLocalShare && props.localScreenShareStream && (
                <ScreenShareItem
                  stream={props.localScreenShareStream}
                  label={localShareTitle}
                  isMaximized={maximizedStreamId === 'local'}
                  onMaximize={() => setMaximizedStreamId(maximizedStreamId === 'local' ? null : 'local')}
                  onCinema={() => {
                    setMaximizedStreamId('local');
                    setIsCinemaMode(true);
                  }}
                />
              )}
              {visibleRemoteScreenShares.map(([userId, stream]) => {
                const participant = props.participants.find((p) => p.userId === userId);
                return (
                  <ScreenShareItem
                    key={userId}
                    stream={stream}
                    label={`${participant?.username ?? 'Unknown'}'s Stream`}
                    isMaximized={maximizedStreamId === userId}
                    onMaximize={() => setMaximizedStreamId(maximizedStreamId === userId ? null : userId)}
                    onCinema={() => {
                      setMaximizedStreamId(userId);
                      setIsCinemaMode(true);
                    }}
                  />
                );
              })}
              </div>
            </>
          ) : props.joined ? (
            <div className="voice-stream-empty-state">
              <div className="empty-state-text">
                <h3>No Active Stream</h3>
                <p>Share your screen or start your camera to begin a livestream.</p>
              </div>
              <div className="empty-state-actions">
                <button className="primary-btn" onClick={() => props.onToggleVideoShare('screen')}>
                  Share Screen
                </button>
                <button className="secondary-btn" onClick={() => props.onToggleVideoShare('camera')}>
                  Start Camera
                </button>
                <button className="danger-btn" onClick={() => void props.onLeave()}>
                  Leave Voice
                </button>
              </div>
            </div>
          ) : (
            <div className="voice-stream-empty-state not-joined">
              <div className="empty-state-icon">
                <svg width="48" height="48" viewBox="0 0 24 24"><path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"></path></svg>
              </div>
              <h3>Ready to join?</h3>
              <p>Join the voice channel to talk with others.</p>
              <button className="primary-btn center-join" disabled={props.busy || !props.wsConnected} onClick={() => void props.onJoin()}>
                {props.busy ? '...' : 'Join Voice Channel'}
              </button>
            </div>
          )}

          {props.joined && (
            <div className="voice-participants-filmstrip">
              {props.participants.map((participant) => {
                const isSelf = participant.userId === props.currentUserId;
                const isSpeaking = props.showVoiceActivity && speakingSet.has(participant.userId);
                const avatarUrl = resolveMediaUrl(participant.avatarUrl);
                const audioState = !isSelf ? props.getParticipantAudioState?.(participant.userId) : null;
                const stats = props.connectionStats.find(s => s.userId === participant.userId);
                const rtt = stats?.currentRttMs;
                const sfuFallbackState = props.localAudioReady ? 'connected' : 'connecting';
                const connState = stats?.connectionState || (props.joined && !isSelf ? sfuFallbackState : 'new');
                const iceState = stats?.iceConnectionState;

                let signalClass = 'good';
                if (connState === 'connecting' || connState === 'new' || iceState === 'checking') {
                  signalClass = 'pending';
                } else if (connState === 'disconnected' || connState === 'failed') {
                  signalClass = 'bad';
                } else if (rtt !== undefined && rtt !== null) {
                  if (rtt > 300) { signalClass = 'bad'; }
                  else if (rtt > 150) { signalClass = 'fair'; }
                } else if (stats && rtt === null) {
                  signalClass = 'pending';
                }

                let displayStatus = participant.deafened ? 'Deafened' : participant.muted ? 'Muted' : 'Connected';
                if (props.joined && !isSelf) {
                  if (connState === 'new' || connState === 'connecting' || iceState === 'checking') displayStatus = 'Connecting...';
                  else if (connState === 'disconnected') displayStatus = 'Reconnecting...';
                  else if (connState === 'failed') displayStatus = 'Connection Failed';
                }

                return (
                  <div
                    key={participant.userId}
                    className={`voice-participant-tile ${isSpeaking ? 'speaking' : ''} ${connState !== 'connected' && connState !== 'new' && props.joined && !isSelf ? 'reconnecting' : ''}`}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      props.onParticipantContextMenu?.(participant, { x: e.clientX, y: e.clientY });
                    }}
                  >
                    <div className="voice-participant-tile-avatar">
                      <div
                        className="avatar-inner"
                        style={{
                          backgroundColor: avatarUrl ? 'transparent' : stringToColor(participant.username),
                          backgroundImage: avatarUrl ? `url(${avatarUrl})` : 'none'
                        }}
                      >
                        {!avatarUrl && participant.username[0].toUpperCase()}
                      </div>
                      {participant.muted && (
                        <div className="status-icon muted">
                          <svg width="12" height="12" viewBox="0 0 24 24"><path fill="currentColor" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"></path></svg>
                        </div>
                      )}
                      {participant.deafened && (
                        <div className="status-icon deafened">
                          <svg width="12" height="12" viewBox="0 0 24 24"><path fill="currentColor" d="M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9z"></path></svg>
                        </div>
                      )}
                    </div>
                    <div className="voice-participant-tile-info">
                      <div className="voice-participant-tile-name">
                        {participant.username} {isSelf && '(You)'}
                      </div>
                      <div className="voice-participant-tile-status">
                        <span className={`voice-status-icon signal ${signalClass}`} title={rtt !== undefined && rtt !== null ? `Ping: ${Math.round(rtt)}ms` : 'Signal details unavailable'}>
                          <SignalStrength quality={signalClass as any} />
                        </span>
                        <span>
                          {displayStatus}
                          {audioState && ` • ${audioState.volume}%`}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {isDrawerOpen && (
          <aside className="voice-stage-drawer">
            <div className="drawer-header">
              <div className="drawer-tabs">
                <button className={activeTab === 'settings' ? 'active' : ''} onClick={() => setActiveTab('settings')}>Settings</button>
                <button className={activeTab === 'stats' ? 'active' : ''} onClick={() => setActiveTab('stats')}>Stats</button>
              </div>
              <button className="ghost-btn small" onClick={() => setIsDrawerOpen(false)}>✕</button>
            </div>

            <div className="drawer-content">
              {activeTab === 'settings' && (
                <div className="drawer-settings">
                  <div className="voice-setting-col">
                    <label className="voice-quality-label">Voice Bitrate</label>
                    <DropdownSelect
                      options={VOICE_BITRATE_OPTIONS.map(formatVoiceBitrateOption)}
                      value={formatVoiceBitrateOption(props.voiceBitrateKbps)}
                      disabled={!props.canEditChannelBitrate || props.qualityBusy}
                      onChange={(val) => props.onVoiceBitrateChange(parseInt(val, 10))}
                    />
                  </div>
                  <div className="voice-setting-col">
                    <label className="voice-quality-label">Stream Bitrate</label>
                    <DropdownSelect
                      options={STREAM_BITRATE_OPTIONS.map(formatStreamBitrateOption)}
                      value={formatStreamBitrateOption(props.streamBitrateKbps)}
                      disabled={!props.canEditChannelBitrate || props.qualityBusy}
                      onChange={(val) => props.onStreamBitrateChange(parseInt(val, 10))}
                    />
                  </div>
                  <div className="voice-setting-col">
                    <label className="voice-quality-label">Resolution Preset</label>
                    <DropdownSelect
                      options={STREAM_QUALITY_OPTIONS}
                      value={props.streamQualityLabel}
                      disabled={!props.localScreenShareStream}
                      onChange={props.onStreamQualityChange}
                    />
                  </div>
                </div>
              )}

              {activeTab === 'stats' && (
                <div className="drawer-stats voice-stats-panel">
                  <header className="voice-stats-panel-header">
                    <div>
                      <strong>Connection Analytics</strong>
                      <small>{props.statsUpdatedAt ? `Updated ${new Date(props.statsUpdatedAt).toLocaleTimeString()}` : 'Waiting for telemetry...'}</small>
                    </div>
                    <span className="voice-stats-panel-count">{props.connectionStats.length} peer{props.connectionStats.length === 1 ? '' : 's'}</span>
                  </header>

                  {props.connectionStats.length === 0 ? (
                    <div className="voice-stats-empty" role="status" aria-live="polite">
                      <strong>No connection stats yet</strong>
                      <small>Join voice and wait a moment for browser WebRTC stats to populate.</small>
                    </div>
                  ) : (
                    <div className="voice-stats-card-list">
                      {props.connectionStats.map((stats) => {
                        const inboundAudio = normalizeMediaStats(stats.inboundAudio);
                        const outboundAudio = normalizeMediaStats(stats.outboundAudio);
                        const inboundVideo = normalizeMediaStats(stats.inboundVideo);
                        const outboundVideo = normalizeMediaStats(stats.outboundVideo);
                        const connectionState = stats.connectionState ?? 'new';
                        const iceConnectionState = stats.iceConnectionState ?? 'new';
                        const signalingState = stats.signalingState ?? 'stable';
                        const connectionTone = getConnectionStatusTone(connectionState, iceConnectionState);
                        const connectionLabel = getConnectionStatusLabel(connectionState, iceConnectionState);
                        const routeKind = stats.localCandidateType === 'sfu' || stats.remoteCandidateType === 'sfu' ? 'SFU' : 'P2P';
                        const routePath = [stats.localCandidateType, stats.remoteCandidateType].filter(Boolean).join(' -> ');

                        return (
                          <article key={stats.userId} className="voice-stats-card">
                            <header className="voice-stats-card-header">
                              <div className="voice-stats-card-title">
                                <strong>{stats.username}</strong>
                                <small>{signalingState}</small>
                              </div>
                              <div className="voice-stats-pill-row">
                                <span className={`voice-stats-pill ${connectionTone}`}>{connectionLabel}</span>
                                <span className="voice-stats-pill neutral">ICE {iceConnectionState}</span>
                                <span className="voice-stats-pill neutral">{routeKind}</span>
                              </div>
                            </header>

                            <div className="voice-stats-section">
                              <div className="voice-stats-section-title">Transport</div>
                              <div className="voice-stats-grid">
                                <div className="voice-stats-metric">
                                  <span className="voice-stats-metric-label">RTT</span>
                                  <span className="voice-stats-metric-value">{formatMetricWithUnit(stats.currentRttMs, 'ms', 1)}</span>
                                </div>
                                <div className="voice-stats-metric">
                                  <span className="voice-stats-metric-label">Out Budget</span>
                                  <span className="voice-stats-metric-value">{formatMetricWithUnit(stats.availableOutgoingBitrateKbps, 'kbps', 0)}</span>
                                </div>
                                <div className="voice-stats-metric wide">
                                  <span className="voice-stats-metric-label">Path</span>
                                  <span className="voice-stats-metric-value compact">{routePath || '--'}</span>
                                </div>
                              </div>
                            </div>

                            <div className="voice-stats-section">
                              <div className="voice-stats-section-title">Audio</div>
                              <div className="voice-stats-grid">
                                <div className="voice-stats-metric">
                                  <span className="voice-stats-metric-label">Inbound</span>
                                  <span className="voice-stats-metric-value">{formatMetricWithUnit(inboundAudio.bitrateKbps, 'kbps', 0)}</span>
                                </div>
                                <div className="voice-stats-metric">
                                  <span className="voice-stats-metric-label">Outbound</span>
                                  <span className="voice-stats-metric-value">{formatMetricWithUnit(outboundAudio.bitrateKbps, 'kbps', 0)}</span>
                                </div>
                                <div className="voice-stats-metric">
                                  <span className="voice-stats-metric-label">Loss</span>
                                  <span className="voice-stats-metric-value">{formatMetric(inboundAudio.packetsLost, 0)}</span>
                                </div>
                                <div className="voice-stats-metric">
                                  <span className="voice-stats-metric-label">Jitter</span>
                                  <span className="voice-stats-metric-value">{formatMetricWithUnit(inboundAudio.jitterMs, 'ms', 1)}</span>
                                </div>
                              </div>
                            </div>

                            <div className="voice-stats-section">
                              <div className="voice-stats-section-title">Video / Screen</div>
                              <div className="voice-stats-grid">
                                <div className="voice-stats-metric">
                                  <span className="voice-stats-metric-label">Inbound</span>
                                  <span className="voice-stats-metric-value">{formatMetricWithUnit(inboundVideo.bitrateKbps, 'kbps', 0)}</span>
                                </div>
                                <div className="voice-stats-metric">
                                  <span className="voice-stats-metric-label">Outbound</span>
                                  <span className="voice-stats-metric-value">{formatMetricWithUnit(outboundVideo.bitrateKbps, 'kbps', 0)}</span>
                                </div>
                                <div className="voice-stats-metric wide">
                                  <span className="voice-stats-metric-label">Inbound Resolution</span>
                                  <span className="voice-stats-metric-value compact">{formatResolutionLabel(inboundVideo)}</span>
                                </div>
                                <div className="voice-stats-metric wide">
                                  <span className="voice-stats-metric-label">Outbound Resolution</span>
                                  <span className="voice-stats-metric-value compact">{formatResolutionLabel(outboundVideo)}</span>
                                </div>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      <div className="voice-global-status-floating">
        {props.joined ? (
          <span className="voice-status-badge connected">● Connected</span>
        ) : props.busy ? (
          <span className="voice-status-badge connecting">Connecting...</span>
        ) : (
          <span className="voice-status-badge disconnected">Disconnected</span>
        )}
      </div>
    </section>
  );
}

