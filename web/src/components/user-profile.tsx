interface UserProfileProps {
  user: { id: string; username: string; email?: string; createdAt?: string } | null;
  onClose: () => void;
  currentUser?: { id: string };
  friendRequestState?: 'self' | 'none' | 'friends' | 'outgoing' | 'incoming';
  sendingFriendRequest?: boolean;
  friendRequestError?: string | null;
  onSendFriendRequest?: (username: string) => Promise<void> | void;
}

export function UserProfile({
  user,
  onClose,
  currentUser,
  friendRequestState = 'none',
  sendingFriendRequest = false,
  friendRequestError = null,
  onSendFriendRequest,
}: UserProfileProps) {
  if (!user) return null;

  const isSelf = currentUser?.id === user.id || friendRequestState === 'self';
  const canSendFriendRequest = !isSelf && friendRequestState === 'none' && Boolean(onSendFriendRequest);
  const actionLabel = sendingFriendRequest
    ? 'Sending...'
    : friendRequestState === 'friends'
      ? 'Already Friends'
      : friendRequestState === 'outgoing'
        ? 'Request Sent'
        : friendRequestState === 'incoming'
          ? 'Request Received'
          : 'Send Friend Request';

  return (
    <div className="user-profile-overlay" onClick={onClose}>
      <div className="user-profile-modal" onClick={(e) => e.stopPropagation()}>
        <header className="profile-banner"></header>
        <div className="profile-avatar">
          {user.username.slice(0, 1).toUpperCase()}
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
                disabled={!canSendFriendRequest || sendingFriendRequest}
                onClick={() => {
                  if (!canSendFriendRequest) {
                    return;
                  }
                  void onSendFriendRequest?.(user.username);
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
