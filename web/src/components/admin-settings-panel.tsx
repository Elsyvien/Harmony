import { useEffect, useState } from 'react';
import type { AdminSettings, AdminStats } from '../types/api';

interface AdminSettingsPanelProps {
  stats: AdminStats | null;
  settings: AdminSettings | null;
  settingsLoading: boolean;
  settingsError: string | null;
  savingSettings: boolean;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onRefreshSettings: () => Promise<void>;
  onSaveSettings: (settings: AdminSettings) => Promise<void>;
}

function formatUptime(totalSec: number) {
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

export function AdminSettingsPanel(props: AdminSettingsPanelProps) {
  const [draft, setDraft] = useState<AdminSettings>({
    allowRegistrations: true,
    readOnlyMode: false,
    slowModeSeconds: 0,
  });

  useEffect(() => {
    if (props.settings) {
      setDraft(props.settings);
    }
  }, [props.settings]);

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

      <article className="setting-card">
        <div className="admin-header">
          <h3>Runtime Controls</h3>
          <button className="ghost-btn" onClick={() => void props.onRefreshSettings()} disabled={props.settingsLoading}>
            {props.settingsLoading ? 'Loading...' : 'Reload'}
          </button>
        </div>

        {props.settingsError ? <p className="error-banner">{props.settingsError}</p> : null}

        <label className="toggle-row">
          <input
            type="checkbox"
            checked={draft.allowRegistrations}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, allowRegistrations: event.target.checked }))
            }
            disabled={props.settingsLoading || props.savingSettings}
          />
          <span>
            <strong>Allow registrations</strong>
            <small>Blocks new user signups when disabled.</small>
          </span>
        </label>

        <label className="toggle-row">
          <input
            type="checkbox"
            checked={draft.readOnlyMode}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, readOnlyMode: event.target.checked }))
            }
            disabled={props.settingsLoading || props.savingSettings}
          />
          <span>
            <strong>Read-only chat mode</strong>
            <small>Non-admin users cannot send messages.</small>
          </span>
        </label>

        <label className="field-inline">
          <span>
            <strong>Slow mode (seconds)</strong>
            <small>Limit how frequently non-admin users can send in a channel.</small>
          </span>
          <input
            type="number"
            min={0}
            max={60}
            value={draft.slowModeSeconds}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                slowModeSeconds: Math.max(0, Math.min(60, Number(event.target.value) || 0)),
              }))
            }
            disabled={props.settingsLoading || props.savingSettings}
          />
        </label>

        <button
          className="ghost-btn"
          onClick={() => void props.onSaveSettings(draft)}
          disabled={props.settingsLoading || props.savingSettings}
        >
          {props.savingSettings ? 'Saving...' : 'Save settings'}
        </button>
      </article>

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
