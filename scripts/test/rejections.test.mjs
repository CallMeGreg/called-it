import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, GROUP_ID, DATA_GROUP_ID } from './config.mjs';
import { startState, idleState, beginSubmission, pendingSubmission, updateSubmission } from './state.mjs';
import { PROTOCOL } from './operations.mjs';
import { responseRejection, activityRejection, readActivityRejection, validRejectionEvidence } from './rejections.mjs';
import { RUN_ID, TEST_NOW, GUID, EVENT_ID, rejectionEvent, rejectedStackResponse } from './test-fixtures.mjs';

const state = { ...beginSubmission(startState(idleState(TEST_NOW), { now: TEST_NOW, runId: RUN_ID }), {}, TEST_NOW), phase: 'Stopping' };
const submission = pendingSubmission(state);
const observedAt = new Date(TEST_NOW.getTime() + 60_000);
const activityPath = `/subscriptions/${CONFIG.subscriptionId}/providers/Microsoft.Insights/eventtypes/management/values`;

test('response and Activity paths accept the exact short and full native rejection diagnostics', () => {
  const short = `The 'location' property is not allowed for 'called-it-test-${RUN_ID}' at resource group scope.`;
  const full = `${short} Please see https://aka.ms/deploy-to-subscription for usage details.`;
  assert.equal(rejectedStackResponse(state.stackId).body.error.message, full);
  for (const message of [short, full]) {
    const response = rejectedStackResponse(state.stackId);
    response.body.error.message = message;
    assert.equal(responseRejection(response, state.stackId, submission, observedAt).source, 'response');
    const event = rejectionEvent(state);
    event.properties.statusMessage = JSON.stringify(response.body);
    assert.equal(activityRejection(event, state, submission, EVENT_ID, observedAt).source, 'activity-log');
  }
});

test('response and Activity paths reject unknown suffixes on either recognized diagnostic', () => {
  const short = `The 'location' property is not allowed for 'called-it-test-${RUN_ID}' at resource group scope.`;
  const full = `${short} Please see https://aka.ms/deploy-to-subscription for usage details.`;
  for (const prefix of [short, full]) {
    for (const suffix of [' ', '\n', ' Additional diagnostic.', ' Please see https://aka.ms/other-page for usage details.']) {
      const response = rejectedStackResponse(state.stackId);
      response.body.error.message = `${prefix}${suffix}`;
      assert.equal(responseRejection(response, state.stackId, submission, observedAt), null);
      const event = rejectionEvent(state);
      event.properties.statusMessage = JSON.stringify(response.body);
      assert.throws(() => activityRejection(event, state, submission, EVENT_ID, observedAt), /not the allowed/);
    }
  }
});

test('a direct receipt admits only the exact native 400 pre-execution rejection and stores no raw response', () => {
  const response = rejectedStackResponse(state.stackId);
  const evidence = responseRejection(response, state.stackId, submission, observedAt);
  assert.equal(evidence.source, 'response');
  assert.equal(evidence.code, 'InvalidDeployment');
  assert.equal(evidence.clientRequestId, submission.clientRequestId);
  assert.equal(JSON.stringify(evidence).includes(response.body.error.message), false);
  const settled = updateSubmission(state, submission.id, {
    status: 'terminal', result: 'failed', evidence, completedAt: observedAt.toISOString(),
  }, observedAt);
  assert.equal(settled.phase, 'Stopping');
  for (const invalid of [
    { ...response, status: 500 }, { ...response, status: 403 },
    { ...response, body: { error: { ...response.body.error, code: 'DeploymentFailed' } } },
    { ...response, body: { error: { ...response.body.error, message: 'A deployment failed after resources were created.' } } },
    rejectedStackResponse(state.stackId.replace(RUN_ID, 'a'.repeat(32))),
    { ...response, headers: new Headers({ Location: 'https://management.azure.com/some-operation' }) },
    { ...response, headers: new Headers({ 'Azure-AsyncOperation': 'https://management.azure.com/some-operation' }) },
    { ...response, headers: new Headers({ 'x-ms-client-request-id': GUID }) },
  ]) assert.equal(responseRejection(invalid, state.stackId, submission, observedAt), null);
});

