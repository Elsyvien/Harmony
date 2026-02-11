export type FontScale = 'sm' | 'md' | 'lg';

export interface UserPreferences {
  compactMode: boolean;
  reducedMotion: boolean;
  use24HourClock: boolean;
  showSeconds: boolean;
  fontScale: FontScale;
  enterToSend: boolean;
  playMessageSound: boolean;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  compactMode: false,
  reducedMotion: false,
  use24HourClock: false,
  showSeconds: false,
  fontScale: 'md',
  enterToSend: true,
  playMessageSound: false,
};
