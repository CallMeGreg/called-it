import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { watchdogDefinition } from '../../infra/test/watchdog-definition.mjs';
import { CONFIG, GROUP_ID, MANAGED_GROUP_ID } from './config.mjs';
import { idleState, startState, extendState, beginSubmission, pendingSubmission, updateSubmission } from './state.mjs';
import { FOUNDATION, RUN_ID, RUN_GROUP, TEST_NOW, EVENT_ID, rejectionEvent, rejectedStackResponse } from './test-fixtures.mjs';
import { evaluate, actionMap } from './wdl-test-evaluator.mjs';
import { PROTOCOL, operationUrl } from './operations.mjs';
import { activityRejection, responseRejection } from './rejections.mjs';

const definition = watchdogDefinition();
const actions = actionMap(definition);
const state = startState(idleState(TEST_NOW), { now: TEST_NOW, runId: RUN_ID });
const context = (observed = state, current = state) => ({
  parameters: {
    controlLocation: CONFIG.location, workloadLocation: CONFIG.workloadLocation,
    stateUrl: FOUNDATION.stateUrl, runGroupId: GROUP_ID, managedGroupId: MANAGED_GROUP_ID,
    subscriptionId: CONFIG.subscriptionId, tenantId: CONFIG.tenantId,
    identityId: 'non-secret-test-identity',
  },
  variables: { leaseId: 'test-lease' },
  bodies: {
    Read_state: observed, Read_current: current,
    Read_run_group: structuredClone(RUN_GROUP),
    Read_cleanup_state: { ...current, phase: 'Stopping' }, Cleanup_pending: [],
    Finish_pending: [],
  },
  outputs: { Read_run_group: { statusCode: 200 } },
  now: '2026-01-01T16:01:00.000Z',
});

test('checked-in watchdog JSON exactly matches its source and uses a five-minute single-run recurrence', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('../../infra/test/watchdog.json', import.meta.url))), definition);
  assert.equal(definition.contentVersion, PROTOCOL.controllerVersion);
  assert.equal(state.schemaVersion, 2);
  assert.equal(definition.triggers.Check_expiry.recurrence.interval, 5);
  assert.equal(definition.triggers.Check_expiry.runtimeConfiguration.concurrency.runs, 1);
});

test('generated control actions stay within the Logic Apps eight-level nesting limit', () => {
  function depth(children, level = 0) {
    return Math.max(level, ...Object.values(children ?? {}).map((action) =>
      Math.max(depth(action.actions, level + 1), depth(action.else?.actions, level + 1))));
  }
  assert.ok(depth(definition.actions) <= 8);
  assert.deepEqual(actions.Reconcile_claimed_run.runAfter, { Idle: ['Succeeded'] });
  assert.deepEqual(actions.Clean_claimed_run.runAfter, { Reconcile_claimed_run: ['Succeeded'] });
  assert.deepEqual(actions.Read_submission_state.runAfter, { Guard_run_group: ['Succeeded'] });
  assert.equal(evaluate(actions.Read_run_group.inputs.uri, context()), `https://management.azure.com${GROUP_ID}?api-version=2024-03-01`);
});

test('all HTTP calls use the assigned identity and Blob calls include required service/date headers', () => {
  for (const action of Object.values(actions).filter((action) => action.type === 'Http')) {
    assert.equal(action.inputs.authentication.type, 'ManagedServiceIdentity');
    assert.equal(action.inputs.authentication.identity, "@parameters('identityId')");
    assert.ok(['https://management.azure.com/', 'https://storage.azure.com/'].includes(action.inputs.authentication.audience));
    assert.equal(action.inputs.retryPolicy.type, 'none');
    if (action.inputs.authentication.audience === 'https://storage.azure.com/') {
      assert.equal(action.inputs.headers['x-ms-date'], "@formatDateTime(utcNow(),'r')");
      assert.equal(action.inputs.headers['x-ms-version'], '2023-11-03');
    }
  }
});

