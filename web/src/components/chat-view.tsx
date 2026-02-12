import { useEffect, useMemo, useRef, useState } from 'react';
import type { Message } from '../types/api';
import { MarkdownMessage } from './markdown-message';

interface ChatViewProps {
  activeChannelId: string | null;
  messages: Message[];
  loading: boolean;
  wsConnected: boolean;
  use24HourClock?: boolean;
  showSeconds?: boolean;
  currentUserId: string;
  currentUsername: string;
  replyingToMessageId?: string | null;
  onLoadOlder: () => Promise<void>;
  onUserClick?: (user: { id: string; username: string }) => void;
  onReplyToMessage?: (message: Message) => void;
  onEditMessage?: (messageId: string, content: string) => Promise<void>;
  onDeleteMessage?: (messageId: string) => Promise<void>;
  onToggleReaction?: (messageId: string, emoji: string) => Promise<void>;
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '🎉'];

function stringToColor(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const c = (hash & 0x00ffffff).toString(16).toUpperCase();
  return '#' + '00000'.substring(0, 6 - c.length) + c;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function ChatView(props: ChatViewProps) {
  const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const previousLastMessageIdRef = useRef<string | null>(null);
  const previousMessageCountRef = useRef(0);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [reactionBusyKey, setReactionBusyKey] = useState<string | null>(null);

  const lastMessageId = useMemo(
    () => (props.messages.length > 0 ? props.messages[props.messages.length - 1]?.id ?? null : null),
    [props.messages],
  );

  const mentionPattern = useMemo(() => {
    const escaped = escapeRegExp(props.currentUsername.trim());
    return new RegExp(`(^|\\s)@${escaped}(?=\\b|\\s|$)`, 'i');
  }, [props.currentUsername]);

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
    setEditingMessageId(null);
    setEditingDraft('');
    setSavingEdit(false);
    setDeletingMessageId(null);
    setReactionBusyKey(null);
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
          if (showJumpToLatest && isNearBottom()) {
            setShowJumpToLatest(false);
          }
        }}
      >
        {props.loading ? <p className="muted">Loading messages...</p> : null}
        {!props.loading && props.messages.length === 0 ? (
          <p className="muted">No messages yet. Be the first one.</p>
        ) : null}

        {props.messages.map((message) => {
          const attachmentUrl =
            message.attachment?.url?.startsWith('http')
              ? message.attachment.url
              : message.attachment?.url
                ? `${apiBaseUrl}${message.attachment.url}`
                : null;
          const isImageAttachment = Boolean(
            message.attachment?.type.toLowerCase().startsWith('image/') && attachmentUrl,
          );
          const isMine = message.userId === props.currentUserId;
          const isDeleted = Boolean(message.deletedAt);
          const isEditing = editingMessageId === message.id;
          const isMentioned = !isDeleted && mentionPattern.test(message.content);

          return (
            <article
              key={message.id}
              className={`message-item${message.optimistic ? ' pending' : ''}${
                message.failed ? ' failed' : ''
              }${isMentioned ? ' mention-hit' : ''}${
                props.replyingToMessageId === message.id ? ' replying-target' : ''
              }`}
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
                  {message.editedAt && !isDeleted ? <span className="pending-tag">edited</span> : null}
                  {message.optimistic ? <span className="pending-tag">Sending...</span> : null}
                  {message.failed ? <span className="pending-tag failed">Failed</span> : null}
                </header>

                {message.replyTo ? (
                  <div className="message-reply-preview" title={`Reply to ${message.replyTo.user.username}`}>
                    <span className="message-reply-author">@{message.replyTo.user.username}</span>
                    <span className="message-reply-content">
                      {message.replyTo.deletedAt ? 'Message deleted' : message.replyTo.content}
                    </span>
                  </div>
                ) : null}

                {isDeleted ? (
                  <p className="message-deleted">Message deleted</p>
                ) : isEditing ? (
                  <form
                    className="message-edit-form"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (!props.onEditMessage || savingEdit || !editingDraft.trim()) {
                        return;
                      }
                      setSavingEdit(true);
                      try {
                        await props.onEditMessage(message.id, editingDraft);
                        setEditingMessageId(null);
                        setEditingDraft('');
                      } finally {
                        setSavingEdit(false);
                      }
                    }}
                  >
                    <textarea
                      value={editingDraft}
                      onChange={(event) => setEditingDraft(event.target.value)}
                      rows={3}
                      disabled={savingEdit}
                    />
                    <div className="message-edit-actions">
                      <button type="submit" className="ghost-btn small" disabled={savingEdit || !editingDraft.trim()}>
                        {savingEdit ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        type="button"
                        className="ghost-btn small"
                        disabled={savingEdit}
                        onClick={() => {
                          setEditingMessageId(null);
                          setEditingDraft('');
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : message.content ? (
                  <MarkdownMessage content={message.content} />
                ) : null}

                {message.attachment && attachmentUrl ? (
                  <a className="message-attachment" href={attachmentUrl} target="_blank" rel="noreferrer">
                    {isImageAttachment ? (
                      <img src={attachmentUrl} alt={message.attachment.name} className="message-attachment-preview" />
                    ) : null}
                    <span className="message-attachment-name">{message.attachment.name}</span>
                    <span className="message-attachment-meta">
                      {message.attachment.type} • {formatAttachmentSize(message.attachment.size)}
                    </span>
                  </a>
                ) : null}

                {!isDeleted && message.reactions.length > 0 ? (
                  <div className="message-reactions">
                    {message.reactions.map((reaction) => {
                      const hasReacted = reaction.userIds.includes(props.currentUserId);
                      const reactionKey = `${message.id}:${reaction.emoji}`;
                      return (
                        <button
                          key={reaction.emoji}
                          className={`reaction-chip${hasReacted ? ' active' : ''}`}
                          disabled={reactionBusyKey === reactionKey}
                          onClick={async () => {
                            if (!props.onToggleReaction) {
                              return;
                            }
                            setReactionBusyKey(reactionKey);
                            try {
                              await props.onToggleReaction(message.id, reaction.emoji);
                            } finally {
                              setReactionBusyKey(null);
                            }
                          }}
                        >
                          <span>{reaction.emoji}</span>
                          <small>{reaction.userIds.length}</small>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {!isDeleted ? (
                  <div className="message-actions">
                    <button
                      className="ghost-btn small"
                      onClick={() => props.onReplyToMessage?.(message)}
                      disabled={!props.onReplyToMessage}
                    >
                      Reply
                    </button>
                    {QUICK_REACTIONS.slice(0, 3).map((emoji) => {
                      const reactionKey = `${message.id}:${emoji}`;
                      return (
                        <button
                          key={emoji}
                          className="ghost-btn small emoji"
                          title={`React ${emoji}`}
                          disabled={!props.onToggleReaction || reactionBusyKey === reactionKey}
                          onClick={async () => {
                            if (!props.onToggleReaction) {
                              return;
                            }
                            setReactionBusyKey(reactionKey);
                            try {
                              await props.onToggleReaction(message.id, emoji);
                            } finally {
                              setReactionBusyKey(null);
                            }
                          }}
                        >
                          {emoji}
                        </button>
                      );
                    })}
                    {isMine ? (
                      <>
                        <button
                          className="ghost-btn small"
                          onClick={() => {
                            setEditingMessageId(message.id);
                            setEditingDraft(message.content);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="ghost-btn small danger"
                          disabled={!props.onDeleteMessage || deletingMessageId === message.id}
                          onClick={async () => {
                            if (!props.onDeleteMessage) {
                              return;
                            }
                            setDeletingMessageId(message.id);
                            try {
                              await props.onDeleteMessage(message.id);
                            } finally {
                              setDeletingMessageId(null);
                            }
                          }}
                        >
                          {deletingMessageId === message.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {showJumpToLatest ? (
        <button
          className="jump-latest-btn"
          onClick={() => {
            scrollToLatest('smooth');
            setShowJumpToLatest(false);
          }}
        >
          Jump to latest
        </button>
      ) : null}
    </section>
  );
}
