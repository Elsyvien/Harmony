import { resolveMediaUrl } from '../utils/media-url';

interface UserProfileProps {
  user: { id: string; username: string; email?: string; createdAt?: string; avatarUrl?: string; state?: string } | null;
  onClose: () => void;
  currentUser?: { id: string };
  friendRequestState?: 'self' | 'none' | 'friends' | 'outgoing' | 'incoming';
  incomingRequestId?: string | null;
  sendingFriendRequest?: boolean;
  acceptingFriendRequest?: boolean;
  friendRequestError?: string | null;
  onSendFriendRequest?: (username: string) => Promise<void> | void;
  onAcceptFriendRequest?: (requestId: string) => Promise<void> | void;
}

export function UserProfile({
  user,
  onClose,
  currentUser,
  friendRequestState = 'none',
  incomingRequestId = null,
  sendingFriendRequest = false,
  acceptingFriendRequest = false,
  friendRequestError = null,
  onSendFriendRequest,
  onAcceptFriendRequest,
}: UserProfileProps) {
  if (!user) return null;

  const avatarUrl = resolveMediaUrl(user.avatarUrl);

  const isSelf = currentUser?.id === user.id || friendRequestState === 'self';
  const canSendFriendRequest = !isSelf && friendRequestState === 'none' && Boolean(onSendFriendRequest);
  const canAcceptFriendRequest =
    !isSelf &&
    friendRequestState === 'incoming' &&
    Boolean(incomingRequestId) &&
    Boolean(onAcceptFriendRequest);
  const isActionBusy = canAcceptFriendRequest ? acceptingFriendRequest : sendingFriendRequest;
  const isActionEnabled = canSendFriendRequest || canAcceptFriendRequest;
  const actionLabel = isActionBusy
    ? canAcceptFriendRequest
      ? 'Accepting...'
      : 'Sending...'
    : friendRequestState === 'friends'
      ? 'Already Friends'
      : friendRequestState === 'outgoing'
        ? 'Request Sent'
        : friendRequestState === 'incoming'
          ? 'Accept Friend Request'
          : 'Send Friend Request';

  return (
    <div className="user-profile-overlay" onClick={onClose}>
      <div className="user-profile-modal" onClick={(e) => e.stopPropagation()}>
        <header className="profile-banner"></header>
        <div className="profile-avatar">
          {avatarUrl ? (
            <img src={avatarUrl} alt={user.username} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover', border: '4px solid var(--modal-bg)' }} />
          ) : (
            user.username.slice(0, 1).toUpperCase()
          )}
          <div className={`status-dot-large ${user.state ?? 'online'}`} style={{ border: '4px solid #111214', width: '24px', height: '24px', bottom: '4px', right: '4px' }}></div>
        </div>
        <div className="profile-body">
          <div className="profile-header">
            <h3>{user.username}</h3>
            <span className="profile-tag">#{user.id.slice(0, 4)}</span>
          </div>

          <div className="profile-section">
            <label>MEMBER SINCE</label>
            <p>{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown'}</p>
          </div>

          <div className="profile-section">
            <label>ROLES</label>
            <div className="role-pill">Member</div>
          </div>

          {!isSelf ? (
            <div className="profile-section profile-actions">
              <button
                className="ghost-btn"
                disabled={!isActionEnabled || isActionBusy}
                onClick={() => {
                  if (canSendFriendRequest) {
                    void onSendFriendRequest?.(user.username);
                    return;
                  }
                  if (canAcceptFriendRequest && incomingRequestId) {
                    void onAcceptFriendRequest?.(incomingRequestId);
                  }
                }}
              >
                {actionLabel}
              </button>
              {friendRequestError ? <p className="error-banner compact">{friendRequestError}</p> : null}
            </div>
          ) : null}

          {currentUser && currentUser.id === user.id && (
            <div className="profile-section">
              <label>NOTE</label>
              <textarea placeholder="Click to add a note" className="note-input" rows={2} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
