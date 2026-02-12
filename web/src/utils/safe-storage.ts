function hasLocalStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getStorageItem(key: string): string | null {
  if (!hasLocalStorage()) {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setStorageItem(key: string, value: string) {
  if (!hasLocalStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage write failures (private mode, disabled storage, quota errors).
  }
}

export function removeStorageItem(key: string) {
  if (!hasLocalStorage()) {
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage deletion failures.
  }
}
