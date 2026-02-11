interface UserProfileProps {
  user: { id: string; username: string; email?: string; createdAt?: string } | null;
  onClose: () => void;
  currentUser?: { id: string };
}

export function UserProfile({ user, onClose, currentUser }: UserProfileProps) {
  if (!user) return null;

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
