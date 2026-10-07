import { ClientError } from './api/errors';

export function resolveLaunchMode(
  optIn: string | undefined,
  platform: string,
  development: boolean,
  hostname: string | undefined,
): 'api' | 'playground' {
  if (optIn !== '1') return 'api';
  if (platform === 'web' && development && ['localhost', '127.0.0.1', '[::1]'].includes(hostname ?? '')) {
    return 'playground';
  }
  throw new ClientError('configuration', 'Local playground is available only in a web development build on loopback. Use npm run playground; native, remote hosts, and release builds cannot enable its controls.');
}
