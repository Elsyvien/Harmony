import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Message } from '../types/api';
import { MarkdownMessage } from './markdown-message';
import { cancelSmoothScroll, smoothScrollTo } from '../utils/smooth-scroll';
import { useRecentEmojis } from '../hooks/use-recent-emojis';
import { resolveMediaUrl } from '../utils/media-url';

const MESSAGE_REACTION_PANEL_EMOJIS = ['👍', '❤️', '😂', '🎉', '🔥', '😮', '👏', '😢'];

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
  const { recentEmojis, addRecentEmoji } = useRecentEmojis();
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const previousLastMessageIdRef = useRef<string | null>(null);
  const previousMessageCountRef = useRef(0);
  const stickToBottomRef = useRef(true);
  const reactionPickerRef = useRef<HTMLDivElement | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [messageMenu, setMessageMenu] = useState<{
    message: Message;
    x: number;
    y: number;
  } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [unseenNewMessagesCount, setUnseenNewMessagesCount] = useState(0);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const longPressTimeoutRef = useRef<number | null>(null);
  const suppressNextClickRef = useRef(false);
  const messageReactionPanelEmojis = useMemo(
    () => Array.from(new Set([...recentEmojis, ...MESSAGE_REACTION_PANEL_EMOJIS])),
    [recentEmojis],
  );
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

  const scrollToLatest = useCallback((animated: boolean) => {
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
  }, [props.reducedMotion]);

  useEffect(() => {
    previousLastMessageIdRef.current = null;
    previousMessageCountRef.current = 0;
    setShowJumpToLatest(false);
    setUnseenNewMessagesCount(0);
    setLoadingOlder(false);
    setMessageMenu(null);
    setReactionPickerMessageId(null);
    cancelSmoothScroll(messageListRef.current);
  }, [props.activeChannelId]);

  useEffect(() => {
    const listElement = messageListRef.current;
    return () => {
      cancelSmoothScroll(listElement);
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

  useEffect(() => {
    if (!reactionPickerMessageId) {
      return;
    }
    const close = () => setReactionPickerMessageId(null);
    const onMouseDown = (event: MouseEvent) => {
      if (reactionPickerRef.current?.contains(event.target as Node)) {
        return;
      }
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [reactionPickerMessageId]);

  const clearLongPress = useCallback(() => {
    if (!longPressTimeoutRef.current) {
      return;
    }
    window.clearTimeout(longPressTimeoutRef.current);
    longPressTimeoutRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      clearLongPress();
    };
  }, [clearLongPress]);

  const loadingOlderInFlightRef = useRef(false);

  const loadOlderMessages = async () => {
    if (loadingOlderInFlightRef.current) {
      return;
    }

    loadingOlderInFlightRef.current = true;
    setLoadingOlder(true);

    try {
      await props.onLoadOlder();
    } finally {
      loadingOlderInFlightRef.current = false;
      setLoadingOlder(false);
    }
  };

  const openMessageMenu = (message: Message, x: number, y: number) => {
    const menuWidth = 260;
    const menuHeight = 280;
    const nextX = Math.min(x, window.innerWidth - menuWidth - 8);
    const nextY = Math.min(y, window.innerHeight - menuHeight - 8);
    setReactionPickerMessageId(null);
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
      setUnseenNewMessagesCount(0);
    } else if (appendedNewMessage) {
      const appendedCount = Math.max(1, props.messages.length - previousCount);
      if (stickToBottomRef.current) {
        requestAnimationFrame(() => {
          scrollToLatest(true);
        });
        stickToBottomRef.current = true;
        setShowJumpToLatest(false);
        setUnseenNewMessagesCount(0);
      } else {
        setShowJumpToLatest(true);
        setUnseenNewMessagesCount((current) => current + appendedCount);
      }
    }

    previousLastMessageIdRef.current = lastMessageId;
    previousMessageCountRef.current = props.messages.length;
  }, [lastMessageId, props.messages.length, scrollToLatest]);

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
        <button
          className="ghost-btn small"
          onClick={() => {
            void loadOlderMessages();
          }}
          disabled={props.loading || loadingOlder}
        >
          {loadingOlder ? 'Loading...' : 'Load older'}
        </button>
      </div>

      <div
        ref={messageListRef}
        className="message-list"
        aria-live="polite"
        onScroll={() => {
          const nearBottom = isNearBottom();
          stickToBottomRef.current = nearBottom;
          if (showJumpToLatest && nearBottom) {
            setShowJumpToLatest(false);
            setUnseenNewMessagesCount(0);
          }
        }}
      >
        {props.loading ? <p className="muted">Loading messages...</p> : null}
        {!props.loading && props.messages.length === 0 ? (
          <p className="muted chat-view-empty-state">No messages yet. Be the first one.</p>
        ) : null}

        {props.messages.map((message, index) => (
          (() => {
            const previousMessage = props.messages[index - 1];
            const isSameUser = previousMessage && previousMessage.userId === message.userId;
            
            // Check if messages were sent within 5 minutes of each other
            const timeDiff = previousMessage 
              ? new Date(message.createdAt).getTime() - new Date(previousMessage.createdAt).getTime()
              : Infinity;
            const isRecent = timeDiff < 5 * 60 * 1000;
            const isGrouped = isSameUser && isRecent && !message.replyTo && !message.deletedAt && !previousMessage.deletedAt;

            const attachmentUrl = resolveMediaUrl(message.attachment?.url) ?? null;
            const avatarUrl = resolveMediaUrl(message.user.avatarUrl);
            const isImageAttachment = Boolean(
              message.attachment?.type?.toLowerCase().startsWith('image/') && attachmentUrl,
            );
            const hasReactions = message.reactions.length > 0;

            return (
              <article
                key={message.id}
                className={`message-item${isGrouped ? ' grouped' : ''}${message.optimistic ? ' pending' : ''}${message.failed ? ' failed' : ''}`}
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
                    suppressNextClickRef.current = true;
                    openMessageMenu(message, touch.clientX, touch.clientY);
                  }, 440);
                }}
                onClickCapture={(event) => {
                  if (!suppressNextClickRef.current) {
                    return;
                  }
                  suppressNextClickRef.current = false;
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onTouchEnd={clearLongPress}
                onTouchCancel={clearLongPress}
                onTouchMove={clearLongPress}
              >
                <div
                  className="message-avatar"
                  style={{
                    backgroundColor: avatarUrl ? 'transparent' : stringToColor(message.user.username),
                    cursor: 'pointer'
                  }}
                  onClick={() => props.onUserClick?.(message.user)}
                >
                  {avatarUrl ? (
                    <img crossOrigin="anonymous" src={avatarUrl} alt={message.user.username} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    message.user.username.slice(0, 1).toUpperCase()
                  )}
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
                        <img crossOrigin="anonymous" src={attachmentUrl} alt={message.attachment.name} className="message-attachment-preview" />
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
                  {/* Message Actions Toolbar */}
                  <div className="message-actions-toolbar">
                    <div className="quick-reactions">
                      {recentEmojis.map((emoji) => (
                        <button
                          key={emoji}
                          className="toolbar-btn emoji"
                          onClick={() => {
                            void props.onToggleReaction?.(message.id, emoji);
                            addRecentEmoji(emoji);
                          }}
                          title={`React with ${emoji}`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                    <div className="toolbar-divider" />
                    <div className="toolbar-actions">
                      <div
                        className="message-reaction-picker"
                        ref={message.id === reactionPickerMessageId ? reactionPickerRef : undefined}
                      >
                        <button
                          className="toolbar-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            setReactionPickerMessageId((current) => (current === message.id ? null : message.id));
                          }}
                          title="Add Reaction"
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>
                        </button>
                        {reactionPickerMessageId === message.id ? (
                          <div className="message-reaction-popover">
                            {messageReactionPanelEmojis.map((emoji) => (
                              <button
                                key={`message-reaction:${message.id}:${emoji}`}
                                type="button"
                                className="emoji-choice"
                                disabled={!props.onToggleReaction}
                                onClick={() => {
                                  if (!props.onToggleReaction) {
                                    return;
                                  }
                                  void props.onToggleReaction(message.id, emoji);
                                  addRecentEmoji(emoji);
                                  setReactionPickerMessageId(null);
                                }}
                                title={`React with ${emoji}`}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <button
                        className="toolbar-btn"
                        onClick={() => props.onReplyToMessage?.(message)}
                        title="Reply"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 14 20 9 15 4"></polyline><path d="M4 20v-7a4 4 0 0 1 4-4h12"></path></svg>
                      </button>
                      <button
                        className="toolbar-btn"
                        onClick={() => {
                          if (!message.content) return;
                          navigator.clipboard.writeText(message.content).catch(() => { });
                        }}
                        title="Copy Text"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                      </button>
                      <button
                        className="toolbar-btn"
                        onClick={(event) => {
                          const triggerRect = event.currentTarget.getBoundingClientRect();
                          const x =
                            event.clientX > 0
                              ? event.clientX
                              : Math.round(triggerRect.left + triggerRect.width / 2);
                          const y =
                            event.clientY > 0
                              ? event.clientY
                              : Math.round(triggerRect.bottom);
                          openMessageMenu(message, x, y);
                        }}
                        title="More"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
                      </button>
                    </div>
                  </div>
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
            setUnseenNewMessagesCount(0);
          }}
          aria-label={
            unseenNewMessagesCount > 0
              ? `Jump to latest message, ${unseenNewMessagesCount} unread`
              : 'Jump to latest message'
          }
        >
          <span className="jump-latest-main">Jump to latest</span>
          {unseenNewMessagesCount > 0 ? (
            <span className="jump-latest-count">{unseenNewMessagesCount}</span>
          ) : null}
        </button>
      ) : null}
    </section>
  );
}
