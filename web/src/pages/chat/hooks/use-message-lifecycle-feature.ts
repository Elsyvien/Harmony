import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { chatApi } from '../../../api/chat-api';
import type { Message, MessageAttachment } from '../../../types/api';
import { getErrorMessage } from '../../../utils/error-message';

export type ReplyTarget = { id: string; userId: string; username: string; content: string };

export function mergeMessages(existing: Message[], incoming: Message[]) {
  const map = new Map<string, Message>();
  for (const message of [...existing, ...incoming]) {
    map.set(message.id, message);
  }
  return [...map.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export function messageSignature(
  channelId: string,
  userId: string,
  content: string,
  attachmentUrl?: string,
) {
  return `${channelId}:${userId}:${content.trim().toLowerCase()}:${attachmentUrl ?? ''}`;
}

export function isLogicalSameMessage(a: Message, b: Message) {
  if (a.channelId !== b.channelId || a.userId !== b.userId) {
    return false;
  }
  if (a.content.trim() !== b.content.trim()) {
    return false;
  }
  const aAttachmentUrl = a.attachment?.url ?? null;
  const bAttachmentUrl = b.attachment?.url ?? null;
  if (aAttachmentUrl !== bAttachmentUrl) {
    return false;
  }
  const aTime = new Date(a.createdAt).getTime();
  const bTime = new Date(b.createdAt).getTime();
  return Math.abs(aTime - bTime) <= 60_000;
}

export function mergeServerWithLocal(serverMessages: Message[], localMessages: Message[]) {
  const unresolvedLocal = localMessages.filter(
    (local) => !serverMessages.some((server) => isLogicalSameMessage(local, server)),
  );
  return mergeMessages(serverMessages, unresolvedLocal);
}

export function reconcileIncomingMessage(existing: Message[], incoming: Message) {
  const optimisticIndex = existing.findIndex(
    (item) =>
      item.optimistic &&
      !item.failed &&
      item.channelId === incoming.channelId &&
      item.userId === incoming.userId &&
      item.content === incoming.content,
  );

  if (optimisticIndex >= 0) {
    const next = [...existing];
    next[optimisticIndex] = incoming;
    return next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  const incomingTime = new Date(incoming.createdAt).getTime();
  const failedIndex = existing.findIndex((item) => {
    if (!item.failed) {
      return false;
    }
    if (
      item.channelId !== incoming.channelId ||
      item.userId !== incoming.userId ||
      item.content !== incoming.content
    ) {
      return false;
    }
    const failedTime = new Date(item.createdAt).getTime();
    return Math.abs(incomingTime - failedTime) <= 30_000;
  });

  if (failedIndex >= 0) {
    const next = [...existing];
    next[failedIndex] = incoming;
    return next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  return mergeMessages(existing, [incoming]);
}

type SendMessagePayload = {
  content: string;
  attachment?: MessageAttachment;
  replyToMessageId?: string | null;
};

type UseMessageLifecycleFeatureOptions = {
  authToken: string | null;
  authUser: { id: string; username: string } | null;
  activeChannelId: string | null;
  replyTarget: ReplyTarget | null;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setReplyTarget: Dispatch<SetStateAction<ReplyTarget | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  wsConnected: boolean;
  sendRealtimeMessage: (channelId: string, content: string) => boolean;
  hasPendingSignature: (signature: string) => boolean;
  addPendingSignature: (signature: string) => void;
  schedulePendingTimeout: (signature: string) => void;
  clearPendingSignature: (signature: string) => void;
};

export function useMessageLifecycleFeature({
  authToken,
  authUser,
  activeChannelId,
  replyTarget,
  setMessages,
  setReplyTarget,
  setError,
  wsConnected,
  sendRealtimeMessage,
  hasPendingSignature,
  addPendingSignature,
  schedulePendingTimeout,
  clearPendingSignature,
}: UseMessageLifecycleFeatureOptions) {
  const editMessage = useCallback(
    async (messageId: string, content: string) => {
      if (!authToken || !activeChannelId) {
        return;
      }
      try {
        const response = await chatApi.updateMessage(authToken, activeChannelId, messageId, content);
        setMessages((prev) => prev.map((item) => (item.id === messageId ? response.message : item)));
        setReplyTarget((current) =>
          current && current.id === messageId ? { ...current, content: response.message.content } : current,
        );
        setError(null);
      } catch (err) {
        setError(getErrorMessage(err, 'Could not edit message'));
      }
    },
    [authToken, activeChannelId, setMessages, setReplyTarget, setError],
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (!authToken || !activeChannelId) {
        return;
      }
      try {
        const response = await chatApi.deleteMessage(authToken, activeChannelId, messageId);
        setMessages((prev) => prev.map((item) => (item.id === messageId ? response.message : item)));
        setReplyTarget((current) => (current && current.id === messageId ? null : current));
        setError(null);
      } catch (err) {
        setError(getErrorMessage(err, 'Could not delete message'));
      }
    },
    [authToken, activeChannelId, setMessages, setReplyTarget, setError],
  );

  const sendMessage = useCallback(
    async (payload: SendMessagePayload) => {
      if (!authToken || !activeChannelId || !authUser) {
        return;
      }
      const trimmedContent = payload.content.trim();
      const attachment = payload.attachment;
      const replyToMessageId = payload.replyToMessageId ?? null;
      const outgoingReplyTarget =
        replyToMessageId && replyTarget && replyTarget.id === replyToMessageId ? replyTarget : null;
      if (!trimmedContent && !attachment) {
        return;
      }

      const signature = messageSignature(
        activeChannelId,
        authUser.id,
        trimmedContent,
        attachment?.url,
      );
      if (hasPendingSignature(signature)) {
        return;
      }
      addPendingSignature(signature);
      schedulePendingTimeout(signature);

      const optimisticMessage: Message = {
        id: `tmp-${crypto.randomUUID()}`,
        channelId: activeChannelId,
        userId: authUser.id,
        content: trimmedContent,
        attachment: attachment ?? null,
        editedAt: null,
        deletedAt: null,
        replyToMessageId,
        replyTo: outgoingReplyTarget
          ? {
            id: outgoingReplyTarget.id,
            userId: outgoingReplyTarget.userId,
            content: outgoingReplyTarget.content,
            createdAt: new Date().toISOString(),
            deletedAt: null,
            user: {
              id: outgoingReplyTarget.userId,
              username: outgoingReplyTarget.username,
            },
          }
          : null,
        reactions: [],
        createdAt: new Date().toISOString(),
        optimistic: true,
        user: { id: authUser.id, username: authUser.username },
      };
      setMessages((prev) => mergeMessages(prev, [optimisticMessage]));
      setReplyTarget((current) => (current?.id === replyToMessageId ? null : current));

      const wsSent =
        !attachment && trimmedContent && wsConnected && !replyToMessageId
          ? sendRealtimeMessage(activeChannelId, trimmedContent)
          : false;
      if (wsSent) {
        return;
      }

      try {
        const response = await chatApi.sendMessage(
          authToken,
          activeChannelId,
          trimmedContent,
          attachment,
          replyToMessageId ?? undefined,
        );
        clearPendingSignature(signature);
        setMessages((prev) => {
          const replaced = prev.map((item) => (item.id === optimisticMessage.id ? response.message : item));
          return mergeMessages(replaced, []);
        });
      } catch (err) {
        try {
          const verification = await chatApi.messages(authToken, activeChannelId, { limit: 100 });
          const confirmed = verification.messages.find((message) =>
            isLogicalSameMessage(message, optimisticMessage),
          );
          if (confirmed) {
            clearPendingSignature(signature);
            setMessages((prev) => prev.map((item) => (item.id === optimisticMessage.id ? confirmed : item)));
            return;
          }
        } catch {
          // Ignore verification errors and continue with failed-state UI.
        }

        clearPendingSignature(signature);
        setMessages((prev) =>
          prev.map((item) =>
            item.id === optimisticMessage.id ? { ...item, failed: true, optimistic: false } : item,
          ),
        );
        throw err;
      }
    },
    [
      authToken,
      activeChannelId,
      authUser,
      replyTarget,
      hasPendingSignature,
      addPendingSignature,
      schedulePendingTimeout,
      setMessages,
      setReplyTarget,
      wsConnected,
      sendRealtimeMessage,
      clearPendingSignature,
    ],
  );

  return {
    editMessage,
    deleteMessage,
    sendMessage,
  };
}
