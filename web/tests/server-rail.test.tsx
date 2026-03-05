import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ServerRail } from '../src/components/server-rail';

describe('ServerRail', () => {
  it('renders servers and triggers selection callbacks', () => {
    const onSelectHome = vi.fn();
    const onSelectServer = vi.fn();
    const onCreateServer = vi.fn();
    const onJoinServer = vi.fn();

    render(
      <ServerRail
        servers={[
          {
            id: 'server-1',
            slug: 'alpha',
            name: 'Alpha Team',
            description: null,
            iconUrl: null,
            visibility: 'INVITE_ONLY',
            createdAt: '2026-01-01T00:00:00.000Z',
            owner: {
              id: 'owner-1',
              username: 'owner',
              avatarUrl: null,
            },
            memberRole: 'OWNER',
            memberCount: 3,
          },
        ]}
        scope={{ kind: 'home' }}
        onSelectHome={onSelectHome}
        onSelectServer={onSelectServer}
        onCreateServer={onCreateServer}
        onJoinServer={onJoinServer}
        creatingServer={false}
        joiningServer={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'Alpha Team' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create server' }));
    fireEvent.click(screen.getByRole('button', { name: 'Join server by invite' }));

    expect(onSelectHome).toHaveBeenCalledTimes(1);
    expect(onSelectServer).toHaveBeenCalledWith('server-1');
    expect(onCreateServer).toHaveBeenCalledTimes(1);
    expect(onJoinServer).toHaveBeenCalledTimes(1);
  });
});

