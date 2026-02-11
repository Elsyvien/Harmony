import type { Message } from '../types/api';

interface ChatViewProps {
  messages: Message[];
  loading: boolean;
  wsConnected: boolean;
  onLoadOlder: () => Promise<void>;
  onUserClick?: (user: { id: string; username: string }) => void;
}

function stringToColor(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const c = (hash & 0x00ffffff).toString(16).toUpperCase();
  return '#' + '00000'.substring(0, 6 - c.length) + c;
}

export function ChatView(props: ChatViewProps) {
  return (
    <section className="chat-view">
      <div className="chat-header">
        <p className="status-indicator">
          {props.wsConnected ? (
            <span className="status-live">● Live</span>
          ) : (
            <span className="status-offline">○ Polling</span>
          )}
        </p>
        <button className="ghost-btn small" onClick={() => void props.onLoadOlder()}>
          Load older
        </button>
      </div>

      <div className="message-list">
        {props.loading ? <p className="muted">Loading messages...</p> : null}
        {!props.loading && props.messages.length === 0 ? (
          <p className="muted">No messages yet. Be the first one.</p>
        ) : null}

        {props.messages.map((message) => (
          <article
            key={message.id}
            className={`message-item${message.optimistic ? ' pending' : ''}${message.failed ? ' failed' : ''}`}
          >
            <div
              className="message-avatar"
              style={{ backgroundColor: stringToColor(message.user.username), cursor: 'pointer' }}
              onClick={() => props.onUserClick?.(message.user)}
            >
              {message.user.username.slice(0, 1).toUpperCase()}
            </div>
            <div className="message-content">
              <header>
                <strong 
                   className="message-author" 
                   style={{ cursor: 'pointer' }}
                   onClick={() => props.onUserClick?.(message.user)}
                >
                  {message.user.username}
                </strong>
                <time>{new Date(message.createdAt).toLocaleString()}</time>
                {message.optimistic ? <span className="pending-tag">Sending...</span> : null}
                {message.failed ? <span className="pending-tag failed">Failed</span> : null}
              </header>
              <p>{message.content}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
