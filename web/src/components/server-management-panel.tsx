import { useMemo, useState } from 'react';
import type {
  ModerationActionSummary,
  ServerAnalytics,
  ServerAuditLog,
  ServerInviteSummary,
  ServerMemberSummary,
  ServerSummary,
} from '../types/api';

type ModerationType = 'WARN' | 'TIMEOUT' | 'KICK' | 'BAN' | 'UNBAN';

interface ServerManagementPanelProps {
  server: ServerSummary | null;
  canManage: boolean;
  loading: boolean;
  error: string | null;
  invites: ServerInviteSummary[];
  analytics: ServerAnalytics | null;
  logs: ServerAuditLog[];
  members: ServerMemberSummary[];
  moderationActions: ModerationActionSummary[];
  inviteBusy: boolean;
  moderationBusy: boolean;
  onRefresh: () => Promise<void>;
  onCreateInvite: (input: { maxUses?: number; expiresInHours?: number }) => Promise<void>;
  onRevokeInvite: (inviteId: string) => Promise<void>;
  onModerate: (input: {
    targetUserId: string;
    type: ModerationType;
    reason?: string;
    durationHours?: number;
  }) => Promise<void>;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleString();
}

export function ServerManagementPanel({
  server,
  canManage,
  loading,
  error,
  invites,
  analytics,
  logs,
  members,
  moderationActions,
  inviteBusy,
  moderationBusy,
  onRefresh,
  onCreateInvite,
  onRevokeInvite,
  onModerate,
}: ServerManagementPanelProps) {
  const [inviteMaxUses, setInviteMaxUses] = useState<number>(0);
  const [inviteExpiresHours, setInviteExpiresHours] = useState<number>(24);
  const [memberSearch, setMemberSearch] = useState('');
  const [targetUserId, setTargetUserId] = useState('');
  const [moderationType, setModerationType] = useState<ModerationType>('WARN');
  const [moderationReason, setModerationReason] = useState('');
  const [moderationDurationHours, setModerationDurationHours] = useState<number>(24);

  const filteredMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    if (!query) {
      return members;
    }
    return members.filter((member) => member.user.username.toLowerCase().includes(query));
  }, [members, memberSearch]);

  if (!server) {
    return (
      <section className="settings-panel">
        <p className="muted">Select a server to manage.</p>
      </section>
    );
  }

  if (!canManage) {
    return (
      <section className="settings-panel">
        <h2>{server.name}</h2>
        <p className="muted">You need moderator-level server role to access server management.</p>
      </section>
    );
  }

  return (
    <section className="settings-panel server-management-panel">
      <div className="admin-header">
        <h2>Server Management</h2>
        <button className="ghost-btn" disabled={loading} onClick={() => void onRefresh()}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error ? <p className="error-banner">{error}</p> : null}

      <article className="setting-card">
        <h3>{server.name}</h3>
        <p className="muted">Slug: {server.slug}</p>
        <p className="muted">Members: {server.memberCount}</p>
        <p className="muted">Owner: @{server.owner.username}</p>
      </article>

      <article className="setting-card">
        <h3>Invite Management</h3>
        <form
          className="server-management-invite-form"
          onSubmit={async (event) => {
            event.preventDefault();
            await onCreateInvite({
              maxUses: inviteMaxUses > 0 ? inviteMaxUses : undefined,
              expiresInHours: inviteExpiresHours > 0 ? inviteExpiresHours : undefined,
            });
          }}
        >
          <label>
            <span>Max Uses (0 = unlimited)</span>
            <input
              type="number"
              min={0}
              max={1000}
              value={inviteMaxUses}
              onChange={(event) => setInviteMaxUses(Math.max(0, Number(event.target.value) || 0))}
            />
          </label>
          <label>
            <span>Expires In Hours (0 = never)</span>
            <input
              type="number"
              min={0}
              max={24 * 30}
              value={inviteExpiresHours}
              onChange={(event) =>
                setInviteExpiresHours(Math.max(0, Number(event.target.value) || 0))
              }
            />
          </label>
          <button className="ghost-btn" disabled={inviteBusy} type="submit">
            {inviteBusy ? 'Creating...' : 'Create Invite'}
          </button>
        </form>
        <div className="server-management-list">
          {invites.map((invite) => (
            <div key={invite.id} className="server-management-item">
              <div>
                <strong>{invite.code}</strong>
                <small>
                  Uses {invite.usesCount}
                  {invite.maxUses ? ` / ${invite.maxUses}` : ''} | Expires {formatDate(invite.expiresAt)}
                </small>
              </div>
              <button className="danger-btn" onClick={() => void onRevokeInvite(invite.id)}>
                Revoke
              </button>
            </div>
          ))}
          {invites.length === 0 ? <p className="muted">No invites yet.</p> : null}
        </div>
      </article>

      <article className="setting-card">
        <h3>Analytics</h3>
        {!analytics ? (
          <p className="muted">No analytics available yet.</p>
        ) : (
          <div className="admin-user-stats">
            <span className="status-chip neutral">Members {analytics.memberCount}</span>
            <span className="status-chip neutral">Channels {analytics.channelCount}</span>
            <span className="status-chip neutral">Msg 24h {analytics.messageCount24h}</span>
            <span className="status-chip neutral">Msg 7d {analytics.messageCount7d}</span>
            <span className="status-chip neutral">Active 24h {analytics.activeMembers24h}</span>
            <span className="status-chip neutral">Mod 30d {analytics.moderationActions30d}</span>
            <span className="status-chip neutral">Join 30d {analytics.inviteJoins30d}</span>
          </div>
        )}
      </article>

      <article className="setting-card">
        <h3>Moderation</h3>
        <form
          className="server-management-moderation-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!targetUserId) {
              return;
            }
            await onModerate({
              targetUserId,
              type: moderationType,
              reason: moderationReason.trim() || undefined,
              durationHours:
                moderationType === 'TIMEOUT'
                  ? Math.max(1, Number(moderationDurationHours) || 1)
                  : undefined,
            });
          }}
        >
          <label>
            <span>Action</span>
            <select
              value={moderationType}
              onChange={(event) => setModerationType(event.target.value as ModerationType)}
            >
              <option value="WARN">WARN</option>
              <option value="TIMEOUT">TIMEOUT</option>
              <option value="KICK">KICK</option>
              <option value="BAN">BAN</option>
              <option value="UNBAN">UNBAN</option>
            </select>
          </label>
          <label>
            <span>Target User ID</span>
            <input
              value={targetUserId}
              onChange={(event) => setTargetUserId(event.target.value)}
              placeholder="Select a member below or paste user id"
            />
          </label>
          <label>
            <span>Reason</span>
            <input
              value={moderationReason}
              onChange={(event) => setModerationReason(event.target.value)}
              placeholder="Optional reason"
            />
          </label>
          {moderationType === 'TIMEOUT' ? (
            <label>
              <span>Duration (hours)</span>
              <input
                type="number"
                min={1}
                max={24 * 30}
                value={moderationDurationHours}
                onChange={(event) =>
                  setModerationDurationHours(
                    Math.max(1, Math.min(24 * 30, Number(event.target.value) || 1)),
                  )
                }
              />
            </label>
          ) : null}
          <button className="ghost-btn" disabled={moderationBusy} type="submit">
            {moderationBusy ? 'Submitting...' : 'Submit Action'}
          </button>
        </form>

        <label className="field-inline">
          <span>
            <strong>Members</strong>
            <small>Filter and pick target user.</small>
          </span>
          <input
            className="admin-user-search"
            value={memberSearch}
            onChange={(event) => setMemberSearch(event.target.value)}
            placeholder="Search members"
          />
        </label>

        <div className="server-management-list">
          {filteredMembers.map((member) => (
            <div key={member.id} className="server-management-item">
              <div>
                <strong>@{member.user.username}</strong>
                <small>
                  {member.role} | Joined {formatDate(member.createdAt)}
                </small>
              </div>
              <button className="ghost-btn small" onClick={() => setTargetUserId(member.userId)}>
                Target
              </button>
            </div>
          ))}
          {filteredMembers.length === 0 ? <p className="muted">No members found.</p> : null}
        </div>

        <h4>Recent moderation actions</h4>
        <div className="server-management-list">
          {moderationActions.map((action) => (
            <div key={action.id} className="server-management-item">
              <div>
                <strong>{action.type}</strong>
                <small>
                  @{action.targetUser.username} by @{action.actor.username} at {formatDate(action.createdAt)}
                </small>
              </div>
            </div>
          ))}
          {moderationActions.length === 0 ? <p className="muted">No moderation actions yet.</p> : null}
        </div>
      </article>

      <article className="setting-card">
        <h3>Audit Logs</h3>
        <div className="server-management-list">
          {logs.map((log) => (
            <div key={log.id} className="server-management-item">
              <div>
                <strong>{log.action}</strong>
                <small>
                  {formatDate(log.createdAt)} | Actor {log.actor ? `@${log.actor.username}` : '-'} | Target{' '}
                  {log.targetUser ? `@${log.targetUser.username}` : '-'}
                </small>
              </div>
            </div>
          ))}
          {logs.length === 0 ? <p className="muted">No audit entries.</p> : null}
        </div>
      </article>
    </section>
  );
}

