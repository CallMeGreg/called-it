import test from 'node:test';
import assert from 'node:assert/strict';
import { Lifecycle, assertOwnedStack, main, UnresolvedSubmissionError } from './lifecycle.mjs';
import { CONFIG, GROUP_ID, MANAGED_GROUP_ID, DATA_GROUP_ID } from './config.mjs';
import { idleState, startState, pendingSubmission } from './state.mjs';
import { FOUNDATION, RUN_ID, TEST_NOW, MemoryAzure } from './test-fixtures.mjs';
import { AzureError } from './azure.mjs';
import { PROTOCOL } from './operations.mjs';

function fakeLifecycle({ migrationStatus = 'Succeeded', managedLeftover = false } = {}) {
  const azure = new MemoryAzure();
  const requests = [];
  let stack;
  let managed = false;
  let generation = 0;
  const deployments = new Map();
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
      return { status: 200, body: { location: CONFIG.location, properties: {
        state: 'Enabled', definition: { contentVersion: PROTOCOL.controllerVersion, triggers: { Check_expiry: {
          recurrence: { frequency: 'Minute', interval: 5 }, runtimeConfiguration: { concurrency: { runs: 1 } },
        } } },
        parameters: Object.fromEntries(Object.entries({
          controlLocation: CONFIG.location, workloadLocation: CONFIG.workloadLocation,
          stateUrl: FOUNDATION.stateUrl, runGroupId: GROUP_ID, managedGroupId: MANAGED_GROUP_ID,
          subscriptionId: CONFIG.subscriptionId, tenantId: CONFIG.tenantId,
        }).map(([key, value]) => [key, { value }])),
      } } };
    }
    if (path.startsWith(`${GROUP_ID}/resources?`)) return { status: 200, body: { value: stack?.properties.resources ?? [] } };
    if (path.startsWith(`${MANAGED_GROUP_ID}?`)) return { status: managed ? 200 : 404 };
    if (path.startsWith(`${FOUNDATION.sqlServerId}?`)) {
      return { status: 200, body: { location: CONFIG.workloadLocation, properties: { publicNetworkAccess: 'Disabled' } } };
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
        generation++;
        const run = options.body.properties.parameters.runId.value;
        const registryName = `cittest${run.slice(0, 20)}`;
        const deploymentId = `${GROUP_ID}/providers/Microsoft.Resources/deployments/test-generation-${generation}`;
        deployments.set(deploymentId.toLowerCase(), {
          id: deploymentId,
          properties: {
            correlationId: `20000000-0000-0000-0000-${String(generation).padStart(12, '0')}`,
            provisioningState: 'Succeeded', parameters: structuredClone(options.body.properties.parameters),
          },
        });
        stack = {
          id: path.split('?')[0], location: options.body.location, tags: options.body.tags,
          properties: {
            ...options.body.properties, provisioningState: 'succeeded', deploymentId,
            correlationId: `10000000-0000-0000-0000-${String(generation).padStart(12, '0')}`,
            resources: [{ id: `${GROUP_ID}/providers/Microsoft.ContainerRegistry/registries/${registryName}` }],
            outputs: Object.fromEntries(Object.entries({
              registryName, registryServer: `${registryName}.azurecr.io`,
              migrationJobId: `${GROUP_ID}/providers/Microsoft.App/jobs/cit-test-${run.slice(0, 12)}-migrate`,
              appUrl: 'https://phone.example.centralus.azurecontainerapps.io',
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
    if (path.includes('/providers/Microsoft.Resources/deployments/')) {
      if (path.includes('/cancel?')) return { status: 202 };
      const deployment = deployments.get(path.split('?')[0].toLowerCase());
      return { status: deployment ? 200 : 404, body: deployment };
    }
    if (path.includes('/start?')) return {
      status: 200, body: { name: 'migration-execution', id: `${path.split('/start?')[0]}/executions/migration-execution` },
    };
    if (path.includes('/executions/')) return { status: 200, body: { properties: { status: migrationStatus } } };
    throw new Error(`Unexpected fake ARM call: ${path}`);
  };
  const lifecycle = new Lifecycle(azure, FOUNDATION, { pause: async () => {}, now: () => TEST_NOW });
  return { azure, lifecycle, requests, deployments, stack: () => stack };
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
  for (const stage of stages) {
    assert.equal(stage.body.location, 'eastus2');
    assert.equal(stage.body.properties.parameters.location.value, 'centralus');
    assert.equal(stage.body.properties.parameters.foundation.value.location, 'eastus2');
    assert.equal(stage.body.properties.parameters.foundation.value.workloadLocation, 'centralus');
  }
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

test('Start and Extend require the split-region controller protocol, not an older watchdog', async () => {
  for (const version of [undefined, '1.0.0.0', '2.0.0.0']) {
    const { lifecycle, azure, requests } = fakeLifecycle();
    const send = azure.arm;
    azure.arm = async (path, options) => {
      const result = await send(path, options);
      if (path.startsWith(`${FOUNDATION.watchdogId}?`)) result.body.properties.definition.contentVersion = version;
      return result;
    };
    await assert.rejects(lifecycle.start(), /controller protocol/);
    await assert.rejects(lifecycle.extend(RUN_ID), /controller protocol/);
    assert.equal(azure.state.phase, 'Idle');
    assert.equal(requests.some(({ method }) => method === 'PUT'), false);
  }
});

test('Start rejects SQL/control-region drift and mismatched watchdog workload scope before a PUT', async () => {
  for (const fault of ['sql', 'controller', 'controlLocation', 'workloadLocation']) {
    const { lifecycle, azure, requests } = fakeLifecycle();
    const send = azure.arm;
    azure.arm = async (path, options) => {
      const response = await send(path, options);
      if (fault === 'sql' && path.startsWith(`${FOUNDATION.sqlServerId}?`)) response.body.location = CONFIG.location;
      if (path.startsWith(`${FOUNDATION.watchdogId}?`)) {
        if (fault === 'controller') response.body.location = CONFIG.workloadLocation;
        else if (fault !== 'sql') response.body.properties.parameters[fault].value = 'westus';
      }
      return response;
    };
    await assert.rejects(lifecycle.start(), /region|scope/);
    assert.equal(azure.state.phase, 'Idle');
    assert.equal(requests.some(({ method }) => method === 'PUT'), false);
  }
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
    id: state.stackId, location: CONFIG.location, tags: { application: 'called-it', environment: 'test', runId: RUN_ID },
    properties: { deploymentScope: GROUP_ID, denySettings: { mode: 'none' }, resources: [] },
  };
  assert.doesNotThrow(() => assertOwnedStack(stack, state));
  assert.throws(() => assertOwnedStack({ ...stack, location: CONFIG.workloadLocation }, state), /metadata region/);
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

test('a timed-out first PUT stays owned through empty reads and a later materialization', async (context) => {
  context.mock.method(console, 'log', () => {});
  const fixture = fakeLifecycle();
  const { azure, lifecycle, requests } = fixture;
  azure.state = startState(idleState(TEST_NOW), { now: TEST_NOW, runId: RUN_ID });
  const send = azure.arm;
  let delayed;
  azure.arm = async (path, options = {}) => {
    if (options.method === 'PUT') {
      assert.equal(pendingSubmission(azure.state).id, options.body.tags.submissionId);
      assert.equal(options.headers['x-ms-client-request-id'], pendingSubmission(azure.state).clientRequestId);
      delayed = () => send(path, options);
      throw new AzureError('PUT stack', 'TimeoutError');
    }
    return send(path, options);
  };
  await assert.rejects(lifecycle.applyRun(RUN_ID), /TimeoutError/);
  const intentId = pendingSubmission(azure.state).id;
  await assert.rejects(lifecycle.stop(RUN_ID, { confirm: RUN_ID }), UnresolvedSubmissionError);
  assert.equal(azure.state.phase, 'Stopping');
  assert.equal(pendingSubmission(azure.state).id, intentId);
  assert.equal(requests.some(({ method }) => method === 'DELETE'), false);
  await assert.rejects(lifecycle.start(), /Cannot Start/);
  await delayed();
  await lifecycle.stop(RUN_ID, { confirm: RUN_ID });
  assert.equal(azure.state.phase, 'Idle');
  assert.equal(azure.state.lastSubmissions[0].evidence.kind, 'deployment-generation');
  assert.equal(fixture.stack(), undefined);
});

test('a delayed stage update cannot become unowned after the old stack disappears', async (context) => {
  context.mock.method(console, 'log', () => {});
  const fixture = fakeLifecycle();
  const { azure, lifecycle } = fixture;
  azure.state = startState(idleState(TEST_NOW), { now: TEST_NOW, runId: RUN_ID });
  await lifecycle.applyRun(RUN_ID);
  const previousDeployment = fixture.stack().properties.deploymentId;
  const send = azure.arm;
  let delayed;
  azure.arm = async (path, options = {}) => {
    if (options.method === 'PUT') {
      delayed = () => send(path, options);
      throw new AzureError('PUT stage', 'TimeoutError');
    }
    return send(path, options);
  };
  await assert.rejects(lifecycle.applyRun(RUN_ID), /TimeoutError/);
  assert.equal(pendingSubmission(azure.state).previousDeploymentId, previousDeployment);
  await send(`${azure.state.stackId}?api-version=2024-03-01`, { method: 'DELETE' });
  await assert.rejects(lifecycle.stop(RUN_ID, { confirm: RUN_ID }), UnresolvedSubmissionError);
  await assert.rejects(lifecycle.stop(RUN_ID, { confirm: RUN_ID }), UnresolvedSubmissionError);
  assert.equal(azure.state.phase, 'Stopping');
  await assert.rejects(lifecycle.start(), /Cannot Start/);
  await delayed();
  await lifecycle.stop(RUN_ID, { confirm: RUN_ID });
  assert.equal(azure.state.phase, 'Idle');
  assert.equal(azure.state.lastSubmissions.length, 2);
  assert.ok(azure.state.lastSubmissions.every(({ status }) => status === 'terminal'));
});

test('a new tag and old terminal generation are not completion evidence', async (context) => {
  context.mock.method(console, 'log', () => {});
  const fixture = fakeLifecycle();
  const { azure, lifecycle } = fixture;
  azure.state = startState(idleState(TEST_NOW), { now: TEST_NOW, runId: RUN_ID });
  await lifecycle.applyRun(RUN_ID);
  const send = azure.arm;
  azure.arm = async (path, options = {}) => {
    if (options.method === 'PUT') {
      fixture.stack().tags = options.body.tags;
      fixture.stack().properties.parameters = options.body.properties.parameters;
      throw new AzureError('PUT stage', 'TimeoutError');
    }
    return send(path, options);
  };
  await assert.rejects(lifecycle.applyRun(RUN_ID), /TimeoutError/);
  await assert.rejects(lifecycle.stop(RUN_ID, { confirm: RUN_ID }), UnresolvedSubmissionError);
  fixture.stack().properties.correlationId = '30000000-0000-0000-0000-000000000001';
  await assert.rejects(lifecycle.stop(RUN_ID, { confirm: RUN_ID }), UnresolvedSubmissionError);
  const old = fixture.deployments.get(fixture.stack().properties.deploymentId.toLowerCase());
  old.properties.parameters = fixture.stack().properties.parameters;
  await assert.rejects(lifecycle.stop(RUN_ID, { confirm: RUN_ID }), UnresolvedSubmissionError);
  assert.equal(azure.state.phase, 'Stopping');
  assert.equal(pendingSubmission(azure.state).status, 'pending');
});

test('another stage cannot use a stale or missing preceding-generation snapshot as its baseline', async () => {
  for (const missing of [false, true]) {
    const fixture = fakeLifecycle();
    const { azure, lifecycle, requests } = fixture;
    azure.state = startState(idleState(TEST_NOW), { now: TEST_NOW, runId: RUN_ID });
    await lifecycle.applyRun(RUN_ID);
    const oldStack = structuredClone(fixture.stack());
    await lifecycle.applyRun(RUN_ID);
    const send = azure.arm;
    azure.arm = async (path, options = {}) => {
      if (path.startsWith(`${azure.state.stackId}?`) && !options.method) {
        return missing ? { status: 404 } : { status: 200, body: oldStack };
      }
      return send(path, options);
    };
    await assert.rejects(lifecycle.applyRun(RUN_ID), /preceding.*(submission|generation)|snapshot is stale/);
    assert.equal(azure.state.submissions.length, 2);
    assert.equal(pendingSubmission(azure.state), null);
    assert.equal(requests.filter(({ method }) => method === 'PUT').length, 2);
  }
});

test('terminal failed/canceled LRO receipts settle exact submissions and permit cleanup', async (context) => {
  context.mock.method(console, 'log', () => {});
  for (const result of ['Failed', 'Canceled']) {
    const { azure, lifecycle, requests } = fakeLifecycle();
    azure.state = startState(idleState(TEST_NOW), { now: TEST_NOW, runId: RUN_ID });
    const send = azure.arm;
    const url = `https://management.azure.com/subscriptions/${CONFIG.subscriptionId}/providers/Microsoft.Resources/locations/eastus2/deploymentStackOperationStatuses/1234?api-version=2024-03-01`;
    azure.arm = async (path, options = {}) => {
      if (path.includes('/deploymentStackOperationStatuses/')) return { status: 200, body: { status: result } };
      const response = await send(path, options);
      if (options.method === 'PUT') response.headers = new Headers({ 'Azure-AsyncOperation': url });
      return response;
    };
    await assert.rejects(lifecycle.applyRun(RUN_ID), /Run stack deployment (failed|canceled)/);
    assert.equal(pendingSubmission(azure.state), null);
    assert.equal(azure.state.submissions[0].evidence.operationUrl, url);
    await lifecycle.stop(RUN_ID, { confirm: RUN_ID });
    assert.equal(azure.state.phase, 'Idle');
    assert.ok(requests.some(({ method }) => method === 'DELETE'));
  }
});

test('all documented busy/deleting stack states avoid a premature DELETE', async (context) => {
  context.mock.method(console, 'log', () => {});
  for (const phase of [...PROTOCOL.stackStates.inFlight, ...PROTOCOL.stackStates.deleting]) {
    const fixture = fakeLifecycle();
    fixture.azure.state = startState(idleState(TEST_NOW), { now: TEST_NOW, runId: RUN_ID });
    await fixture.lifecycle.applyRun(RUN_ID);
    fixture.stack().properties.provisioningState = phase;
    fixture.lifecycle.pause = async () => { throw new Error('bounded state probe'); };
    await assert.rejects(fixture.lifecycle.stop(RUN_ID, { confirm: RUN_ID }), /bounded state probe/);
    assert.equal(fixture.requests.some(({ method }) => method === 'DELETE'), false, phase);
    assert.equal(fixture.azure.state.phase, 'Stopping');
  }
});

test('a bodyless 204 LRO receipt alone never clears ambiguous submission intent', async (context) => {
  context.mock.method(console, 'log', () => {});
  const { azure, lifecycle } = fakeLifecycle();
  azure.state = startState(idleState(TEST_NOW), { now: TEST_NOW, runId: RUN_ID });
  const url = `https://management.azure.com/subscriptions/${CONFIG.subscriptionId}/providers/Microsoft.Resources/locations/eastus2/deploymentStackOperationResults/1234?api-version=2024-03-01`;
  const send = azure.arm;
  azure.arm = async (path, options = {}) => {
    if (options.method === 'PUT') return { status: 201, headers: new Headers({ Location: url }) };
    if (path.includes('/deploymentStackOperationResults/')) {
      assert.ok(options.allowed.includes(204));
      return { status: 204 };
    }
    return send(path, options);
  };
  lifecycle.pause = async () => { throw new Error('bounded unresolved wait'); };
  await assert.rejects(lifecycle.applyRun(RUN_ID), /bounded unresolved wait/);
  await assert.rejects(lifecycle.stop(RUN_ID, { confirm: RUN_ID }), UnresolvedSubmissionError);
  assert.equal(azure.state.phase, 'Stopping');
  assert.equal(pendingSubmission(azure.state).operationUrl, url);
});

test('empty 202 Job start follows Location to the final execution before status polling', async () => {
  const { azure, lifecycle, requests } = fakeLifecycle();
  azure.state = startState(idleState(TEST_NOW), { now: TEST_NOW, runId: RUN_ID });
  const jobId = `${GROUP_ID}/providers/Microsoft.App/jobs/test-migrate`;
  const url = `https://management.azure.com/subscriptions/${CONFIG.subscriptionId}/providers/Microsoft.App/locations/centralus/operationResults/start-123?api-version=2025-01-01`;
  const send = azure.arm;
  let polls = 0;
  azure.arm = async (path, options = {}) => {
    if (path.includes('/start?')) return { status: 202, body: null, headers: new Headers({ Location: url }) };
    if (path.includes('/operationResults/')) {
      polls++;
      return polls === 1 ? { status: 202, body: null } : { status: 200, body: { name: 'final-execution', id: `${jobId}/executions/final-execution` } };
    }
    return send(path, options);
  };
  await lifecycle.migrate(jobId, RUN_ID);
  assert.equal(polls, 2);
  assert.ok(requests.some(({ path }) => path?.includes('/executions/final-execution?')));
});

test('Job start prefers Azure-AsyncOperation, then retrieves the saved Location execution result', async () => {
  const { azure, lifecycle, requests } = fakeLifecycle();
  azure.state = startState(idleState(TEST_NOW), { now: TEST_NOW, runId: RUN_ID });
  const jobId = `${GROUP_ID}/providers/Microsoft.App/jobs/test-migrate`;
  const root = `https://management.azure.com/subscriptions/${CONFIG.subscriptionId}/providers/Microsoft.App/locations/centralus`;
  const statusUrl = `${root}/operationStatuses/start-123?api-version=2025-01-01`;
  const resultUrl = `${root}/operationResults/start-123?api-version=2025-01-01`;
  const send = azure.arm;
  const polled = [];
  azure.arm = async (path, options = {}) => {
    if (path.includes('/start?')) return {
      status: 202, body: null, headers: new Headers({ 'Azure-AsyncOperation': statusUrl, Location: resultUrl }),
    };
    if (path.includes('/operationStatuses/')) {
      polled.push('status');
      return { status: 200, body: { status: polled.length === 1 ? 'InProgress' : 'Succeeded', name: 'operation-not-execution' } };
    }
    if (path.includes('/operationResults/')) {
      polled.push('result');
      return { status: 200, body: { name: 'final-execution', id: `${jobId}/executions/final-execution`, status: 'Succeeded' } };
    }
    return send(path, options);
  };
  await lifecycle.migrate(jobId, RUN_ID);
  assert.deepEqual(polled, ['status', 'status', 'result']);
  assert.ok(requests.some(({ path }) => path?.includes('/executions/final-execution?')));
});

test('failed Job start LROs never poll a successful-looking execution Location', async () => {
  const { azure, lifecycle } = fakeLifecycle();
  azure.state = startState(idleState(TEST_NOW), { now: TEST_NOW, runId: RUN_ID });
  const jobId = `${GROUP_ID}/providers/Microsoft.App/jobs/test-migrate`;
  const url = `${jobId}/operationStatuses/start-123?api-version=2025-01-01`;
  let calls = 0;
  azure.arm = async (path) => {
    calls++;
    if (path.includes('/start?')) return {
      status: 202, headers: new Headers({ 'Azure-AsyncOperation': url, Location: `${jobId}/executions/final-execution?api-version=2025-01-01` }),
    };
    assert.equal(path, url);
    return { status: 200, body: { status: 'Failed' } };
  };
  await assert.rejects(lifecycle.migrate(jobId, RUN_ID), /start operation failed/);
  assert.equal(calls, 2);
});

test('Job start rejects foreign Location headers and stops polling after ownership is lost', async () => {
  const jobId = `${GROUP_ID}/providers/Microsoft.App/jobs/test-migrate`;
  for (const url of [
    'https://example.org/steal',
    'https://management.azure.com/subscriptions/another/providers/Microsoft.App/locations/centralus/operations/1?api-version=2025-01-01',
    `https://management.azure.com/subscriptions/${CONFIG.subscriptionId}/providers/Microsoft.App/locations/eastus2/operations/1?api-version=2025-01-01`,
  ]) {
    const { azure, lifecycle } = fakeLifecycle();
    azure.state = startState(idleState(TEST_NOW), { now: TEST_NOW, runId: RUN_ID });
    azure.arm = async () => ({ status: 202, headers: new Headers({ Location: url }) });
    await assert.rejects(lifecycle.migrate(jobId, RUN_ID), /Refusing an ARM operation/);
  }
  const { azure, lifecycle } = fakeLifecycle();
  azure.state = startState(idleState(TEST_NOW), { now: TEST_NOW, runId: RUN_ID });
  let calls = 0;
  azure.arm = async () => {
    calls++;
    return { status: 202, headers: new Headers({ Location: `${jobId}/operationResults/1?api-version=2025-01-01` }) };
  };
  lifecycle.pause = async () => { azure.state.phase = 'Stopping'; };
  await assert.rejects(lifecycle.migrate(jobId, RUN_ID), /no longer owns/);
  assert.equal(calls, 1);
});
