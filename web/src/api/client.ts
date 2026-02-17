import type { ApiError } from '../types/api';
import { clearStoredAuth, dispatchAuthUnauthorizedEvent } from '../config/auth';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

async function parseError(response: Response): Promise<ApiError> {
  try {
    return (await response.json()) as ApiError;
  } catch {
    return { code: 'REQUEST_FAILED', message: 'Request failed' };
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const hasBody = options.body !== undefined && options.body !== null;
  const hasFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData;

  const response = await fetch(`${API_BASE_URL}${path}`, {
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
