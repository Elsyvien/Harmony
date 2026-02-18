export const VOICE_RECONNECT_BASE_DELAY_MS = 500;
export const VOICE_RECONNECT_MAX_DELAY_MS = 15_000;

export function getVoiceReconnectDelayMs(attempt: number) {
  const normalizedAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return Math.min(
    VOICE_RECONNECT_BASE_DELAY_MS * Math.pow(2, normalizedAttempt),
    VOICE_RECONNECT_MAX_DELAY_MS,
  );
}
