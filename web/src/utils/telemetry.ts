import { AUTH_TOKEN_STORAGE_KEY } from '../config/auth';
import { getStorageItem } from './safe-storage';
import {
  getAnalyticsEventDefinition,
  sanitizeAnalyticsContext,
  type AnalyticsCategory,
  type AnalyticsContextValue,
  type TelemetryLevel,
} from './analytics-catalog';

export interface TelemetryEvent {
  name: string;
  category?: AnalyticsCategory;
  level?: TelemetryLevel;
  context?: Record<string, unknown>;
  error?: unknown;
  success?: boolean;
  durationMs?: number;
  statusCode?: number;
  sessionId?: string;
  requestId?: string;
  channelId?: string;
}

export interface TelemetryPayload {
  name: string;
  source: 'web_client';
  category: AnalyticsCategory;
  level: TelemetryLevel;
  timestamp: string;
  sessionId: string;
  requestId?: string;
  channelId?: string;
  success?: boolean;
  durationMs?: number;
  statusCode?: number;
  context?: Record<string, AnalyticsContextValue>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const TELEMETRY_ENDPOINT = `${API_BASE_URL}/analytics/events`;

const MAX_BUFFERED_EVENTS = 200;
const MAX_BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 1500;
const MAX_RETRY_DELAY_MS = 30_000;

const pendingEvents: TelemetryPayload[] = [];

let flushTimer: number | null = null;
let flushInFlight = false;
let retryDelayMs = 1000;
let listenersInitialized = false;
let wsReconnectAttempt = 0;

declare global {
  interface Window {
    __harmonyTelemetryQueue__?: TelemetryPayload[];
    __harmonyTelemetrySessionId__?: string;
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
  let serializedError = '[unserializable]';
  if (typeof error === 'string') {
    serializedError = error;
  } else {
    try {
      serializedError = JSON.stringify(error);
    } catch {
      // Ignore serialization errors for unsupported values.
    }
  }
  return {
    name: 'UnknownError',
    message: serializedError,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getSessionId() {
  if (typeof window === 'undefined') {
    return 'server';
  }
  if (window.__harmonyTelemetrySessionId__) {
    return window.__harmonyTelemetrySessionId__;
  }
  const next = randomId();
  window.__harmonyTelemetrySessionId__ = next;
  return next;
}

function isSendableEventName(name: string) {
  return Boolean(getAnalyticsEventDefinition(name));
}

function extractCodeFromError(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const record = error as { code?: unknown };
  if (typeof record.code === 'string') {
    return record.code;
  }
  return undefined;
}

function toSendableEvent(event: TelemetryEvent): TelemetryPayload | null {
  const normalizedName = event.name.trim().toLowerCase();
  const definition = getAnalyticsEventDefinition(normalizedName);

  if (!definition) {
    const fallbackName = 'client.error.reported';
    const fallbackDefinition = getAnalyticsEventDefinition(fallbackName);
    if (!fallbackDefinition) {
      return null;
    }
    return {
      name: fallbackName,
      source: 'web_client',
      category: fallbackDefinition.category,
      level: 'error',
      timestamp: nowIso(),
      sessionId: event.sessionId ?? getSessionId(),
      requestId: event.requestId,
      channelId: event.channelId,
      success: event.success,
      durationMs: event.durationMs,
      statusCode: event.statusCode,
      context: sanitizeAnalyticsContext(fallbackName, {
        feature: normalizedName,
        code: extractCodeFromError(event.error),
      }),
      error: normalizeError(event.error),
    };
  }

  return {
    name: normalizedName,
    source: 'web_client',
    category: event.category ?? definition.category,
    level: event.level ?? (event.error ? 'error' : definition.defaultLevel ?? 'info'),
    timestamp: nowIso(),
    sessionId: event.sessionId ?? getSessionId(),
    requestId: event.requestId,
    channelId: event.channelId,
    success: event.success,
    durationMs: typeof event.durationMs === 'number' && Number.isFinite(event.durationMs)
      ? Math.max(0, Math.round(event.durationMs))
      : undefined,
    statusCode: typeof event.statusCode === 'number' && Number.isFinite(event.statusCode)
      ? Math.round(event.statusCode)
      : undefined,
    context: sanitizeAnalyticsContext(normalizedName, event.context),
    error: normalizeError(event.error),
  };
}

function remember(payload: TelemetryPayload) {
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

function scheduleFlush(delayMs = FLUSH_INTERVAL_MS) {
  if (typeof window === 'undefined' || flushTimer !== null) {
    return;
  }
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushPendingEvents();
  }, delayMs);
}

function buildAuthHeaders(): Record<string, string> {
  const token = getStorageItem(AUTH_TOKEN_STORAGE_KEY);
  if (!token) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

async function postBatch(events: TelemetryPayload[]) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...buildAuthHeaders(),
  };
  const response = await fetch(TELEMETRY_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ events }),
    keepalive: true,
  });
  if (!response.ok) {
    throw new Error(`Telemetry request failed (${response.status})`);
  }
}

