interface VoiceChannelPanelProps {
  channelName: string;
  participants: Array<{ userId: string; username: string }>;
  currentUserId: string;
  localAudioReady: boolean;
  remoteAudioUsers: Array<{ userId: string; username: string; stream: MediaStream }>;
  joined: boolean;
  busy: boolean;
  wsConnected: boolean;
  onJoin: () => Promise<void> | void;
  onLeave: () => Promise<void> | void;
}

export function VoiceChannelPanel(props: VoiceChannelPanelProps) {
  return (
    <section className="voice-panel">
      <header className="voice-panel-header">
        <h2>Voice Channel: {props.channelName}</h2>
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
      </header>

      <p className="setting-hint">
        {props.joined
          ? props.localAudioReady
            ? 'Mic stream active. WebRTC peer transport is running.'
            : 'Joining voice... requesting microphone access.'
          : 'Join the channel to establish WebRTC voice transport.'}
      </p>

      <div className="voice-participant-list">
        {props.participants.length === 0 ? <p className="muted">No one in this voice channel yet.</p> : null}
        {props.participants.map((participant) => (
          <div key={participant.userId} className="voice-participant-item">
            <span>{participant.username}</span>
            <small>
              {participant.userId === props.currentUserId
                ? props.joined
                  ? props.localAudioReady
                    ? 'You (Mic Active)'
                    : 'You (Connecting)'
                  : 'You'
                : props.remoteAudioUsers.some((user) => user.userId === participant.userId)
                  ? 'Audio Connected'
                  : 'Signaling'}
            </small>
          </div>
        ))}
      </div>

      <div className="voice-audio-sinks" aria-hidden="true">
        {props.remoteAudioUsers.map((user) => (
          <audio
            key={user.userId}
            autoPlay
            playsInline
            ref={(node) => {
              if (!node) {
                return;
              }
              if (node.srcObject !== user.stream) {
                node.srcObject = user.stream;
              }
            }}
          />
        ))}
      </div>
    </section>
  );
}
