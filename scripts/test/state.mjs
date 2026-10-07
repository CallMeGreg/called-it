import { randomBytes, randomUUID } from 'node:crypto';
import { CONFIG, stackId, requireValue } from './config.mjs';
import { AzureError } from './azure.mjs';
import { PROTOCOL, operationUrl } from './operations.mjs';
import { validRejectionEvidence } from './rejections.mjs';

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const terminalResults = ['succeeded', 'failed', 'canceled'];

export function pendingSubmission(state) {
  return state.submissions.find((submission) => submission.status === 'pending') ?? null;
}

export function idleState(now = new Date()) {
  return {
    schemaVersion: PROTOCOL.stateVersion,
    subscriptionId: CONFIG.subscriptionId,
    tenantId: CONFIG.tenantId,
    phase: 'Idle',
    runId: null,
    stackId: null,
    expiresAt: null,
    updatedAt: now.toISOString(),
    url: null,
    lastError: null,
    submissions: [],
  };
}

export function validateState(value) {
  requireValue(value?.schemaVersion === PROTOCOL.stateVersion && value.subscriptionId === CONFIG.subscriptionId
    && value.tenantId === CONFIG.tenantId, 'Invalid TEST lifecycle scope/schema; refusing mutation.');
  requireValue(['Idle', 'Starting', 'Running', 'Stopping'].includes(value.phase), 'Invalid lifecycle phase.');
  requireValue(Array.isArray(value.submissions) && value.submissions.length <= 3, 'Missing or invalid durable submission ledger.');
  const ids = new Set();
  for (const submission of value.submissions) {
    requireValue(submission && guid.test(submission.id) && guid.test(submission.clientRequestId)
      && !ids.has(submission.id) && Number.isFinite(Date.parse(submission.submittedAt)), 'Invalid submission identity/timestamp.');
    ids.add(submission.id);
    requireValue(['pending', 'terminal'].includes(submission.status), 'Invalid submission status.');
    requireValue(submission.operationUrl === null || typeof submission.operationUrl === 'string', 'Invalid submission operation URL.');
    if (submission.operationUrl) operationUrl(submission.operationUrl, 'Microsoft.Resources', value.stackId);
    for (const key of ['previousStackCorrelationId', 'previousDeploymentCorrelationId']) {
      requireValue(submission[key] === null || guid.test(submission[key]), 'Invalid prior submission correlation ID.');
    }
    requireValue(submission.previousDeploymentId === null || validDeploymentId(submission.previousDeploymentId), 'Invalid prior deployment scope.');
    requireValue(submission.status === 'pending' ? submission.result === null : terminalResults.includes(submission.result),
      'Submission terminal evidence is incomplete.');
    if (submission.status === 'terminal') {
      requireValue(Number.isFinite(Date.parse(submission.completedAt))
        && (['lro', 'deployment-generation'].includes(submission.evidence?.kind)
          || validRejectionEvidence(submission.evidence, value.stackId, submission)),
      'Submission completion requires durable terminal evidence.');
    }
  }
  requireValue(value.submissions.filter((submission) => submission.status === 'pending').length <= 1
    && (!pendingSubmission(value) || value.submissions.at(-1).status === 'pending'), 'Only the latest submission may be unresolved.');
  if (value.phase === 'Idle') {
    requireValue(value.runId === null && value.stackId === null && value.expiresAt === null && value.url === null,
      'Idle state has an unexpected active run.');
    requireValue(value.submissions.length === 0, 'Idle cannot conceal unresolved or uncleared submissions.');
  } else {
    requireValue(value.stackId === stackId(value.runId), 'Lifecycle stack ID does not match its run.');
    requireValue(typeof value.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt)),
      'Invalid run expiry timestamp.');
  }
  return value;
}

export function validDeploymentId(id) {
  const prefix = `/subscriptions/${CONFIG.subscriptionId}/resourceGroups/${CONFIG.runGroup}/providers/Microsoft.Resources/deployments/`;
  return typeof id === 'string' && id.toLowerCase().startsWith(prefix.toLowerCase())
    && /^[a-z0-9_.()-]+$/i.test(id.slice(prefix.length));
}

export function beginSubmission(current, baseline, now = new Date()) {
  validateState(current);
  requireValue(current.phase === 'Starting' && !pendingSubmission(current) && current.submissions.length < 3,
    'A new stack PUT cannot supersede unresolved submission intent.');
  const submission = {
    id: randomUUID(), clientRequestId: randomUUID(), submittedAt: now.toISOString(),
    previousStackCorrelationId: baseline.stackCorrelationId ?? null,
    previousDeploymentId: baseline.deploymentId ?? null,
    previousDeploymentCorrelationId: baseline.deploymentCorrelationId ?? null,
    status: 'pending', operationUrl: null, result: null, evidence: null, completedAt: null,
  };
  return validateState({ ...current, submissions: [...current.submissions, submission], updatedAt: now.toISOString() });
}

