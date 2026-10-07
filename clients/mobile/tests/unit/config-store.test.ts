import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveApiBaseUrl } from '../../src/api/config';
import { createSessionStore, createWebAdapter, SESSION_KEY } from '../../src/auth/store';
import { makeAuth } from '../fixtures';

function browserStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() { return entries.size; },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value); },
    removeItem: (key) => { entries.delete(key); },
    key: (index) => [...entries.keys()][index] ?? null,
  };
}

test('web defaults to same origin; native requires an explicit HTTPS origin', () => {
  assert.equal(resolveApiBaseUrl(undefined, 'web', false), '');
  assert.equal(resolveApiBaseUrl('', 'web', true), '');
  assert.throws(() => resolveApiBaseUrl(undefined, 'native', true), /HTTPS TEST API/);
  assert.equal(resolveApiBaseUrl('https://example.test/', 'native', false), 'https://example.test');
  assert.throws(() => resolveApiBaseUrl('http://example.test', 'web', true), /HTTPS/);
  assert.throws(() => resolveApiBaseUrl('https://example.test/api', 'web', false), /without a path/);
  assert.throws(() => resolveApiBaseUrl('https://user:password@example.test', 'web', false), /credentials/);
  assert.throws(() => resolveApiBaseUrl('https://example.test?token=anything', 'web', false), /query/);
});

test('only explicit loopback HTTP is allowed for web development, never native or a release override', () => {
  assert.equal(resolveApiBaseUrl('http://localhost:5080', 'web', true), 'http://localhost:5080');
  assert.throws(() => resolveApiBaseUrl('http://localhost:5080', 'web', false), /HTTPS/);
  assert.throws(() => resolveApiBaseUrl('http://localhost:5080', 'native', true), /HTTPS/);
  assert.throws(() => resolveApiBaseUrl('http://192.168.1.2:5080', 'web', true), /HTTPS/);
});

test('browser session storage round-trips validated tokens, scoped to the API, with no invite field', async () => {
  const storage = browserStorage();
  const store = createSessionStore(createWebAdapter(() => storage), 'https://example.test');
  const auth = makeAuth();
  await store.write(auth);
  assert.deepEqual(await store.read(), auth);
  assert.equal(storage.getItem(SESSION_KEY)?.includes('invite'), false);
  const otherApi = createSessionStore(createWebAdapter(() => storage), 'https://different.test');
  await assert.rejects(otherApi.read(), /does not match/);
  await store.clear();
  assert.equal(await store.read(), null);
});

test('blocked web storage has explicit memory-only warning and loses session with a new adapter', async () => {
  const blocked = (): Storage => { throw new Error('blocked'); };
  const store = createSessionStore(createWebAdapter(blocked), 'same-origin');
  assert.equal(await store.read(), null);
  assert.match(store.warning() ?? '', /memory-only/);
  await store.write(makeAuth());
  assert.equal((await store.read())?.displayName, 'Test player');
  const reload = createSessionStore(createWebAdapter(blocked), 'same-origin');
  assert.equal(await reload.read(), null);
  await store.clear();
  assert.equal(await store.read(), null);
});

test('rotation write failure cannot silently leave an older persisted session', async () => {
  const storage = browserStorage();
  const store = createSessionStore(createWebAdapter(() => storage), 'same-origin');
  await store.write(makeAuth());
  storage.setItem = () => { throw new Error('quota'); };
  await assert.rejects(store.write(makeAuth({ refreshToken: 'rotated-fixture' })), /could not be saved safely/);
  storage.removeItem = () => { throw new Error('blocked'); };
  await assert.rejects(store.clear(), /saved session could not be removed/);
});

test('corrupt storage is an explicit recovery error, not a fake successful session', async () => {
  const storage = browserStorage();
  storage.setItem(SESSION_KEY, '{invalid');
  const store = createSessionStore(createWebAdapter(() => storage), 'same-origin');
  await assert.rejects(store.read(), /unreadable/);
});