test('generated timer rechecks lease-protected current state, not a stale expiry observation', () => {
  assert.equal(evaluate(actions.Is_due.expression, context()), true);
  assert.equal(evaluate(actions.Still_due.expression, context()), true);
  const extended = extendState(state, RUN_ID, TEST_NOW);
  assert.equal(evaluate(actions.Still_due.expression, context(state, extended)), false);
  assert.equal(evaluate(actions.Still_due.expression, context(state, idleState(TEST_NOW))), false);
  const newRun = startState(idleState(TEST_NOW), { now: TEST_NOW, runId: 'a'.repeat(32) });
  assert.equal(evaluate(actions.Still_due.expression, context(state, newRun)), false);
});

test('Idle/skipped claim actions cannot enter cleanup; both claim and release must succeed', () => {
  const ctx = context(idleState(TEST_NOW));
  assert.equal(evaluate(actions.Clean_claimed_run.expression, ctx), false);
  ctx.actions = { Mark_stopping: { status: 'Succeeded' }, Release_state: { status: 'Failed' } };
  assert.equal(evaluate(actions.Clean_claimed_run.expression, ctx), false);
  ctx.actions.Release_state.status = 'Succeeded';
  assert.equal(evaluate(actions.Clean_claimed_run.expression, ctx), true);
});

test('all generated action and parameter references resolve to declared names', () => {
  function inspect(value) {
    if (typeof value === 'string' && value.startsWith('@')) {
      assert.ok(value.length <= 8192, 'WDL expression exceeds the service limit.');
      for (const match of value.matchAll(/\b(body|outputs|actions|parameters)\('([^']+)'\)/g)) {
        assert.ok(match[1] === 'parameters' ? match[2] in definition.parameters : match[2] in actions, `Unknown WDL reference ${match[2]}`);
      }
    } else if (value && typeof value === 'object') for (const child of Object.values(value)) inspect(child);
  }
  inspect(definition);
});

test('generated active-state predicate rejects wrong subscription, stack scope and fixture run IDs', () => {
  for (const patch of [
    { subscriptionId: 'wrong' }, { tenantId: 'wrong' }, { runId: '0'.repeat(32) },
    { stackId: state.stackId.replace('test-run', 'test-data') },
  ]) assert.equal(evaluate(actions.Valid_run.expression, context({ ...state, ...patch })), false);
});

test('controller region mismatches fail closed for both Idle and active schema-v2 state', () => {
  for (const field of ['controlLocation', 'workloadLocation']) {
    for (const value of [undefined, 'westus']) {
      const idle = context(idleState(TEST_NOW));
      idle.parameters[field] = value;
      assert.equal(evaluate(actions.Idle.expression, idle), false);
      const active = context();
      active.parameters[field] = value;
      assert.equal(evaluate(actions.Valid_run.expression, active), false);
    }
  }
  assert.equal(evaluate(actions.Idle.expression, context(idleState(TEST_NOW))), true);
});

test('generated teardown rejects foreign resources and requires actual inventory and stack ownership', () => {
  const ctx = context();
  ctx.bodies.Read_stack = {
    id: state.stackId, tags: { runId: RUN_ID, application: 'called-it', environment: 'test' },
    properties: { resources: [], deploymentScope: GROUP_ID, denySettings: { mode: 'none' }, provisioningState: 'succeeded' },
  };
  ctx.bodies.Foreign_resources = [];
  assert.equal(evaluate(actions.Owned_stack.expression, ctx), true);
  for (const deploymentScope of [null, undefined]) {
    ctx.bodies.Read_stack.properties.deploymentScope = deploymentScope;
    assert.equal(evaluate(actions.Owned_stack.expression, ctx), true);
  }
  ctx.bodies.Read_stack.properties.deploymentScope = GROUP_ID;
  ctx.bodies.Read_run_group.location = CONFIG.workloadLocation;
  assert.equal(evaluate(actions.Owned_stack.expression, ctx), false);
  assert.equal(evaluate(actions.Guard_run_group.expression, ctx), false);
  ctx.bodies.Read_run_group.location = CONFIG.location;
  assert.equal(evaluate(actions.Guard_run_group.expression, ctx), true);
  for (const group of [{ ...RUN_GROUP, id: MANAGED_GROUP_ID }, { ...RUN_GROUP, tags: {} }]) {
    assert.equal(evaluate(actions.Guard_run_group.expression, { ...ctx, bodies: { ...ctx.bodies, Read_run_group: group } }), false);
  }
  assert.equal(evaluate(actions.Foreign_resources.inputs.where, { ...ctx, item: { id: FOUNDATION.sqlServerId } }), true);
  ctx.bodies.Foreign_resources = [{ id: FOUNDATION.sqlServerId }];
  assert.equal(evaluate(actions.Owned_stack.expression, ctx), false);
  ctx.bodies.Foreign_resources = [];
  delete ctx.bodies.Read_stack.properties.resources;
  assert.equal(evaluate(actions.Owned_stack.expression, ctx), false);
});

