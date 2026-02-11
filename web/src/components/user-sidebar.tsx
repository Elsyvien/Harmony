interface UserSidebarProps {
  users: { id: string; username: string }[];
  onUserClick?: (user: { id: string; username: string }) => void;
}

export function UserSidebar({ users, onUserClick }: UserSidebarProps) {
  return (
    <aside className="user-sidebar">
      <header>
        <h2>ONLINE — {users.length}</h2>
      </header>
      <div className="user-list">
        {users.map((user) => (
          <div key={user.id} className="user-item" onClick={() => onUserClick?.(user)}>
            <div className="avatar" style={{ backgroundColor: stringToColor(user.username) }}>
              {user.username.slice(0, 1).toUpperCase()}
            </div>
            <span className="username">{user.username}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

function stringToColor(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const c = (hash & 0x00ffffff).toString(16).toUpperCase();
  return '#' + '00000'.substring(0, 6 - c.length) + c;
}
