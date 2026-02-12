import { useCallback, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { chatApi } from '../../../api/chat-api';
import type { Channel, FriendRequestSummary, FriendSummary } from '../../../types/api';
import { getErrorMessage } from '../../../utils/error-message';

export type SelectedProfileUser = {
  id: string;
  username: string;
  avatarUrl?: string;
};

export type SelectedUserFriendRequestState = 'self' | 'none' | 'friends' | 'outgoing' | 'incoming';

export function upsertChannel(existing: Channel[], incoming: Channel) {
  const next = existing.some((channel) => channel.id === incoming.id)
    ? existing.map((channel) => (channel.id === incoming.id ? incoming : channel))
    : [...existing, incoming];

  return next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

type UseProfileDmFeatureOptions = {
  authToken: string | null;
  currentUserId: string | undefined;
  friends: FriendSummary[];
  incomingRequests: FriendRequestSummary[];
  outgoingRequests: FriendRequestSummary[];
  friendActionBusyId: string | null;
  setFriendsError: Dispatch<SetStateAction<string | null>>;
  onDirectChannelOpened: (channel: Channel) => void;
};

export function useProfileDmFeature({
  authToken,
  currentUserId,
  friends,
  incomingRequests,
  outgoingRequests,
  friendActionBusyId,
  setFriendsError,
  onDirectChannelOpened,
}: UseProfileDmFeatureOptions) {
  const [selectedUser, setSelectedUser] = useState<SelectedProfileUser | null>(null);
  const [openingDmUserId, setOpeningDmUserId] = useState<string | null>(null);

  const selectedUserFriendRequestState = useMemo<SelectedUserFriendRequestState>(() => {
    if (!selectedUser || !currentUserId) {
      return 'none';
    }

    if (selectedUser.id === currentUserId) {
      return 'self';
    }

    if (friends.some((friend) => friend.user.id === selectedUser.id)) {
      return 'friends';
    }

    if (outgoingRequests.some((request) => request.to.id === selectedUser.id)) {
      return 'outgoing';
    }

    if (incomingRequests.some((request) => request.from.id === selectedUser.id)) {
      return 'incoming';
    }

    return 'none';
  }, [selectedUser, currentUserId, friends, outgoingRequests, incomingRequests]);

  const selectedUserIncomingRequestId = useMemo(() => {
    if (!selectedUser) {
      return null;
    }
    return incomingRequests.find((request) => request.from.id === selectedUser.id)?.id ?? null;
  }, [selectedUser, incomingRequests]);

  const acceptingSelectedUserFriendRequest =
    selectedUserIncomingRequestId !== null && friendActionBusyId === selectedUserIncomingRequestId;

  const openDirectMessage = useCallback(
    async (targetUserId: string) => {
      if (!authToken) {
        return;
      }
      setOpeningDmUserId(targetUserId);
      try {
        const response = await chatApi.createDirectChannel(authToken, targetUserId);
        onDirectChannelOpened(response.channel);
        setFriendsError(null);
      } catch (err) {
        setFriendsError(getErrorMessage(err, 'Could not open DM'));
      } finally {
        setOpeningDmUserId(null);
      }
    },
    [authToken, setFriendsError, onDirectChannelOpened],
  );

  return {
    selectedUser,
    setSelectedUser,
    selectedUserFriendRequestState,
    selectedUserIncomingRequestId,
    acceptingSelectedUserFriendRequest,
    openingDmUserId,
    openDirectMessage,
  };
}