test('native-shaped Activity evidence produces a sanitized proof for exactly the named failed PUT', () => {
  const event = rejectionEvent(state);
  const evidence = activityRejection(event, state, submission, EVENT_ID, observedAt);
  assert.equal(evidence.source, 'activity-log');
  assert.equal(evidence.eventDataId, EVENT_ID);
  assert.equal(evidence.correlationId, event.correlationId);
  assert.equal(evidence.eventTimestamp, event.eventTimestamp);
  assert.equal(JSON.stringify(evidence).includes('statusMessage'), false);
  assert.equal(JSON.stringify(evidence).includes('localizedValue'), false);
  event.httpRequest.uri = state.stackId;
  assert.doesNotThrow(() => activityRejection(event, state, submission, EVENT_ID, observedAt));
});

test('foreign, stale, mismatched and nonterminal Activity evidence never settles a submission', () => {
  const faults = [
    (event) => { event.eventDataId = GUID; },
    (event) => { event.correlationId = 'not-an-id'; },
    (event) => { event.subscriptionId = 'another-subscription'; },
    (event) => { event.resourceGroupName = CONFIG.dataGroup; },
    (event) => { event.resourceProviderName.value = 'Microsoft.App'; },
    (event) => { event.resourceId = state.stackId.replace(GROUP_ID, DATA_GROUP_ID); },
    (event) => { event.properties.entity = `${state.stackId}-other`; },
    (event) => { event.eventName.value = 'BeginRequest'; },
    (event) => { event.operationName.value = 'Microsoft.Resources/deploymentStacks/delete'; },
    (event) => { event.httpRequest.method = 'POST'; },
    (event) => { event.httpRequest.clientRequestId = GUID; },
    (event) => { event.httpRequest.uri += '/other'; },
    (event) => { event.httpRequest.uri = event.httpRequest.uri.replace('management.azure.com', 'example.com'); },
    (event) => { event.httpRequest.uri += '&api-version=2024-03-01'; },
    (event) => { event.httpRequest.uri += '#fragment'; },
    (event) => { event.httpRequest.uri = `${state.stackId}/../${state.stackId.split('/').at(-1)}`; },
    (event) => { event.eventTimestamp = new Date(TEST_NOW.getTime() - 1).toISOString(); },
    (event) => { event.eventTimestamp = new Date(observedAt.getTime() + 1).toISOString(); },
    (event) => { event.eventTimestamp = 'not-a-time'; },
    (event) => { event.status.value = 'Started'; },
    (event) => { event.subStatus.value = 'InternalServerError'; },
    (event) => { event.properties.statusCode = 'InternalServerError'; },
    (event) => { event.properties.statusMessage = '{}'; },
    (event) => { event.properties.statusMessage = 'null'; },
    (event) => { event.properties.statusMessage = '{"error":{"code":"InvalidDeployment","message":"Other invalid deployment"}}'; },
    (event) => { event.properties.statusMessage = JSON.stringify(rejectedStackResponse(`${state.stackId}-other`).body); },
    (event) => { delete event.httpRequest; },
  ];
  for (const fault of faults) {
    const event = rejectionEvent(state);
    fault(event);
    assert.throws(() => activityRejection(event, state, submission, EVENT_ID, observedAt));
  }
  const delayed = rejectionEvent(state);
  delayed.eventTimestamp = new Date(TEST_NOW.getTime() + (PROTOCOL.validationRejection.windowSeconds + 1) * 1000).toISOString();
  assert.throws(() => activityRejection(delayed, state, submission, EVENT_ID, new Date(TEST_NOW.getTime() + 3_600_000)), /window/);
  assert.throws(() => activityRejection(rejectionEvent(state), state, { ...submission, operationUrl: 'already-accepted' }, EVENT_ID, observedAt), /accepted LRO/);
});

test('malformed or oversized Activity error details are refused without echoing their content', () => {
  for (const message of ['sensitive-invalid-json', 'sensitive-text'.repeat(2000)]) {
    const event = rejectionEvent(state);
    event.properties.statusMessage = message;
    assert.throws(() => activityRejection(event, state, submission, EVENT_ID, observedAt),
      (error) => !error.message.includes('sensitive'));
  }
});

