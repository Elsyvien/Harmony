import { useMemo, useState } from 'react';
import type { User } from '../types/api';
import type { UserPreferences } from '../types/preferences';

interface SettingsPanelProps {
  user: User;
  wsConnected: boolean;
  preferences: UserPreferences;
  onUpdatePreferences: (patch: Partial<UserPreferences>) => void;
  onResetPreferences: () => void;
}

function currentNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const [notificationPermission, setNotificationPermission] = useState(currentNotificationPermission());
  const [requestingNotifications, setRequestingNotifications] = useState(false);

  const createdAt = useMemo(
    () =>
      new Date(props.user.createdAt).toLocaleString([], {
        hour12: !props.preferences.use24HourClock,
        ...(props.preferences.showSeconds ? { second: '2-digit' as const } : {}),
      }),
    [props.user.createdAt, props.preferences.use24HourClock, props.preferences.showSeconds],
  );

  return (
    <section className="settings-panel">
      <div className="admin-header">
        <h2>User Settings</h2>
        <button className="ghost-btn" onClick={props.onResetPreferences}>
          Reset preferences
        </button>
      </div>

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
          <p>
            <strong>Account created:</strong> {createdAt}
          </p>
        </article>

        <article className="setting-card">
          <h3>Connection</h3>
          <p>
            <strong>Realtime:</strong> {props.wsConnected ? 'Connected (WebSocket)' : 'Polling fallback'}
          </p>
          <p>
            <strong>Session:</strong> Active
          </p>
          <p className="muted setting-hint">
            Token/session refresh stays on chat when login is still valid.
          </p>
        </article>

        <article className="setting-card">
          <h3>Appearance</h3>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={props.preferences.compactMode}
              onChange={(event) =>
                props.onUpdatePreferences({ compactMode: event.target.checked })
              }
            />
            <span>
              <strong>Compact message spacing</strong>
              <small>Denser chat layout for high traffic channels.</small>
            </span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={props.preferences.reducedMotion}
              onChange={(event) =>
                props.onUpdatePreferences({ reducedMotion: event.target.checked })
              }
            />
            <span>
              <strong>Reduced motion</strong>
              <small>Disables UI transitions/animations.</small>
            </span>
          </label>

          <label className="field-inline">
            <span>
              <strong>Font scale</strong>
              <small>Adjust readability in chat and side panels.</small>
            </span>
            <select
              value={props.preferences.fontScale}
              onChange={(event) =>
                props.onUpdatePreferences({
                  fontScale: event.target.value as UserPreferences['fontScale'],
                })
              }
            >
              <option value="sm">Small</option>
              <option value="md">Normal</option>
              <option value="lg">Large</option>
            </select>
          </label>
        </article>

        <article className="setting-card">
          <h3>Messages & Time</h3>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={props.preferences.enterToSend}
              onChange={(event) =>
                props.onUpdatePreferences({ enterToSend: event.target.checked })
              }
            />
            <span>
              <strong>Send with Enter</strong>
              <small>
                Off: send with Ctrl/Cmd + Enter, keep Enter for new line.
              </small>
            </span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={props.preferences.use24HourClock}
              onChange={(event) =>
                props.onUpdatePreferences({ use24HourClock: event.target.checked })
              }
            />
            <span>
              <strong>24-hour clock</strong>
              <small>Display timestamps in 24h format.</small>
            </span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={props.preferences.showSeconds}
              onChange={(event) =>
                props.onUpdatePreferences({ showSeconds: event.target.checked })
              }
            />
            <span>
              <strong>Show seconds</strong>
              <small>Use precise timestamps in chat message headers.</small>
            </span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={props.preferences.playMessageSound}
              onChange={(event) =>
                props.onUpdatePreferences({ playMessageSound: event.target.checked })
              }
            />
            <span>
              <strong>Play message sound</strong>
              <small>Plays a short notification tone for incoming messages from others.</small>
            </span>
          </label>
        </article>

        <article className="setting-card">
          <h3>Notifications & Shortcuts</h3>
          <p>
            <strong>Browser notifications:</strong>{' '}
            {notificationPermission === 'unsupported'
              ? 'Not supported'
              : notificationPermission}
          </p>
          <button
            className="ghost-btn"
            disabled={
              notificationPermission === 'unsupported' ||
              notificationPermission === 'granted' ||
              requestingNotifications
            }
            onClick={async () => {
              if (typeof window === 'undefined' || !('Notification' in window)) {
                return;
              }
              setRequestingNotifications(true);
              try {
                const permission = await Notification.requestPermission();
                setNotificationPermission(permission);
              } finally {
                setRequestingNotifications(false);
              }
            }}
          >
            {requestingNotifications ? 'Requesting...' : 'Enable notifications'}
          </button>
          <p className="muted setting-hint">
            Search channels from the left sidebar, search messages in the chat header.
          </p>
          <p className="muted setting-hint">
            Compose: Enter/Shift+Enter or Ctrl/Cmd+Enter depending on your preference.
          </p>
        </article>
      </div>
    </section>
  );
}