test('generated cleanup never deletes either resource group or persistent data directly', () => {
  const deletion = Object.values(actions).filter((action) => action.type === 'Http' && action.inputs.method === 'DELETE');
  assert.equal(deletion.length, 1);
  const url = evaluate(deletion[0].inputs.uri, context());
  assert.ok(url.startsWith(`https://management.azure.com${state.stackId}?`));
  assert.ok(url.includes('unmanageAction.ResourceGroups=detach'));
  assert.ok(url.includes('unmanageAction.Resources=delete'));
  for (const name of ['Acquire_state', 'Acquire_finish']) {
    assert.equal(actions[name].inputs.headers['x-ms-lease-duration'], '60');
  }
});

test('Off requires a successful empty inventory, no continuation page, and managed group 404', () => {
  const ctx = context();
  ctx.bodies.Read_remaining = { value: [] };
  ctx.outputs = { ...ctx.outputs, Read_remaining: { statusCode: 200 }, Read_managed_group: { statusCode: 200 } };
  assert.equal(evaluate(actions.Check_empty.expression, ctx), false);
  ctx.outputs.Read_managed_group.statusCode = 404;
  assert.equal(evaluate(actions.Check_empty.expression, ctx), true);
  ctx.bodies.Read_remaining.nextLink = 'another-page';
  assert.equal(evaluate(actions.Check_empty.expression, ctx), false);
  ctx.bodies.Read_remaining = {};
  assert.equal(evaluate(actions.Check_empty.expression, ctx), false);
});

test('a stuck provider delete becomes a failed, alerting tick without disabling future retries', () => {
  const ctx = context(state, { ...state, phase: 'Stopping', stopRequestedAt: '2026-01-01T15:30:00Z' });
  assert.equal(evaluate(actions.Cleanup_deadline.expression, ctx), true);
  ctx.actions = { Write_idle: { status: 'Succeeded' } };
  assert.equal(evaluate(actions.Cleanup_deadline.expression, ctx), false);
  assert.deepEqual(actions.Cleanup_deadline.runAfter, { Stack_result: ['Succeeded'] });
});

test('a late cleanup completion cannot clear a newer run and produces a valid Idle transition', () => {
  const ctx = context();
  ctx.bodies.Read_finish = { ...state, phase: 'Stopping' };
  assert.equal(evaluate(actions.Same_run.expression, ctx), true);
  const idle = evaluate(actions.Write_idle.inputs.body, ctx);
  assert.equal(idle.phase, 'Idle');
  assert.equal(idle.runId, null);
  assert.equal(idle.lastRunId, RUN_ID);
  ctx.bodies.Read_finish.runId = 'a'.repeat(32);
  assert.equal(evaluate(actions.Same_run.expression, ctx), false);
});

test('generated predicates use all documented stack states, including camelCase delete/update phases', () => {
  const ctx = context();
  for (const phase of PROTOCOL.stackStates.inFlight) {
    ctx.bodies.Read_stack = { properties: { provisioningState: phase } };
    assert.equal(evaluate(actions.Deployment_busy.expression, ctx), true, phase);
  }
  for (const phase of ['deleting', 'deletingResources']) {
    ctx.bodies.Read_stack = { properties: { provisioningState: phase } };
    assert.equal(evaluate(actions.Already_deleting.expression, ctx), true, phase);
    assert.equal(evaluate(actions.Deployment_busy.expression, ctx), false, phase);
  }
});

