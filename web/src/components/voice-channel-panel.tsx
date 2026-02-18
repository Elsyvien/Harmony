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

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const ensurePlayback = (forceReattach = false) => {
      const node = videoRef.current;
      if (!node) return;
      if (forceReattach || node.srcObject !== stream) {
        node.srcObject = stream;
      }
      void node.play().catch(() => {
        // Autoplay may be blocked
      });
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
      
      const hasLiveVideoTrack = stream.getVideoTracks().some(t => t.readyState === 'live');
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
      className={`voice-screen-share-item ${isMaximized ? 'maximized' : ''}`}
      onClick={onMaximize}
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
        </div>
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
  const speakingSet = new Set(props.speakingUserIds);
  const [maximizedStreamId, setMaximizedStreamId] = useState<string | null>(null);
  const [isCinemaMode, setIsCinemaMode] = useState(false);
  
  const hasLiveVideoTrack = (stream: MediaStream | null | undefined) =>
    Boolean(stream?.getVideoTracks().some((track) => track.readyState === 'live'));

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
    <section className="voice-panel">
      <header className="voice-panel-header">
        <h2>{props.channelName}</h2>
        <div className="voice-panel-header-actions">
          <button
            className={`voice-action-btn ${props.isMuted ? 'danger' : ''}`}
            disabled={!props.joined}
            onClick={props.onToggleMute}
          >
            {props.isMuted ? 'Unmute' : 'Mute'}
          </button>
          <button
            className={`voice-action-btn ${props.joined ? 'danger' : 'primary'}`}
            disabled={props.busy || !props.wsConnected}
            onClick={() => props.joined ? void props.onLeave() : void props.onJoin()}
          >
            {props.busy ? '...' : props.joined ? 'Leave' : 'Join Voice'}
          </button>
        </div>
      </header>

      <div className="voice-overview-chips">
        <span className={`voice-overview-chip ${props.wsConnected ? 'ok' : 'warn'}`}>
          {props.wsConnected ? '● Connected' : '○ Disconnected'}
        </span>
        <span className="voice-overview-chip">
          Participants ({props.participants.length})
        </span>
        {hasScreenShares && (
          <span className="voice-overview-chip ok">
            Live ({visibleRemoteScreenShares.length + (hasLocalShare ? 1 : 0)})
          </span>
        )}
        <button 
          className={`voice-overview-chip ${props.showDetailedStats ? 'ok' : ''}`}
          onClick={props.onToggleDetailedStats}
          style={{ cursor: 'pointer' }}
        >
          Stats
        </button>
      </div>

      {props.showDetailedStats && (
        <section className="voice-detailed-stats">
          <header className="voice-detailed-stats-header">
            <strong>Connection Analytics</strong>
            <small>{props.statsUpdatedAt ? `Last update: ${new Date(props.statsUpdatedAt).toLocaleTimeString()}` : 'Waiting...'}</small>
          </header>
          <div className="voice-detailed-stats-grid">
            {props.connectionStats.length === 0 ? (
              <article className="voice-detailed-stat-card voice-detailed-stat-card-empty">
                <header>
                  <strong>Collecting voice stats</strong>
                  <small>Waiting for active peer transport telemetry.</small>
                </header>
              </article>
            ) : null}
            {props.connectionStats.map((stats) => (
              <article key={stats.userId} className="voice-detailed-stat-card">
                <header>
                  <strong>{stats.username}</strong>
                  <small>
                    {stats.connectionState} • {stats.iceConnectionState}
                    {(stats.localCandidateType === 'sfu' || stats.remoteCandidateType === 'sfu') && ' • SFU'}
                  </small>
                </header>
                <div className="voice-detailed-metrics">
                  <div className="voice-metric-item">
                    <label>Latency (RTT)</label>
                    <span>{formatMetric(stats.currentRttMs)} ms</span>
                  </div>
                  <div className="voice-metric-item">
                    <label>Bitrate Out</label>
                    <span>{formatMetric(stats.availableOutgoingBitrateKbps)} kbps</span>
                  </div>
                  <div className="voice-metric-item">
                    <label>Audio In/Out</label>
                    <span>{formatMetric(stats.inboundAudio.bitrateKbps)} / {formatMetric(stats.outboundAudio.bitrateKbps)} kbps</span>
                  </div>
                  <div className="voice-metric-item">
                    <label>Video In/Out</label>
                    <span>{formatMetric(stats.inboundVideo.bitrateKbps)} / {formatMetric(stats.outboundVideo.bitrateKbps)} kbps</span>
                  </div>
                  <div className="voice-metric-item">
                    <label>Video Resolution</label>
                    <span>{stats.inboundVideo.frameWidth ? `${stats.inboundVideo.frameWidth}x${stats.inboundVideo.frameHeight}` : '--'}</span>
                  </div>
                  <div className="voice-metric-item">
                    <label>Packet Loss</label>
                    <span>{formatMetric(stats.inboundAudio.packetsLost, 0)}</span>
                  </div>
                  <div className="voice-metric-item">
                    <label>Audio Jitter</label>
                    <span>{formatMetric(stats.inboundAudio.jitterMs)} ms</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {hasScreenShares && (
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
      )}

      {props.joined && !hasScreenShares && (
        <div className="voice-stream-empty-state">
          <strong>No one is streaming</strong>
          <p>Share your screen or camera to start a live broadcast in this channel.</p>
          <div className="voice-panel-header-actions" style={{ justifyContent: 'center' }}>
            <button className="voice-action-btn" onClick={() => props.onToggleVideoShare('screen')}>
              Share Screen
            </button>
            <button className="voice-action-btn" onClick={() => props.onToggleVideoShare('camera')}>
              Share Camera
            </button>
          </div>
        </div>
      )}

      {props.joined && hasScreenShares && (
        <div className="voice-panel-header-actions" style={{ justifyContent: 'center', marginTop: 4 }}>
          {hasLocalShare ? (
            <button className="voice-action-btn danger" onClick={() => props.onToggleVideoShare(props.localStreamSource ?? 'screen')}>
              Stop Sharing
            </button>
          ) : (
            <>
              <button className="voice-action-btn" onClick={() => props.onToggleVideoShare('screen')}>
                Share Screen
              </button>
              <button className="voice-action-btn" onClick={() => props.onToggleVideoShare('camera')}>
                Share Camera
              </button>
            </>
          )}
        </div>
      )}

      {props.joined && (
        <div className="voice-settings-grid">
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

      <div className="voice-participant-list">
        {props.participants.map((participant) => {
          const isSelf = participant.userId === props.currentUserId;
          const isSpeaking = props.showVoiceActivity && speakingSet.has(participant.userId);
          const avatarUrl = resolveMediaUrl(participant.avatarUrl);
          const audioState = !isSelf ? props.getParticipantAudioState?.(participant.userId) : null;
          const stats = props.connectionStats.find(s => s.userId === participant.userId);
          const rtt = stats?.currentRttMs;
          const connState = stats?.connectionState || (props.joined && !isSelf ? 'connecting' : 'new');
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

          let displayStatus = participant.deafened ? 'Deafened' : participant.muted ? 'Muted' : isSpeaking ? 'Speaking' : 'Connected';
          if (props.joined && !isSelf) {
            if (connState === 'new' || connState === 'connecting' || iceState === 'checking') displayStatus = 'Connecting...';
            else if (connState === 'disconnected') displayStatus = 'Reconnecting...';
            else if (connState === 'failed') displayStatus = 'Connection Failed';
          }

          return (
            <div
              key={participant.userId}
              className={`voice-participant-item ${isSpeaking ? 'speaking' : ''} ${connState !== 'connected' && connState !== 'new' && props.joined && !isSelf ? 'reconnecting' : ''}`}
              onContextMenu={(e) => {
                e.preventDefault();
                props.onParticipantContextMenu?.(participant, { x: e.clientX, y: e.clientY });
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                <div className="voice-participant-avatar-wrap">
                  <div
                    className="voice-participant-avatar"
                    style={{
                      backgroundColor: avatarUrl ? 'transparent' : stringToColor(participant.username),
                      backgroundImage: avatarUrl ? `url(${avatarUrl})` : 'none'
                    }}
                  >
                    {!avatarUrl && participant.username[0].toUpperCase()}
                  </div>
                </div>
                <div className="voice-participant-info">
                  <div className="voice-participant-name">
                    {participant.username} {isSelf && '(You)'}
                  </div>
                  <div className="voice-participant-status">
                    {displayStatus}
                    {audioState && ` • ${audioState.volume}%`}
                  </div>
                </div>
              </div>
              <div className="voice-participant-icons">
                <span 
                  className={`voice-status-icon signal ${signalClass}`} 
                  title={rtt !== undefined && rtt !== null ? `Ping: ${Math.round(rtt)}ms` : 'Signal details unavailable'}
                >
                  <SignalStrength quality={signalClass as any} />
                </span>
                {participant.muted && (
                  <span className="voice-status-icon muted">
                    <svg width="14" height="14" viewBox="0 0 24 24"><path fill="currentColor" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"></path></svg>
                  </span>
                )}
                {participant.deafened && (
                  <span className="voice-status-icon deafened">
                    <svg width="14" height="14" viewBox="0 0 24 24"><path fill="currentColor" d="M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9z"></path></svg>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
