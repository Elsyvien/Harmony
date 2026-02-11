import { useEffect, useMemo, useState } from 'react';
import type { User } from '../types/api';

interface SettingsPanelProps {
  user: User;
  wsConnected: boolean;
}

interface UserPreferences {
  compactMode: boolean;
  reducedMotion: boolean;
  use24HourClock: boolean;
}

const PREFS_KEY = 'discordclone_user_preferences';
const DEFAULT_PREFS: UserPreferences = {
  compactMode: false,
  reducedMotion: false,
  use24HourClock: false,
};

function loadPreferences(): UserPreferences {
  const raw = localStorage.getItem(PREFS_KEY);
  if (!raw) {
    return DEFAULT_PREFS;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return {
      compactMode: Boolean(parsed.compactMode),
      reducedMotion: Boolean(parsed.reducedMotion),
      use24HourClock: Boolean(parsed.use24HourClock),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function currentNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFS);
  const [notificationPermission, setNotificationPermission] = useState(currentNotificationPermission());
  const [requestingNotifications, setRequestingNotifications] = useState(false);

  useEffect(() => {
    setPreferences(loadPreferences());
  }, []);

  useEffect(() => {
    localStorage.setItem(PREFS_KEY, JSON.stringify(preferences));
    document.body.classList.toggle('compact-chat', preferences.compactMode);
    document.body.classList.toggle('reduced-motion', preferences.reducedMotion);
    document.body.classList.toggle('clock-24h', preferences.use24HourClock);
  }, [preferences]);

  const createdAt = useMemo(
    () =>
      new Date(props.user.createdAt).toLocaleString([], {
        hour12: !preferences.use24HourClock,
      }),
    [props.user.createdAt, preferences.use24HourClock],
  );

  return (
    <section className="settings-panel">
      <h2>User Settings</h2>
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
            If your token expires, you will be redirected to login automatically.
          </p>
        </article>

        <article className="setting-card">
          <h3>Appearance & Behavior</h3>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={preferences.compactMode}
              onChange={(event) =>
                setPreferences((prev) => ({ ...prev, compactMode: event.target.checked }))
              }
            />
            <span>
              <strong>Compact chat layout</strong>
              <small>Reduces spacing in message list for high-density channels.</small>
            </span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={preferences.reducedMotion}
              onChange={(event) =>
                setPreferences((prev) => ({ ...prev, reducedMotion: event.target.checked }))
              }
            />
            <span>
              <strong>Reduce motion</strong>
              <small>Turns off most UI animations and transitions.</small>
            </span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={preferences.use24HourClock}
              onChange={(event) =>
                setPreferences((prev) => ({ ...prev, use24HourClock: event.target.checked }))
              }
            />
            <span>
              <strong>24-hour clock</strong>
              <small>Uses 24h time format in user-facing timestamps.</small>
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
          <p className="muted setting-hint">Send: Enter | New line: Shift + Enter</p>
          <p className="muted setting-hint">
            In chat, you now get a jump button when new messages arrive while you read older ones.
          </p>
        </article>
      </div>
    </section>
  );
}
