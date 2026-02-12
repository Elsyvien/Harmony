type TelemetryLevel = 'info' | 'warn' | 'error';

export interface TelemetryEvent {
  name: string;
  level?: TelemetryLevel;
  context?: Record<string, unknown>;
  error?: unknown;
}

export interface TelemetryPayload {
  name: string;
  level: TelemetryLevel;
  timestamp: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

const MAX_BUFFERED_EVENTS = 100;

declare global {
  interface Window {
    __harmonyTelemetryQueue__?: TelemetryPayload[];
  }
}

function normalizeError(error: unknown) {
  if (!error) {
    return undefined;
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    name: 'UnknownError',
    message: typeof error === 'string' ? error : JSON.stringify(error),
  };
}

export function trackTelemetry(event: TelemetryEvent) {
  const payload: TelemetryPayload = {
    name: event.name,
    level: event.level ?? 'info',
    timestamp: new Date().toISOString(),
    context: event.context,
    error: normalizeError(event.error),
  };

  if (typeof window === 'undefined') {
    return;
  }

  const queue = window.__harmonyTelemetryQueue__ ?? [];
  queue.push(payload);
  if (queue.length > MAX_BUFFERED_EVENTS) {
    queue.shift();
  }
  window.__harmonyTelemetryQueue__ = queue;
  window.dispatchEvent(
    new CustomEvent<TelemetryPayload>('harmony:telemetry', {
      detail: payload,
    }),
  );
}

export function trackTelemetryError(
  name: string,
  error: unknown,
  context?: Record<string, unknown>,
) {
  trackTelemetry({
    name,
    level: 'error',
    context,
    error,
  });
}
