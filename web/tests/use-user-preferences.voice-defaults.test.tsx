import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUserPreferences } from '../src/hooks/use-user-preferences';

const PREFS_KEY = 'discordclone_user_preferences_v4';

function writeStoredPreferences(value: Record<string, unknown>) {
  window.localStorage.setItem(PREFS_KEY, JSON.stringify(value));
}

describe('useUserPreferences voice defaults', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('applies server voice defaults when local keys are missing', () => {
    writeStoredPreferences({
      theme: 'dark',
      compactMode: false,
      reducedMotion: false,
      use24HourClock: false,
      showSeconds: false,
      fontScale: 'md',
      enterToSend: true,
      playMessageSound: false,
      voiceInputSensitivity: 0.01,
      voiceInputGain: 100,
      voiceOutputVolume: 100,
      showVoiceActivity: true,
      autoMuteOnJoin: false,
      voiceInputDeviceId: null,
    });

    const { result } = renderHook(() => useUserPreferences());

    act(() => {
      result.current.applyVoiceDefaults({
        voiceNoiseSuppression: false,
        voiceEchoCancellation: false,
        voiceAutoGainControl: false,
      });
    });

    expect(result.current.preferences.voiceNoiseSuppression).toBe(false);
    expect(result.current.preferences.voiceEchoCancellation).toBe(false);
    expect(result.current.preferences.voiceAutoGainControl).toBe(false);
  });

  it('keeps explicit local voice preferences when server defaults differ', () => {
    writeStoredPreferences({
      theme: 'dark',
      compactMode: false,
      reducedMotion: false,
      use24HourClock: false,
      showSeconds: false,
      fontScale: 'md',
      enterToSend: true,
      playMessageSound: false,
      voiceInputSensitivity: 0.01,
      voiceInputGain: 100,
      voiceOutputVolume: 100,
      voiceNoiseSuppression: true,
      voiceEchoCancellation: true,
      voiceAutoGainControl: true,
      showVoiceActivity: true,
      autoMuteOnJoin: false,
      voiceInputDeviceId: null,
    });

    const { result } = renderHook(() => useUserPreferences());

    act(() => {
      result.current.applyVoiceDefaults({
        voiceNoiseSuppression: false,
        voiceEchoCancellation: false,
        voiceAutoGainControl: false,
      });
    });

    expect(result.current.preferences.voiceNoiseSuppression).toBe(true);
    expect(result.current.preferences.voiceEchoCancellation).toBe(true);
    expect(result.current.preferences.voiceAutoGainControl).toBe(true);
  });

  it('does not override an explicitly updated voice preference', () => {
    writeStoredPreferences({
      theme: 'dark',
      compactMode: false,
      reducedMotion: false,
      use24HourClock: false,
      showSeconds: false,
      fontScale: 'md',
      enterToSend: true,
      playMessageSound: false,
      voiceInputSensitivity: 0.01,
      voiceInputGain: 100,
      voiceOutputVolume: 100,
      showVoiceActivity: true,
      autoMuteOnJoin: false,
      voiceInputDeviceId: null,
    });

    const { result } = renderHook(() => useUserPreferences());

    act(() => {
      result.current.updatePreferences({ voiceNoiseSuppression: false });
      result.current.applyVoiceDefaults({ voiceNoiseSuppression: true });
    });

    expect(result.current.preferences.voiceNoiseSuppression).toBe(false);
  });
});
