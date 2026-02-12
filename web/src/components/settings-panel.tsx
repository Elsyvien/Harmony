import { useMemo, useState } from 'react';
import type { User } from '../types/api';
import type { UserPreferences } from '../types/preferences';

interface SettingsPanelProps {
  user: User;
  wsConnected: boolean;
  preferences: UserPreferences;
  onUpdatePreferences: (patch: Partial<UserPreferences>) => void;
  onResetPreferences: () => void;
  onLogout: () => Promise<void>;
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
  const [loggingOut, setLoggingOut] = useState(false);

  const createdAt = useMemo(
    () =>
      new Date(props.user.createdAt).toLocaleString([], {
        hour12: !props.preferences.use24HourClock,
        ...(props.preferences.showSeconds ? { second: '2-digit' as const } : {}),
      }),
    [props.user.createdAt, props.preferences.use24HourClock, props.preferences.showSeconds],
  );

  const connectionLabel = props.wsConnected ? 'Connected (WebSocket)' : 'Polling fallback';

  return (
    <section className="settings-panel discord-settings-panel">
      <div className="settings-shell">
        <aside className="settings-sidebar">
          <div className="settings-profile">
            <div className="settings-avatar">
              {props.user.username.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <strong>{props.user.username}</strong>
              <small>{props.user.email}</small>
            </div>
          </div>
          <p className="settings-nav-title">User Settings</p>
          <nav className="settings-nav-list" aria-label="Settings sections">
            <a className="settings-nav-item" href="#account">My Account</a>
            <a className="settings-nav-item" href="#appearance">Appearance</a>
            <a className="settings-nav-item" href="#messages">Messages & Time</a>
            <a className="settings-nav-item" href="#voice">Voice & Audio</a>
            <a className="settings-nav-item" href="#notifications">Notifications</a>
          </nav>
        </aside>

        <div className="settings-content">
          <header className="settings-toolbar">
            <div>
              <h2>User Settings</h2>
              <p className="muted">Personalize your Harmony experience.</p>
            </div>
            <div className="settings-actions">
              <button className="ghost-btn" onClick={props.onResetPreferences}>
                Reset preferences
              </button>
            </div>
          </header>

          <section id="account" className="settings-section">
            <h3>My Account</h3>
            <div className="settings-account-grid">
              <div className="settings-account-item">
                <span>Username</span>
                <strong>{props.user.username}</strong>
              </div>
              <div className="settings-account-item">
                <span>Email</span>
                <strong>{props.user.email}</strong>
              </div>
              <div className="settings-account-item">
                <span>Role</span>
                <strong>{props.user.role}</strong>
              </div>
              <div className="settings-account-item">
                <span>Created</span>
                <strong>{createdAt}</strong>
              </div>
            </div>

            <div className="settings-row">
              <span className="settings-row-copy">
                <strong>Realtime connection</strong>
                <small>Status of your websocket session.</small>
              </span>
              <span className={`status-chip ${props.wsConnected ? 'ok' : 'neutral'}`}>
                {connectionLabel}
              </span>
            </div>

            <div className="settings-danger-zone">
              <div>
                <strong>Log Out</strong>
                <small>End your current session on this device.</small>
              </div>
              <button
                className="danger-btn"
                disabled={loggingOut}
                onClick={async () => {
                  setLoggingOut(true);
                  try {
                    await props.onLogout();
                  } finally {
                    setLoggingOut(false);
                  }
                }}
              >
                {loggingOut ? 'Logging out...' : 'Log Out'}
              </button>
            </div>
          </section>

          <section id="appearance" className="settings-section">
            <h3>Appearance</h3>
            <label className="settings-row">
              <span className="settings-row-copy">
                <strong>Compact message spacing</strong>
                <small>Denser chat layout for high-traffic channels.</small>
              </span>
              <input
                className="settings-toggle"
                type="checkbox"
                checked={props.preferences.compactMode}
                onChange={(event) =>
                  props.onUpdatePreferences({ compactMode: event.target.checked })
                }
              />
            </label>

            <label className="settings-row">
              <span className="settings-row-copy">
                <strong>Reduced motion</strong>
                <small>Disable UI transitions and animations.</small>
              </span>
              <input
                className="settings-toggle"
                type="checkbox"
                checked={props.preferences.reducedMotion}
                onChange={(event) =>
                  props.onUpdatePreferences({ reducedMotion: event.target.checked })
                }
              />
            </label>

            <label className="settings-row">
              <span className="settings-row-copy">
                <strong>Font scale</strong>
                <small>Adjust readability in chat and side panels.</small>
              </span>
              <select
                className="settings-select"
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
          </section>

          <section id="messages" className="settings-section">
            <h3>Messages & Time</h3>
            <label className="settings-row">
              <span className="settings-row-copy">
                <strong>Send with Enter</strong>
                <small>Disable to use Ctrl/Cmd + Enter for sending.</small>
              </span>
              <input
                className="settings-toggle"
                type="checkbox"
                checked={props.preferences.enterToSend}
                onChange={(event) =>
                  props.onUpdatePreferences({ enterToSend: event.target.checked })
                }
              />
            </label>

            <label className="settings-row">
              <span className="settings-row-copy">
                <strong>24-hour clock</strong>
                <small>Display timestamps in 24h format.</small>
              </span>
              <input
                className="settings-toggle"
                type="checkbox"
                checked={props.preferences.use24HourClock}
                onChange={(event) =>
                  props.onUpdatePreferences({ use24HourClock: event.target.checked })
                }
              />
            </label>

            <label className="settings-row">
              <span className="settings-row-copy">
                <strong>Show seconds</strong>
                <small>Use precise timestamps in message headers.</small>
              </span>
              <input
                className="settings-toggle"
                type="checkbox"
                checked={props.preferences.showSeconds}
                onChange={(event) =>
                  props.onUpdatePreferences({ showSeconds: event.target.checked })
                }
              />
            </label>

            <label className="settings-row">
              <span className="settings-row-copy">
                <strong>Play message sound</strong>
                <small>Play a subtle tone for incoming messages.</small>
              </span>
              <input
                className="settings-toggle"
                type="checkbox"
                checked={props.preferences.playMessageSound}
                onChange={(event) =>
                  props.onUpdatePreferences({ playMessageSound: event.target.checked })
                }
              />
            </label>
          </section>

          <section id="voice" className="settings-section">
            <h3>Voice & Audio</h3>
            <div className="settings-row settings-row-stacked">
              <span className="settings-row-copy">
                <strong>Input sensitivity</strong>
                <small>Lower values react faster to quieter voices.</small>
              </span>
              <div className="settings-range-wrap">
                <input
                  className="settings-range"
                  type="range"
                  min={0.005}
                  max={0.12}
                  step={0.005}
                  value={props.preferences.voiceInputSensitivity}
                  onChange={(event) =>
                    props.onUpdatePreferences({ voiceInputSensitivity: Number(event.target.value) })
                  }
                />
                <span className="settings-value-pill">{props.preferences.voiceInputSensitivity.toFixed(3)}</span>
              </div>
            </div>

            <div className="settings-row settings-row-stacked">
              <span className="settings-row-copy">
                <strong>Output volume</strong>
                <small>Applies to all incoming voice streams.</small>
              </span>
              <div className="settings-range-wrap">
                <input
                  className="settings-range"
                  type="range"
                  min={0}
                  max={200}
                  step={5}
                  value={props.preferences.voiceOutputVolume}
                  onChange={(event) =>
                    props.onUpdatePreferences({ voiceOutputVolume: Number(event.target.value) })
                  }
                />
                <span className="settings-value-pill">{props.preferences.voiceOutputVolume}%</span>
              </div>
            </div>

            <label className="settings-row">
              <span className="settings-row-copy">
                <strong>Show speaking indicators</strong>
                <small>Highlight users while they are actively speaking.</small>
              </span>
              <input
                className="settings-toggle"
                type="checkbox"
                checked={props.preferences.showVoiceActivity}
                onChange={(event) =>
                  props.onUpdatePreferences({ showVoiceActivity: event.target.checked })
                }
              />
            </label>

            <label className="settings-row">
              <span className="settings-row-copy">
                <strong>Join voice muted</strong>
                <small>Keep microphone muted until you explicitly unmute.</small>
              </span>
              <input
                className="settings-toggle"
                type="checkbox"
                checked={props.preferences.autoMuteOnJoin}
                onChange={(event) =>
                  props.onUpdatePreferences({ autoMuteOnJoin: event.target.checked })
                }
              />
            </label>
          </section>

          <section id="notifications" className="settings-section">
            <h3>Notifications & Shortcuts</h3>
            <div className="settings-row">
              <span className="settings-row-copy">
                <strong>Browser notifications</strong>
                <small>
                  {notificationPermission === 'unsupported'
                    ? 'This browser does not support notifications.'
                    : `Current permission: ${notificationPermission}`}
                </small>
              </span>
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
            </div>

            <div className="settings-shortcuts">
              <p>Search channels in the left sidebar.</p>
              <p>Search messages from the chat header input.</p>
              <p>Compose with Enter/Shift+Enter or Ctrl/Cmd+Enter based on your preference.</p>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
