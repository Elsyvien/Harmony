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
    void loadAdminStats();
    void loadAdminSettings();
    void loadAdminUsers();
    const interval = window.setInterval(() => {
      void loadAdminStats();
      void loadAdminSettings();
      void loadAdminUsers();
    }, 5000);
    return () => {
      window.clearInterval(interval);
    };
  }, [activeView, isAdminUser, loadAdminStats, loadAdminSettings, loadAdminUsers]);

  useEffect(() => {
    if (activeView !== 'friends' || !authToken) {
      return;
    }
    const interval = window.setInterval(() => {
      void loadFriendData();
    }, 8000);
    return () => {
      window.clearInterval(interval);
    };
  }, [activeView, authToken, loadFriendData]);

  useEffect(() => {
    if (!authToken || !activeChannelId || wsConnected) {
      return;
    }
    const interval = window.setInterval(() => {
      void loadMessages(activeChannelId);
    }, 5000);
    return () => {
      window.clearInterval(interval);
    };
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