async function flushPendingEvents() {
  if (flushInFlight || pendingEvents.length === 0) {
    return;
  }

  flushInFlight = true;
  try {
    while (pendingEvents.length > 0) {
      const batch = pendingEvents.splice(0, MAX_BATCH_SIZE);
      try {
        await postBatch(batch);
      } catch (error) {
        pendingEvents.unshift(...batch);
        retryDelayMs = Math.min(MAX_RETRY_DELAY_MS, retryDelayMs * 2);
        scheduleFlush(retryDelayMs);
        throw error;
      }
    }
    retryDelayMs = 1000;
  } catch {
    // Flush errors are handled by retries.
  } finally {
    flushInFlight = false;
  }
}

function flushUsingBeacon() {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
    return;
  }
  if (pendingEvents.length === 0) {
    return;
  }

  const batch = pendingEvents.slice(0, MAX_BATCH_SIZE);
  const payload = JSON.stringify({ events: batch });
  const sent = navigator.sendBeacon(
    TELEMETRY_ENDPOINT,
    new Blob([payload], { type: 'application/json' }),
  );
  if (sent) {
    pendingEvents.splice(0, batch.length);
  }
}

function initializeTransportListeners() {
  if (listenersInitialized || typeof window === 'undefined') {
    return;
  }
  listenersInitialized = true;

  const flushSoon = () => {
    scheduleFlush(80);
  };
  const flushNow = () => {
    flushUsingBeacon();
    void flushPendingEvents();
  };

  window.addEventListener('online', flushSoon);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushNow();
      return;
    }
    flushSoon();
  });
  window.addEventListener('pagehide', flushNow);
  window.addEventListener('beforeunload', flushNow);
}

function enqueue(payload: TelemetryPayload) {
  pendingEvents.push(payload);
  if (pendingEvents.length > MAX_BUFFERED_EVENTS) {
    pendingEvents.shift();
  }
  scheduleFlush();
}

export function trackTelemetry(event: TelemetryEvent) {
  const payload = toSendableEvent(event);
  if (!payload || !isSendableEventName(payload.name)) {
    return;
  }
  remember(payload);
  initializeTransportListeners();
  enqueue(payload);
}

export function trackTelemetryError(
  name: string,
  error: unknown,
  context?: Record<string, unknown>,
) {
  const code = extractCodeFromError(error);
  trackTelemetry({
    name,
    level: 'error',
    context: {
      ...(context ?? {}),
      ...(code ? { code } : {}),
    },
    error,
    success: false,
  });
}

export function nextWsReconnectAttempt() {
  wsReconnectAttempt += 1;
  return wsReconnectAttempt;
}

export function resetWsReconnectAttempt() {
  wsReconnectAttempt = 0;
}
