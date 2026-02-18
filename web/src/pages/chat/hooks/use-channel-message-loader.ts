import { useCallback, useEffect, useRef } from 'react';
import { chatApi } from '../../../api/chat-api';
import type { Message } from '../../../types/api';
import {
  mergeMessages,
  mergeServerWithLocal,
} from './use-message-lifecycle-feature';

type UseChannelMessageLoaderOptions = {
  token: string | null;
  activeChannelId: string | null;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setLoadingMessages: React.Dispatch<React.SetStateAction<boolean>>;
};

export function useChannelMessageLoader({
  token,
  activeChannelId,
  setMessages,
  setLoadingMessages,
}: UseChannelMessageLoaderOptions) {
  const isMountedRef = useRef(true);
  const activeChannelIdRef = useRef<string | null>(activeChannelId);
  const pendingMessageLoadsRef = useRef(0);

  useEffect(() => {
    activeChannelIdRef.current = activeChannelId;
  }, [activeChannelId]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return useCallback(
    async (channelId: string, before?: string, prepend = false) => {
      if (!token) {
        return;
      }
      pendingMessageLoadsRef.current += 1;
      if (isMountedRef.current) {
        setLoadingMessages(true);
      }
      try {
        const response = await chatApi.messages(token, channelId, { before, limit: 50 });
        if (!isMountedRef.current || activeChannelIdRef.current !== channelId) {
          return;
        }
        setMessages((prev) => {
          if (prepend) {
            return mergeMessages(response.messages, prev);
          }
          const localPending = prev.filter((item) => item.optimistic || item.failed);
          return mergeServerWithLocal(response.messages, localPending);
        });
      } finally {
        pendingMessageLoadsRef.current = Math.max(0, pendingMessageLoadsRef.current - 1);
        if (isMountedRef.current && pendingMessageLoadsRef.current === 0) {
          setLoadingMessages(false);
        }
      }
    },
    [token, setLoadingMessages, setMessages],
  );
}
