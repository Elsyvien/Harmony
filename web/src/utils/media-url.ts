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

  const normalizedUrl = url.trim();
  const hasPathPrefix = normalizedUrl.startsWith('/') || normalizedUrl.startsWith('uploads/');
  const isLikelyFilename = !normalizedUrl.includes('/') && /\.[a-z0-9]{2,5}$/i.test(normalizedUrl);
  const relativePath = hasPathPrefix
    ? normalizedUrl.startsWith('/')
      ? normalizedUrl
      : `/${normalizedUrl}`
    : isLikelyFilename
      ? `/uploads/${normalizedUrl}`
      : `/${normalizedUrl}`;

  return `${API_BASE_URL}${relativePath}`;
}
