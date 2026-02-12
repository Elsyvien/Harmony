import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChannelSidebar } from '../src/components/channel-sidebar';
import { ChatView } from '../src/components/chat-view';
import { FriendsPanel } from '../src/components/friends-panel';
import type { Channel, Message } from '../src/types/api';

function createTextChannel(id: string, name: string): Channel {
  return {
    id,
    name,
    createdAt: '2026-01-01T00:00:00.000Z',
    isDirect: false,
    isVoice: false,
    voiceBitrateKbps: null,
    streamBitrateKbps: null,
    directUser: null,
  };
}

describe('avatar display integration', () => {
  it('shows the persisted avatar in the sidebar footer', () => {
    render(
      <ChannelSidebar
        channels={[createTextChannel('channel-1', 'general')]}
        activeChannelId="channel-1"
        onSelect={vi.fn()}
        unreadChannelCounts={{}}
        activeView="chat"
        onChangeView={vi.fn()}
        onLogout={async () => {}}
        username="max"
        isAdmin={false}
        onCreateChannel={async () => {}}
        onDeleteChannel={async () => {}}
        deletingChannelId={null}
        activeVoiceChannelId={null}
        voiceParticipantCounts={{}}
        voiceParticipantsByChannel={{}}
        voiceStreamingUserIdsByChannel={{}}
        speakingUserIds={[]}
        onJoinVoice={async () => {}}
        onLeaveVoice={async () => {}}
        isSelfMuted={false}
        isSelfDeafened={false}
        onToggleMute={vi.fn()}
        onToggleDeafen={vi.fn()}
        joiningVoiceChannelId={null}
        incomingFriendRequests={0}
        avatarUrl="/uploads/avatars/max.png"
        ping={42}
      />,
    );

    const avatar = screen.getByRole('img', { name: 'max' });
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveAttribute('src', 'http://localhost:4000/uploads/avatars/max.png');
  });

  it('shows friend avatars in the friends list', () => {
    render(
      <FriendsPanel
        friends={[
          {
            id: 'friendship-1',
            user: {
              id: 'user-1',
              username: 'alice',
              avatarUrl: '/uploads/avatars/alice.png',
            },
            friendsSince: '2026-01-01T00:00:00.000Z',
          },
        ]}
        incoming={[]}
        outgoing={[]}
        loading={false}
        error={null}
        actionBusyId={null}
        submittingRequest={false}
        onRefresh={async () => {}}
        onSendRequest={async () => {}}
        onAccept={async () => {}}
        onDecline={async () => {}}
        onCancel={async () => {}}
        onRemove={async () => {}}
        onStartDm={async () => {}}
        openingDmUserId={null}
      />,
    );

    const avatar = screen.getByRole('img', { name: 'alice' });
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveAttribute('src', 'http://localhost:4000/uploads/avatars/alice.png');
  });

  it('shows message author avatars in chat', () => {
    const messages: Message[] = [
      {
        id: 'message-1',
        channelId: 'channel-1',
        userId: 'user-1',
        content: 'hello',
        attachment: null,
        editedAt: null,
        deletedAt: null,
        replyToMessageId: null,
        replyTo: null,
        reactions: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        user: {
          id: 'user-1',
          username: 'alice',
          avatarUrl: '/uploads/avatars/alice.png',
        },
      },
    ];

    render(
      <ChatView
        activeChannelId="channel-1"
        messages={messages}
        loading={false}
        wsConnected
        currentUserId="user-2"
        onLoadOlder={async () => {}}
      />,
    );

    const avatar = screen.getByRole('img', { name: 'alice' });
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveAttribute('src', 'http://localhost:4000/uploads/avatars/alice.png');
  });
});
