import { useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Message } from '../../../types/api';
import type { ReplyTarget } from './use-message-lifecycle-feature';

type MainView = 'chat' | 'friends' | 'settings' | 'admin';
type MobilePane = 'none' | 'channels' | 'users';

type UseChatPageEffectsOptions = {
  notice: string | null;
  setNotice: Dispatch<SetStateAction<string | null>>;
  activeView: MainView;
  activeChannelId: string | null;
  activeChannelIsVoice: boolean;
  closeAudioContextMenu: () => void;
  setReplyTarget: Dispatch<SetStateAction<ReplyTarget | null>>;
  setMobilePane: Dispatch<SetStateAction<MobilePane>>;
  setUnreadChannelCounts: Dispatch<SetStateAction<Record<string, number>>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setMessageQuery: Dispatch<SetStateAction<string>>;
  loadMessages: (channelId: string, before?: string, prepend?: boolean) => Promise<void>;
  authToken: string | null;
  wsConnected: boolean;
  isAdminUser: boolean | undefined;
  loadAdminStats: () => Promise<void>;
  loadAdminSettings: () => Promise<void>;
  loadAdminUsers: () => Promise<void>;
  loadFriendData: () => Promise<void>;
  messageSearchInputRef: RefObject<HTMLInputElement | null>;
};

type PollingLoopOptions = {
  task: () => Promise<void>;
  intervalMs: number;
  immediate?: boolean;
  jitterMs?: number;
};

function startPollingLoop({
  task,
  intervalMs,
  immediate = false,
  jitterMs = 0,
}: PollingLoopOptions): () => void {
  let disposed = false;
  let timeoutId: number | null = null;
  let inFlight = false;

  const scheduleNext = () => {
    if (disposed) {
      return;
    }
    const jitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
    timeoutId = window.setTimeout(() => {
      void runTask();
    }, intervalMs + jitter);
  };

  const runTask = async () => {
    if (disposed || inFlight) {
      return;
    }
    inFlight = true;
    try {
      await task();
    } catch {
      // Best-effort polling. Errors are already surfaced by each feature loader.
    } finally {
      inFlight = false;
      scheduleNext();
    }
  };

  if (immediate) {
    void runTask();
  } else {
    scheduleNext();
  }

  return () => {
    disposed = true;
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
}

export function useChatPageEffects({
  notice,
  setNotice,
  activeView,
  activeChannelId,
  activeChannelIsVoice,
  closeAudioContextMenu,
  setReplyTarget,
  setMobilePane,
  setUnreadChannelCounts,
  setMessages,
  setMessageQuery,
  loadMessages,
  authToken,
  wsConnected,
  isAdminUser,
  loadAdminStats,
  loadAdminSettings,
  loadAdminUsers,
  loadFriendData,
  messageSearchInputRef,
}: UseChatPageEffectsOptions) {
  useEffect(() => {
    if (!notice) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setNotice(null);
    }, 5000);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [notice, setNotice]);

  useEffect(() => {
    if (activeView !== 'chat' || !activeChannelId) {
      return;
    }
    setUnreadChannelCounts((prev) => {
      if (!prev[activeChannelId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[activeChannelId];
      return next;
    });
  }, [activeView, activeChannelId, setUnreadChannelCounts]);

  useEffect(() => {
    closeAudioContextMenu();
    setReplyTarget(null);
    setMobilePane('none');
  }, [activeView, activeChannelId, closeAudioContextMenu, setReplyTarget, setMobilePane]);

  useEffect(() => {
    if (!activeChannelId) {
      setMessages([]);
      return;
    }
    if (activeChannelIsVoice) {
      setMessages([]);
      setMessageQuery('');
      return;
    }
    setMessages([]);
    setMessageQuery('');
    void loadMessages(activeChannelId);
  }, [activeChannelId, activeChannelIsVoice, loadMessages, setMessages, setMessageQuery]);

  useEffect(() => {
    if (activeView !== 'admin' || !isAdminUser) {
      return;
    }

    return startPollingLoop({
      intervalMs: 5000,
      jitterMs: 500,
      immediate: true,
      task: async () => {
        await Promise.allSettled([loadAdminStats(), loadAdminSettings(), loadAdminUsers()]);
      },
    });
  }, [activeView, isAdminUser, loadAdminStats, loadAdminSettings, loadAdminUsers]);

  useEffect(() => {
    if (activeView !== 'friends' || !authToken) {
      return;
    }

    return startPollingLoop({
      intervalMs: 8000,
      jitterMs: 1200,
      task: async () => {
        await loadFriendData();
      },
    });
  }, [activeView, authToken, loadFriendData]);

  useEffect(() => {
    if (!authToken || !activeChannelId || wsConnected) {
      return;
    }

    return startPollingLoop({
      intervalMs: 5000,
      jitterMs: 600,
      immediate: true,
      task: async () => {
        await loadMessages(activeChannelId);
      },
    });
  }, [authToken, activeChannelId, loadMessages, wsConnected]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      if (event.shiftKey || event.altKey) {
        return;
      }
      if (event.key.toLowerCase() !== 'k') {
        return;
      }
      if (activeView !== 'chat' || activeChannelIsVoice) {
        return;
      }
      event.preventDefault();
      messageSearchInputRef.current?.focus();
      messageSearchInputRef.current?.select();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [activeView, activeChannelIsVoice, messageSearchInputRef]);
}
