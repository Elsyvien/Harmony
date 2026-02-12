import { useEffect, useMemo, useRef, useState } from 'react';
import type { Message } from '../types/api';
import { MarkdownMessage } from './markdown-message';
import { cancelSmoothScroll, smoothScrollTo } from '../utils/smooth-scroll';

interface ChatViewProps {
  activeChannelId: string | null;
  messages: Message[];
  loading: boolean;
  wsConnected: boolean;
  currentUserId?: string;
  use24HourClock?: boolean;
  showSeconds?: boolean;
  reducedMotion?: boolean;
  onLoadOlder: () => Promise<void>;
  onUserClick?: (user: { id: string; username: string }) => void;
  onMentionUser?: (user: { id: string; username: string }) => void;
  onReplyToMessage?: (message: Message) => void;
  onToggleReaction?: (messageId: string, emoji: string) => Promise<void> | void;
  onEditMessage?: (messageId: string, content: string) => Promise<void> | void;
  onDeleteMessage?: (messageId: string) => Promise<void> | void;
  canManageAllMessages?: boolean;
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
  const quickReactions = ['👍', '❤️', '😂', '😮', '😢', '🎉'];
  const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const previousLastMessageIdRef = useRef<string | null>(null);
  const previousMessageCountRef = useRef(0);
  const stickToBottomRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [messageMenu, setMessageMenu] = useState<{
    message: Message;
    x: number;
    y: number;
  } | null>(null);
  const longPressTimeoutRef = useRef<number | null>(null);
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

  const scrollToLatest = (animated: boolean) => {
    const element = messageListRef.current;
    if (!element) {
      return;
    }
    const targetTop = element.scrollHeight;
    if (!animated || props.reducedMotion) {
      cancelSmoothScroll(element);
      element.scrollTop = targetTop;
      return;
    }
    smoothScrollTo(element, targetTop, { reducedMotion: props.reducedMotion });
  };

  useEffect(() => {
    previousLastMessageIdRef.current = null;
    previousMessageCountRef.current = 0;
    setShowJumpToLatest(false);
    setMessageMenu(null);
    cancelSmoothScroll(messageListRef.current);
  }, [props.activeChannelId]);

  useEffect(() => {
    return () => {
      cancelSmoothScroll(messageListRef.current);
    };
  }, []);

