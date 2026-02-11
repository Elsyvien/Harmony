import { Navigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { chatApi } from '../api/chat-api';
import { ChannelSidebar } from '../components/channel-sidebar';
import { ChatView } from '../components/chat-view';
import { MessageComposer } from '../components/message-composer';
import { useChatSocket } from '../hooks/use-chat-socket';
import { useAuth } from '../store/auth-store';
import type { Channel, Message } from '../types/api';
import { getErrorMessage } from '../utils/error-message';

function mergeMessages(existing: Message[], incoming: Message[]) {
  const map = new Map<string, Message>();
  for (const message of [...existing, ...incoming]) {
    map.set(message.id, message);
  }
  return [...map.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export function ChatPage() {
  const auth = useAuth();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [channels, activeChannelId],
  );

  const loadMessages = useCallback(
    async (channelId: string, before?: string, prepend = false) => {
      if (!auth.token) {
        return;
      }

      setLoadingMessages(true);
      try {
        const response = await chatApi.messages(auth.token, channelId, { before, limit: 50 });
        setMessages((prev) => (prepend ? mergeMessages(response.messages, prev) : response.messages));
      } finally {
        setLoadingMessages(false);
      }
    },
    [auth.token],
  );

  const ws = useChatSocket({
    token: auth.token,
    activeChannelId,
    onMessageNew: (message) => {
      if (message.channelId !== activeChannelId) {
        return;
      }
      setMessages((prev) => mergeMessages(prev, [message]));
    },
  });

  useEffect(() => {
    if (!auth.token) {
      return;
    }

    let disposed = false;
    const load = async () => {
      try {
        const response = await chatApi.channels(auth.token as string);
        if (disposed) {
          return;
        }
        setChannels(response.channels);
        setActiveChannelId((current) => current ?? response.channels[0]?.id ?? null);
      } catch (err) {
        if (!disposed) {
          setError(getErrorMessage(err, 'Could not load channels'));
        }
      }
    };

    void load();
    return () => {
      disposed = true;
    };
  }, [auth.token]);

  useEffect(() => {
    if (!activeChannelId) {
      setMessages([]);
      return;
    }
    void loadMessages(activeChannelId);
  }, [activeChannelId, loadMessages]);

  useEffect(() => {
    if (!auth.token || !activeChannelId || ws.connected) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadMessages(activeChannelId);
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, [auth.token, activeChannelId, loadMessages, ws.connected]);

  if (!auth.token || !auth.user) {
    return <Navigate to="/login" replace />;
  }

  const sendMessage = async (content: string) => {
    if (!auth.token || !activeChannelId) {
      return;
    }

    const wsSent = ws.connected ? ws.sendMessage(activeChannelId, content) : false;
    if (wsSent) {
      return;
    }

    const response = await chatApi.sendMessage(auth.token, activeChannelId, content);
    setMessages((prev) => mergeMessages(prev, [response.message]));
  };

  const loadOlder = async () => {
    if (!activeChannelId || messages.length === 0) {
      return;
    }
    const before = messages[0].createdAt;
    await loadMessages(activeChannelId, before, true);
  };

  const logout = async () => {
    if (auth.token) {
      try {
        await chatApi.logout(auth.token);
      } catch {
        // Keep logout resilient even if the backend is unavailable.
      }
    }
    auth.clearAuth();
  };

  return (
    <main className="chat-layout">
      <ChannelSidebar
        channels={channels}
        activeChannelId={activeChannelId}
        onSelect={setActiveChannelId}
        onLogout={logout}
        username={auth.user.username}
      />

      <section className="chat-panel">
        <header className="panel-header">
          <h1>{activeChannel ? `# ${activeChannel.name}` : 'Select channel'}</h1>
          {error ? <p className="error-banner">{error}</p> : null}
        </header>

        <ChatView
          loading={loadingMessages}
          messages={messages}
          wsConnected={ws.connected}
          onLoadOlder={loadOlder}
        />

        <MessageComposer disabled={!activeChannelId} onSend={sendMessage} />
      </section>
    </main>
  );
}
