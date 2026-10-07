import { authSchema, type AuthResult } from '../api/contracts';
import { ClientError } from '../api/errors';

export interface TokenAdapter {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
  warning(): string | null;
}

export interface SessionStore {
  read(): Promise<AuthResult | null>;
  write(auth: AuthResult): Promise<void>;
  clear(): Promise<void>;
  warning(): string | null;
}

export function createSessionStore(adapter: TokenAdapter, apiOrigin: string): SessionStore {
  return {
    warning: () => adapter.warning(),
    async read() {
      let raw: string | null;
      try {
        raw = await adapter.read();
      } catch {
        throw new ClientError('storage', 'Saved session could not be read. Clear the saved session and sign in again.');
      }
      if (raw === null) return null;
      let decoded: unknown;
      try {
        decoded = JSON.parse(raw);
      } catch {
        throw new ClientError('storage', 'Saved session is unreadable. Clear the saved session and sign in again.');
      }
      if (
        typeof decoded !== 'object' || decoded === null
        || !('apiOrigin' in decoded) || decoded.apiOrigin !== apiOrigin
        || !('auth' in decoded) || !('version' in decoded) || decoded.version !== 1
      ) {
        throw new ClientError('storage', 'Saved session does not match this TEST API. Clear it before signing in.');
      }
      const auth = authSchema.safeParse(decoded.auth);
      if (!auth.success) throw new ClientError('storage', 'Saved session is incomplete. Clear it before signing in.');
      return auth.data;
    },
    async write(auth) {
      try {
        await adapter.write(JSON.stringify({ version: 1, apiOrigin, auth: authSchema.parse(auth) }));
      } catch {
        throw new ClientError('storage', 'The new session could not be saved safely. Please sign in again.');
      }
    },
    async clear() {
      try {
        await adapter.remove();
      } catch {
        throw new ClientError('storage', 'Signed out on this screen, but the saved session could not be removed. Retry clearing it before leaving this device.');
      }
    },
  };
}

export const SESSION_KEY = 'called_it_test_session_v1';

export function createWebAdapter(getStorage: () => Storage): TokenAdapter {
  let memory: string | null = null;
  let memoryOnly = false;
  let hasPersistedSession = false;
  const warning = 'Browser session storage is blocked. This is a memory-only session and is not saved for reloads. Close this tab to discard any older inaccessible session. Your invite code is never saved.';
  const retainedWarning = 'Browser storage is blocked and an older saved session may remain. Retry clearing the saved session, or close this tab before leaving this device.';
  return {
    warning: () => memoryOnly ? (hasPersistedSession ? retainedWarning : warning) : null,
    async read() {
      if (memoryOnly) return memory;
      try {
        const value = getStorage().getItem(SESSION_KEY);
        hasPersistedSession = value !== null;
        return value;
      } catch {
        memoryOnly = true;
        return memory;
      }
    },
    async write(value) {
      memory = value;
      if (memoryOnly) return;
      try {
        getStorage().setItem(SESSION_KEY, value);
        hasPersistedSession = true;
      } catch (error) {
        memoryOnly = true;
        if (hasPersistedSession) throw error;
      }
    },
    async remove() {
      memory = null;
      // Still try removing an older token if storage failed midway through rotation.
      try {
        getStorage().removeItem(SESSION_KEY);
        hasPersistedSession = false;
      } catch (error) {
        memoryOnly = true;
        if (hasPersistedSession) throw error;
      }
    },
  };
}
