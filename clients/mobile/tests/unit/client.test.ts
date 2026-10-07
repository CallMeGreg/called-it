import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiClient } from '../../src/api/client';
import type { AuthResult } from '../../src/api/contracts';
import { CancelledRequest, ClientError } from '../../src/api/errors';
import type { SessionStore } from '../../src/auth/store';
import { makeAuth, makeGame, otherUserId, questionIds } from '../fixtures';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function memoryStore(initial: AuthResult | null = makeAuth()) {
  let stored = initial;
  const writes: AuthResult[] = [];
  const store: SessionStore = {
    read: async () => stored,
    write: async (auth) => { stored = auth; writes.push(auth); },
    clear: async () => { stored = null; },
    warning: () => null,
  };
  return { store, writes, stored: () => stored };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function ready(fetcher: typeof fetch, initial?: AuthResult) {
  const storage = memoryStore(initial);
  const client = new ApiClient({ baseUrl: '', store: storage.store, fetch: fetcher });
  await client.restore();
  return { client, storage };
}

test('the default browser transport preserves the global fetch receiver', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async function (this: unknown) {
    assert.equal(this, globalThis);
    return json(makeGame());
  };
  try {
    const storage = memoryStore();
    const client = new ApiClient({ baseUrl: '', store: storage.store });
    await client.restore();
    await client.game();
  } finally {
    globalThis.fetch = original;
  }
});

test('login uses the exact endpoint and payload, and persists only AuthResult', async () => {
  const storage = memoryStore(null);
  const invite = 'x'.repeat(32);
  const client = new ApiClient({
    baseUrl: '', store: storage.store,
    fetch: async (url, init) => {
      assert.equal(url, '/api/test/login');
      assert.deepEqual(JSON.parse(String(init?.body)), { inviteCode: invite, displayName: 'Player' });
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.credentials, 'omit');
      return json(makeAuth({ displayName: 'Player' }));
    },
  });
  await client.restore();
  await client.login(invite, '  Player  ');
  assert.equal(client.getSnapshot().status, 'signed-in');
  assert.equal(storage.writes.length, 1);
  assert.equal(JSON.stringify(storage.stored()).includes(invite), false);
});

test('restoring twice is single-flight and emits a recovery state for invalid storage', async () => {
  const storage = memoryStore();
  let reads = 0;
  storage.store.read = async () => { reads += 1; throw new ClientError('storage', 'Invalid saved session'); };
  const client = new ApiClient({ baseUrl: '', store: storage.store });
  await Promise.all([client.restore(), client.restore()]);
  assert.equal(reads, 1);
  assert.equal(client.getSnapshot().cleanupRequired, true);
  assert.equal(client.getSnapshot().auth, null);
  await client.signOut();
  assert.equal(client.getSnapshot().cleanupRequired, false);
});

test('concurrent expired-token requests share one refresh and await rotated-token persistence', async () => {
  const expired = makeAuth({ accessTokenExpiresAt: '2020-01-01T00:00:00Z' });
  const storage = memoryStore(expired);
  const writeStarted = deferred<void>();
  const finishWrite = deferred<void>();
  const originalWrite = storage.store.write;
  storage.store.write = async (auth) => {
    writeStarted.resolve();
    await finishWrite.promise;
    await originalWrite(auth);
  };
  let refreshes = 0;
  let games = 0;
  const client = new ApiClient({
    baseUrl: '', store: storage.store,
    fetch: async (url, init) => {
      if (url === '/api/auth/refresh') {
        refreshes += 1;
        assert.deepEqual(JSON.parse(String(init?.body)), { refreshToken: expired.refreshToken });
        return json(makeAuth({ accessToken: 'rotated-access', refreshToken: 'rotated-refresh' }));
      }
      games += 1;
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer rotated-access');
      assert.equal(storage.stored()?.refreshToken, 'rotated-refresh');
      return json(makeGame());
    },
  });
  await client.restore();
  const first = client.game();
  const second = client.game();
  await writeStarted.promise;
  assert.equal(games, 0);
  finishWrite.resolve();
  await Promise.all([first, second]);
  assert.equal(refreshes, 1);
  assert.equal(games, 2);
});

test('a delayed parallel 401 reuses the already rotated access token', async () => {
  const late = deferred<Response>();
  let originalRequests = 0;
  let refreshes = 0;
  const { client } = await ready(async (url, init) => {
    if (url === '/api/auth/refresh') {
      refreshes += 1;
      return json(makeAuth({ accessToken: 'rotated', refreshToken: 'rotated-refresh' }));
    }
    if (new Headers(init?.headers).get('Authorization') === 'Bearer fixture-access') {
      originalRequests += 1;
      return originalRequests === 1 ? json({ title: 'Unauthorized' }, 401) : late.promise;
    }
    return json(makeGame());
  });
  const first = client.game();
  const second = client.game();
  await first;
  late.resolve(json({ title: 'Unauthorized' }, 401));
  await second;
  assert.equal(refreshes, 1);
});

test('refresh rejection signs out, clears persisted auth, and does not loop', async () => {
  let calls = 0;
  const { client, storage } = await ready(async () => {
    calls += 1;
    return json({ title: 'Forbidden', detail: 'Refresh rejected' }, 403);
  }, makeAuth({ accessTokenExpiresAt: '2020-01-01T00:00:00Z' }));
  await assert.rejects(client.game(), /session expired/);
  assert.equal(client.getSnapshot().status, 'signed-out');
  assert.equal(storage.stored(), null);
  assert.equal(calls, 1);
});

