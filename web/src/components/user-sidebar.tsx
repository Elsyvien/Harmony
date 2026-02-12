import { useRef } from 'react';

interface UserSidebarProps {
  users: { id: string; username: string }[];
  onUserClick?: (user: { id: string; username: string }) => void;
  onUserContextMenu?: (
    user: { id: string; username: string },
    position: { x: number; y: number },
  ) => void;
}

function stringToColor(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const c = (hash & 0x00ffffff).toString(16).toUpperCase();
  return '#' + '00000'.substring(0, 6 - c.length) + c;
}

export function UserSidebar({ users, onUserClick, onUserContextMenu }: UserSidebarProps) {
  const longPressTimeoutRef = useRef<number | null>(null);

  const clearLongPress = () => {
    if (!longPressTimeoutRef.current) {
      return;
    }
    window.clearTimeout(longPressTimeoutRef.current);
    longPressTimeoutRef.current = null;
  };

  return (
    <aside className="user-sidebar">
      <header>
        <h2>ONLINE — {users.length}</h2>
      </header>
      <div className="user-list">
        {users.map((user) => (
          <div
            key={user.id}
            className="user-item"
            onClick={() => onUserClick?.(user)}
            onContextMenu={(event) => {
              if (!onUserContextMenu) {
                return;
              }
              event.preventDefault();
              onUserContextMenu(user, { x: event.clientX, y: event.clientY });
            }}
            onTouchStart={(event) => {
              if (!onUserContextMenu) {
                return;
              }
              const touch = event.touches[0];
              if (!touch) {
                return;
              }
              clearLongPress();
              longPressTimeoutRef.current = window.setTimeout(() => {
                onUserContextMenu(user, { x: touch.clientX, y: touch.clientY });
              }, 440);
            }}
            onTouchEnd={clearLongPress}
            onTouchCancel={clearLongPress}
            onTouchMove={clearLongPress}
          >
            <div className="user-item-avatar-wrapper">
              <div className="avatar" style={{ backgroundColor: stringToColor(user.username) }}>
                {user.username.slice(0, 1).toUpperCase()}
              </div>
              <div className="status-dot-large online"></div>
            </div>
            <div className="user-item-info">
              <span className="username">{user.username}</span>
              <span className="activity-text"></span>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
