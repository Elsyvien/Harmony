import { fireEvent, render, renderHook, screen, act } from '@testing-library/react';
import type { Dispatch, SetStateAction } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatApi } from '../src/api/chat-api';
import { ChatView } from '../src/components/chat-view';
import {
  applyReceiptProgress,
  reconcileConfirmedMessage,
  useMessageLifecycleFeature,
} from '../src/pages/chat/hooks/use-message-lifecycle-feature';
import type { Message } from '../src/types/api';

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'message-1',
    channelId: 'channel-1',
    userId: 'user-1',
    content: 'Hello world',
    attachment: null,
    editedAt: null,
    deletedAt: null,
    replyToMessageId: null,
    replyTo: null,
    reactions: [],
    deliveredUserIds: ['user-1'],
    readUserIds: ['user-1'],
    createdAt: '2026-03-03T10:00:00.000Z',
    optimistic: false,
    failed: false,
    user: {
      id: 'user-1',
      username: 'max',
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reconcileConfirmedMessage', () => {
  it('replaces optimistic messages and removes matching failed duplicates', () => {
    const failed = createMessage({
      id: 'tmp-failed',
      failed: true,
      createdAt: '2026-03-03T10:00:05.000Z',
    });
    const optimistic = createMessage({
      id: 'tmp-optimistic',
      optimistic: true,
      createdAt: '2026-03-03T10:00:06.000Z',
    });
    const confirmed = createMessage({
      id: 'server-1',
      createdAt: '2026-03-03T10:00:07.000Z',
    });

    const result = reconcileConfirmedMessage([failed, optimistic], optimistic.id, confirmed);

    expect(result).toEqual([confirmed]);
  });
});

describe('useMessageLifecycleFeature retryMessage', () => {
  it('retries a failed message and reconciles with the confirmed response', async () => {
    const failedMessage = createMessage({
      id: 'tmp-failed',
      failed: true,
      createdAt: '2026-03-03T10:00:05.000Z',
    });
    const confirmed = createMessage({
      id: 'server-2',
      createdAt: '2026-03-03T10:00:06.000Z',
    });

    let currentMessages: Message[] = [failedMessage];
    const setMessages: Dispatch<SetStateAction<Message[]>> = (updater) => {
      currentMessages =
        typeof updater === 'function'
          ? (updater as (prev: Message[]) => Message[])(currentMessages)
          : updater;
    };

    const addPendingSignature = vi.fn();
    const schedulePendingTimeout = vi.fn();
    const clearPendingSignature = vi.fn();
    const setReplyTarget: Dispatch<SetStateAction<null>> = vi.fn();
    const setError: Dispatch<SetStateAction<string | null>> = vi.fn();

    vi.spyOn(chatApi, 'sendMessage').mockResolvedValue({ message: confirmed });

    const { result } = renderHook(() =>
      useMessageLifecycleFeature({
        authToken: 'token-1',
        authUser: { id: 'user-1', username: 'max' },
        activeChannelId: 'channel-1',
        replyTarget: null,
        setMessages,
        setReplyTarget,
        setError,
        wsConnected: false,
        sendRealtimeMessage: () => false,
        hasPendingSignature: () => false,
        addPendingSignature,
        schedulePendingTimeout,
        clearPendingSignature,
      }),
    );

    await act(async () => {
      await result.current.retryMessage(failedMessage.id);
    });

    expect(chatApi.sendMessage).toHaveBeenCalledWith(
      'token-1',
      'channel-1',
      failedMessage.content,
      undefined,
      undefined,
    );
    expect(addPendingSignature).toHaveBeenCalledTimes(1);
    expect(schedulePendingTimeout).toHaveBeenCalledTimes(1);
    expect(clearPendingSignature).toHaveBeenCalledTimes(1);
    expect(currentMessages).toEqual([confirmed]);
    expect(setError).toHaveBeenCalledWith(null);
  });
});

describe('ChatView failed retry action', () => {
  it('calls onRetryMessage when the retry button is clicked on a failed message', () => {
    const failedMessage = createMessage({ id: 'tmp-failed', failed: true });
    const onRetryMessage = vi.fn();

    render(
      <ChatView
        activeChannelId="channel-1"
        messages={[failedMessage]}
        loading={false}
        wsConnected={true}
        currentUserId="user-1"
        onLoadOlder={async () => undefined}
        onRetryMessage={onRetryMessage}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetryMessage).toHaveBeenCalledWith('tmp-failed');
  });

  it('renders safely when receipt arrays are missing on a message', () => {
    const legacyMessage = createMessage({
      id: 'legacy-message-1',
      deliveredUserIds: undefined as unknown as string[],
      readUserIds: undefined as unknown as string[],
    });

    expect(() =>
      render(
        <ChatView
          activeChannelId="channel-1"
          messages={[legacyMessage]}
          loading={false}
          wsConnected={true}
          currentUserId="user-1"
          onLoadOlder={async () => undefined}
        />,
      ),
    ).not.toThrow();

    expect(screen.getByText('Sent')).toBeInTheDocument();
  });
});

describe('applyReceiptProgress', () => {
  it('handles missing receipt arrays from legacy payloads', () => {
    const legacyMessage = createMessage({
      deliveredUserIds: undefined as unknown as string[],
      readUserIds: undefined as unknown as string[],
    });

    const delivered = applyReceiptProgress(
      [legacyMessage],
      {
        channelId: 'channel-1',
        userId: 'user-2',
        upToMessageId: legacyMessage.id,
      },
      'delivered',
    );

    expect(delivered[0]?.deliveredUserIds).toEqual(['user-2']);
    expect(delivered[0]?.readUserIds).toEqual([]);

    const read = applyReceiptProgress(
      [legacyMessage],
      {
        channelId: 'channel-1',
        userId: 'user-2',
        upToMessageId: legacyMessage.id,
      },
      'read',
    );

    expect(read[0]?.deliveredUserIds).toEqual(['user-2']);
    expect(read[0]?.readUserIds).toEqual(['user-2']);
  });
});


