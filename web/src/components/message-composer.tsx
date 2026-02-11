import { useState } from 'react';

interface MessageComposerProps {
  disabled?: boolean;
  onSend: (content: string) => Promise<void>;
}

export function MessageComposer(props: MessageComposerProps) {
  const [value, setValue] = useState('');
  const [isSending, setIsSending] = useState(false);

  return (
    <form
      className="composer"
      onSubmit={async (event) => {
        event.preventDefault();
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
        try {
          await props.onSend(trimmed);
        } catch {
          setValue(trimmed);
        } finally {
          setIsSending(false);
        }
      }}
    >
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Write a message..."
        minLength={1}
        maxLength={2000}
        disabled={props.disabled || isSending}
      />
      <button className="primary-btn" type="submit" disabled={props.disabled || isSending}>
        Send
      </button>
    </form>
  );
}