export function updateSubmission(current, id, patch, now = new Date()) {
  validateState(current);
  requireValue(['Starting', 'Stopping'].includes(current.phase)
    && pendingSubmission(current)?.id === id, 'Submission reconciliation lost the active run/generation.');
  return validateState({
    ...current,
    submissions: current.submissions.map((submission) => submission.id === id ? { ...submission, ...patch } : submission),
    updatedAt: now.toISOString(),
  });
}

export function startState(current, { now = new Date(), hours = CONFIG.defaultHours, runId = randomBytes(16).toString('hex') } = {}) {
  validateState(current);
  requireValue(current.phase === 'Idle', `Cannot Start while phase is ${current.phase}; use Status/Stop instead.`);
  requireValue(hours === CONFIG.defaultHours, 'Normal Start always uses the approved four-hour default.');
  return {
    ...idleState(now), phase: 'Starting', runId, stackId: stackId(runId),
    expiresAt: new Date(now.getTime() + hours * 3_600_000).toISOString(),
    startedAt: now.toISOString(),
  };
}

export function extendState(current, runId, now = new Date()) {
  validateState(current);
  requireValue(current.runId === runId && ['Starting', 'Running'].includes(current.phase),
    'Extend requires the current active run; it cannot reverse a claimed Stop.');
  requireValue(Date.parse(current.expiresAt) > now.getTime(), 'The run has already expired. Wait for Stop to finish, then Start again.');
  return {
    ...current,
    expiresAt: new Date(Date.parse(current.expiresAt) + CONFIG.defaultHours * 3_600_000).toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function stopState(current, runId, { now = new Date(), expiredOnly = false } = {}) {
  validateState(current);
  requireValue(current.runId === runId && current.phase !== 'Idle', 'Stop requires the exact current run ID.');
  if (expiredOnly && current.phase !== 'Stopping' && Date.parse(current.expiresAt) > now.getTime()) return null;
  return { ...current, phase: 'Stopping', stopRequestedAt: current.stopRequestedAt ?? now.toISOString(), updatedAt: now.toISOString() };
}

export class StateStore {
  constructor(azure, stateUrl, { renewEvery = 15_000 } = {}) {
    this.azure = azure;
    this.stateUrl = stateUrl;
    this.renewEvery = renewEvery;
  }

  request(method, { suffix = '', headers = {}, body, allowed = [200], signal } = {}) {
    return this.azure.request(`${this.stateUrl}${suffix}`, {
      method, body, allowed, signal, timeout: 10_000, audience: 'https://storage.azure.com/',
      headers: { 'x-ms-version': '2023-11-03', 'x-ms-date': new Date().toUTCString(), ...headers },
    });
  }

  async read(signal) {
    return validateState((await this.request('GET', { signal })).body);
  }

  async initialize() {
    try {
      const result = await this.request('PUT', {
        headers: { 'If-None-Match': '*', 'x-ms-blob-type': 'BlockBlob' },
        body: idleState(), allowed: [201, 412],
      });
      if (result.status === 201) return;
    } catch (error) {
      if (!(error instanceof AzureError && error.status === 409 && error.code === 'BlobAlreadyExists')) throw error;
    }
    await this.read();
  }

  async locked(operation) {
    await this.azure.token('https://storage.azure.com/');
    const leaseId = randomUUID();
    await this.request('PUT', {
      suffix: '?comp=lease',
      headers: { 'x-ms-lease-action': 'acquire', 'x-ms-lease-duration': '60', 'x-ms-proposed-lease-id': leaseId },
      allowed: [201],
    });
    let operationError;
    let leaseError;
    let renewal;
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (renewal || controller.signal.aborted) return;
      renewal = this.request('PUT', {
        suffix: '?comp=lease',
        headers: { 'x-ms-lease-action': 'renew', 'x-ms-lease-id': leaseId },
        allowed: [200],
      }).catch((error) => {
        leaseError = error;
        controller.abort(error);
      }).finally(() => { renewal = undefined; });
    }, this.renewEvery);
    timer.unref();
    try {
      const current = await this.read(controller.signal);
      const write = async (next) => {
        if (leaseError) throw leaseError;
        validateState(next);
        await this.request('PUT', {
          headers: { 'x-ms-lease-id': leaseId, 'x-ms-blob-type': 'BlockBlob' },
          body: next, allowed: [201], signal: controller.signal,
        });
      };
      const result = await operation(current, write, controller.signal);
      if (leaseError) throw leaseError;
      return result;
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      clearInterval(timer);
      if (renewal) await renewal;
      try {
        await this.request('PUT', {
          suffix: '?comp=lease',
          headers: { 'x-ms-lease-action': 'release', 'x-ms-lease-id': leaseId },
          allowed: [200],
        });
      } catch (releaseError) {
        if (operationError) throw new AggregateError([operationError, releaseError], 'Lifecycle operation and lease release failed. The finite lease expires after 60 seconds.');
        throw new AzureError('Lifecycle lease release', releaseError.status ?? 'error');
      }
      if (leaseError && !operationError) throw leaseError;
    }
  }
}
