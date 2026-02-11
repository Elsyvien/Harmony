import type { User } from '../types/api';

interface SettingsPanelProps {
  user: User;
  wsConnected: boolean;
}

export function SettingsPanel(props: SettingsPanelProps) {
  return (
    <section className="settings-panel">
      <h2>Settings</h2>
      <div className="settings-grid">
        <article className="setting-card">
          <h3>Account</h3>
          <p>
            <strong>Username:</strong> {props.user.username}
          </p>
          <p>
            <strong>Email:</strong> {props.user.email}
          </p>
          <p>
            <strong>Role:</strong> {props.user.role}
          </p>
        </article>

        <article className="setting-card">
          <h3>Connection</h3>
          <p>
            <strong>Realtime:</strong> {props.wsConnected ? 'Connected (WebSocket)' : 'Polling'}
          </p>
          <p>
            <strong>Account created:</strong> {new Date(props.user.createdAt).toLocaleString()}
          </p>
        </article>
      </div>
    </section>
  );
}
