import { useState, useRef, useEffect } from 'react';

interface MessageComposerProps {
  disabled?: boolean;
  onSend: (content: string) => Promise<void>;
}

export function MessageComposer(props: MessageComposerProps) {
  const [value, setValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isSending || props.disabled) {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    // Clear immediately so the UI feels instant.
    setValue('');
    setIsSending(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto'; // Reset height
    
    try {
      await props.onSend(trimmed);
    } catch {
      setValue(trimmed);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="composer">
      <form onSubmit={handleSubmit}>
        <div className="input-wrapper">
          <button type="button" className="action-btn" disabled>
             {/* Plus icon placeholder */}
             <svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"></path></svg>
          </button>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message..."
            rows={1}
            disabled={props.disabled || isSending}
          />
          <button className="send-btn" type="submit" disabled={props.disabled || isSending || !value.trim()}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2.01 21L23 12L2.01 3L2 10L17 12L2 14L2.01 21Z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