test('Activity recovery uses the documented bounded resource/time filter and scoped skiptoken continuation', async () => {
  const calls = [];
  const azure = { arm: async (path) => {
    calls.push(path);
    if (calls.length === 1) return { body: { value: [], nextLink: `https://management.azure.com${activityPath}?$skiptoken=opaque%3Dtoken` } };
    return { body: { value: [rejectionEvent(state)] } };
  } };
  const event = await readActivityRejection(azure, state, submission, EVENT_ID, observedAt);
  assert.equal(event.eventDataId, EVENT_ID);
  assert.equal(calls.length, 2);
  const query = new URL(calls[0], 'https://management.azure.com');
  assert.equal(query.pathname, activityPath);
  assert.equal(query.searchParams.get('api-version'), '2015-04-01');
  assert.equal(query.searchParams.get('$filter'),
    `eventTimestamp ge '${submission.submittedAt}' and eventTimestamp le '${observedAt.toISOString()}' and resourceUri eq '${state.stackId}'`);
  assert.equal(query.searchParams.get('$filter').includes('eventDataId'), false);
});

test('foreign, broadened or invalid Activity continuations are rejected before a second request', async () => {
  for (const nextLink of [
    `https://example.com${activityPath}?$skiptoken=a`,
    `https://management.azure.com${activityPath.replace(CONFIG.subscriptionId, 'other')}?$skiptoken=a`,
    `https://management.azure.com${GROUP_ID}/resources?$skiptoken=a`,
    `https://management.azure.com${activityPath}?$filter=broadened&$skiptoken=a`,
    `https://management.azure.com${activityPath}?api-version=2020-01-01&$skiptoken=a`,
    `https://management.azure.com${activityPath}?$skiptoken=a&$skiptoken=b`,
    `https://management.azure.com${activityPath}?$skiptoken=a#fragment`,
    `https://management.azure.com${activityPath}?$skiptoken=a&unknown=true`,
    `https://management.azure.com${activityPath}`,
  ]) {
    let calls = 0;
    await assert.rejects(readActivityRejection({ arm: async () => {
      calls++;
      return { body: { value: [], nextLink } };
    } }, state, submission, EVENT_ID, observedAt), /continuation/);
    assert.equal(calls, 1);
  }
});

test('missing, duplicate or endlessly paginated Activity evidence is never a completion receipt', async () => {
  await assert.rejects(readActivityRejection({ arm: async () => ({ body: { value: [] } }) },
    state, submission, EVENT_ID, observedAt), /not found/);
  await assert.rejects(readActivityRejection({ arm: async () => ({ body: {} }) },
    state, submission, EVENT_ID, observedAt), /event collection/);
  await assert.rejects(readActivityRejection({ arm: async () => ({ body: { value: [rejectionEvent(state), rejectionEvent(state)] } }) },
    state, submission, EVENT_ID, observedAt), /duplicate/);
  let pages = 0;
  await assert.rejects(readActivityRejection({ arm: async () => ({
    body: { value: [], nextLink: `https://management.azure.com${activityPath}?$skiptoken=${++pages}` },
  }) }, state, submission, EVENT_ID, observedAt), /page limit/);
  assert.equal(pages, 10);
});

test('a receipt cannot masquerade as success or lose its exact request and failure associations', () => {
  const evidence = activityRejection(rejectionEvent(state), state, submission, EVENT_ID, observedAt);
  const completed = { ...submission, result: 'failed', completedAt: observedAt.toISOString() };
  assert.equal(validRejectionEvidence(evidence, state.stackId, completed), true);
  for (const patch of [
    { kind: 'unknown' }, { source: 'local-file' }, { code: 'DeploymentFailed' }, { statusCode: 500 },
    { reason: 'unrecognized' }, { stackId: `${state.stackId}-other` }, { clientRequestId: GUID },
    { observedAt: 'invalid' }, { observedAt: new Date(TEST_NOW.getTime() - 1).toISOString() },
    { eventDataId: 'invalid' }, { eventTimestamp: 'invalid' },
  ]) assert.equal(validRejectionEvidence({ ...evidence, ...patch }, state.stackId, completed), false);
  assert.equal(validRejectionEvidence(evidence, state.stackId, { ...completed, result: 'succeeded' }), false);
  assert.equal(validRejectionEvidence(evidence, state.stackId, { ...completed, operationUrl: 'accepted-lro' }), false);
});
