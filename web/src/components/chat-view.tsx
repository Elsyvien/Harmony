import { useEffect, useMemo, useRef, useState } from 'react';
import type { Message } from '../types/api';

interface ChatViewProps {
  activeChannelId: string | null;
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
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const previousLastMessageIdRef = useRef<string | null>(null);
  const previousMessageCountRef = useRef(0);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const lastMessageId = useMemo(
    () => (props.messages.length > 0 ? props.messages[props.messages.length - 1]?.id ?? null : null),
    [props.messages],
  );

  const isNearBottom = () => {
    const element = messageListRef.current;
    if (!element) {
      return true;
    }
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    return distanceToBottom <= 80;
  };

  const scrollToLatest = (behavior: ScrollBehavior = 'auto') => {
    const element = messageListRef.current;
    if (!element) {
      return;
    }
    element.scrollTo({ top: element.scrollHeight, behavior });
  };

  useEffect(() => {
    previousLastMessageIdRef.current = null;
    previousMessageCountRef.current = 0;
    setShowJumpToLatest(false);
  }, [props.activeChannelId]);

  useEffect(() => {
    if (!lastMessageId) {
      previousLastMessageIdRef.current = null;
      previousMessageCountRef.current = props.messages.length;
      return;
    }

    const previousLastMessageId = previousLastMessageIdRef.current;
    const previousCount = previousMessageCountRef.current;
    const isInitialChannelRender = previousLastMessageId === null;
    const hasNewLatestMessage = previousLastMessageId !== null && previousLastMessageId !== lastMessageId;
    const hasMoreMessagesThanBefore = props.messages.length > previousCount;
    const appendedNewMessage = hasNewLatestMessage && hasMoreMessagesThanBefore;

    if (isInitialChannelRender) {
      requestAnimationFrame(() => {
        scrollToLatest();
      });
      setShowJumpToLatest(false);
    } else if (appendedNewMessage) {
      if (isNearBottom()) {
        requestAnimationFrame(() => {
          scrollToLatest('smooth');
        });
        setShowJumpToLatest(false);
      } else {
        setShowJumpToLatest(true);
      }
    }

    previousLastMessageIdRef.current = lastMessageId;
    previousMessageCountRef.current = props.messages.length;
  }, [lastMessageId, props.messages.length]);

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

      <div
        ref={messageListRef}
        className="message-list"
        onScroll={() => {
          if (showJumpToLatest && isNearBottom()) {
            setShowJumpToLatest(false);
          }
        }}
      >
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

      {showJumpToLatest ? (
        <button
          className="jump-latest-btn"
          onClick={() => {
            scrollToLatest('smooth');
            setShowJumpToLatest(false);
          }}
        >
          Zur neuesten Nachricht
        </button>
      ) : null}
    </section>
  );
}