test('WDL requires actual terminal evidence and normalizes ARM LRO status spelling', () => {
  const ctx = context();
  for (const item of [
    { status: 'pending' },
    { status: 'terminal' },
    { status: 'terminal', result: 'succeeded', completedAt: TEST_NOW.toISOString() },
  ]) assert.equal(evaluate(actions.Cleanup_pending.inputs.where, { ...ctx, item }), true);
  assert.equal(evaluate(actions.Cleanup_pending.inputs.where, {
    ...ctx, item: { status: 'terminal', result: 'succeeded', evidence: { kind: 'lro' }, completedAt: TEST_NOW.toISOString() },
  }), false);
  ctx.outputs = { Read_submission_operation: { statusCode: 200 } };
  for (const status of ['Succeeded', 'Failed', 'Canceled', 'Cancelled']) {
    ctx.bodies.Read_submission_operation = { status };
    assert.equal(evaluate(actions.Operation_terminal.expression, ctx), true);
    assert.ok(['succeeded', 'failed', 'canceled'].includes(evaluate(actions.Lro_evidence.inputs.result, ctx)));
  }
  ctx.outputs.Read_submission_operation.statusCode = 204;
  ctx.bodies.Read_submission_operation = null;
  assert.equal(evaluate(actions.Operation_terminal.expression, ctx), false);
});

test('WDL recognizes only exact failed rejection receipts at reconciliation, cleanup and Idle fences', () => {
  const intent = beginSubmission(state, {}, TEST_NOW);
  const entry = pendingSubmission(intent);
  for (const evidence of [
    responseRejection(rejectedStackResponse(intent.stackId), intent.stackId, entry, TEST_NOW),
    activityRejection(rejectionEvent(intent), intent, entry, EVENT_ID, TEST_NOW),
  ]) {
    const settled = updateSubmission({ ...intent, phase: 'Stopping' }, entry.id, {
      status: 'terminal', result: 'failed', evidence, completedAt: TEST_NOW.toISOString(),
    }, TEST_NOW);
    const item = settled.submissions[0];
    const ctx = { ...context(settled, settled), item };
    ctx.bodies.Read_submission_state = settled;
    ctx.bodies.Read_finish = settled;
    for (const name of ['Find_pending', 'Cleanup_pending', 'Finish_pending']) {
      assert.equal(evaluate(actions[name].inputs.where, ctx), false);
      for (const invalid of [
        { ...item, result: 'succeeded' }, { ...item, status: 'pending' },
        { ...item, evidence: { ...evidence, code: 'DeploymentFailed' } },
        { ...item, evidence: { ...evidence, source: 'local-file' } },
        { ...item, evidence: { ...evidence, stackId: `${intent.stackId}-other` } },
        { ...item, evidence: { ...evidence, clientRequestId: EVENT_ID } },
        { ...item, evidence: { ...evidence, observedAt: null } },
        { ...item, evidence: { ...evidence, eventDataId: null, source: 'activity-log' } },
        { ...item, operationUrl: 'a-conflicting-accepted-LRO' },
      ]) assert.equal(evaluate(actions[name].inputs.where, { ...ctx, item: invalid }), true);
    }
    assert.equal(evaluate(actions.All_submissions_settled.expression, ctx), true);
    assert.equal(evaluate(actions.Same_run.expression, ctx), true);
    ctx.bodies.Read_run_group.location = 'centralus';
    ctx.bodies.Read_remaining = { value: [] };
    ctx.outputs.Read_remaining = { statusCode: 200 };
    ctx.outputs.Read_managed_group = { statusCode: 404 };
    assert.equal(evaluate(actions.Check_empty.expression, ctx), false);
  }
});

