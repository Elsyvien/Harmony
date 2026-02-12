export type FontScale = 'sm' | 'md' | 'lg';
export type ThemeMode = 'dark' | 'light';

export interface UserPreferences {
  theme: ThemeMode;
  compactMode: boolean;
  reducedMotion: boolean;
  use24HourClock: boolean;
  showSeconds: boolean;
  fontScale: FontScale;
  enterToSend: boolean;
  playMessageSound: boolean;
  voiceInputSensitivity: number;
  voiceOutputVolume: number;
  showVoiceActivity: boolean;
  autoMuteOnJoin: boolean;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: 'dark',
  compactMode: false,
  reducedMotion: false,
  use24HourClock: false,
  showSeconds: false,
  fontScale: 'md',
  enterToSend: true,
  playMessageSound: false,
  voiceInputSensitivity: 0.04,
  voiceOutputVolume: 100,
  showVoiceActivity: true,
  autoMuteOnJoin: false,
};
