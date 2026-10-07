import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { AzureError } from './azure.mjs';
import { idleState, startState, extendState, stopState, beginSubmission, validateState, StateStore } from './state.mjs';
import { RUN_ID, TEST_NOW, FOUNDATION, MemoryAzure } from './test-fixtures.mjs';

const starting = () => startState(idleState(TEST_NOW), { now: TEST_NOW, runId: RUN_ID });

test('Start allocates four hours including provisioning and cannot reset an active deadline', () => {
  const state = starting();
  assert.equal(state.expiresAt, '2026-01-01T16:00:00.000Z');
  assert.throws(() => startState(state), /Cannot Start/);
  assert.throws(() => startState(idleState(), { hours: 8 }), /four-hour/);
});

test('Extend adds four hours to the current deadline, not the current time', () => {
  const state = extendState(starting(), RUN_ID, new Date('2026-01-01T15:55:00.000Z'));
  assert.equal(state.expiresAt, '2026-01-01T20:00:00.000Z');
});

test('a stale timer cannot stop an extended run or target a different run', () => {
  const extended = extendState(starting(), RUN_ID, TEST_NOW);
  assert.equal(stopState(extended, RUN_ID, { expiredOnly: true, now: new Date('2026-01-01T16:01:00Z') }), null);
  assert.throws(() => stopState(extended, 'a'.repeat(32)), /exact current/);
});

test('Stop claim is irreversible to Start or Extend; already expired Extend fails', () => {
  const stopped = stopState(starting(), RUN_ID, { now: TEST_NOW });
  assert.equal(stopped.phase, 'Stopping');
  assert.throws(() => extendState(stopped, RUN_ID, TEST_NOW), /claimed Stop/);
  assert.throws(() => startState(stopped), /Cannot Start/);
  assert.throws(() => extendState(starting(), RUN_ID, new Date('2026-01-01T16:00:00Z')), /already expired/);
});

test('state validates exact subscription, run ID, stack ownership and expiry', () => {
  for (const patch of [
    { subscriptionId: 'wrong' }, { tenantId: 'wrong' }, { runId: '0'.repeat(32) },
    { stackId: starting().stackId.replace('test-run', 'test-data') },
    { phase: 'unknown' }, { expiresAt: 'not a date' },
  ]) assert.throws(() => validateState({ ...starting(), ...patch }));
  assert.throws(() => validateState({ ...idleState(), expiresAt: '2026-01-01T16:00:00Z' }));
});

test('the finite lease serializes concurrent starts and is always released', async () => {
  const azure = new MemoryAzure();
  const store = new StateStore(azure, FOUNDATION.stateUrl);
  let competingFailed = false;
  await store.locked(async (current, write) => {
    await assert.rejects(store.locked(() => {}), /409/);
    competingFailed = true;
    await write(startState(current, { now: TEST_NOW, runId: RUN_ID }));
  });
  assert.equal(competingFailed, true);
  assert.equal(azure.state.runId, RUN_ID);
  assert.equal(azure.leaseId, null);
  assert.equal(azure.calls.find((call) => call.headers?.['x-ms-lease-action'] === 'acquire').headers['x-ms-lease-duration'], '60');
  assert.ok(azure.calls.every((call) => Number.isFinite(Date.parse(call.headers['x-ms-date']))));
});

test('operation errors release the lease and initialization never replaces existing state', async () => {
  const azure = new MemoryAzure(starting());
  const store = new StateStore(azure, FOUNDATION.stateUrl);
  await store.initialize();
  assert.equal(azure.state.runId, RUN_ID);
  await assert.rejects(store.locked(() => { throw new Error('expected test failure'); }), /expected test failure/);
  assert.equal(azure.leaseId, null);
});

test('initialization reads and preserves existing state after the native BlobAlreadyExists conflict', async () => {
  for (const existing of [idleState(TEST_NOW), beginSubmission(starting(), {}, TEST_NOW)]) {
    const calls = [];
    const azure = {
      async request(_url, options) {
        calls.push(options);
        if (options.method === 'PUT') throw new AzureError('Create lifecycle blob', 409, 'BlobAlreadyExists');
        return { status: 200, body: structuredClone(existing) };
      },
    };
    const before = structuredClone(existing);
    await new StateStore(azure, FOUNDATION.stateUrl).initialize();
    assert.deepEqual(calls.map((call) => call.method), ['PUT', 'GET']);
    assert.equal(calls[0].headers['If-None-Match'], '*');
    assert.deepEqual(existing, before);
  }
});

test('initialization does not turn other conflicts or request failures into success', async () => {
  for (const error of [
    new AzureError('Create lifecycle blob', 409, 'LeaseAlreadyPresent'),
    new AzureError('Create lifecycle blob', 409),
    new AzureError('Create lifecycle blob', 500, 'BlobAlreadyExists'),
    new Error('BlobAlreadyExists'),
  ]) {
    const calls = [];
    const azure = { async request(_url, options) { calls.push(options.method); throw error; } };
    await assert.rejects(new StateStore(azure, FOUNDATION.stateUrl).initialize(), (caught) => caught === error);
    assert.deepEqual(calls, ['PUT']);
  }
});

test('an existing blob still requires readable, valid lifecycle state', async () => {
  for (const result of [
    { status: 200, body: { ...idleState(TEST_NOW), schemaVersion: 1 } },
    { status: 200, body: { ...idleState(TEST_NOW), subscriptionId: 'foreign-subscription' } },
    new AzureError('Read lifecycle blob', 404, 'BlobNotFound'),
  ]) {
    const calls = [];
    const azure = {
      async request(_url, options) {
        calls.push(options.method);
        if (options.method === 'PUT') throw new AzureError('Create lifecycle blob', 409, 'BlobAlreadyExists');
        if (result instanceof Error) throw result;
        return result;
      },
    };
    await assert.rejects(new StateStore(azure, FOUNDATION.stateUrl).initialize());
    assert.deepEqual(calls, ['PUT', 'GET']);
  }
});

test('long operations renew a finite lease; losing it aborts further mutations', async () => {
  const azure = new MemoryAzure();
  const store = new StateStore(azure, FOUNDATION.stateUrl, { renewEvery: 2 });
  await store.locked(async () => { await setTimeout(15); });
  assert.ok(azure.calls.some((call) => call.headers?.['x-ms-lease-action'] === 'renew'));
  azure.failRenewal = true;
  await assert.rejects(store.locked(async (current, write, signal) => {
    await setTimeout(15);
    assert.equal(signal.aborted, true);
    await write(startState(current, { now: TEST_NOW, runId: RUN_ID }));
  }), /409/);
  assert.equal(azure.state.phase, 'Idle');
});
