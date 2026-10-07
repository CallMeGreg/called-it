import test from 'node:test';
import assert from 'node:assert/strict';
import { Lifecycle, assertOwnedStack, main } from './lifecycle.mjs';
import { CONFIG, GROUP_ID, MANAGED_GROUP_ID, DATA_GROUP_ID } from './config.mjs';
import { idleState, startState } from './state.mjs';
import { FOUNDATION, RUN_ID, TEST_NOW, MemoryAzure } from './test-fixtures.mjs';

function fakeLifecycle({ migrationStatus = 'Succeeded', managedLeftover = false } = {}) {
  const azure = new MemoryAzure();
  const requests = [];
  let stack;
  let managed = false;
  azure.guard = async () => {};
  azure.compile = async (path) => {
    assert.equal(path, 'infra/test/run.bicep');
    return { resources: [] };
  };
  azure.command = async (file, args) => { requests.push({ file, args }); return ''; };
  azure.az = async (args) => {
    requests.push({ file: 'az', args });
    return args[0] === 'acr' && args[1] === 'repository' ? `sha256:${'a'.repeat(64)}` : {};
  };
  azure.fetcher = async (url, options = {}) => {
    if (options.method === 'HEAD') return new Response(null, { headers: { 'content-type': 'application/javascript' } });
    return url.endsWith('/health/ready')
      ? new Response('{"status":"ok"}', { headers: { 'content-type': 'application/json' } })
      : new Response('<html><body>phone web<script src="/_expo/entry.js"></script></body></html>', { headers: { 'content-type': 'text/html' } });
  };
  azure.arm = async (path, options = {}) => {
    options.signal?.throwIfAborted();
    requests.push({ path, ...options });
    if (path.startsWith(`${FOUNDATION.watchdogId}/runs?`)) {
      return { status: 200, body: { value: [{ properties: { status: 'Succeeded', endTime: TEST_NOW.toISOString() } }] } };
    }
    if (path.startsWith(`${FOUNDATION.watchdogId}?`)) {
      return { status: 200, body: { properties: {
        state: 'Enabled', definition: { triggers: { Check_expiry: {
          recurrence: { frequency: 'Minute', interval: 5 }, runtimeConfiguration: { concurrency: { runs: 1 } },
        } } },
        parameters: Object.fromEntries(Object.entries({
          stateUrl: FOUNDATION.stateUrl, runGroupId: GROUP_ID, managedGroupId: MANAGED_GROUP_ID,
          subscriptionId: CONFIG.subscriptionId, tenantId: CONFIG.tenantId,
        }).map(([key, value]) => [key, { value }])),
      } } };
    }
    if (path.startsWith(`${GROUP_ID}/resources?`)) return { status: 200, body: { value: stack?.properties.resources ?? [] } };
    if (path.startsWith(`${MANAGED_GROUP_ID}?`)) return { status: managed ? 200 : 404 };
    if (path.startsWith(`${FOUNDATION.sqlServerId}?`)) {
      return { status: 200, body: { properties: { publicNetworkAccess: 'Disabled' } } };
    }
    if (path.includes('/Microsoft.Insights/metricAlerts/')) {
      return { status: 200, body: { properties: { enabled: true, scopes: [FOUNDATION.watchdogId] } } };
    }
    if (path.includes('/Microsoft.KeyVault/')) {
      const name = path.split('/secrets/')[1].split('?')[0];
      return { status: 200, body: { properties: { secretUriWithVersion: `${FOUNDATION.vaultUri}secrets/${name}/${'a'.repeat(32)}` } } };
    }
    if (path.includes('/Microsoft.Resources/deploymentStacks/')) {
      if (options.method === 'PUT') {
        const run = options.body.properties.parameters.runId.value;
        const registryName = `cittest${run.slice(0, 20)}`;
        stack = {
          id: path.split('?')[0], tags: options.body.tags,
          properties: {
            ...options.body.properties, provisioningState: 'Succeeded',
            resources: [{ id: `${GROUP_ID}/providers/Microsoft.ContainerRegistry/registries/${registryName}` }],
            outputs: Object.fromEntries(Object.entries({
              registryName, registryServer: `${registryName}.azurecr.io`,
              migrationJobId: `${GROUP_ID}/providers/Microsoft.App/jobs/cit-test-${run.slice(0, 12)}-migrate`,
              appUrl: 'https://phone.example.azurecontainerapps.io',
            }).map(([name, value]) => [name, { value }])),
          },
        };
        managed = true;
        return { status: 201, body: stack };
      }
      if (options.method === 'DELETE') {
        stack = undefined;
        managed = managedLeftover;
        return { status: 202 };
      }
      return { status: stack ? 200 : 404, body: stack };
    }
    if (path.includes('/start?')) return { status: 200, body: { name: 'migration-execution' } };
    if (path.includes('/executions/')) return { status: 200, body: { properties: { status: migrationStatus } } };
    throw new Error(`Unexpected fake ARM call: ${path}`);
  };
  const lifecycle = new Lifecycle(azure, FOUNDATION, { pause: async () => {}, now: () => TEST_NOW });
  return { azure, lifecycle, requests };
}

test('extra actions or unrelated options are rejected before any Azure context is used', async () => {
  await assert.rejects(main(['start', 'another-environment']), /exactly one/);
  await assert.rejects(main(['start', '--run-id', RUN_ID]), /Unexpected options/);
  await assert.rejects(main(['status', '--register-providers']), /Unexpected options/);
});

