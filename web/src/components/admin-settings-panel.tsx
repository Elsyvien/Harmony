import type { AdminStats } from '../types/api';

interface AdminSettingsPanelProps {
  stats: AdminStats | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
}

function formatUptime(totalSec: number) {
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

export function AdminSettingsPanel(props: AdminSettingsPanelProps) {
  return (
    <section className="settings-panel">
      <div className="admin-header">
        <h2>Admin Settings</h2>
        <button className="ghost-btn" onClick={() => void props.onRefresh()} disabled={props.loading}>
          {props.loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {props.error ? <p className="error-banner">{props.error}</p> : null}
      {!props.stats ? <p className="muted">No server stats available yet.</p> : null}

      {props.stats ? (
        <div className="admin-stats-grid">
          <article className="setting-card stat-card">
            <h3>Server Health</h3>
            <p>
              <strong>Server time:</strong> {new Date(props.stats.serverTime).toLocaleString()}
            </p>
            <p>
              <strong>Uptime:</strong> {formatUptime(props.stats.uptimeSec)}
            </p>
            <p>
              <strong>Load avg:</strong> {props.stats.system.loadAverage.join(' / ')}
            </p>
          </article>

          <article className="setting-card stat-card">
            <h3>System Resources</h3>
            <p>
              <strong>CPU cores:</strong> {props.stats.system.cpuCores}
            </p>
            <p>
              <strong>RAM used:</strong> {props.stats.system.memoryMB.used} MB /{' '}
              {props.stats.system.memoryMB.total} MB
            </p>
            <p>
              <strong>RAM usage:</strong> {props.stats.system.memoryMB.usagePercent}%
            </p>
          </article>

          <article className="setting-card stat-card">
            <h3>Node Process</h3>
            <p>
              <strong>Version:</strong> {props.stats.node.version}
            </p>
            <p>
              <strong>RSS:</strong> {props.stats.node.memoryMB.rss} MB
            </p>
            <p>
              <strong>Heap:</strong> {props.stats.node.memoryMB.heapUsed} MB /{' '}
              {props.stats.node.memoryMB.heapTotal} MB
            </p>
          </article>

          <article className="setting-card stat-card">
            <h3>Database Usage</h3>
            <p className="stat-big">Users: {props.stats.database.users}</p>
            <p className="stat-big">Channels: {props.stats.database.channels}</p>
            <p className="stat-big">Messages: {props.stats.database.messages}</p>
            <p>
              <strong>Messages (last hour):</strong> {props.stats.database.messagesLastHour}
            </p>
          </article>
        </div>
      ) : null}
    </section>
  );
}
