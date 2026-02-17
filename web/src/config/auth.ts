import { removeStorageItem } from '../utils/safe-storage';

export const AUTH_TOKEN_STORAGE_KEY = 'discordclone_token';
export const AUTH_USER_STORAGE_KEY = 'discordclone_user';
export const AUTH_UNAUTHORIZED_EVENT = 'harmony:auth-unauthorized';

export function clearStoredAuth() {
  removeStorageItem(AUTH_TOKEN_STORAGE_KEY);
  removeStorageItem(AUTH_USER_STORAGE_KEY);
}

export function dispatchAuthUnauthorizedEvent() {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
}
