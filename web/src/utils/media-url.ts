const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export function resolveMediaUrl(url?: string | null): string | undefined {
  if (!url) {
    return undefined;
  }
  if (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('data:') ||
    url.startsWith('blob:')
  ) {
    return url;
  }
  return `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}