test('an unresolved submission blocks both cleanup and the final Idle write even with an empty group', () => {
  const intent = beginSubmission(state, {}, TEST_NOW);
  const entry = pendingSubmission(intent);
  const ctx = context(intent, intent);
  ctx.bodies.Find_pending = [entry];
  ctx.bodies.Read_candidate = null;
  ctx.outputs = { ...ctx.outputs, Read_candidate: { statusCode: 404 }, Read_remaining: { statusCode: 200 }, Read_managed_group: { statusCode: 404 } };
  ctx.bodies.Read_remaining = { value: [] };
  ctx.bodies.Read_finish = { ...intent, phase: 'Stopping' };
  ctx.bodies.Cleanup_pending = [entry];
  ctx.bodies.Finish_pending = [entry];
  assert.equal(evaluate(actions.Candidate_generation.expression, ctx), false);
  assert.equal(evaluate(actions.Submission_evidence_ready.expression, ctx), false);
  assert.equal(evaluate(actions.Check_empty.expression, ctx), true);
  assert.equal(evaluate(actions.All_submissions_settled.expression, ctx), false);
  assert.equal(evaluate(actions.Same_run.expression, ctx), false);
  ctx.bodies.Read_state = { ...intent, phase: 'Idle' };
  assert.equal(evaluate(actions.Idle.expression, ctx), false);
});

test('WDL requires the associated new deployment generation, not new tags and an old terminal state', () => {
  const priorId = `${GROUP_ID}/providers/Microsoft.Resources/deployments/previous`;
  const oldStackCorrelation = '10000000-0000-0000-0000-000000000001';
  const oldDeploymentCorrelation = '20000000-0000-0000-0000-000000000001';
  const intent = beginSubmission(state, {
    stackCorrelationId: oldStackCorrelation, deploymentId: priorId, deploymentCorrelationId: oldDeploymentCorrelation,
  }, TEST_NOW);
  const entry = pendingSubmission(intent);
  const ctx = context(intent, intent);
  ctx.bodies.Find_pending = [entry];
  ctx.bodies.Read_candidate = {
    id: intent.stackId, tags: { application: 'called-it', environment: 'test', runId: RUN_ID, submissionId: entry.id },
    properties: {
      deploymentScope: GROUP_ID, parameters: { submissionId: { value: entry.id } },
      correlationId: oldStackCorrelation, deploymentId: priorId, provisioningState: 'succeeded',
    },
  };
  ctx.outputs = { ...ctx.outputs, Read_candidate: { statusCode: 200 }, Read_submission_deployment: { statusCode: 200 } };
  assert.equal(evaluate(actions.Candidate_generation.expression, ctx), false);
  ctx.bodies.Read_candidate.properties.correlationId = '30000000-0000-0000-0000-000000000001';
  ctx.bodies.Read_submission_deployment = {
    id: priorId, properties: {
      correlationId: oldDeploymentCorrelation, provisioningState: 'Succeeded',
      parameters: { submissionId: { value: entry.id } },
    },
  };
  assert.equal(evaluate(actions.Candidate_generation.expression, ctx), true);
  assert.equal(evaluate(actions.Generation_terminal.expression, ctx), false);
  ctx.bodies.Read_submission_deployment.properties.correlationId = '40000000-0000-0000-0000-000000000001';
  assert.equal(evaluate(actions.Generation_terminal.expression, ctx), true);
  ctx.bodies.Read_submission_deployment.properties.provisioningState = 'Running';
  assert.equal(evaluate(actions.Generation_terminal.expression, ctx), false);
});

test('JS and WDL operation URL guards admit provider LRO paths but never another subscription', () => {
  const intent = beginSubmission(state, {}, TEST_NOW);
  const entry = pendingSubmission(intent);
  const ctx = context(intent, intent);
  ctx.bodies.Find_pending = [entry];
  for (const suffix of [
    `/providers/Microsoft.Resources/locations/eastus2/deploymentStackOperationStatuses/operation-1?api-version=2024-03-01`,
    `/providers/Microsoft.Resources/deploymentStackOperationResults/operation-1?monitor=true&api-version=2024-03-01`,
    `/resourceGroups/${CONFIG.runGroup}/providers/Microsoft.Resources/deployments/generation/operationStatuses/operation-1?api-version=2024-03-01`,
  ]) {
    entry.operationUrl = `https://management.azure.com/subscriptions/${CONFIG.subscriptionId}${suffix}`;
    assert.doesNotThrow(() => operationUrl(entry.operationUrl, 'Microsoft.Resources', state.stackId));
    assert.equal(evaluate(actions.Safe_operation_url.expression, ctx), true);
    entry.operationUrl = entry.operationUrl.replace(CONFIG.subscriptionId, 'another-subscription');
    assert.throws(() => operationUrl(entry.operationUrl, 'Microsoft.Resources', state.stackId));
    assert.equal(evaluate(actions.Safe_operation_url.expression, ctx), false);
  }
  entry.operationUrl = `https://management.azure.com/subscriptions/${CONFIG.subscriptionId}/providers/Microsoft.Resources/locations/centralus/deploymentStackOperationStatuses/operation-1?api-version=2024-03-01`;
  assert.throws(() => operationUrl(entry.operationUrl, 'Microsoft.Resources', state.stackId));
  assert.equal(evaluate(actions.Safe_operation_url.expression, ctx), false);
});

