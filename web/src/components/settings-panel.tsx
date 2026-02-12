import { useMemo, useRef, useState } from 'react';
import type { User } from '../types/api';
import type { UserPreferences } from '../types/preferences';
import { DropdownSelect } from './dropdown-select';
import { smoothScrollTo } from '../utils/smooth-scroll';

interface SettingsPanelProps {
  user: User;
  wsConnected: boolean;
  preferences: UserPreferences;
  audioInputDevices: Array<{ deviceId: string; label: string }>;
  microphonePermission:
    | 'granted'
    | 'denied'
    | 'prompt'
    | 'unsupported'
    | 'unknown';
  requestingMicrophonePermission: boolean;
  onUpdatePreferences: (patch: Partial<UserPreferences>) => void;
  onResetPreferences: () => void;
  onRequestMicrophonePermission: () => Promise<void>;
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
  const [notificationHint, setNotificationHint] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [activeSection, setActiveSection] = useState('account');
  const scrollContainerRef = useRef<HTMLElement | null>(null);

  const createdAt = useMemo(
    () =>
      new Date(props.user.createdAt).toLocaleString([], {
        hour12: !props.preferences.use24HourClock,
        ...(props.preferences.showSeconds ? { second: '2-digit' as const } : {}),
      }),
    [props.user.createdAt, props.preferences.use24HourClock, props.preferences.showSeconds],
  );

  const connectionLabel = props.wsConnected ? 'Connected (WebSocket)' : 'Polling fallback';
  const canRequestNotifications =
    notificationPermission !== 'unsupported' &&
    notificationPermission !== 'granted' &&
    !requestingNotifications;

  const jumpToSection = (sectionId: string) => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    const node = container.querySelector<HTMLElement>(`#${sectionId}`);
    if (!node) {
      return;
    }

    setActiveSection(sectionId);

    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const targetTop = Math.max(0, nodeRect.top - containerRect.top + container.scrollTop - 8);

    smoothScrollTo(container, targetTop, { reducedMotion: props.preferences.reducedMotion });
  };

  return (
    <section ref={scrollContainerRef} className="settings-panel discord-settings-panel">
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
            <button
              type="button"
              className={`settings-nav-item ${activeSection === 'account' ? 'active' : ''}`}
              onClick={() => jumpToSection('account')}
            >
              My Account
            </button>
            <button
              type="button"
              className={`settings-nav-item ${activeSection === 'appearance' ? 'active' : ''}`}
              onClick={() => jumpToSection('appearance')}
            >
              Appearance
            </button>
            <button
              type="button"
              className={`settings-nav-item ${activeSection === 'messages' ? 'active' : ''}`}
              onClick={() => jumpToSection('messages')}
            >
              Messages & Time
            </button>
            <button
              type="button"
              className={`settings-nav-item ${activeSection === 'voice' ? 'active' : ''}`}
              onClick={() => jumpToSection('voice')}
            >
              Voice & Audio
            </button>
            <button
              type="button"
              className={`settings-nav-item ${activeSection === 'notifications' ? 'active' : ''}`}
              onClick={() => jumpToSection('notifications')}
            >
              Notifications
            </button>
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
                <strong>Color theme</strong>
                <small>Switch between dark and light mode.</small>
              </span>
              <DropdownSelect
                options={['Dark', 'Light']}
                value={props.preferences.theme === 'dark' ? 'Dark' : 'Light'}
                onChange={(value) => {
                  props.onUpdatePreferences({
                    theme: value === 'Dark' ? 'dark' : 'light',
                  });
                }}
              />
            </label>

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
              <DropdownSelect
                options={['Small', 'Normal', 'Large']}
                value={
                  props.preferences.fontScale === 'sm'
                    ? 'Small'
                    : props.preferences.fontScale === 'lg'
                      ? 'Large'
                      : 'Normal'
                }
                onChange={(value) => {
                  const scaleMap = { Small: 'sm', Normal: 'md', Large: 'lg' } as const;
                  props.onUpdatePreferences({
                    fontScale: scaleMap[value as keyof typeof scaleMap],
                  });
                }}
              />
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

            <label className="settings-row">
              <span className="settings-row-copy">
                <strong>Input device</strong>
                <small>Select which microphone is used for voice chat.</small>
              </span>
              <DropdownSelect
                options={[
                  'System default microphone',
                  ...props.audioInputDevices.map((device) => device.label),
                ]}
                value={
                  props.preferences.voiceInputDeviceId
                    ? props.audioInputDevices.find(
                        (device) => device.deviceId === props.preferences.voiceInputDeviceId
                      )?.label || 'System default microphone'
                    : 'System default microphone'
                }
                onChange={(value) => {
                  if (value === 'System default microphone') {
                    props.onUpdatePreferences({ voiceInputDeviceId: null });
                  } else {
                    const device = props.audioInputDevices.find((d) => d.label === value);
                    if (device) {
                      props.onUpdatePreferences({ voiceInputDeviceId: device.deviceId });
                    }
                  }
                }}
              />
            </label>

            <div className="settings-row">
              <span className="settings-row-copy">
                <strong>Microphone permission</strong>
                <small>
                  {props.microphonePermission === 'unsupported'
                    ? 'Microphone API is not supported in this browser.'
                    : `Current permission: ${props.microphonePermission}`}
                </small>
              </span>
              <button
                className="ghost-btn"
                disabled={
                  props.microphonePermission === 'unsupported' ||
                  props.requestingMicrophonePermission
                }
                onClick={() => {
                  void props.onRequestMicrophonePermission();
                }}
              >
                {props.requestingMicrophonePermission ? 'Requesting...' : 'Enable microphone'}
              </button>
            </div>
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
                disabled={!canRequestNotifications}
                onClick={async () => {
                  if (typeof window === 'undefined' || !('Notification' in window)) {
                    setNotificationHint('Notifications are not supported in this browser.');
                    return;
                  }
                  if (!window.isSecureContext) {
                    setNotificationHint(
                      'Notification permission requires HTTPS (or localhost).',
                    );
                    return;
                  }
                  setRequestingNotifications(true);
                  setNotificationHint(null);
                  try {
                    const permission = await Notification.requestPermission();
                    setNotificationPermission(permission);
                    if (permission === 'default') {
                      setNotificationHint(
                        'Permission prompt was dismissed. On mobile, open browser site settings to allow notifications.',
                      );
                    }
                    if (permission === 'denied') {
                      setNotificationHint(
                        'Notifications are blocked. Enable them in your browser/site settings.',
                      );
                    }
                  } catch {
                    setNotificationHint(
                      'Could not request notification permission in this browser context.',
                    );
                  } finally {
                    setRequestingNotifications(false);
                  }
                }}
              >
                {requestingNotifications ? 'Requesting...' : 'Enable notifications'}
              </button>
            </div>
            {notificationHint ? <p className="setting-hint">{notificationHint}</p> : null}

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
