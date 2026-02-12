import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { chatApi } from '../../../api/chat-api';
import type { Message } from '../../../types/api';
import { getErrorMessage } from '../../../utils/error-message';

type UseReactionsFeatureOptions = {
  authToken: string | null;
  activeChannelId: string | null;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
};

export function useReactionsFeature({
  authToken,
  activeChannelId,
  setMessages,
  setError,
}: UseReactionsFeatureOptions) {
  const toggleMessageReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!authToken || !activeChannelId) {
        return;
      }
      try {
        const response = await chatApi.toggleMessageReaction(authToken, activeChannelId, messageId, emoji);
        setMessages((prev) => prev.map((item) => (item.id === messageId ? response.message : item)));
      } catch (err) {
        setError(getErrorMessage(err, 'Could not update reaction'));
      }
    },
    [authToken, activeChannelId, setMessages, setError],
  );

  return { toggleMessageReaction };
}
