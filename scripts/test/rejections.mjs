import { CONFIG, STACK_API, requireValue } from './config.mjs';
import { PROTOCOL } from './operations.mjs';

const rule = PROTOCOL.validationRejection;
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const activityPath = `/subscriptions/${CONFIG.subscriptionId}/providers/Microsoft.Insights/eventtypes/management/values`;
const activityVersion = '2015-04-01';
const sameId = (left, right) => typeof left === 'string' && left.toLowerCase() === right.toLowerCase();

export function assertRecoveryIds(submissionId, eventDataId) {
  requireValue(guid.test(submissionId ?? '') && guid.test(eventDataId ?? ''),
    'Rejection recovery requires explicit UUID submission and Activity event IDs.');
}

function knownRejection(error, stackId) {
  const message = `The 'location' property is not allowed for '${stackId.split('/').at(-1)}' at resource group scope.`;
  return error?.code === rule.code
    && (error.message === message
      || error.message === `${message} Please see https://aka.ms/deploy-to-subscription for usage details.`);
}

function receipt(stackId, submission, source, now) {
  return {
    kind: 'validation-rejection', source, statusCode: rule.statusCode, code: rule.code,
    reason: rule.reason, stackId, clientRequestId: submission.clientRequestId, observedAt: now.toISOString(),
  };
}

export function responseRejection(response, stackId, submission, now = new Date()) {
  if (response.status !== rule.statusCode || !knownRejection(response.body?.error, stackId)
    || response.headers?.get('azure-asyncoperation') || response.headers?.get('location')) return null;
  const echoed = response.headers?.get('x-ms-client-request-id');
  if (echoed && echoed !== submission.clientRequestId) return null;
  return receipt(stackId, submission, 'response', now);
}

function exactRequestUri(value, stackId) {
  if (typeof value !== 'string') return false;
  let url;
  try { url = new URL(value, 'https://management.azure.com'); } catch { return false; }
  return url.origin === 'https://management.azure.com' && !url.username && !url.password && !url.hash
    && !value.includes('%') && !value.includes('..') && !value.includes('\\')
    && sameId(url.pathname, stackId)
    && (url.search === '' || url.search === `?api-version=${STACK_API}`);
}

export function activityRejection(event, state, submission, eventDataId, now = new Date()) {
  assertRecoveryIds(submission.id, eventDataId);
  requireValue(!submission.operationUrl, 'An accepted LRO cannot be superseded by a validation-rejection receipt.');
  requireValue(event?.eventDataId === eventDataId && guid.test(event.correlationId ?? '')
    && event.subscriptionId === CONFIG.subscriptionId
    && sameId(event.resourceGroupName, CONFIG.runGroup)
    && sameId(event.resourceProviderName?.value, 'Microsoft.Resources')
    && sameId(event.resourceId, state.stackId) && sameId(event.properties?.entity, state.stackId),
  'Activity rejection evidence does not identify the exact subscription, resource and event.');
  requireValue(event.eventName?.value === 'EndRequest'
    && sameId(event.operationName?.value, 'Microsoft.Resources/deploymentStacks/write')
    && event.httpRequest?.method === 'PUT'
    && event.httpRequest.clientRequestId === submission.clientRequestId
    && exactRequestUri(event.httpRequest.uri, state.stackId),
  'Activity rejection evidence does not identify this exact PUT and client request.');
  const eventTime = Date.parse(event.eventTimestamp);
  const submitted = Date.parse(submission.submittedAt);
  requireValue(Number.isFinite(eventTime) && eventTime >= submitted
    && eventTime <= submitted + rule.windowSeconds * 1000 && eventTime <= now.getTime(),
  'Activity rejection evidence is stale, future-dated or outside the immediate validation window.');
  requireValue(event.status?.value === 'Failed' && event.subStatus?.value === 'BadRequest'
    && event.properties.statusCode === 'BadRequest', 'Activity evidence is not a terminal BadRequest rejection.');
  const message = event.properties.statusMessage;
  requireValue(typeof message === 'string' && message.length <= 16_384, 'Missing or oversized Activity validation-rejection detail.');
  let parsed;
  try { parsed = JSON.parse(message); } catch {
    throw new Error('Activity rejection detail is not valid JSON; no response content was logged.');
  }
  requireValue(knownRejection(parsed?.error, state.stackId), 'Activity error is not the allowed pre-execution validation rejection.');
  return {
    ...receipt(state.stackId, submission, 'activity-log', now),
    eventDataId, correlationId: event.correlationId, eventTimestamp: event.eventTimestamp,
  };
}

