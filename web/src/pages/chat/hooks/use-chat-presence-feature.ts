import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { PresenceState, PresenceUser } from '../../../hooks/use-chat-socket';

type UseChatPresenceFeatureOptions = {
  currentUserId: string | null;
  onlineUsers: PresenceUser[];
  setOnlineUsers: Dispatch<SetStateAction<PresenceUser[]>>;
};

export function useChatPresenceFeature({
  currentUserId,
  onlineUsers,
  setOnlineUsers,
}: UseChatPresenceFeatureOptions) {
  const [hiddenUnreadCount, setHiddenUnreadCount] = useState(0);

  const currentPresenceState: PresenceState = useMemo(() => {
    if (!currentUserId) {
      return 'online';
    }
    return onlineUsers.find((user) => user.id === currentUserId)?.state ?? 'online';
  }, [currentUserId, onlineUsers]);

  const setPresenceStateLocal = useCallback(
    (nextState: string): PresenceState | null => {
      if (!currentUserId) {
        return null;
      }
      const normalizedState: PresenceState =
        nextState === 'dnd' || nextState === 'idle' ? nextState : 'online';

      setOnlineUsers((prev) => {
        const currentUserIndex = prev.findIndex((user) => user.id === currentUserId);
        if (currentUserIndex < 0) {
          return prev;
        }

        const currentUser = prev[currentUserIndex];
        if (currentUser.state === normalizedState) {
          return prev;
        }

        const next = [...prev];
        next[currentUserIndex] = { ...currentUser, state: normalizedState };
        return next;
      });

      return normalizedState;
    },
    [currentUserId, setOnlineUsers],
  );

  const incrementHiddenUnread = useCallback(() => {
    setHiddenUnreadCount((count) => count + 1);
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) {
        setHiddenUnreadCount(0);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, []);

  useEffect(() => {
    document.title = hiddenUnreadCount > 0 ? `(${hiddenUnreadCount}) Harmony` : 'Harmony';
  }, [hiddenUnreadCount]);

  return {
    currentPresenceState,
    setPresenceStateLocal,
    incrementHiddenUnread,
  };
}

