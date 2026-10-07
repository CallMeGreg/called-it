import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { watchdogDefinition } from '../../infra/test/watchdog-definition.mjs';
import { CONFIG, GROUP_ID, MANAGED_GROUP_ID } from './config.mjs';
import { idleState, startState, extendState, beginSubmission, pendingSubmission } from './state.mjs';
import { FOUNDATION, RUN_ID, TEST_NOW } from './test-fixtures.mjs';
import { evaluate, actionMap } from './wdl-test-evaluator.mjs';
import { PROTOCOL, operationUrl } from './operations.mjs';

const definition = watchdogDefinition();
const actions = actionMap(definition);
const state = startState(idleState(TEST_NOW), { now: TEST_NOW, runId: RUN_ID });
const context = (observed = state, current = state) => ({
  parameters: {
    stateUrl: FOUNDATION.stateUrl, runGroupId: GROUP_ID, managedGroupId: MANAGED_GROUP_ID,
    subscriptionId: CONFIG.subscriptionId, tenantId: CONFIG.tenantId,
    identityId: 'non-secret-test-identity',
  },
  variables: { leaseId: 'test-lease' },
  bodies: {
    Read_state: observed, Read_current: current,
    Read_cleanup_state: { ...current, phase: 'Stopping' }, Cleanup_pending: [],
    Finish_pending: [],
  },
  now: '2026-01-01T16:01:00.000Z',
});

test('checked-in watchdog JSON exactly matches its source and uses a five-minute single-run recurrence', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('../../infra/test/watchdog.json', import.meta.url))), definition);
  assert.equal(definition.contentVersion, `${PROTOCOL.stateVersion}.0.0.0`);
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

test('generated teardown rejects foreign resources and requires actual inventory and stack ownership', () => {
  const ctx = context();
  ctx.bodies.Read_stack = {
    id: state.stackId, tags: { runId: RUN_ID, application: 'called-it', environment: 'test' },
    properties: { resources: [], deploymentScope: GROUP_ID, denySettings: { mode: 'none' }, provisioningState: 'succeeded' },
  };
  ctx.bodies.Foreign_resources = [];
  assert.equal(evaluate(actions.Owned_stack.expression, ctx), true);
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
  ctx.outputs = { Read_remaining: { statusCode: 200 }, Read_managed_group: { statusCode: 200 } };
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

test('an unresolved submission blocks both cleanup and the final Idle write even with an empty group', () => {
  const intent = beginSubmission(state, {}, TEST_NOW);
  const entry = pendingSubmission(intent);
  const ctx = context(intent, intent);
  ctx.bodies.Find_pending = [entry];
  ctx.bodies.Read_candidate = null;
  ctx.outputs = { Read_candidate: { statusCode: 404 }, Read_remaining: { statusCode: 200 }, Read_managed_group: { statusCode: 404 } };
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
  ctx.outputs = { Read_candidate: { statusCode: 200 }, Read_submission_deployment: { statusCode: 200 } };
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
});