test('transient refresh network failure preserves the session for an explicit retry', async () => {
  let offline = true;
  const { client, storage } = await ready(async (url) => {
    if (offline) throw new TypeError('offline');
    return url === '/api/auth/refresh'
      ? json(makeAuth({ refreshToken: 'rotated' }))
      : json(makeGame());
  }, makeAuth({ accessTokenExpiresAt: '2020-01-01T00:00:00Z' }));
  await assert.rejects(client.game(), (error) => error instanceof ClientError && error.kind === 'network');
  assert.equal(client.getSnapshot().status, 'signed-in');
  assert.equal(storage.stored()?.refreshToken, 'fixture-refresh');
  offline = false;
  await client.game();
  assert.equal(storage.stored()?.refreshToken, 'rotated');
});

test('logout during token persistence cannot resurrect an old account or its saved token', async () => {
  const storage = memoryStore(makeAuth({ accessTokenExpiresAt: '2020-01-01T00:00:00Z' }));
  const started = deferred<void>();
  const finish = deferred<void>();
  const original = storage.store.write;
  storage.store.write = async (auth) => {
    started.resolve();
    await finish.promise;
    await original(auth);
  };
  const client = new ApiClient({ baseUrl: '', store: storage.store, fetch: async () => json(makeAuth({ refreshToken: 'rotated' })) });
  await client.restore();
  const request = client.game();
  const rejected = assert.rejects(request, CancelledRequest);
  await started.promise;
  const signedOut = client.signOut();
  finish.resolve();
  await Promise.all([rejected, signedOut]);
  assert.equal(client.getSnapshot().auth, null);
  assert.equal(storage.stored(), null);
});

test('late API responses are cancelled after logout and account change', async () => {
  const oldResponse = deferred<Response>();
  const { client, storage } = await ready(async (url) => url === '/api/test/login'
    ? json(makeAuth({ userId: otherUserId, displayName: 'Another player' }))
    : oldResponse.promise);
  const request = client.game();
  const rejected = assert.rejects(request, CancelledRequest);
  await client.signOut();
  await client.login('x'.repeat(32), 'Another player');
  oldResponse.resolve(json(makeGame()));
  await rejected;
  assert.equal(client.getSnapshot().auth?.userId, otherUserId);
  assert.equal(storage.stored()?.userId, otherUserId);
});

test('rotation cannot change the account identity', async () => {
  const { client, storage } = await ready(async () => json(makeAuth({ userId: otherUserId })),
    makeAuth({ accessTokenExpiresAt: '2020-01-01T00:00:00Z' }));
  await assert.rejects(client.game(), /session expired/);
  assert.equal(client.getSnapshot().auth, null);
  assert.equal(storage.stored(), null);
});

test('secure storage write failure ends the session explicitly rather than accepting unpersisted rotation', async () => {
  const storage = memoryStore(makeAuth({ accessTokenExpiresAt: '2020-01-01T00:00:00Z' }));
  storage.store.write = async () => { throw new ClientError('storage', 'Secure storage is unavailable'); };
  const client = new ApiClient({ baseUrl: '', store: storage.store, fetch: async () => json(makeAuth()) });
  await client.restore();
  await assert.rejects(client.game(), /session expired/);
  assert.equal(client.getSnapshot().status, 'signed-out');
  assert.match(client.getSnapshot().notice ?? '', /Secure storage/);
  assert.equal(storage.stored(), null);
});

test('423 submission locks retain RFC7807 details, do not retry, and never return a saved result', async () => {
  let submissions = 0;
  const { client } = await ready(async (url) => {
    assert.equal(url, '/api/guesses');
    submissions += 1;
    return json({ title: 'Submission window closed', status: 423, detail: 'This round is locked.' }, 423);
  });
  await assert.rejects(client.submit(questionIds[0], 'A'), (error) =>
    error instanceof ClientError && error.isSubmissionLocked && error.message === 'This round is locked.');
  assert.equal(submissions, 1);
});

test('skip is posted as a null pick; successful confirmation must match the submitted selection', async () => {
  const { client } = await ready(async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { questionId: questionIds[0], pick: null, skip: true });
    return json({ questionId: questionIds[0], categoryCode: 'sports', pick: 'A', isSkip: false, submittedAt: new Date().toISOString() });
  });
  await assert.rejects(client.submit(questionIds[0], null), /did not match/);
});

test('leaderboard filters use the existing category parameter and reject mismatched rows', async () => {
  const { client } = await ready(async (url) => {
    assert.equal(url, '/api/leaderboards?type=CategoryStreak&scope=Global&category=finance');
    return json({ type: 'CategoryStreak', scope: 'Global', categoryCode: 'sports', rows: [] });
  });
  await assert.rejects(client.leaderboard({ type: 'CategoryStreak', category: 'finance' }), /did not match/);
});

test('invalid game payloads are errors, not synthetic successful rounds', async () => {
  const malformed = makeGame();
  malformed.currentRound!.questions[1] = { ...malformed.currentRound!.questions[0]! };
  const { client } = await ready(async () => json(malformed));
  await assert.rejects(client.game(), (error) => error instanceof ClientError && error.kind === 'invalid-response');
});

test('request timeouts stop and surface a retryable error without losing auth', async () => {
  const storage = memoryStore();
  const client = new ApiClient({
    baseUrl: '', store: storage.store, timeoutMs: 5,
    fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });
  await client.restore();
  await assert.rejects(client.game(), (error) => error instanceof ClientError && error.kind === 'timeout');
  assert.equal(client.getSnapshot().status, 'signed-in');
});
