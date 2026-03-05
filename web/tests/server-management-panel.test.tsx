import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ServerManagementPanel } from '../src/components/server-management-panel';

const server = {
  id: 'server-1',
  slug: 'alpha',
  name: 'Alpha',
  description: null,
  iconUrl: null,
  visibility: 'INVITE_ONLY' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  owner: {
    id: 'owner-1',
    username: 'owner',
    avatarUrl: null,
  },
  memberRole: 'OWNER' as const,
  memberCount: 2,
};

describe('ServerManagementPanel', () => {
  it('shows permission message for non-managers', () => {
    render(
      <ServerManagementPanel
        server={server}
        canManage={false}
        loading={false}
        error={null}
        invites={[]}
        analytics={null}
        logs={[]}
        members={[]}
        moderationActions={[]}
        inviteBusy={false}
        moderationBusy={false}
        onRefresh={async () => {}}
        onCreateInvite={async () => {}}
        onRevokeInvite={async () => {}}
        onModerate={async () => {}}
      />,
    );

    expect(
      screen.getByText('You need moderator-level server role to access server management.'),
    ).toBeInTheDocument();
  });

  it('submits invite and moderation actions', () => {
    const onCreateInvite = vi.fn().mockResolvedValue(undefined);
    const onModerate = vi.fn().mockResolvedValue(undefined);

    render(
      <ServerManagementPanel
        server={server}
        canManage
        loading={false}
        error={null}
        invites={[]}
        analytics={{
          memberCount: 2,
          channelCount: 3,
          messageCount24h: 4,
          messageCount7d: 10,
          activeMembers24h: 2,
          moderationActions30d: 1,
          inviteJoins30d: 1,
        }}
        logs={[]}
        members={[
          {
            id: 'member-1',
            userId: 'user-2',
            role: 'MEMBER',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            user: {
              id: 'user-2',
              username: 'alice',
              avatarUrl: null,
            },
          },
        ]}
        moderationActions={[]}
        inviteBusy={false}
        moderationBusy={false}
        onRefresh={async () => {}}
        onCreateInvite={onCreateInvite}
        onRevokeInvite={async () => {}}
        onModerate={onModerate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Invite' }));
    expect(onCreateInvite).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Target' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Action' }));
    expect(onModerate).toHaveBeenCalledWith({
      targetUserId: 'user-2',
      type: 'WARN',
      reason: undefined,
      durationHours: undefined,
    });
  });
});

