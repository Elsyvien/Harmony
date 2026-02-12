import { useState, useRef, useEffect } from 'react';
import type { MessageAttachment } from '../types/api';

interface MessageComposerProps {
  disabled?: boolean;
  enterToSend?: boolean;
  insertRequest?: { key: number; text: string } | null;
  onSend: (payload: { content: string; attachment?: MessageAttachment }) => Promise<void>;
  onUploadAttachment: (file: File) => Promise<MessageAttachment>;
}

export function MessageComposer(props: MessageComposerProps) {
  const [value, setValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const sendingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastInsertKeyRef = useRef<number | null>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

  useEffect(() => {
    const insertRequest = props.insertRequest;
    if (!insertRequest) {
      return;
    }
    if (lastInsertKeyRef.current === insertRequest.key) {
      return;
    }
    lastInsertKeyRef.current = insertRequest.key;
    setValue((current) => {
      const spacer = current && !current.endsWith(' ') ? ' ' : '';
      return `${current}${spacer}${insertRequest.text}`.trimStart();
    });
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [props.insertRequest]);

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    const sendWithEnter = props.enterToSend ?? true;
    const shouldSend = sendWithEnter
      ? e.key === 'Enter' && !e.shiftKey
      : e.key === 'Enter' && (e.ctrlKey || e.metaKey);

    if (shouldSend) {
      e.preventDefault();
      handleSubmit();
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

    // Clear immediately so the UI feels instant.
    sendingRef.current = true;
    setValue('');
    setIsSending(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto'; // Reset height
    
    try {
      await props.onSend({ content: trimmed });
    } catch {
      setValue(trimmed);
    } finally {
      sendingRef.current = false;
      setIsSending(false);
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
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
      await props.onSend({ content: trimmed, attachment });
    } catch {
      setValue(trimmed);
    } finally {
      sendingRef.current = false;
      setIsUploadingAttachment(false);
      setIsSending(false);
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  };

  return (
    <div className="composer">
      <form onSubmit={handleSubmit}>
        <div className="input-wrapper">
          <button
            type="button"
            className="action-btn"
            disabled={props.disabled || isSending || isUploadingAttachment}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Upload attachment"
            title="Upload attachment"
          >
             <svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"></path></svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={(event) => void handleAttachmentPick(event)}
          />
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
            disabled={props.disabled || isSending || isUploadingAttachment}
          />
          <button
            className="send-btn"
            type="submit"
            disabled={props.disabled || isSending || isUploadingAttachment || !value.trim()}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2.01 21L23 12L2.01 3L2 10L17 12L2 14L2.01 21Z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