test('regional LRO allowlists distinguish control-plane stacks from workload Jobs', () => {
  const jobId = `${GROUP_ID}/providers/Microsoft.App/jobs/test-migrate`;
  for (const [provider, resource, region] of [
    ['Microsoft.Resources', state.stackId, 'eastus2'],
    ['Microsoft.App', jobId, 'centralus'],
  ]) {
    const url = (location) => `https://management.azure.com/subscriptions/${CONFIG.subscriptionId}/providers/${provider}/locations/${location}/operationResults/result?api-version=2025-01-01`;
    assert.doesNotThrow(() => operationUrl(url(region), provider, resource));
    for (const other of ['westus', region === 'centralus' ? 'eastus2' : 'centralus']) {
      assert.throws(() => operationUrl(url(other), provider, resource), /Refusing/);
    }
    assert.doesNotThrow(() => operationUrl(`${resource}/operationResults/result?api-version=2025-01-01`, provider, resource));
  }
});

test('JS and WDL preserve signed regional stack receipts and reject changed scope or query shape', () => {
  const intent = beginSubmission(state, {}, TEST_NOW);
  const entry = pendingSubmission(intent);
  const ctx = context(intent, intent);
  ctx.bodies.Find_pending = [entry];
  const root = `https://management.azure.com/subscriptions/${CONFIG.subscriptionId}/providers/Microsoft.Resources/locations/eastus2`;
  const query = '?api-version=2024-03-01&t=639269869167784920&c=certificate_fixture&s=signature_fixture&h=hash_fixture';
  for (const kind of PROTOCOL.signedStackOperation.paths) {
    const url = `${root}/${kind}/receipt${query}`;
    entry.operationUrl = url;
    assert.equal(operationUrl(url, 'Microsoft.Resources', state.stackId), url);
    assert.equal(evaluate(actions.Safe_operation_url.expression, ctx), true);
    for (const [index, invalid] of [
      url.replace('management.azure.com', 'example.com'),
      url.replace(CONFIG.subscriptionId, 'another-subscription'),
      url.replace('/eastus2/', '/centralus/'),
      url.replace('/Microsoft.Resources/', '/Microsoft.App/'),
      url.replace(`/${kind}/`, '/operationResults/'),
      url.replace('/receipt?', '/receipt/another?'),
      url.replace('/receipt?', '/?'),
      url.replace('2024-03-01', '2025-01-01'),
      url.replace('t=639269869167784920', 't=not-a-timestamp'),
      url.replace('t=639269869167784920', 't=t=639269869167784920'),
      url.replace('c=certificate_fixture', 'c='),
      url.replace('&s=', '&c='),
      url.replace('&h=', '&unexpected='),
      url.replace('signature_fixture', 'signature%2Ffixture'),
      ...[' ', '\t', '\r', '\n', '\\', '..'].map((value) => url.replace('signature_fixture', `signature${value}fixture`)),
      `${url}&monitor=true`,
      `${url}&api-version=2024-03-01`,
      `${url}#fragment`,
      url.replace('certificate_fixture', 'A'.repeat(PROTOCOL.signedStackOperation.maxUrlLength)),
    ].entries()) {
      entry.operationUrl = invalid;
      assert.throws(() => operationUrl(invalid, 'Microsoft.Resources', state.stackId), /Refusing/);
      assert.equal(evaluate(actions.Safe_operation_url.expression, ctx), false, `${kind} rejection case ${index}`);
    }
  }
});