test('Start provisions network, builds digests, migrates privately, then publishes API; Stop retains data', async (context) => {
  context.mock.method(console, 'log', () => {});
  const { azure, lifecycle, requests } = fakeLifecycle();
  const running = await lifecycle.start();
  assert.equal(running.phase, 'Running');
  const stages = requests.filter(({ method }) => method === 'PUT');
  assert.equal(stages.length, 3);
  assert.equal(stages[0].body.properties.parameters.apiImage.value, '');
  assert.equal(stages[0].body.properties.parameters.migrationImage.value, '');
  assert.match(stages[1].body.properties.parameters.migrationImage.value, /@sha256:/);
  assert.equal(stages[1].body.properties.parameters.apiImage.value, '');
  assert.match(stages[2].body.properties.parameters.apiImage.value, /@sha256:/);
  assert.equal(stages[0].path, stages[2].path);
  assert.equal(requests.some(({ file, args }) => file === 'az' && args.includes('update')), false);
  await lifecycle.stop(running.runId, { confirm: running.runId });
  assert.equal(azure.state.phase, 'Idle');
  const deletion = requests.find(({ method }) => method === 'DELETE');
  assert.match(deletion.path, /unmanageAction.Resources=delete/);
  assert.match(deletion.path, /unmanageAction.ResourceGroups=detach/);
  assert.equal(requests.some(({ path, method }) => method === 'DELETE' && path.startsWith(DATA_GROUP_ID)), false);
  await lifecycle.stop(running.runId, { confirm: running.runId });
});

test('failed migration never publishes an app and invokes guarded cleanup', async (context) => {
  context.mock.method(console, 'log', () => {});
  context.mock.method(console, 'error', () => {});
  const { lifecycle, requests, azure } = fakeLifecycle({ migrationStatus: 'Failed' });
  await assert.rejects(lifecycle.start(), /Private migration Failed/);
  assert.equal(requests.filter(({ method }) => method === 'PUT').length, 2);
  assert.equal(azure.state.phase, 'Idle');
  assert.ok(requests.some(({ method }) => method === 'DELETE'));
});

test('Start does not call an HTML shell healthy when a required JavaScript asset is missing', async (context) => {
  context.mock.method(console, 'log', () => {});
  context.mock.method(console, 'error', () => {});
  const { lifecycle, azure } = fakeLifecycle();
  const fetcher = azure.fetcher;
  azure.fetcher = async (url, options) => options?.method === 'HEAD'
    ? new Response('not found', { status: 404 }) : fetcher(url, options);
  await assert.rejects(lifecycle.start(), /JavaScript asset is missing/);
  assert.equal(azure.state.phase, 'Idle');
});

test('an orphaned ACA-managed group prevents Off even after stack deletion', async (context) => {
  context.mock.method(console, 'log', () => {});
  const { lifecycle, azure } = fakeLifecycle({ managedLeftover: true });
  const running = await lifecycle.start();
  let waits = 0;
  lifecycle.pause = async () => { if (++waits > 1) throw new Error('bounded test wait'); };
  await assert.rejects(lifecycle.stop(running.runId, { confirm: running.runId }), /bounded test wait/);
  assert.equal(azure.state.phase, 'Stopping');
  assert.match(azure.state.lastError, /paid resources may remain/);
  await assert.rejects(lifecycle.verifyOff(), /managed group still exists/);
});

test('Stop needs exact run confirmation and cannot target a new run', async (context) => {
  context.mock.method(console, 'log', () => {});
  const { lifecycle, azure, requests } = fakeLifecycle();
  azure.state = startState(idleState(TEST_NOW), { now: TEST_NOW, runId: RUN_ID });
  await assert.rejects(lifecycle.stop(RUN_ID), /--confirm/);
  await assert.rejects(lifecycle.stop('a'.repeat(32), { confirm: 'a'.repeat(32) }), /different or newer/);
  assert.equal(requests.some(({ method }) => method === 'DELETE'), false);
});

test('ownership inventory rejects persistent resources, unknown scope, deny settings and missing inventory', () => {
  const state = startState(idleState(TEST_NOW), { now: TEST_NOW, runId: RUN_ID });
  const stack = {
    id: state.stackId, tags: { application: 'called-it', environment: 'test', runId: RUN_ID },
    properties: { deploymentScope: GROUP_ID, denySettings: { mode: 'none' }, resources: [] },
  };
  assert.doesNotThrow(() => assertOwnedStack(stack, state));
  for (const properties of [
    { resources: [{ id: FOUNDATION.sqlServerId }] },
    { deploymentScope: DATA_GROUP_ID }, { denySettings: { mode: 'denyDelete' } }, { resources: undefined },
  ]) assert.throws(() => assertOwnedStack({ ...stack, properties: { ...stack.properties, ...properties } }, state));
});

test('controlled expiry shortens only the matching run; the watchdog, not this command, deletes it', async (context) => {
  context.mock.method(console, 'log', () => {});
  const { lifecycle, azure, requests } = fakeLifecycle();
  azure.state = startState(idleState(TEST_NOW), { now: TEST_NOW, runId: RUN_ID });
  await lifecycle.expire(RUN_ID, RUN_ID);
  assert.equal(azure.state.expiresAt, TEST_NOW.toISOString());
  assert.equal(azure.state.phase, 'Starting');
  assert.equal(requests.some(({ method }) => method === 'DELETE'), false);
  await assert.rejects(lifecycle.extend(RUN_ID), /already expired/);
});
