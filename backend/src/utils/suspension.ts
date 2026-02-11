export function isSuspensionActive(
  isSuspended: boolean,
  suspendedUntil: Date | null,
  nowMs = Date.now(),
): boolean {
  if (!isSuspended) {
    return false;
  }
  if (!suspendedUntil) {
    return true;
  }
  return suspendedUntil.getTime() > nowMs;
}
