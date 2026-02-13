import { useEffect, useMemo, useState } from 'react';
import type { AdminSettings, AdminStats, AdminUserSummary, UserRole } from '../types/api';

type AdminVoiceTestStatus = 'idle' | 'running' | 'pass' | 'fail';

export interface AdminVoiceTestEntry {
  id: string;
  label: string;
  description: string;
  status: AdminVoiceTestStatus;
  message: string;
  ranAt: number | null;
}

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
  users: AdminUserSummary[];
  usersLoading: boolean;
  usersError: string | null;
  updatingUserId: string | null;
  deletingUserId: string | null;
  onRefreshUsers: () => Promise<void>;
  onUpdateUser: (
    userId: string,
    input: Partial<{
      role: UserRole;
      avatarUrl: string | null;
      isSuspended: boolean;
      suspensionHours: number;
    }>,
  ) => Promise<void>;
  onDeleteUser: (userId: string) => Promise<void>;
  onClearUsersExceptCurrent: () => Promise<void>;
  clearingUsersExceptCurrent: boolean;
  currentUserId: string;
  voiceTests: AdminVoiceTestEntry[];
  runningVoiceTests: boolean;
  onRunVoiceTest: (testId: string) => Promise<void>;
  onRunAllVoiceTests: () => Promise<void>;
}

