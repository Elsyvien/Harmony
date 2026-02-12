interface VoiceChannelPanelProps {
  channelName: string;
  participants: Array<{ userId: string; username: string }>;
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
        Voice signaling is enabled. Full audio transport/WebRTC media is the next step.
      </p>

      <div className="voice-participant-list">
        {props.participants.length === 0 ? <p className="muted">No one in this voice channel yet.</p> : null}
        {props.participants.map((participant) => (
          <div key={participant.userId} className="voice-participant-item">
            <span>{participant.username}</span>
            <small>Connected</small>
          </div>
        ))}
      </div>
    </section>
  );
}
