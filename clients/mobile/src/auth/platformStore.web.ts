import { createSessionStore, createWebAdapter } from './store';

export function createPlatformStore(apiOrigin: string) {
  return createSessionStore(createWebAdapter(() => window.sessionStorage), apiOrigin);
}