function formatUptime(totalSec: number) {
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

function formatSuspensionLabel(suspendedUntil: string | null) {
  if (!suspendedUntil) {
    return 'Suspended permanently';
  }
  return `Suspended until ${new Date(suspendedUntil).toLocaleString()}`;
}

export function AdminSettingsPanel(props: AdminSettingsPanelProps) {
  const [draft, setDraft] = useState<AdminSettings>({
    allowRegistrations: true,
    readOnlyMode: false,
    slowModeSeconds: 0,
    idleTimeoutMinutes: 15,
  });
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | UserRole>('ALL');
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);
  const [confirmDeleteText, setConfirmDeleteText] = useState('');
  const [avatarDraftByUserId, setAvatarDraftByUserId] = useState<Record<string, string>>({});
  const [suspensionHoursByUserId, setSuspensionHoursByUserId] = useState<Record<string, number>>({});
  const [confirmClearOthersOpen, setConfirmClearOthersOpen] = useState(false);
  const [confirmClearOthersText, setConfirmClearOthersText] = useState('');

  useEffect(() => {
    if (props.settings) {
      setDraft(props.settings);
    }
  }, [props.settings]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const user of props.users) {
      next[user.id] = user.avatarUrl ?? '';
    }
    setAvatarDraftByUserId(next);
  }, [props.users]);

  useEffect(() => {
    setSuspensionHoursByUserId((prev) => {
      const next: Record<string, number> = {};
      for (const user of props.users) {
        const existing = prev[user.id];
        next[user.id] = Number.isFinite(existing)
          ? Math.max(1, Math.min(24 * 30, Math.round(existing)))
          : 24;
      }
      return next;
    });
  }, [props.users]);

  const filteredUsers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return props.users.filter((user) => {
      if (roleFilter !== 'ALL' && user.role !== roleFilter) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      return (
        user.username.toLowerCase().includes(normalizedSearch) ||
        user.email.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [props.users, search, roleFilter]);

  const userStats = useMemo(
    () => ({
      total: props.users.length,
      owners: props.users.filter((user) => user.role === 'OWNER').length,
      admins: props.users.filter((user) => user.role === 'ADMIN').length,
      moderators: props.users.filter((user) => user.role === 'MODERATOR').length,
      members: props.users.filter((user) => user.role === 'MEMBER').length,
      suspended: props.users.filter((user) => user.isSuspended).length,
    }),
    [props.users],
  );

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

        <label className="field-inline">
          <span>
            <strong>Idle timeout (minutes)</strong>
            <small>How long until a user is automatically marked as Idle.</small>
          </span>
          <input
            type="number"
            min={1}
            max={120}
            value={draft.idleTimeoutMinutes}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                idleTimeoutMinutes: Math.max(1, Math.min(120, Number(event.target.value) || 15)),
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

      <article className="setting-card admin-test-menu">
        <div className="admin-header">
          <h3>Voice/Streaming Test Menu</h3>
          <button
            className="ghost-btn"
            onClick={() => void props.onRunAllVoiceTests()}
            disabled={props.runningVoiceTests}
          >
            {props.runningVoiceTests ? 'Running all tests...' : 'Run all tests'}
          </button>
        </div>
        <p className="muted-inline">
          Start tests directly from here and check pass/fail feedback immediately.
        </p>
        <div className="admin-test-list">
          {props.voiceTests.map((test) => (
            <div key={test.id} className="admin-test-row">
              <div className="admin-test-main">
                <strong>{test.label}</strong>
                <small>{test.description}</small>
                <small className="admin-test-message">{test.message}</small>
                <small className="admin-test-time">
                  {test.ranAt ? `Last run ${new Date(test.ranAt).toLocaleTimeString()}` : 'Not run yet'}
                </small>
              </div>
              <div className="admin-test-actions">
                <span
                  className={`status-chip ${
                    test.status === 'pass'
                      ? 'ok'
                      : test.status === 'fail'
                        ? 'danger'
                        : 'neutral'
                  }`}
                >
                  {test.status === 'running' ? 'RUNNING' : test.status.toUpperCase()}
                </span>
                <button
                  className="ghost-btn small"
                  onClick={() => void props.onRunVoiceTest(test.id)}
                  disabled={props.runningVoiceTests || test.status === 'running'}
                >
                  {test.status === 'running' ? 'Running...' : 'Run'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </article>

      <article className="setting-card">
        <div className="admin-header">
          <h3>User Management</h3>
          <div className="admin-header-actions">
            <button className="ghost-btn" onClick={() => void props.onRefreshUsers()} disabled={props.usersLoading || props.clearingUsersExceptCurrent}>
              {props.usersLoading ? 'Loading...' : 'Reload users'}
            </button>
            <button
              className="danger-btn"
              onClick={() => {
                if (confirmClearOthersOpen) {
                  setConfirmClearOthersOpen(false);
                  setConfirmClearOthersText('');
                  return;
                }
                setConfirmClearOthersOpen(true);
                setConfirmClearOthersText('');
              }}
              disabled={props.usersLoading || props.clearingUsersExceptCurrent}
            >
              {props.clearingUsersExceptCurrent
                ? 'Clearing...'
                : confirmClearOthersOpen
                  ? 'Cancel'
                  : 'Clear all other users'}
            </button>
          </div>
        </div>

        {props.usersError ? <p className="error-banner">{props.usersError}</p> : null}

        <div className="admin-user-stats">
          <span className="status-chip neutral">Total {userStats.total}</span>
          <span className="status-chip neutral">Owners {userStats.owners}</span>
          <span className="status-chip neutral">Admins {userStats.admins}</span>
          <span className="status-chip neutral">Mods {userStats.moderators}</span>
          <span className="status-chip neutral">Members {userStats.members}</span>
          <span className="status-chip danger">Suspended {userStats.suspended}</span>
        </div>

        <div className="admin-user-toolbar">
          <input
            className="admin-user-search"
            placeholder="Search by username or email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as 'ALL' | UserRole)}>
            <option value="ALL">All roles</option>
            <option value="OWNER">Owner</option>
            <option value="ADMIN">Admin</option>
            <option value="MODERATOR">Moderator</option>
            <option value="MEMBER">Member</option>
          </select>
        </div>

        {confirmClearOthersOpen ? (
          <div className="delete-confirm-row admin-clear-others-row">
            <p>
              This will delete every user account except your current one. Type <strong>DELETE ALL</strong> to confirm.
            </p>
            <input
              value={confirmClearOthersText}
              onChange={(event) => setConfirmClearOthersText(event.target.value)}
              placeholder='Type "DELETE ALL" to confirm'
              disabled={props.clearingUsersExceptCurrent}
            />
            <button
              className="danger-btn"
              disabled={
                props.clearingUsersExceptCurrent ||
                confirmClearOthersText.trim() !== 'DELETE ALL'
              }
              onClick={() => {
                void props.onClearUsersExceptCurrent();
                setConfirmClearOthersOpen(false);
                setConfirmClearOthersText('');
              }}
            >
              Confirm clear
            </button>
          </div>
        ) : null}

        <div className="admin-user-table-wrap">
          <table className="admin-user-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Profile</th>
                <th>Moderation</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => {
                const isSelf = user.id === props.currentUserId;
                const busy = props.updatingUserId === user.id || props.deletingUserId === user.id;
                const confirmOpen = confirmDeleteUserId === user.id;
                const canDelete = !isSelf && user.role !== 'OWNER';
                const suspensionHours = suspensionHoursByUserId[user.id] ?? 24;
                return [
                  <tr key={`row-${user.id}`}>
                    <td>
                      <strong>{user.username}</strong>
                      <small>{user.email}</small>
                    </td>
                    <td>
                      <select
                        value={user.role}
                        disabled={busy || isSelf}
                        onChange={(event) =>
                          void props.onUpdateUser(user.id, { role: event.target.value as UserRole })
                        }
                      >
                        <option value="OWNER">OWNER</option>
                        <option value="ADMIN">ADMIN</option>
                        <option value="MODERATOR">MODERATOR</option>
                        <option value="MEMBER">MEMBER</option>
                      </select>
                    </td>
                    <td>
                      <input
                        className="admin-avatar-input"
                        value={avatarDraftByUserId[user.id] ?? ''}
                        onChange={(event) =>
                          setAvatarDraftByUserId((prev) => ({
                            ...prev,
                            [user.id]: event.target.value,
                          }))
                        }
                        placeholder="https://example.com/avatar.png"
                        disabled={busy || isSelf}
                      />
                      <div className="admin-inline-actions">
                        <button
                          className="ghost-btn small"
                          disabled={busy || isSelf}
                          onClick={() =>
                            void props.onUpdateUser(user.id, {
                              avatarUrl: (avatarDraftByUserId[user.id] ?? '').trim() || null,
                            })
                          }
                        >
                          Save avatar
                        </button>
                        <button
                          className="ghost-btn small"
                          disabled={busy || isSelf || !user.avatarUrl}
                          onClick={() => {
                            setAvatarDraftByUserId((prev) => ({ ...prev, [user.id]: '' }));
                            void props.onUpdateUser(user.id, { avatarUrl: null });
                          }}
                        >
                          Clear
                        </button>
                      </div>
                      <small className="admin-url-preview">{user.avatarUrl ?? 'No avatar set'}</small>
                    </td>
                    <td>
                      <span className={`status-chip ${user.isSuspended ? 'danger' : 'ok'}`}>
                        {user.isSuspended ? 'Suspended' : 'Active'}
                      </span>
                      <small>
                        {user.isSuspended ? formatSuspensionLabel(user.suspendedUntil) : 'No active suspension'}
                      </small>
                      <div className="admin-inline-actions">
                        <input
                          className="admin-hours-input"
                          type="number"
                          min={1}
                          max={24 * 30}
                          value={suspensionHours}
                          disabled={busy || isSelf}
                          onChange={(event) => {
                            const next = Math.max(
                              1,
                              Math.min(24 * 30, Number(event.target.value) || 1),
                            );
                            setSuspensionHoursByUserId((prev) => ({ ...prev, [user.id]: next }));
                          }}
                        />
                        <button
                          className="ghost-btn small"
                          disabled={busy || isSelf}
                          onClick={() =>
                            void props.onUpdateUser(user.id, {
                              isSuspended: true,
                              suspensionHours,
                            })
                          }
                        >
                          Suspend
                        </button>
                        <button
                          className="ghost-btn small"
                          disabled={busy || isSelf || !user.isSuspended}
                          onClick={() =>
                            void props.onUpdateUser(user.id, {
                              isSuspended: false,
                            })
                          }
                        >
                          Unsuspend
                        </button>
                      </div>
                    </td>
                    <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                    <td className="admin-user-actions">
                      <button
                        className="danger-btn"
                        disabled={!canDelete || busy}
                        onClick={() => {
                          if (confirmOpen) {
                            setConfirmDeleteUserId(null);
                            setConfirmDeleteText('');
                            return;
                          }
                          setConfirmDeleteUserId(user.id);
                          setConfirmDeleteText('');
                        }}
                      >
                        {props.deletingUserId === user.id
                          ? 'Deleting...'
                          : confirmOpen
                            ? 'Cancel'
                            : 'Delete'}
                      </button>
                    </td>
                  </tr>,
                  confirmOpen ? (
                    <tr key={`confirm-${user.id}`}>
                      <td colSpan={6}>
                        <div className="delete-confirm-row">
                          <p>
                            Delete <strong>{user.username}</strong>? This removes account data and cannot be undone.
                          </p>
                          <input
                            value={confirmDeleteText}
                            onChange={(event) => setConfirmDeleteText(event.target.value)}
                            placeholder={`Type "${user.username}" to confirm`}
                            disabled={props.deletingUserId === user.id}
                          />
                          <button
                            className="danger-btn"
                            disabled={
                              props.deletingUserId === user.id ||
                              confirmDeleteText.trim() !== user.username
                            }
                            onClick={() => {
                              void props.onDeleteUser(user.id);
                              setConfirmDeleteUserId(null);
                              setConfirmDeleteText('');
                            }}
                          >
                            Confirm delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <p className="muted">No users found for current filter.</p>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
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
