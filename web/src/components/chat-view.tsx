import type { Message } from '../types/api';

interface ChatViewProps {
  messages: Message[];
  loading: boolean;
  wsConnected: boolean;
  onLoadOlder: () => Promise<void>;
}

export function ChatView(props: ChatViewProps) {
  return (
    <section className="chat-view">
      <div className="chat-header">
        <div>
          <h2>Conversation</h2>
          <p>{props.wsConnected ? 'Realtime connected' : 'Polling fallback active'}</p>
        </div>
        <button className="ghost-btn" onClick={() => void props.onLoadOlder()}>
          Load older
        </button>
      </div>

      <div className="message-list">
        {props.loading ? <p className="muted">Loading messages...</p> : null}
        {!props.loading && props.messages.length === 0 ? (
          <p className="muted">No messages yet. Be the first one.</p>
        ) : null}

        {props.messages.map((message) => (
          <article key={message.id} className="message-item">
            <header>
              <strong>{message.user.username}</strong>
              <time>{new Date(message.createdAt).toLocaleString()}</time>
            </header>
            <p>{message.content}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
