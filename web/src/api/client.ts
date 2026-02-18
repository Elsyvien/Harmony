import type { ApiError } from '../types/api';
import { clearStoredAuth, dispatchAuthUnauthorizedEvent } from '../config/auth';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

const RETRYABLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const MAX_RETRY_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 15_000;

async function parseError(response: Response): Promise<ApiError> {
  try {
    return (await response.json()) as ApiError;
  } catch {
    return { code: 'REQUEST_FAILED', message: 'Request failed' };
  }
}

function normalizeMethod(options: RequestInit): string {
  const method = options.method?.toUpperCase();
  return method && method.length > 0 ? method : 'GET';
}

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) {
    return null;
  }

  const asSeconds = Number(headerValue);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return asSeconds * 1000;
  }

  const retryAtEpoch = Date.parse(headerValue);
  if (Number.isNaN(retryAtEpoch)) {
    return null;
  }

  return Math.max(0, retryAtEpoch - Date.now());
}

function computeRetryDelayMs(attempt: number): number {
  const exponentialBackoff = BASE_RETRY_DELAY_MS * (2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(MAX_RETRY_DELAY_MS, exponentialBackoff + jitter);
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

async function fetchWithRetry(url: string, options: RequestInit): Promise<Response> {
  const method = normalizeMethod(options);
  const shouldRetryRequest = RETRYABLE_METHODS.has(method);
  const maxAttempts = shouldRetryRequest ? MAX_RETRY_ATTEMPTS : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        method,
      });

      if (response.ok) {
        return response;
      }

      const shouldRetryResponse =
        shouldRetryRequest &&
        RETRYABLE_STATUS_CODES.has(response.status) &&
        attempt < maxAttempts;

      if (!shouldRetryResponse) {
        return response;
      }

      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
      await sleep(retryAfterMs ?? computeRetryDelayMs(attempt));
    } catch (error) {
      const canRetry = shouldRetryRequest && attempt < maxAttempts;
      if (!canRetry) {
        throw error;
      }
      await sleep(computeRetryDelayMs(attempt));
    }
  }

  throw new Error('REQUEST_RETRY_EXHAUSTED');
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const hasBody = options.body !== undefined && options.body !== null;
  const hasFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData;

  const response = await fetchWithRetry(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(hasBody && !hasFormDataBody ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    if (response.status === 401 && token) {
      clearStoredAuth();
      dispatchAuthUnauthorizedEvent();
    }
    throw await parseError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
