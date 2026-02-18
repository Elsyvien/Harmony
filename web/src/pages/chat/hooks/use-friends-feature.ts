import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { chatApi } from '../../../api/chat-api';
import type { FriendRequestSummary, FriendSummary } from '../../../types/api';
import { getErrorMessage } from '../../../utils/error-message';

type UseFriendsFeatureOptions = {
  authToken: string | null;
  onNotice: Dispatch<SetStateAction<string | null>>;
};

type FriendAction =
  | 'acceptFriendRequest'
  | 'declineFriendRequest'
  | 'cancelFriendRequest'
  | 'removeFriend';

export function useFriendsFeature({ authToken, onNotice }: UseFriendsFeatureOptions) {
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequestSummary[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequestSummary[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [friendsError, setFriendsError] = useState<string | null>(null);
  const [friendActionBusyId, setFriendActionBusyId] = useState<string | null>(null);
  const [submittingFriendRequest, setSubmittingFriendRequest] = useState(false);

  const loadFriendData = useCallback(async () => {
    if (!authToken) {
      return;
    }
    setLoadingFriends(true);
    try {
      const [friendsResponse, requestResponse] = await Promise.all([
        chatApi.friends(authToken),
        chatApi.friendRequests(authToken),
      ]);
      setFriends(friendsResponse.friends);
      setIncomingRequests(requestResponse.incoming);
      setOutgoingRequests(requestResponse.outgoing);
      setFriendsError(null);
    } catch (err) {
      setFriendsError(getErrorMessage(err, 'Could not load friends'));
    } finally {
      setLoadingFriends(false);
    }
  }, [authToken]);

  const sendFriendRequest = useCallback(
    async (username: string) => {
      if (!authToken) {
        return false;
      }
      const normalizedUsername = username.trim().replace(/^@/, '');
      if (!normalizedUsername) {
        return false;
      }
      setSubmittingFriendRequest(true);
      try {
        await chatApi.sendFriendRequest(authToken, normalizedUsername);
        await loadFriendData();
        setFriendsError(null);
        onNotice(`Friend request sent to ${normalizedUsername}.`);
        return true;
      } catch (err) {
        setFriendsError(getErrorMessage(err, 'Could not send friend request'));
        onNotice(null);
        return false;
      } finally {
        setSubmittingFriendRequest(false);
      }
    },
    [authToken, loadFriendData, onNotice],
  );

  const runFriendAction = useCallback(
    async (requestOrFriendshipId: string, action: FriendAction, errorMessage: string) => {
      if (!authToken) {
        return;
      }
      setFriendActionBusyId(requestOrFriendshipId);
      try {
        await chatApi[action](authToken, requestOrFriendshipId);
        await loadFriendData();
      } catch (err) {
        setFriendsError(getErrorMessage(err, errorMessage));
      } finally {
        setFriendActionBusyId(null);
      }
    },
    [authToken, loadFriendData],
  );

  const acceptFriendRequest = useCallback(
    async (requestId: string) => {
      await runFriendAction(requestId, 'acceptFriendRequest', 'Could not accept request');
    },
    [runFriendAction],
  );

  const declineFriendRequest = useCallback(
    async (requestId: string) => {
      await runFriendAction(requestId, 'declineFriendRequest', 'Could not decline request');
    },
    [runFriendAction],
  );

  const cancelFriendRequest = useCallback(
    async (requestId: string) => {
      await runFriendAction(requestId, 'cancelFriendRequest', 'Could not cancel request');
    },
    [runFriendAction],
  );

  const removeFriend = useCallback(
    async (friendshipId: string) => {
      await runFriendAction(friendshipId, 'removeFriend', 'Could not remove friend');
    },
    [runFriendAction],
  );

  return {
    friends,
    incomingRequests,
    outgoingRequests,
    loadingFriends,
    friendsError,
    friendActionBusyId,
    submittingFriendRequest,
    setFriendsError,
    loadFriendData,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    cancelFriendRequest,
    removeFriend,
  };
}