  useEffect(() => {
    if (!messageMenu) {
      return;
    }
    const close = () => setMessageMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [messageMenu]);

  const clearLongPress = () => {
    if (!longPressTimeoutRef.current) {
      return;
    }
    window.clearTimeout(longPressTimeoutRef.current);
    longPressTimeoutRef.current = null;
  };

  const openMessageMenu = (message: Message, x: number, y: number) => {
    const menuWidth = 260;
    const menuHeight = 280;
    const nextX = Math.min(x, window.innerWidth - menuWidth - 8);
    const nextY = Math.min(y, window.innerHeight - menuHeight - 8);
    setMessageMenu({
      message,
      x: Math.max(8, nextX),
      y: Math.max(8, nextY),
    });
  };

  useEffect(() => {
    if (!lastMessageId) {
      previousLastMessageIdRef.current = null;
      previousMessageCountRef.current = props.messages.length;
      stickToBottomRef.current = true;
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
        scrollToLatest(false);
      });
      stickToBottomRef.current = true;
      setShowJumpToLatest(false);
    } else if (appendedNewMessage) {
      if (stickToBottomRef.current) {
        requestAnimationFrame(() => {
          scrollToLatest(true);
        });
        stickToBottomRef.current = true;
        setShowJumpToLatest(false);
      } else {
        setShowJumpToLatest(true);
      }
    }

    previousLastMessageIdRef.current = lastMessageId;
    previousMessageCountRef.current = props.messages.length;
  }, [lastMessageId, props.messages.length]);

  const formatMessageTime = (value: string) =>
    new Date(value).toLocaleString([], {
      hour12: !(props.use24HourClock ?? false),
      ...(props.showSeconds ? { second: '2-digit' as const } : {}),
    });

  const formatAttachmentSize = (size: number) => {
    if (size < 1024) {
      return `${size} B`;
    }
    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

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
          const nearBottom = isNearBottom();
          stickToBottomRef.current = nearBottom;
          if (showJumpToLatest && nearBottom) {
            setShowJumpToLatest(false);
          }
        }}
      >
        {props.loading ? <p className="muted">Loading messages...</p> : null}
        {!props.loading && props.messages.length === 0 ? (
          <p className="muted">No messages yet. Be the first one.</p>
        ) : null}

        {props.messages.map((message) => (
          (() => {
            const attachmentUrl = message.attachment?.url?.startsWith('http')
              ? message.attachment.url
              : message.attachment?.url
                ? `${apiBaseUrl}${message.attachment.url}`
                : null;
            const isImageAttachment = Boolean(
              message.attachment?.type.toLowerCase().startsWith('image/') && attachmentUrl,
            );
            const hasReactions = message.reactions.length > 0;

            return (
          <article
            key={message.id}
            className={`message-item${message.optimistic ? ' pending' : ''}${message.failed ? ' failed' : ''}`}
            onContextMenu={(event) => {
              event.preventDefault();
              openMessageMenu(message, event.clientX, event.clientY);
            }}
            onTouchStart={(event) => {
              const touch = event.touches[0];
              if (!touch) {
                return;
              }
              clearLongPress();
              longPressTimeoutRef.current = window.setTimeout(() => {
                openMessageMenu(message, touch.clientX, touch.clientY);
              }, 440);
            }}
            onTouchEnd={clearLongPress}
            onTouchCancel={clearLongPress}
            onTouchMove={clearLongPress}
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
                <time>{formatMessageTime(message.createdAt)}</time>
                {message.optimistic ? <span className="pending-tag">Sending...</span> : null}
                {message.failed ? <span className="pending-tag failed">Failed</span> : null}
              </header>
              {message.replyTo ? (
                <div className="message-reply-preview">
                  <span className="message-reply-author">@{message.replyTo.user.username}</span>
                  <span className="message-reply-content">
                    {message.replyTo.deletedAt
                      ? 'Deleted message'
                      : message.replyTo.content || '(no text)'}
                  </span>
                </div>
              ) : null}
              {message.deletedAt ? (
                <p className="message-deleted">Message deleted</p>
              ) : message.content ? (
                <MarkdownMessage content={message.content} />
              ) : null}
              {message.attachment && attachmentUrl ? (
                <a
                  className="message-attachment"
                  href={attachmentUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {isImageAttachment ? (
                    <img src={attachmentUrl} alt={message.attachment.name} className="message-attachment-preview" />
                  ) : null}
                  <span className="message-attachment-name">{message.attachment.name}</span>
                  <span className="message-attachment-meta">
                    {message.attachment.type} • {formatAttachmentSize(message.attachment.size)}
                  </span>
                </a>
              ) : null}
              {hasReactions ? (
                <div className="message-reactions">
                  {message.reactions.map((reaction) => {
                    const reactedByCurrentUser = props.currentUserId
                      ? reaction.userIds.includes(props.currentUserId)
                      : false;
                    return (
                      <button
                        key={`${message.id}:${reaction.emoji}`}
                        type="button"
                        className={`reaction-chip${reactedByCurrentUser ? ' active' : ''}`}
                        disabled={!props.onToggleReaction}
                        onClick={() => {
                          if (!props.onToggleReaction) {
                            return;
                          }
                          void props.onToggleReaction(message.id, reaction.emoji);
                        }}
                        title={`React with ${reaction.emoji}`}
                      >
                        <span>{reaction.emoji}</span>
                        <small>{reaction.userIds.length}</small>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </article>
            );
          })()
        ))}
      </div>

      {messageMenu ? (
        (() => {
          const canManageMessage =
            props.canManageAllMessages || props.currentUserId === messageMenu.message.userId;
          const canEditMessage =
            canManageMessage &&
            !messageMenu.message.deletedAt &&
            Boolean(props.onEditMessage) &&
            Boolean(messageMenu.message.content);
          const canDeleteMessage = canManageMessage && !messageMenu.message.deletedAt && Boolean(props.onDeleteMessage);
          return (
        <div
          className="message-context-menu"
          style={{ left: `${messageMenu.x}px`, top: `${messageMenu.y}px` }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="message-context-reactions">
            {quickReactions.map((emoji) => (
              <button
                key={`menu-reaction:${emoji}`}
                type="button"
                className="reaction-menu-btn"
                disabled={!props.onToggleReaction}
                onClick={() => {
                  if (!props.onToggleReaction) {
                    return;
                  }
                  void props.onToggleReaction(messageMenu.message.id, emoji);
                  setMessageMenu(null);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              props.onUserClick?.(messageMenu.message.user);
              setMessageMenu(null);
            }}
          >
            Open Profile
          </button>
          <button
            onClick={() => {
              props.onMentionUser?.(messageMenu.message.user);
              setMessageMenu(null);
            }}
            disabled={!props.onMentionUser}
          >
            Mention User
          </button>
          <button
            onClick={() => {
              props.onReplyToMessage?.(messageMenu.message);
              setMessageMenu(null);
            }}
            disabled={!props.onReplyToMessage}
          >
            Reply
          </button>
          <button
            onClick={() => {
              if (!canEditMessage || !props.onEditMessage) {
                return;
              }
              const currentContent = messageMenu.message.content;
              const nextContent = window.prompt('Edit message', currentContent);
              if (nextContent === null) {
                return;
              }
              const trimmed = nextContent.trim();
              if (!trimmed || trimmed === currentContent) {
                setMessageMenu(null);
                return;
              }
              void props.onEditMessage(messageMenu.message.id, trimmed);
              setMessageMenu(null);
            }}
            disabled={!canEditMessage}
          >
            Edit Message
          </button>
          <button
            className="danger"
            onClick={() => {
              if (!canDeleteMessage || !props.onDeleteMessage) {
                return;
              }
              const confirmed = window.confirm('Delete this message?');
              if (!confirmed) {
                return;
              }
              void props.onDeleteMessage(messageMenu.message.id);
              setMessageMenu(null);
            }}
            disabled={!canDeleteMessage}
          >
            Delete Message
          </button>
          <button
            onClick={async () => {
              if (!messageMenu.message.content) {
                return;
              }
              try {
                await navigator.clipboard.writeText(messageMenu.message.content);
              } catch {
                // Clipboard access can fail in insecure contexts.
              }
              setMessageMenu(null);
            }}
            disabled={!messageMenu.message.content}
          >
            Copy Message
          </button>
        </div>
          );
        })()
      ) : null}

      {showJumpToLatest ? (
        <button
          className="jump-latest-btn"
          onClick={() => {
            scrollToLatest(true);
            stickToBottomRef.current = true;
            setShowJumpToLatest(false);
          }}
        >
          Zur neuesten Nachricht
        </button>
      ) : null}
    </section>
  );
}
