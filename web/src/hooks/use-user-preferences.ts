import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserPreferences } from '../types/preferences';
import { DEFAULT_USER_PREFERENCES } from '../types/preferences';
import { getStorageItem, setStorageItem } from '../utils/safe-storage';

const PREFS_KEY = 'discordclone_user_preferences_v4';

const VOICE_DEFAULT_KEYS = [
  'voiceNoiseSuppression',
  'voiceEchoCancellation',
  'voiceAutoGainControl',
] as const;

type VoiceDefaultKey = (typeof VOICE_DEFAULT_KEYS)[number];

export type VoicePreferenceDefaults = Pick<UserPreferences, VoiceDefaultKey>;

function buildDefaultVoicePreferencePresence(): Record<VoiceDefaultKey, boolean> {
  return {
    voiceNoiseSuppression: false,
    voiceEchoCancellation: false,
    voiceAutoGainControl: false,
  };
}

function parseVoicePreferencePresence(raw: string | null): Record<VoiceDefaultKey, boolean> {
  if (!raw) {
    return buildDefaultVoicePreferencePresence();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return {
      voiceNoiseSuppression: typeof parsed.voiceNoiseSuppression === 'boolean',
      voiceEchoCancellation: typeof parsed.voiceEchoCancellation === 'boolean',
      voiceAutoGainControl: typeof parsed.voiceAutoGainControl === 'boolean',
    };
  } catch {
    return buildDefaultVoicePreferencePresence();
  }
}

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
        typeof parsed.voiceInputSensitivity === 'number' &&
        Number.isFinite(parsed.voiceInputSensitivity)
          ? Math.min(0.12, Math.max(0.005, parsed.voiceInputSensitivity))
          : DEFAULT_USER_PREFERENCES.voiceInputSensitivity,
      voiceInputGain:
        typeof parsed.voiceInputGain === 'number' && Number.isFinite(parsed.voiceInputGain)
          ? Math.min(200, Math.max(0, Math.round(parsed.voiceInputGain)))
          : DEFAULT_USER_PREFERENCES.voiceInputGain,
      voiceOutputVolume:
        typeof parsed.voiceOutputVolume === 'number' && Number.isFinite(parsed.voiceOutputVolume)
          ? Math.min(100, Math.max(0, Math.round(parsed.voiceOutputVolume)))
          : DEFAULT_USER_PREFERENCES.voiceOutputVolume,
      voiceNoiseSuppression:
        typeof parsed.voiceNoiseSuppression === 'boolean'
          ? parsed.voiceNoiseSuppression
          : DEFAULT_USER_PREFERENCES.voiceNoiseSuppression,
      voiceEchoCancellation:
        typeof parsed.voiceEchoCancellation === 'boolean'
          ? parsed.voiceEchoCancellation
          : DEFAULT_USER_PREFERENCES.voiceEchoCancellation,
      voiceAutoGainControl:
        typeof parsed.voiceAutoGainControl === 'boolean'
          ? parsed.voiceAutoGainControl
          : DEFAULT_USER_PREFERENCES.voiceAutoGainControl,
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
    parsePreferences(getStorageItem(PREFS_KEY)),
  );
  const [voicePreferencePresence, setVoicePreferencePresence] = useState<
    Record<VoiceDefaultKey, boolean>
  >(() => parseVoicePreferencePresence(getStorageItem(PREFS_KEY)));
  const voicePreferencePresenceRef = useRef(voicePreferencePresence);

  useEffect(() => {
    voicePreferencePresenceRef.current = voicePreferencePresence;
  }, [voicePreferencePresence]);

  useEffect(() => {
    setStorageItem(PREFS_KEY, JSON.stringify(preferences));
    applyBodyClasses(preferences);
  }, [preferences]);

  const updatePreferences = useCallback((patch: Partial<UserPreferences>) => {
    setPreferences((prev) => ({ ...prev, ...patch }));
    if (
      patch.voiceNoiseSuppression === undefined &&
      patch.voiceEchoCancellation === undefined &&
      patch.voiceAutoGainControl === undefined
    ) {
      return;
    }
    const nextPresence = {
      voiceNoiseSuppression:
        voicePreferencePresenceRef.current.voiceNoiseSuppression ||
        typeof patch.voiceNoiseSuppression === 'boolean',
      voiceEchoCancellation:
        voicePreferencePresenceRef.current.voiceEchoCancellation ||
        typeof patch.voiceEchoCancellation === 'boolean',
      voiceAutoGainControl:
        voicePreferencePresenceRef.current.voiceAutoGainControl ||
        typeof patch.voiceAutoGainControl === 'boolean',
    };
    voicePreferencePresenceRef.current = nextPresence;
    setVoicePreferencePresence(nextPresence);
  }, []);

  const applyVoiceDefaults = useCallback((defaults: Partial<VoicePreferenceDefaults>) => {
    const normalizedDefaults: VoicePreferenceDefaults = {
      voiceNoiseSuppression:
        typeof defaults.voiceNoiseSuppression === 'boolean'
          ? defaults.voiceNoiseSuppression
          : DEFAULT_USER_PREFERENCES.voiceNoiseSuppression,
      voiceEchoCancellation:
        typeof defaults.voiceEchoCancellation === 'boolean'
          ? defaults.voiceEchoCancellation
          : DEFAULT_USER_PREFERENCES.voiceEchoCancellation,
      voiceAutoGainControl:
        typeof defaults.voiceAutoGainControl === 'boolean'
          ? defaults.voiceAutoGainControl
          : DEFAULT_USER_PREFERENCES.voiceAutoGainControl,
    };
    setPreferences((prev) => {
      let changed = false;
      const next = { ...prev };
      const presence = voicePreferencePresenceRef.current;
      for (const key of VOICE_DEFAULT_KEYS) {
        if (presence[key]) {
          continue;
        }
        const nextValue = normalizedDefaults[key];
        if (next[key] !== nextValue) {
          next[key] = nextValue;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const resetPreferences = useCallback(() => {
    setPreferences(DEFAULT_USER_PREFERENCES);
    const nextPresence = buildDefaultVoicePreferencePresence();
    voicePreferencePresenceRef.current = nextPresence;
    setVoicePreferencePresence(nextPresence);
  }, []);

  return {
    preferences,
    updatePreferences,
    resetPreferences,
    applyVoiceDefaults,
  };
}