export function validRejectionEvidence(evidence, stackId, submission) {
  const observed = Date.parse(evidence?.observedAt);
  const submitted = Date.parse(submission.submittedAt);
  const completed = Date.parse(submission.completedAt);
  if (evidence?.kind !== 'validation-rejection' || evidence.statusCode !== rule.statusCode
    || evidence.code !== rule.code || evidence.reason !== rule.reason
    || evidence.stackId !== stackId || evidence.clientRequestId !== submission.clientRequestId
    || !Number.isFinite(observed) || observed < submitted || !Number.isFinite(completed) || completed < observed
    || submission.result !== 'failed' || submission.operationUrl) return false;
  if (evidence.source === 'response') return true;
  const eventTime = Date.parse(evidence.eventTimestamp);
  return evidence.source === 'activity-log' && guid.test(evidence.eventDataId ?? '') && guid.test(evidence.correlationId ?? '')
    && Number.isFinite(eventTime) && eventTime >= submitted && eventTime <= observed
    && eventTime <= submitted + rule.windowSeconds * 1000;
}

export async function readActivityRejection(azure, state, submission, eventDataId, now = new Date()) {
  assertRecoveryIds(submission.id, eventDataId);
  const submitted = Date.parse(submission.submittedAt);
  requireValue(Number.isFinite(submitted) && submitted <= now.getTime(), 'Invalid submission timestamp for Activity recovery.');
  const end = new Date(Math.min(now.getTime(), submitted + rule.windowSeconds * 1000)).toISOString();
  const filter = `eventTimestamp ge '${submission.submittedAt}' and eventTimestamp le '${end}' and resourceUri eq '${state.stackId}'`;
  const select = 'correlationId,eventDataId,eventName,eventTimestamp,httpRequest,operationName,properties,resourceGroupName,resourceProviderName,resourceId,status,subStatus,subscriptionId';
  let path = `${activityPath}?${new URLSearchParams({ 'api-version': activityVersion, '$filter': filter, '$select': select })}`;
  const visited = new Set();
  for (let page = 0; path && page < 10; page++) {
    requireValue(!visited.has(path), 'Activity continuation repeated; refusing unbounded recovery.');
    visited.add(path);
    const response = await azure.arm(path);
    requireValue(Array.isArray(response.body?.value), 'Activity API did not return an event collection.');
    const matches = response.body.value.filter((event) => event.eventDataId === eventDataId);
    requireValue(matches.length <= 1, 'Activity API returned duplicate evidence; refusing reconciliation.');
    if (matches.length === 1) {
      activityRejection(matches[0], state, submission, eventDataId, now);
      return matches[0];
    }
    if (!response.body.nextLink) { path = ''; continue; }
    let next;
    try { next = new URL(response.body.nextLink); } catch {
      throw new Error('Activity continuation is not a valid URL; no response content was logged.');
    }
    requireValue(next.origin === 'https://management.azure.com' && !next.username && !next.password && !next.hash
      && sameId(next.pathname, activityPath)
      && [...next.searchParams.keys()].every((key) => ['api-version', '$filter', '$select', '$skiptoken'].includes(key))
      && ['api-version', '$filter', '$select', '$skiptoken'].every((key) => next.searchParams.getAll(key).length <= 1)
      && (!next.searchParams.has('api-version') || next.searchParams.get('api-version') === activityVersion)
      && (!next.searchParams.has('$filter') || next.searchParams.get('$filter') === filter)
      && (!next.searchParams.has('$select') || next.searchParams.get('$select') === select)
      && next.searchParams.has('$skiptoken'),
    'Activity continuation escaped the approved evidence query.');
    path = `${next.pathname}${next.search}`;
  }
  requireValue(!path, 'Activity evidence exceeded the bounded page limit; submission remains unresolved.');
  throw new Error('The exact Activity event was not found in the validation window. Allow for log ingestion or investigate; state remains Stopping.');
}
