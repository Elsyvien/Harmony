import { useEffect, useState } from 'react';
import type { UserPreferences } from '../types/preferences';
import { DEFAULT_USER_PREFERENCES } from '../types/preferences';

const PREFS_KEY = 'discordclone_user_preferences_v4';

function parsePreferences(raw: string | null): UserPreferences {
  if (!raw) {
    return DEFAULT_USER_PREFERENCES;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return {
      theme:
        parsed.theme === 'light' || parsed.theme === 'dark'
          ? parsed.theme
          : DEFAULT_USER_PREFERENCES.theme,
      compactMode: Boolean(parsed.compactMode),
      reducedMotion: Boolean(parsed.reducedMotion),
      use24HourClock: Boolean(parsed.use24HourClock),
      showSeconds: Boolean(parsed.showSeconds),
      fontScale:
        parsed.fontScale === 'sm' || parsed.fontScale === 'lg' || parsed.fontScale === 'md'
          ? parsed.fontScale
          : DEFAULT_USER_PREFERENCES.fontScale,
      enterToSend:
        typeof parsed.enterToSend === 'boolean'
          ? parsed.enterToSend
          : DEFAULT_USER_PREFERENCES.enterToSend,
      playMessageSound: Boolean(parsed.playMessageSound),
      voiceInputSensitivity:
        typeof parsed.voiceInputSensitivity === 'number'
          ? Math.min(0.12, Math.max(0.005, parsed.voiceInputSensitivity))
          : DEFAULT_USER_PREFERENCES.voiceInputSensitivity,
      voiceOutputVolume:
        typeof parsed.voiceOutputVolume === 'number'
          ? Math.min(100, Math.max(0, Math.round(parsed.voiceOutputVolume)))
          : DEFAULT_USER_PREFERENCES.voiceOutputVolume,
      showVoiceActivity:
        typeof parsed.showVoiceActivity === 'boolean'
          ? parsed.showVoiceActivity
          : DEFAULT_USER_PREFERENCES.showVoiceActivity,
      autoMuteOnJoin:
        typeof parsed.autoMuteOnJoin === 'boolean'
          ? parsed.autoMuteOnJoin
          : DEFAULT_USER_PREFERENCES.autoMuteOnJoin,
      voiceInputDeviceId:
        typeof parsed.voiceInputDeviceId === 'string'
          ? parsed.voiceInputDeviceId
          : DEFAULT_USER_PREFERENCES.voiceInputDeviceId,
    };
  } catch {
    return DEFAULT_USER_PREFERENCES;
  }
}

function applyBodyClasses(preferences: UserPreferences) {
  document.body.classList.toggle('theme-light', preferences.theme === 'light');
  document.body.classList.toggle('compact-chat', preferences.compactMode);
  document.body.classList.toggle('reduced-motion', preferences.reducedMotion);
  document.body.classList.toggle('clock-24h', preferences.use24HourClock);
  document.body.classList.toggle('font-scale-sm', preferences.fontScale === 'sm');
  document.body.classList.toggle('font-scale-md', preferences.fontScale === 'md');
  document.body.classList.toggle('font-scale-lg', preferences.fontScale === 'lg');
}

export function useUserPreferences() {
  const [preferences, setPreferences] = useState<UserPreferences>(() =>
    parsePreferences(localStorage.getItem(PREFS_KEY)),
  );

  useEffect(() => {
    localStorage.setItem(PREFS_KEY, JSON.stringify(preferences));
    applyBodyClasses(preferences);
  }, [preferences]);

  const updatePreferences = (patch: Partial<UserPreferences>) => {
    setPreferences((prev) => ({ ...prev, ...patch }));
  };

  const resetPreferences = () => {
    setPreferences(DEFAULT_USER_PREFERENCES);
  };

  return {
    preferences,
    updatePreferences,
    resetPreferences,
  };
}
