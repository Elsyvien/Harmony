import { useEffect, useRef, useState } from 'react';
import type { MessageAttachment } from '../types/api';

interface ReplyTarget {
  id: string;
  username: string;
  content: string;
}

interface MessageComposerProps {
  disabled?: boolean;
  enterToSend?: boolean;
  replyingTo?: ReplyTarget | null;
  onCancelReply?: () => void;
  onSend: (payload: {
    content: string;
    attachment?: MessageAttachment;
    replyToMessageId?: string;
  }) => Promise<void>;
  onUploadAttachment: (file: File) => Promise<MessageAttachment>;
}

const EMOJI_CHOICES = ['😀', '😂', '😍', '👍', '❤️', '🔥', '🎉', '🤝', '🙏'];

export function MessageComposer(props: MessageComposerProps) {
  const [value, setValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const sendingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!emojiMenuRef.current) {
        return;
      }
      if (!emojiMenuRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, []);

  const focusComposer = () => {
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  };

  const insertEmoji = (emoji: string) => {
    const node = textareaRef.current;
    if (!node) {
      setValue((current) => `${current}${emoji}`);
      return;
    }
    const start = node.selectionStart ?? value.length;
    const end = node.selectionEnd ?? value.length;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const next = `${before}${emoji}${after}`;
    setValue(next);
    window.requestAnimationFrame(() => {
      node.focus();
      const caret = start + emoji.length;
      node.setSelectionRange(caret, caret);
    });
  };

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    const sendWithEnter = props.enterToSend ?? true;
    const shouldSend = sendWithEnter
      ? e.key === 'Enter' && !e.shiftKey
      : e.key === 'Enter' && (e.ctrlKey || e.metaKey);

    if (shouldSend) {
      e.preventDefault();
      await handleSubmit();
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (sendingRef.current || props.disabled) {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    sendingRef.current = true;
    setValue('');
    setIsSending(true);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      await props.onSend({
        content: trimmed,
        replyToMessageId: props.replyingTo?.id,
      });
    } catch {
      setValue(trimmed);
    } finally {
      sendingRef.current = false;
      setIsSending(false);
      focusComposer();
    }
  };

  const handleAttachmentPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || sendingRef.current || props.disabled) {
      return;
    }

    const trimmed = value.trim();
    sendingRef.current = true;
    setIsUploadingAttachment(true);
    setIsSending(true);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const attachment = await props.onUploadAttachment(file);
      await props.onSend({
        content: trimmed,
        attachment,
        replyToMessageId: props.replyingTo?.id,
      });
    } catch {
      setValue(trimmed);
    } finally {
      sendingRef.current = false;
      setIsUploadingAttachment(false);
      setIsSending(false);
      focusComposer();
    }
  };

  return (
    <div className="composer">
      {props.replyingTo ? (
        <div className="composer-reply-pill">
          <div>
            <strong>Replying to @{props.replyingTo.username}</strong>
            <small>{props.replyingTo.content || 'Attachment message'}</small>
          </div>
          <button className="ghost-btn small" onClick={props.onCancelReply}>
            Cancel
          </button>
        </div>
      ) : null}

      <form onSubmit={handleSubmit}>
        <div className="input-wrapper">
          <button
            type="button"
            className="action-btn"
            disabled={props.disabled || isUploadingAttachment}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Upload attachment"
            title="Upload attachment"
          >
            <svg width="24" height="24" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"
              ></path>
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={(event) => void handleAttachmentPick(event)}
          />

          <div className="composer-text-zone">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isUploadingAttachment
                  ? 'Uploading attachment...'
                  : (props.enterToSend ?? true)
                    ? 'Message...'
                    : 'Message... (Ctrl/Cmd+Enter to send)'
              }
              rows={1}
              disabled={props.disabled || isUploadingAttachment}
            />

            <div className="composer-emoji-wrap" ref={emojiMenuRef}>
              <button
                type="button"
                className="action-btn emoji-toggle"
                disabled={props.disabled || isUploadingAttachment}
                aria-label="Open emoji picker"
                title="Emoji picker"
                onClick={() => {
                  setShowEmojiPicker((open) => !open);
                  focusComposer();
                }}
              >
                🙂
              </button>
              {showEmojiPicker ? (
                <div className="emoji-popover">
                  {EMOJI_CHOICES.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className="emoji-choice"
                      onClick={() => {
                        insertEmoji(emoji);
                        setShowEmojiPicker(false);
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <button
            className="send-btn"
            type="submit"
            disabled={props.disabled || isUploadingAttachment || isSending || !value.trim()}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2.01 21L23 12L2.01 3L2 10L17 12L2 14L2.01 21Z" fill="currentColor" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
