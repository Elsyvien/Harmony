import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthProvider, useAuth } from '../src/store/auth-store';

const persistedUser = {
  id: 'user-1',
  username: 'max',
  email: 'max@example.com',
  role: 'OWNER' as const,
  isAdmin: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  avatarUrl: '/uploads/avatars/persisted.png',
};

function AuthProbe() {
  const auth = useAuth();
  return (
    <section>
      <button onClick={() => auth.setAuth('token-1', persistedUser)}>save-avatar</button>
      <p data-testid="avatar-url">{auth.user?.avatarUrl ?? 'none'}</p>
    </section>
  );
}

describe('AuthProvider avatar persistence', () => {
  it('persists uploaded avatar URL in auth store and localStorage', () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    fireEvent.click(screen.getByText('save-avatar'));

    expect(screen.getByTestId('avatar-url')).toHaveTextContent('/uploads/avatars/persisted.png');
    const storedRaw = localStorage.getItem('discordclone_user');
    expect(storedRaw).not.toBeNull();
    expect(JSON.parse(storedRaw ?? '{}')).toMatchObject({
      avatarUrl: '/uploads/avatars/persisted.png',
    });
  });
});
