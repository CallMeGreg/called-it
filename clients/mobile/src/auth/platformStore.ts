import * as SecureStore from 'expo-secure-store';

import { createSessionStore, SESSION_KEY } from './store';

export function createPlatformStore(apiOrigin: string) {
  const options: SecureStore.SecureStoreOptions = {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
  return createSessionStore({
    read: () => SecureStore.getItemAsync(SESSION_KEY, options),
    write: (value) => SecureStore.setItemAsync(SESSION_KEY, value, options),
    remove: () => SecureStore.deleteItemAsync(SESSION_KEY, options),
    warning: () => null,
  }, apiOrigin);
}
