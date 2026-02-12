import { useCallback, useEffect, useMemo, useState } from 'react';
import type { VoiceParticipant } from '../../../hooks/use-chat-socket';
import type { Channel, UserRole } from '../../../types/api';

export type UserAudioPreference = { volume: number; muted: boolean };

type AudioContextMenuState = {
  userId: string;
  username: string;
  x: number;
  y: number;
};

const USER_AUDIO_PREFS_KEY = 'harmony_user_audio_prefs_v1';

function parseUserAudioPrefs(raw: string | null): Record<string, UserAudioPreference> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<UserAudioPreference>>;
    const normalized: Record<string, UserAudioPreference> = {};
    for (const [userId, pref] of Object.entries(parsed)) {
      if (!pref) {
        continue;
      }
      const volume =
        typeof pref.volume === 'number' ? Math.min(100, Math.max(0, Math.round(pref.volume))) : 100;
      const muted = Boolean(pref.muted);
      normalized[userId] = { volume, muted };
    }
    return normalized;
  } catch {
    return {};
  }
}

export function canModerateVoiceSettings(role: UserRole | null | undefined) {
  return role === 'OWNER' || role === 'ADMIN' || role === 'MODERATOR';
}

type UseVoiceFeatureOptions = {
  channels: Channel[];
  activeChannelId: string | null;
  activeVoiceChannelId: string | null;
  voiceParticipantsByChannel: Record<string, VoiceParticipant[]>;
  remoteScreenShares: Record<string, MediaStream>;
  localScreenShareStream: MediaStream | null;
  authUserId: string | undefined;
  authUserRole: UserRole | null | undefined;
};

export function useVoiceFeature({
  channels,
  activeChannelId,
  activeVoiceChannelId,
  voiceParticipantsByChannel,
  remoteScreenShares,
  localScreenShareStream,
  authUserId,
  authUserRole,
}: UseVoiceFeatureOptions) {
  const [userAudioPrefs, setUserAudioPrefs] = useState<Record<string, UserAudioPreference>>(() =>
    parseUserAudioPrefs(localStorage.getItem(USER_AUDIO_PREFS_KEY)),
  );
  const [audioContextMenu, setAudioContextMenu] = useState<AudioContextMenuState | null>(null);

  const activeVoiceChannel = useMemo(
    () => channels.find((channel) => channel.id === activeVoiceChannelId) ?? null,
    [channels, activeVoiceChannelId],
  );
  const activeVoiceBitrateKbps = activeVoiceChannel?.voiceBitrateKbps ?? 64;
  const activeStreamBitrateKbps = activeVoiceChannel?.streamBitrateKbps ?? 2500;
  const canEditVoiceSettings = canModerateVoiceSettings(authUserRole);

  const voiceParticipantCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [channelId, participants] of Object.entries(voiceParticipantsByChannel)) {
      counts[channelId] = participants.length;
    }
    return counts;
  }, [voiceParticipantsByChannel]);

  const activeVoiceParticipants = useMemo(() => {
    if (!activeChannelId) {
      return [];
    }
    return voiceParticipantsByChannel[activeChannelId] ?? [];
  }, [activeChannelId, voiceParticipantsByChannel]);

  const joinedVoiceParticipants = useMemo(() => {
    if (!activeVoiceChannelId) {
      return [];
    }
    return voiceParticipantsByChannel[activeVoiceChannelId] ?? [];
  }, [activeVoiceChannelId, voiceParticipantsByChannel]);

  const voiceStreamingUserIdsByChannel = useMemo(() => {
    const byChannel: Record<string, string[]> = {};
    if (!activeVoiceChannelId) {
      return byChannel;
    }
    const liveUserIds = new Set<string>(Object.keys(remoteScreenShares));
    if (localScreenShareStream && authUserId) {
      liveUserIds.add(authUserId);
    }
    byChannel[activeVoiceChannelId] = [...liveUserIds];
    return byChannel;
  }, [activeVoiceChannelId, remoteScreenShares, localScreenShareStream, authUserId]);

  const getUserAudioState = useCallback(
    (userId: string): UserAudioPreference => userAudioPrefs[userId] ?? { volume: 100, muted: false },
    [userAudioPrefs],
  );

  const openUserAudioMenu = useCallback(
    (user: { id: string; username: string }, position: { x: number; y: number }) => {
      if (!authUserId || user.id === authUserId) {
        return;
      }
      const menuWidth = 280;
      const menuHeight = 190;
      const x = Math.max(8, Math.min(position.x, window.innerWidth - menuWidth - 8));
      const y = Math.max(8, Math.min(position.y, window.innerHeight - menuHeight - 8));
      setAudioContextMenu({
        userId: user.id,
        username: user.username,
        x,
        y,
      });
    },
    [authUserId],
  );

  const closeAudioContextMenu = useCallback(() => {
    setAudioContextMenu(null);
  }, []);

  const setUserVolume = useCallback((userId: string, volume: number) => {
    setUserAudioPrefs((prev) => ({
      ...prev,
      [userId]: {
        volume: Math.min(100, Math.max(0, Math.round(volume))),
        muted: prev[userId]?.muted ?? false,
      },
    }));
  }, []);

  const toggleUserMuted = useCallback((userId: string) => {
    setUserAudioPrefs((prev) => {
      const current = prev[userId] ?? { volume: 100, muted: false };
      return {
        ...prev,
        [userId]: {
          ...current,
          muted: !current.muted,
        },
      };
    });
  }, []);

  useEffect(() => {
    localStorage.setItem(USER_AUDIO_PREFS_KEY, JSON.stringify(userAudioPrefs));
  }, [userAudioPrefs]);

  useEffect(() => {
    if (!audioContextMenu) {
      return;
    }
    const close = () => setAudioContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [audioContextMenu]);

  return {
    activeVoiceChannel,
    activeVoiceBitrateKbps,
    activeStreamBitrateKbps,
    canEditVoiceSettings,
    voiceParticipantCounts,
    activeVoiceParticipants,
    joinedVoiceParticipants,
    voiceStreamingUserIdsByChannel,
    audioContextMenu,
    closeAudioContextMenu,
    openUserAudioMenu,
    getUserAudioState,
    setUserVolume,
    toggleUserMuted,
  };
}
