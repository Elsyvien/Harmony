import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../src/components/settings-panel';
import { chatApi } from '../src/api/chat-api';
import { useAuth } from '../src/store/auth-store';

vi.mock('../src/api/chat-api', () => ({
  chatApi: {
    uploadAvatar: vi.fn(),
  },
}));

vi.mock('../src/store/auth-store', () => ({
  useAuth: vi.fn(),
}));

const uploadAvatarMock = vi.mocked(chatApi.uploadAvatar);
const useAuthMock = vi.mocked(useAuth);

const baseUser = {
  id: 'user-1',
  username: 'max',
  email: 'max@example.com',
  role: 'OWNER' as const,
  isAdmin: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  avatarUrl: '/uploads/avatars/old.png',
};

const basePreferences = {
  theme: 'dark' as const,
  compactMode: false,
  reducedMotion: false,
  fontScale: 'md' as const,
  enterToSend: true,
  use24HourClock: false,
  showSeconds: false,
  playMessageSound: true,
  voiceInputSensitivity: 0.03,
  voiceOutputVolume: 100,
  showVoiceActivity: true,
  autoMuteOnJoin: false,
  voiceInputDeviceId: null,
};

describe('SettingsPanel avatar upload flow', () => {
  const setAuth = vi.fn();

  beforeEach(() => {
    setAuth.mockReset();
    uploadAvatarMock.mockReset();
    useAuthMock.mockReturnValue({
      token: 'token-1',
      user: baseUser,
      hydrating: false,
      setAuth,
      clearAuth: vi.fn(),
    });
  });

  it('uploads avatar and updates auth state with success banner', async () => {
    const updatedUser = {
      ...baseUser,
      avatarUrl: '/uploads/avatars/new.png',
    };
    uploadAvatarMock.mockResolvedValue({ user: updatedUser });

    const { container } = render(
      <SettingsPanel
        user={baseUser}
        wsConnected
        preferences={basePreferences}
        audioInputDevices={[]}
        microphonePermission="granted"
        requestingMicrophonePermission={false}
        onUpdatePreferences={vi.fn()}
        onResetPreferences={vi.fn()}
        onRequestMicrophonePermission={async () => {}}
        onLogout={async () => {}}
      />,
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    const file = new File(['avatar-binary'], 'avatar.png', { type: 'image/png' });
    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [file] } });

    await waitFor(() => {
      expect(uploadAvatarMock).toHaveBeenCalledWith('token-1', file);
    });
    expect(setAuth).toHaveBeenCalledWith('token-1', updatedUser);
    expect(screen.getByText('Avatar updated successfully.')).toBeInTheDocument();
  });

  it('shows an error banner when upload fails', async () => {
    uploadAvatarMock.mockRejectedValue(new Error('Upload failed'));

    const { container } = render(
      <SettingsPanel
        user={baseUser}
        wsConnected
        preferences={basePreferences}
        audioInputDevices={[]}
        microphonePermission="granted"
        requestingMicrophonePermission={false}
        onUpdatePreferences={vi.fn()}
        onResetPreferences={vi.fn()}
        onRequestMicrophonePermission={async () => {}}
        onLogout={async () => {}}
      />,
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    const file = new File(['avatar-binary'], 'avatar.png', { type: 'image/png' });
    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('Upload failed')).toBeInTheDocument();
    });
  });
});
