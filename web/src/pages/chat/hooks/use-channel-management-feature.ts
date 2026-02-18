import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { VoiceParticipant } from '../../../hooks/use-chat-socket';
import { chatApi } from '../../../api/chat-api';
import type { Channel } from '../../../types/api';
import { getErrorMessage } from '../../../utils/error-message';
import { upsertChannel } from './use-profile-dm-feature';

type MainView = 'chat' | 'friends' | 'settings' | 'admin';

type UseChannelManagementFeatureOptions = {
  authToken: string | null;
  isAdmin: boolean | undefined;
  canEditVoiceSettings: boolean;
  activeChannelId: string | null;
  activeVoiceChannelId: string | null;
  leaveVoice: (channelId: string) => boolean;
  setChannels: Dispatch<SetStateAction<Channel[]>>;
  setActiveChannelId: Dispatch<SetStateAction<string | null>>;
  setActiveView: Dispatch<SetStateAction<MainView>>;
  setVoiceParticipantsByChannel: Dispatch<SetStateAction<Record<string, VoiceParticipant[]>>>;
  setUnreadChannelCounts: Dispatch<SetStateAction<Record<string, number>>>;
  setActiveVoiceChannelId: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
};

export function useChannelManagementFeature({
  authToken,
  isAdmin,
  canEditVoiceSettings,
  activeChannelId,
  activeVoiceChannelId,
  leaveVoice,
  setChannels,
  setActiveChannelId,
  setActiveView,
  setVoiceParticipantsByChannel,
  setUnreadChannelCounts,
  setActiveVoiceChannelId,
  setError,
}: UseChannelManagementFeatureOptions) {
  const [deletingChannelId, setDeletingChannelId] = useState<string | null>(null);
  const [savingVoiceSettingsChannelId, setSavingVoiceSettingsChannelId] = useState<string | null>(null);

  const createChannel = useCallback(
    async (name: string, type: 'TEXT' | 'VOICE') => {
      if (!authToken || !isAdmin) {
        return;
      }
      try {
        const response = await chatApi.createChannel(authToken, name, type);
        setChannels((prev) => {
          const exists = prev.some((channel) => channel.id === response.channel.id);
          return exists ? prev : [...prev, response.channel];
        });
        setActiveChannelId(response.channel.id);
        setActiveView('chat');
        setError(null);
      } catch (err) {
        setError(getErrorMessage(err, 'Could not create channel'));
      }
    },
    [authToken, isAdmin, setChannels, setActiveChannelId, setActiveView, setError],
  );

  const updateVoiceChannelSettings = useCallback(
    async (
      channelId: string,
      input: { voiceBitrateKbps?: number; streamBitrateKbps?: number },
    ) => {
      if (!authToken || !canEditVoiceSettings) {
        return;
      }
      setSavingVoiceSettingsChannelId(channelId);
      try {
        const response = await chatApi.updateVoiceChannelSettings(authToken, channelId, input);
        setChannels((prev) => upsertChannel(prev, response.channel));
        setError(null);
      } catch (err) {
        setError(getErrorMessage(err, 'Could not update voice quality'));
      } finally {
        setSavingVoiceSettingsChannelId((current) => (current === channelId ? null : current));
      }
    },
    [authToken, canEditVoiceSettings, setChannels, setError],
  );

  const uploadAttachment = useCallback(
    async (file: File) => {
      if (!authToken) {
        throw new Error('Not authenticated');
      }
      try {
        const response = await chatApi.uploadAttachment(authToken, file);
        setError(null);
        return response.attachment;
      } catch (err) {
        setError(getErrorMessage(err, 'Could not upload attachment'));
        throw err;
      }
    },
    [authToken, setError],
  );

  const deleteChannel = useCallback(
    async (channelId: string) => {
      if (!authToken || !isAdmin) {
        return;
      }
      setDeletingChannelId(channelId);
      try {
        if (activeVoiceChannelId === channelId) {
          leaveVoice(channelId);
          setActiveVoiceChannelId(null);
        }
        await chatApi.deleteChannel(authToken, channelId);
        setChannels((prev) => {
          const nextChannels = prev.filter((channel) => channel.id !== channelId);
          if (activeChannelId === channelId) {
            const fallback = nextChannels.find((channel) => !channel.isDirect) ?? nextChannels[0] ?? null;
            setActiveChannelId(fallback?.id ?? null);
          }
          return nextChannels;
        });
        setVoiceParticipantsByChannel((prev) => {
          const next = { ...prev };
          delete next[channelId];
          return next;
        });
        setUnreadChannelCounts((prev) => {
          if (!prev[channelId]) {
            return prev;
          }
          const next = { ...prev };
          delete next[channelId];
          return next;
        });
        setError(null);
      } catch (err) {
        setError(getErrorMessage(err, 'Could not delete channel'));
      } finally {
        setDeletingChannelId(null);
      }
    },
    [
      authToken,
      isAdmin,
      activeVoiceChannelId,
      leaveVoice,
      setActiveVoiceChannelId,
      setChannels,
      activeChannelId,
      setActiveChannelId,
      setVoiceParticipantsByChannel,
      setUnreadChannelCounts,
      setError,
    ],
  );

  return {
    deletingChannelId,
    savingVoiceSettingsChannelId,
    createChannel,
    updateVoiceChannelSettings,
    uploadAttachment,
    deleteChannel,
  };
}
