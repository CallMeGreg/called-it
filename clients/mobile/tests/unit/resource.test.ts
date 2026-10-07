import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ClientError } from '../../src/api/errors';
import { PollingResource } from '../../src/api/resource';

test('foreground polling schedules only after completion and pause cancels the timer', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const resource = new PollingResource(async () => ++calls, 8_000);
  context.after(() => resource.pause());
  await resource.resume();
  assert.equal(resource.getSnapshot().data, 1);
  context.mock.timers.tick(7_999);
  assert.equal(calls, 1);
  context.mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(calls, 2);
  resource.pause();
  context.mock.timers.tick(60_000);
  assert.equal(calls, 2);
  await resource.resume();
  assert.equal(calls, 3);
});

test('an offline API pauses retries, preserves confirmed data, and can recover manually', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  let offline = false;
  const resource = new PollingResource(async () => {
    calls += 1;
    if (offline) throw new ClientError('network', 'Offline');
    return calls;
  }, 8_000);
  context.after(() => resource.pause());
  await resource.resume();
  offline = true;
  await resource.refresh();
  assert.equal(resource.getSnapshot().data, 1);
  assert.equal(resource.getSnapshot().error?.message, 'Offline');
  context.mock.timers.tick(60_000);
  assert.equal(calls, 2);
  offline = false;
  await resource.refresh();
  assert.equal(resource.getSnapshot().data, 3);
  assert.equal(resource.getSnapshot().error, null);
});

test('replacing an in-flight refresh prevents an old response overwriting confirmed state', async (context) => {
  let resolveOld!: (value: number) => void;
  let calls = 0;
  const resource = new PollingResource(async () => ++calls === 1
    ? new Promise<number>((resolve) => { resolveOld = resolve; })
    : 2, 8_000);
  context.after(() => resource.pause());
  const old = resource.resume();
  await resource.refresh();
  resolveOld(1);
  assert.deepEqual(await old, { ok: false, error: null });
  assert.equal(resource.getSnapshot().data, 2);
});

test('background pause cancels in-flight work even when the transport ignores abort', async (context) => {
  let complete!: (value: string) => void;
  const resource = new PollingResource(() => new Promise<string>((resolve) => { complete = resolve; }), 8_000);
  context.after(() => resource.pause());
  const request = resource.resume();
  assert.equal(resource.getSnapshot().busy, true);
  resource.pause();
  complete('late account data');
  assert.deepEqual(await request, { ok: false, error: null });
  assert.deepEqual(resource.getSnapshot(), { data: null, error: null, busy: false });
});

test('slow requests never overlap automatic polls', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  let complete!: (value: number) => void;
  const resource = new PollingResource(() => {
    calls += 1;
    return new Promise<number>((resolve) => { complete = resolve; });
  }, 8_000);
  context.after(() => resource.pause());
  const request = resource.resume();
  context.mock.timers.tick(60_000);
  assert.equal(calls, 1);
  complete(1);
  await request;
  context.mock.timers.tick(8_000);
  assert.equal(calls, 2);
  complete(2);
});
