import { ClientError } from './errors';

export function resolveApiBaseUrl(
  configured: string | undefined,
  platform: 'web' | 'native',
  development: boolean,
): string {
  const value = configured?.trim();
  if (!value) {
    if (platform === 'web') return '';
    throw new ClientError('configuration', 'Set EXPO_PUBLIC_API_BASE_URL to the HTTPS TEST API origin before running the native app.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ClientError('configuration', 'EXPO_PUBLIC_API_BASE_URL must be an absolute HTTPS origin, without /api.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const localWebDevelopment = platform === 'web' && development && loopback && url.protocol === 'http:';
  if (
    (url.protocol !== 'https:' && !localWebDevelopment)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/'
  ) {
    throw new ClientError('configuration', 'Use an HTTPS API origin without a path, credentials, query, or fragment. HTTP loopback is allowed only for explicit web development configuration.');
  }
  return url.origin;
}
