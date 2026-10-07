import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Azure, AzureError, sleep } from './azure.mjs';
import { CONFIG, GROUP_ID, DATA_GROUP_ID, MANAGED_GROUP_ID, STACK_API, assertAppUrl, assertDigest, requireValue, stackId } from './config.mjs';
import { StateStore, idleState, startState, extendState, stopState, validateState, pendingSubmission, beginSubmission, updateSubmission, validDeploymentId } from './state.mjs';
import { hashes, readBundle, parseBundle, writePrivate, assertBundleUpdate } from './invites.mjs';
import { PROTOCOL, STACK_STATES, stackPhase, responseOperationUrl, responseOperationUrls, operationUrl, operationPhase, armPath } from './operations.mjs';
import { generationCandidate, generationEvidence } from './submissions.mjs';
import { assertRecoveryIds, responseRejection, readActivityRejection, activityRejection } from './rejections.mjs';

const SECRET_NAMES = { signingKey: 'auth-signing-key', contactsPepper: 'contacts-pepper', invitesJson: 'test-invites' };
const printable = (state) => ({
  phase: state.phase, runId: state.runId, expiresAt: state.expiresAt, url: state.url,
  lastError: state.lastError ?? null,
  pendingSubmission: pendingSubmission(state),
  retained: ['SQL accounts/results', 'Key Vault keys/invites', 'lifecycle controller'],
});

export function assertOwnedStack(stack, state) {
  validateState(state);
  requireValue(stack?.id?.toLowerCase() === state.stackId.toLowerCase(), 'Unexpected deployment stack ID.');
  requireValue(stack.tags?.runId === state.runId && stack.tags?.application === 'called-it'
    && stack.tags?.environment === 'test', 'Stack ownership tags do not match this TEST run.');
  const scope = stack.properties?.deploymentScope;
  requireValue((scope == null || (typeof scope === 'string' && scope.toLowerCase() === GROUP_ID.toLowerCase()))
    && stack.properties?.denySettings?.mode === 'none', 'Refusing a stack with unexpected deployment scope or deny settings.');
  requireValue(Array.isArray(stack.properties.resources), 'Stack resource inventory is unavailable.');
  for (const resource of stack.properties.resources) {
    requireValue(typeof resource.id === 'string'
      && resource.id.toLowerCase().startsWith(`${GROUP_ID.toLowerCase()}/providers/`),
    'Refusing teardown: the stack owns a resource outside the disposable TEST group.');
  }
}

export function assertOwnedRunGroup(group) {
  requireValue(group?.id?.toLowerCase() === GROUP_ID.toLowerCase() && group.location === CONFIG.location
    && group.tags?.application === 'called-it' && group.tags?.environment === 'test'
    && group.tags?.lifecycle === 'disposable', 'Disposable TEST resource-group ownership or metadata region is unexpected.');
}

export class UnresolvedSubmissionError extends Error {
  constructor(submission) {
    super(`Stack submission ${submission.id} (client request ${submission.clientRequestId}) is unresolved. `
      + `Inspect its ${submission.operationUrl ? `ARM operation ${submission.operationUrl}` : 'Azure deployment/activity history and generation marker'}. `
      + 'Ownership remains Stopping; a 404 or empty inventory is not completion evidence. Do not clear the ledger or start another run.');
  }
}

export class Lifecycle {
  constructor(azure, foundation, { pause = sleep, now = () => new Date() } = {}) {
    this.azure = azure;
    this.foundation = foundation;
    this.store = new StateStore(azure, foundation.stateUrl);
    this.pause = pause;
    this.now = now;
  }

  async resources() {
    const resources = [];
    let path = `${GROUP_ID}/resources?api-version=2021-04-01`;
    for (let page = 0; path && page < 100; page++) {
      const result = (await this.azure.arm(path)).body;
      requireValue(Array.isArray(result?.value), 'Cannot inspect the disposable resource inventory.');
      resources.push(...result.value);
      if (result.nextLink) {
        const next = new URL(result.nextLink);
        requireValue(next.origin === 'https://management.azure.com'
          && next.pathname.toLowerCase().startsWith(`${GROUP_ID.toLowerCase()}/`), 'Unexpected inventory continuation scope.');
        path = `${next.pathname}${next.search}`;
      } else path = '';
    }
    requireValue(!path, 'Inventory exceeded the safety pagination limit.');
    return resources;
  }

  async runGroup(signal) {
    const group = (await this.azure.arm(`${GROUP_ID}?api-version=2024-03-01`, { signal })).body;
    assertOwnedRunGroup(group);
  }

  async verifyOff() {
    await this.runGroup();
    const remaining = await this.resources();
    requireValue(remaining.length === 0, 'Paid or unknown resources remain in the disposable group. Refusing to mark Off or start a new run.');
    const managed = await this.azure.arm(`${MANAGED_GROUP_ID}?api-version=2024-03-01`, { allowed: [200, 404] });
    requireValue(managed.status === 404, 'The ACA service-managed group still exists. Wait for provider cleanup; never delete it directly.');
  }

  async watcherReady() {
    const workflow = (await this.azure.arm(`${this.foundation.watchdogId}?api-version=2019-05-01`)).body;
    requireValue(workflow?.properties?.state === 'Enabled', 'The independent expiry watchdog is not enabled. Refusing Start/Extend.');
    requireValue(workflow.location === CONFIG.location, 'The expiry watchdog is outside the retained control region.');
    requireValue(workflow.properties.definition?.contentVersion === PROTOCOL.controllerVersion,
      'The expiry watchdog does not support this controller protocol. Deploy the matching foundation before Start/Extend.');
    requireValue(workflow.properties.definition?.triggers?.Check_expiry?.recurrence?.interval === 5
      && workflow.properties.definition.triggers.Check_expiry.recurrence.frequency === 'Minute'
      && workflow.properties.definition.triggers.Check_expiry.runtimeConfiguration?.concurrency?.runs === 1,
      'The expiry watchdog schedule differs from the reviewed five-minute guard.');
    for (const [key, expected] of Object.entries({
      controlLocation: CONFIG.location, workloadLocation: CONFIG.workloadLocation,
      stateUrl: this.foundation.stateUrl, runGroupId: GROUP_ID, managedGroupId: MANAGED_GROUP_ID,
      subscriptionId: CONFIG.subscriptionId, tenantId: CONFIG.tenantId,
    })) {
      requireValue(workflow.properties.parameters?.[key]?.value === expected, 'The expiry watchdog parameters do not match the approved run scope.');
    }
    const recent = (await this.azure.arm(`${this.foundation.watchdogId}/runs?api-version=2019-05-01&$top=1`)).body?.value?.[0];
    requireValue(recent?.properties?.status === 'Succeeded'
      && Date.parse(recent.properties.endTime) > this.now().getTime() - 15 * 60_000,
    'The expiry watchdog has no recent successful heartbeat. Wait for its first five-minute check, or repair its Owner alert before Start/Extend.');
    for (const name of ['called-it-test-expiry-failure', 'called-it-test-expiry-missing-heartbeat']) {
      const alert = (await this.azure.arm(`${DATA_GROUP_ID}/providers/Microsoft.Insights/metricAlerts/${name}?api-version=2018-03-01`)).body;
      requireValue(alert?.properties?.enabled === true && alert.properties.scopes?.includes(this.foundation.watchdogId),
        'TEST expiry failure/heartbeat alerts are disabled or incorrectly scoped. Repair the retained foundation first.');
    }
  }

  async active(runId) {
    const current = await this.store.read();
    requireValue(current.runId === runId && current.phase === 'Starting'
      && Date.parse(current.expiresAt) > this.now().getTime(), 'This Start no longer owns an unexpired active run. No further provisioning is allowed.');
    return current;
  }

  async validateRun(current, body, signal) {
    const deadline = Math.min(this.now().getTime() + 5 * 60_000, Date.parse(current.expiresAt));
    let response = await this.azure.arm(`${current.stackId}/validate?api-version=${STACK_API}`, {
      method: 'POST', body, allowed: [200, 202, 400], signal,
    });
    let url;
    let asynchronous;
    let location;
    for (let attempt = 0; attempt < 60 && this.now().getTime() < deadline; attempt++) {
      signal.throwIfAborted();
      const phase = operationPhase(response);
      requireValue(response.status !== 400 && !response.body?.error && !['failed', 'canceled'].includes(phase),
        'Stack preflight validation failed; no PUT intent or request was submitted for this stage. Inspect Azure validation diagnostics.');
      const properties = response.body?.properties;
      if (response.status === 200 && Array.isArray(properties?.validatedResources)) return;
      const links = responseOperationUrls(response, 'Microsoft.Resources', current.stackId);
      asynchronous = links.asynchronous ?? asynchronous;
      location = links.location ?? location;
      if (phase === 'succeeded') {
        requireValue(location && location !== url, 'Stack validation completed without its final validation result; no PUT was submitted.');
        asynchronous = null;
        url = location;
      } else url = asynchronous ?? location ?? url;
      requireValue(url, 'Stack validation is incomplete without a scoped polling URL; no PUT was submitted.');
      const retry = response.headers?.get('retry-after');
      await this.pause(/^\d{1,3}$/.test(retry ?? '') ? Math.max(1, Math.min(10, Number(retry))) * 1000 : 5_000);
      signal.throwIfAborted();
      requireValue(this.now().getTime() < deadline, 'Stack validation timed out or the run expired; no PUT was submitted.');
      response = await this.azure.arm(armPath(url), { allowed: [200, 202, 400], signal });
    }
    throw new Error('Stack preflight validation timed out; no PUT intent or request was submitted for this stage.');
  }

  async applyRun(runId, { migrationImage = '', apiImage = '', secretUris = {} } = {}) {
    const template = await this.azure.compile('infra/test/run.bicep');
    await this.azure.guard();
    await this.azure.token('https://management.azure.com/');
    const registryServer = `cittest${runId.slice(0, 20)}.azurecr.io`;
    if (migrationImage) assertDigest(migrationImage, registryServer, 'called-it-migrate');
    if (apiImage) {
      assertDigest(apiImage, registryServer, 'called-it-api');
      requireValue(migrationImage, 'The application cannot be deployed before its migration image.');
    }
    let submission;
    await this.store.locked(async (current, write, signal) => {
      requireValue(current.runId === runId && current.phase === 'Starting'
        && Date.parse(current.expiresAt) > this.now().getTime(), 'Start lost its lifecycle claim.');
      requireValue(!pendingSubmission(current), 'An unresolved PUT must be reconciled before another submission.');
      await this.runGroup(signal);
      const previous = await this.azure.arm(`${current.stackId}?api-version=${STACK_API}`, { allowed: [200, 404], signal });
      let baseline = {};
      if (previous.status === 200) {
        assertOwnedStack(previous.body, current);
        requireValue(stackPhase(previous.body.properties.provisioningState) === 'succeeded', 'The prior stack generation is not successful.');
        const preceding = current.submissions.at(-1);
        requireValue(preceding?.status === 'terminal' && preceding.result === 'succeeded',
          'An existing stack must be associated with the preceding successful submission.');
        const deploymentId = previous.body.properties.deploymentId;
        requireValue(validDeploymentId(deploymentId), 'The prior stack deployment generation is unavailable.');
        const deployment = (await this.azure.arm(`${deploymentId}?api-version=2022-09-01`, { signal })).body;
        requireValue(generationEvidence(preceding, previous.body, deployment)?.result === 'succeeded',
          'The prior stack/deployment snapshot is stale or not associated with the preceding submission.');
        baseline = {
          stackCorrelationId: previous.body.properties.correlationId,
          deploymentId,
          deploymentCorrelationId: deployment.properties?.correlationId,
        };
        requireValue(baseline.stackCorrelationId && baseline.deploymentCorrelationId, 'Missing prior generation correlation IDs.');
      } else requireValue(current.submissions.length === 0, 'The preceding stack generation disappeared; refusing an untracked replacement PUT.');
      let intent = beginSubmission(current, baseline, this.now());
      submission = pendingSubmission(intent);
      const body = {
        tags: { application: 'called-it', environment: 'test', runId, submissionId: submission.id },
        properties: {
          actionOnUnmanage: { resources: 'delete', resourceGroups: 'detach', managementGroups: 'detach' },
          denySettings: { mode: 'none' },
          deploymentScope: GROUP_ID,
          template,
          parameters: Object.fromEntries(Object.entries({
            location: CONFIG.workloadLocation, runId, submissionId: submission.id,
            foundation: this.foundation, migrationImage, apiImage, secretUris,
          }).map(([name, value]) => [name, { value }])),
        },
      };
      await this.validateRun(current, body, signal);
      requireValue(Date.parse(current.expiresAt) > this.now().getTime(), 'Run expired during stack validation; no PUT is allowed.');
      const submittedAt = this.now().toISOString();
      submission = { ...submission, submittedAt };
      intent = { ...intent, submissions: [...current.submissions, submission], updatedAt: submittedAt };
      // This write must succeed before sending any bytes of a potentially ambiguous ARM PUT.
      await write(intent);
      const response = await this.azure.arm(`${current.stackId}?api-version=${STACK_API}`, {
        method: 'PUT', allowed: [200, 201, 202, 400], signal,
        headers: { 'x-ms-client-request-id': submission.clientRequestId },
        body,
      });
      if (response.status === 400) {
        const evidence = responseRejection(response, current.stackId, submission, this.now());
        if (evidence) await write(updateSubmission(intent, submission.id, {
          status: 'terminal', result: 'failed', evidence, completedAt: this.now().toISOString(),
        }, this.now()));
        throw new AzureError(evidence ? 'Stack PUT (definitive rejection recorded; guarded Stop required)'
          : 'Stack PUT (unrecognized rejection; submission remains unresolved)', response.status);
      }
      const url = responseOperationUrl(response, 'Microsoft.Resources', current.stackId);
      if (url) await write(updateSubmission(intent, submission.id, { operationUrl: url }, this.now()));
    });
    for (let attempt = 0; attempt < 360; attempt++) {
      let current = await this.active(runId);
      if (pendingSubmission(current)) {
        const outcome = await this.reconcileSubmission(current);
        if (!outcome.resolved) { await this.pause(10_000); continue; }
        requireValue(outcome.result === 'succeeded', `Run stack deployment ${outcome.result}. See Azure deployment operations; private SQL was not opened.`);
        current = await this.active(runId);
      }
      const stack = (await this.azure.arm(`${current.stackId}?api-version=${STACK_API}`)).body;
      const phase = stackPhase(stack.properties?.provisioningState);
      if (phase === 'succeeded' && stack.tags?.submissionId === submission.id
        && stack.properties.parameters?.submissionId?.value === submission.id) {
        assertOwnedStack(stack, current);
        return Object.fromEntries(Object.entries(stack.properties.outputs ?? {}).map(([name, output]) => [name, output.value]));
      }
      requireValue(!['failed', 'canceled'].includes(phase), `Run stack deployment ${phase}. See Azure deployment operations; private SQL was not opened.`);
      await this.pause(10_000);
    }
    throw new Error('Run stack deployment timed out. Guarded cleanup is required.');
  }

  async reconcileSubmission(current) {
    const submission = pendingSubmission(current);
    if (!submission) return { resolved: true };
    let proof;
    if (submission.operationUrl) {
      const url = operationUrl(submission.operationUrl, 'Microsoft.Resources', current.stackId);
      const operation = await this.azure.arm(armPath(url), { allowed: [200, 202, 204, 404, 410] });
      if (operation.status === 200) {
        const result = operationPhase(operation);
        if (STACK_STATES.terminal.includes(result)) proof = { result, evidence: { kind: 'lro', operationUrl: url } };
      }
    }
    const response = await this.azure.arm(`${current.stackId}?api-version=${STACK_API}`, { allowed: [200, 404] });
    if (!proof && response.status === 200 && generationCandidate(submission, response.body)) {
      assertOwnedStack(response.body, current);
      const deployment = await this.azure.arm(`${response.body.properties.deploymentId}?api-version=2022-09-01`, { allowed: [200, 404] });
      if (deployment.status === 200) proof = generationEvidence(submission, response.body, deployment.body);
    }
    if (!proof) return { resolved: false, stack: response, submission };
    await this.store.locked(async (latest, write) => {
      requireValue(latest.runId === current.runId, 'A submission result cannot settle another run.');
      if (latest.submissions.find((entry) => entry.id === submission.id)?.status === 'terminal') return;
      await write(updateSubmission(latest, submission.id, {
        status: 'terminal', result: proof.result, evidence: proof.evidence, completedAt: this.now().toISOString(),
      }, this.now()));
    });
    return { resolved: true, ...proof };
  }

  async reconcileRejection(runId, submissionId, eventDataId) {
    stackId(runId);
    assertRecoveryIds(submissionId, eventDataId);
    const account = await this.azure.guard();
    requireValue(account.user?.type === 'user', 'Activity rejection recovery requires the authorized human operator, not a workflow identity.');
    await this.runGroup();
    const current = await this.store.read();
    const submission = pendingSubmission(current);
    requireValue(current.phase === 'Stopping' && current.runId === runId && submission?.id === submissionId,
      'Rejection recovery requires the exact Stopping run and its pending submission.');
    requireValue(!submission.operationUrl, 'An accepted LRO cannot be superseded by a validation-rejection receipt.');
    const event = await readActivityRejection(this.azure, current, submission, eventDataId, this.now());
    await this.store.locked(async (latest, write) => {
      const pending = pendingSubmission(latest);
      requireValue(latest.phase === 'Stopping' && latest.runId === runId && pending?.id === submissionId
        && pending.clientRequestId === submission.clientRequestId && pending.submittedAt === submission.submittedAt,
      'Rejection recovery lost the exact pending run/submission; no evidence was applied.');
      const evidence = activityRejection(event, latest, pending, eventDataId, this.now());
      await write({
        ...updateSubmission(latest, submissionId, {
          status: 'terminal', result: 'failed', evidence, completedAt: this.now().toISOString(),
        }, this.now()),
        lastError: 'The rejected PUT is reconciled with Azure Activity evidence. Confirmed Stop must still verify complete teardown.',
      });
    });
    console.log(JSON.stringify({ runId, submissionId, eventDataId, result: 'failed', phase: 'Stopping',
      next: 'Run confirmed Stop; this command neither deletes resources nor marks Off.' }, null, 2));
  }

  async secretUris() {
    const result = {};
    for (const [key, name] of Object.entries(SECRET_NAMES)) {
      const metadata = (await this.azure.arm(`${DATA_GROUP_ID}/providers/Microsoft.KeyVault/vaults/${this.foundation.vaultName}/secrets/${name}?api-version=2023-07-01`)).body;
      const uri = metadata?.properties?.secretUriWithVersion;
      requireValue(typeof uri === 'string' && uri.startsWith(`${this.foundation.vaultUri}secrets/${name}/`)
        && /^[a-f0-9]{32}$/.test(uri.split('/').at(-1)), 'Publish stable TEST secrets before starting; version metadata is missing.');
      result[key] = uri;
    }
    return result;
  }

  async image(registry, repository, target, runId) {
    await this.active(runId);
    const tag = `${registry}/${repository}:${runId}`;
    await this.azure.command('docker', ['build', '--platform', 'linux/amd64', '--file', 'Dockerfile', '--target', target, '--tag', tag, '.'], { live: true });
    await this.active(runId);
    await this.azure.command('docker', ['push', tag], { live: true });
    const digest = await this.azure.az([
      'acr', 'repository', 'show', '--name', registry.split('.')[0],
      '--image', `${repository}:${runId}`, '--query', 'digest',
    ], { raw: true });
    const image = `${registry}/${repository}@${digest}`;
    assertDigest(image, registry, repository);
    return image;
  }

  async migrate(jobId, runId) {
    requireValue(jobId.startsWith(`${GROUP_ID}/providers/Microsoft.App/jobs/`), 'Migration Job must belong to the disposable TEST group.');
    let executionName;
    let result;
    await this.azure.token('https://management.azure.com/');
    await this.store.locked(async (current, _write, signal) => {
      requireValue(current.runId === runId && current.phase === 'Starting'
        && !pendingSubmission(current) && Date.parse(current.expiresAt) > this.now().getTime(),
      'Start lost ownership or has an unresolved stack submission before migration.');
      result = await this.azure.arm(`${jobId}/start?api-version=2025-01-01`, { method: 'POST', allowed: [200, 202], signal });
    });
    let url;
    let resultUrl;
    let asynchronous = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      await this.active(runId);
      const next = responseOperationUrls(result, 'Microsoft.App', jobId);
      if (next.location) resultUrl = next.location;
      const phase = operationPhase(result);
      requireValue(!['failed', 'canceled'].includes(phase), `Migration Job start operation ${phase}.`);
      const executionId = typeof result.body?.id === 'string' && typeof result.body?.name === 'string'
        && result.body.id.toLowerCase() === `${jobId}/executions/${result.body.name}`.toLowerCase();
      if (result.status === 200 && typeof result.body?.name === 'string' && (!phase || (phase === 'succeeded' && executionId))) {
        executionName = result.body.name;
        requireValue(/^[a-z0-9-]+$/.test(executionName)
          && (!result.body.id || executionId),
        'Azure returned an execution outside the expected migration Job.');
        break;
      }
      if (phase === 'succeeded') {
        requireValue(resultUrl && resultUrl !== url, 'Job start completed without an execution result or a distinct final result URL.');
        url = resultUrl;
        resultUrl = null;
        asynchronous = false;
      } else if (next.asynchronous) {
        url = next.asynchronous;
        asynchronous = true;
      } else if (!asynchronous && next.location) url = next.location;
      requireValue(url, 'Azure accepted Job start without a validated operation/result URL.');
      await this.pause(10_000);
      await this.active(runId);
      result = await this.azure.arm(armPath(url), { allowed: [200, 202] });
    }
    requireValue(executionName, 'Migration Job start operation timed out before returning an execution.');
    for (let attempt = 0; attempt < 120; attempt++) {
      await this.active(runId);
      const execution = (await this.azure.arm(`${jobId}/executions/${executionName}?api-version=2025-01-01`)).body;
      const status = execution?.properties?.status;
      if (status === 'Succeeded') return;
      requireValue(!['Failed', 'Stopped', 'Degraded'].includes(status), `Private migration ${status}. Application deployment was not attempted.`);
      await this.pause(10_000);
    }
    throw new Error('Private migration did not succeed within its bounded execution window.');
  }

  async start() {
    await this.watcherReady();
    const sql = (await this.azure.arm(`${this.foundation.sqlServerId}?api-version=2023-08-01`)).body;
    requireValue(sql?.location === CONFIG.workloadLocation,
      'SQL is outside the approved TEST workload region. Repair the retained foundation through Bicep before Start.');
    requireValue(sql?.properties?.publicNetworkAccess === 'Disabled',
      'SQL public network access is not Disabled. Repair the retained foundation through Bicep before Start.');
    await this.verifyOff();
    const secrets = await this.secretUris();
    // Fail before allocating paid resources if the local/runner image builder is unavailable.
    await this.azure.command('docker', ['info', '--format', '{{.ServerVersion}}']);
    let run;
    await this.store.locked(async (current, write) => {
      run = startState(current, { now: this.now() });
      await write(run);
    });
    console.log(`Starting TEST run ${run.runId}; automatic teardown deadline ${run.expiresAt}.`);
    try {
      const network = await this.applyRun(run.runId);
      await this.active(run.runId);
      await this.azure.az(['acr', 'login', '--name', network.registryName], { mutate: true, raw: true });
      const migrationImage = await this.image(network.registryServer, 'called-it-migrate', 'migration', run.runId);
      const apiImage = await this.image(network.registryServer, 'called-it-api', 'api', run.runId);
      const migration = await this.applyRun(run.runId, { migrationImage });
      await this.migrate(migration.migrationJobId, run.runId);
      const app = await this.applyRun(run.runId, { migrationImage, apiImage, secretUris: secrets });
      assertAppUrl(app.appUrl);
      await this.checkWeb(app.appUrl, run.runId);
      await this.store.locked(async (current, write) => {
        requireValue(current.runId === run.runId && current.phase === 'Starting'
          && Date.parse(current.expiresAt) > this.now().getTime(), 'Run expired before readiness completed.');
        run = { ...current, phase: 'Running', url: app.appUrl, migrationImage, apiImage, updatedAt: this.now().toISOString() };
        await write(run);
      });
      console.log(JSON.stringify(printable(run), null, 2));
      return run;
    } catch (error) {
      console.error('Start failed. Attempting guarded runtime teardown; SQL and keys are retained.');
      try { await this.stop(run.runId, { confirm: run.runId }); } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Start and cleanup failed. The persistent expiry watchdog will retry; inspect Status and the Owner alert.');
      }
      throw error;
    }
  }

  async checkWeb(url, runId) {
    for (let attempt = 0; attempt < 40; attempt++) {
      await this.active(runId);
      try {
        const ready = await this.azure.fetcher(`${url}/health/ready`, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
        const page = await this.azure.fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
        if (ready.ok && ready.headers.get('content-type')?.includes('application/json')
          && page.ok && page.headers.get('content-type')?.includes('text/html')) {
          const healthy = await ready.json();
          const html = await page.text();
          if (healthy.status === 'ok' && html.includes('<html')) {
            const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((match) => new URL(match[1], url));
            requireValue(scripts.length > 0 && scripts.every((script) => script.origin === new URL(url).origin),
              'The Expo export must contain same-origin JavaScript assets.');
            for (const script of scripts) {
              const asset = await this.azure.fetcher(script, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(15_000) });
              requireValue(asset.ok && asset.headers.get('content-type')?.includes('javascript'),
                'An Expo JavaScript asset is missing or was rewritten to HTML.');
            }
            return;
          }
        }
      } catch (error) {
        if (error.name === 'SyntaxError') throw new Error('The readiness route returned invalid JSON; no response body was logged.');
        if (!['TimeoutError', 'AbortError', 'TypeError'].includes(error.name)) throw error;
      }
      await this.pause(10_000);
    }
    throw new Error('The private-DB readiness route and phone web page did not become healthy. Runtime will be removed.');
  }

  async extend(runId) {
    stackId(runId);
    await this.watcherReady();
    return this.store.locked(async (current, write) => {
      const extended = extendState(current, runId, this.now());
      await write(extended);
      console.log(JSON.stringify(printable(extended), null, 2));
      return extended;
    });
  }

  async expire(runId, confirm) {
    stackId(runId);
    requireValue(confirm === runId, 'Expiry verification requires --confirm equal to the current run ID.');
    await this.watcherReady();
    await this.store.locked(async (current, write) => {
      requireValue(current.runId === runId && ['Starting', 'Running'].includes(current.phase),
        'Expiry verification requires the exact active run.');
      await write({ ...current, expiresAt: this.now().toISOString(), updatedAt: this.now().toISOString() });
    });
    console.log('Deadline shortened for watchdog verification. This did not delete resources; monitor Status until the independent watchdog completes Stop.');
  }

  async status() {
    const state = await this.store.read();
    const inventory = (await this.resources()).map(({ id, type }) => ({ id, type }));
    console.log(JSON.stringify({ ...printable(state), disposableResources: inventory }, null, 2));
    if (state.phase === 'Idle') await this.verifyOff();
    else await this.watcherReady();
    return state;
  }

  async stop(runId, { confirm } = {}) {
    stackId(runId);
    const initial = await this.store.read();
    if (initial.phase === 'Idle') {
      requireValue(initial.lastRunId === runId, 'There is no matching completed run to Stop.');
      await this.verifyOff();
      console.log('TEST is already off; retained SQL and keys are unchanged.');
      return;
    }
    requireValue(initial.runId === runId, 'Refusing to Stop a different or newer run.');
    console.log(JSON.stringify({ stopping: runId, resources: (await this.resources()).map(({ id }) => id) }, null, 2));
    requireValue(confirm === runId, 'Stop requires --confirm equal to the current run ID after reviewing the inventory.');
    await this.store.locked(async (current, write) => { await write(stopState(current, runId, { now: this.now() })); });
    try {
      for (let attempt = 0; attempt < 240; attempt++) {
        let current = await this.store.read();
        if (current.phase === 'Idle' && current.lastRunId === runId) {
          await this.verifyOff();
          return;
        }
        requireValue(current.runId === runId && current.phase === 'Stopping', 'Cleanup lost ownership; refusing any more mutations.');
        await this.runGroup();
        if (pendingSubmission(current)) {
          const outcome = await this.reconcileSubmission(current);
          if (!outcome.resolved) throw new UnresolvedSubmissionError(outcome.submission);
          current = await this.store.read();
          requireValue(current.runId === runId && current.phase === 'Stopping' && !pendingSubmission(current),
            'Cleanup must retain ownership until every stack submission is terminal.');
        }
        const result = await this.azure.arm(`${current.stackId}?api-version=${STACK_API}`, { allowed: [200, 404] });
        if (result.status === 404) {
          const remaining = await this.resources();
          const managed = await this.azure.arm(`${MANAGED_GROUP_ID}?api-version=2024-03-01`, { allowed: [200, 404] });
          if (remaining.length === 0 && managed.status === 404) {
            await this.store.locked(async (latest, write) => {
              requireValue(latest.runId === runId && latest.phase === 'Stopping' && !pendingSubmission(latest),
                'Cleanup cannot clear a different run or an unresolved submission.');
              await write({ ...idleState(this.now()), lastRunId: runId, lastSubmissions: latest.submissions });
            });
            console.log('TEST runtime is off. Accounts, results, keys, and the independent expiry controller are retained.');
            return;
          }
        } else {
          assertOwnedStack(result.body, current);
          const phase = stackPhase(result.body.properties.provisioningState);
          if (STACK_STATES.inFlight.includes(phase)) {
            const deploymentId = result.body.properties.deploymentId;
            requireValue(typeof deploymentId === 'string'
              && deploymentId.toLowerCase().startsWith(`${GROUP_ID.toLowerCase()}/providers/microsoft.resources/deployments/`),
            'Cannot safely cancel the in-flight stack deployment; wait for it to settle.');
            await this.azure.arm(`${deploymentId}/cancel?api-version=2022-09-01`, { method: 'POST', allowed: [200, 202, 204, 409] });
          } else if (STACK_STATES.terminal.includes(phase)) {
            await this.azure.arm(`${current.stackId}?api-version=${STACK_API}&unmanageAction.Resources=delete&unmanageAction.ResourceGroups=detach&unmanageAction.ManagementGroups=detach`,
              { method: 'DELETE', allowed: [200, 202, 204] });
          }
        }
        await this.pause(15_000);
      }
      throw new Error('Cleanup has not completed. Do not assume billing stopped; inspect the disposable stack and ACA-managed group.');
    } catch (error) {
      await this.store.locked(async (current, write) => {
        if (current.runId === runId && current.phase === 'Stopping') {
          await write({ ...current, lastError: error instanceof UnresolvedSubmissionError ? error.message
            : 'Runtime cleanup failed or timed out. Inspect stack operations and the expiry workflow; paid resources may remain.', updatedAt: this.now().toISOString() });
        }
      });
      throw error;
    }
  }
}

async function providers(azure, register) {
  const missing = [];
  for (const namespace of CONFIG.providers) {
    const status = await azure.az(['provider', 'show', '--namespace', namespace, '--query', 'registrationState'], { raw: true });
    if (status !== 'Registered') missing.push(namespace);
  }
  if (missing.length && !register) throw new Error(`Explicit provider registration is required: ${missing.join(', ')}. Operator bootstrap --register-providers is the only opt-in path.`);
  for (const namespace of missing) {
    console.log(`Registering nonbillable prerequisite ${namespace} in the approved TEST subscription.`);
    await azure.az(['provider', 'register', '--namespace', namespace, '--wait'], { mutate: true });
  }
}

export async function bootstrap(azure, register) {
  const account = await azure.guard();
  requireValue(account.user?.type === 'user', 'Foundation bootstrap requires the authorized human operator, not the workflow UAMI.');
  for (const [name, lifecycle] of [[CONFIG.dataGroup, 'persistent'], [CONFIG.runGroup, 'disposable']]) {
    const existing = await azure.arm(`/subscriptions/${CONFIG.subscriptionId}/resourceGroups/${name}?api-version=2024-03-01`, { allowed: [200, 404] });
    requireValue(existing.status === 404 || (existing.body.tags?.application === 'called-it'
      && existing.body.tags?.environment === 'test' && existing.body.tags?.lifecycle === lifecycle
      && existing.body.location === CONFIG.location),
    'Refusing to adopt a preexisting resource group without matching TEST ownership tags and retained metadata region.');
  }
  await providers(azure, register);
  const token = await azure.token('https://management.azure.com/');
  const operatorId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).oid;
  requireValue(/^[a-f0-9-]{36}$/i.test(operatorId ?? ''), 'The operator token did not contain an object ID.');
  const budget = await azure.arm(`/subscriptions/${CONFIG.subscriptionId}/providers/Microsoft.Consumption/budgets/called-it-test-monthly?api-version=2024-08-01`, { allowed: [200, 404] });
  const budgetStart = budget.status === 200 ? budget.body.properties.timePeriod.startDate
    : `${new Date().toISOString().slice(0, 7)}-01T00:00:00Z`;
  await azure.az([
    'deployment', 'sub', 'create', '--name', CONFIG.foundationDeployment, '--location', CONFIG.location,
    '--template-file', 'infra/main.test.bicep', '--parameters', `operatorObjectId=${operatorId}`,
    `budgetStartDate=${budgetStart}`, `location=${CONFIG.location}`, `workloadLocation=${CONFIG.workloadLocation}`,
  ], { mutate: true });
  const foundation = await azure.foundation();
  const store = new StateStore(azure, foundation.stateUrl);
  for (let attempt = 0; ; attempt++) {
    try { await store.initialize(); break; } catch (error) {
      if (error.status !== 403 || attempt >= 24) throw error;
      if (attempt === 0) console.log('Waiting for the newly assigned lifecycle data role to propagate.');
      await sleep(5_000);
    }
  }
  console.log(JSON.stringify({ deployerClientId: foundation.deployerClientId, tenantId: CONFIG.tenantId, subscriptionId: CONFIG.subscriptionId }, null, 2));
}

export async function publishSecrets(azure, lifecycle, file) {
  const bundle = await readBundle(file);
  await azure.token('https://vault.azure.net');
  await lifecycle.store.locked(async (current, _write, signal) => {
    requireValue(current.phase === 'Idle', 'Publish invites/keys only while TEST is off; Stop first so old revisions cannot retain revoked sessions.');
    const existing = await azure.request(`${lifecycle.foundation.vaultUri}secrets/owner-recovery?api-version=7.4`, {
      audience: 'https://vault.azure.net', allowed: [200, 404], signal,
    });
    const secretValues = { signingKey: bundle.signingKey, contactsPepper: bundle.contactsPepper, invitesJson: JSON.stringify(hashes(bundle)) };
    if (existing.status === 200) {
      const previous = parseBundle(existing.body.value);
      assertBundleUpdate(previous, bundle);
      if (JSON.stringify(previous) === JSON.stringify(bundle)) {
        let reconciled = true;
        for (const [key, name] of Object.entries(SECRET_NAMES)) {
          const secret = await azure.request(`${lifecycle.foundation.vaultUri}secrets/${name}?api-version=7.4`, {
            audience: 'https://vault.azure.net', allowed: [200, 404], signal,
          });
          if (secret.status !== 200 || secret.body.value !== secretValues[key]) reconciled = false;
        }
        const deployment = await azure.arm(`${DATA_GROUP_ID}/providers/Microsoft.Resources/deployments/called-it-test-secrets?api-version=2022-09-01`, { allowed: [200, 404], signal });
        if (reconciled && deployment.status === 200 && deployment.body?.properties?.provisioningState === 'Succeeded') {
          console.log('Existing TEST keys and invites already match; no new versions were created.');
          return;
        }
      }
    }
    const directory = await mkdtemp(join(tmpdir(), 'called-it-test-secrets-'));
    const parameters = join(directory, 'parameters.json');
    try {
      await writeFile(parameters, JSON.stringify({
        $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#',
        contentVersion: '1.0.0.0',
        parameters: Object.fromEntries(Object.entries({
          vaultName: lifecycle.foundation.vaultName,
          runtimePrincipalId: lifecycle.foundation.runtimePrincipalId,
          deployerPrincipalId: lifecycle.foundation.deployerPrincipalId,
          ...secretValues, ownerRecoveryJson: JSON.stringify(bundle),
        }).map(([name, value]) => [name, { value }])),
      }), { mode: 0o600 });
      await azure.az([
        'deployment', 'group', 'create', '--resource-group', CONFIG.dataGroup,
        '--name', 'called-it-test-secrets', '--template-file', 'infra/test/secrets.bicep', '--parameters', `@${parameters}`,
      ], { mutate: true, sensitive: true, signal });
    } finally {
      await rm(parameters, { force: true });
      await rmdir(directory);
    }
    console.log('Stable TEST secrets reconciled. No secret values were emitted.');
  });
}

export async function main(args = process.argv.slice(2)) {
  const { positionals, values } = parseArgs({
    args, allowPositionals: true,
    options: {
      'register-providers': { type: 'boolean' }, 'run-id': { type: 'string' },
      'submission-id': { type: 'string' }, 'event-id': { type: 'string' },
      confirm: { type: 'string' }, file: { type: 'string' }, output: { type: 'string' },
    },
  });
  const [action] = positionals;
  requireValue(positionals.length === 1, 'Specify exactly one TEST lifecycle action.');
  requireValue(['preflight', 'bootstrap', 'publish-secrets', 'recover-secrets', 'start', 'status', 'extend', 'stop', 'expire', 'reconcile-rejection'].includes(action),
    'Use preflight, bootstrap, publish-secrets, recover-secrets, start, status, extend, stop, expire, or reconcile-rejection.');
  const allowedOptions = {
    preflight: [], bootstrap: ['register-providers'], 'publish-secrets': ['file'],
    'recover-secrets': ['output'], start: [], status: [], extend: ['run-id'],
    stop: ['run-id', 'confirm'], expire: ['run-id', 'confirm'],
    'reconcile-rejection': ['run-id', 'submission-id', 'event-id'],
  }[action];
  requireValue(Object.keys(values).every((key) => allowedOptions.includes(key)), 'Unexpected options for this TEST lifecycle action.');
  if (action === 'reconcile-rejection') {
    stackId(values['run-id']);
    assertRecoveryIds(values['submission-id'], values['event-id']);
  }
  const azure = new Azure();
  await azure.guard();
  if (action === 'bootstrap') return bootstrap(azure, values['register-providers'] === true);
  if (action === 'preflight') {
    await providers(azure, false);
    console.log('Approved TEST subscription/tenant and provider registrations verified. No resources were changed.');
    return;
  }
  const foundation = await azure.foundation();
  const lifecycle = new Lifecycle(azure, foundation);
  if (action === 'publish-secrets') return publishSecrets(azure, lifecycle, values.file);
  if (action === 'recover-secrets') {
    const secret = (await azure.request(`${foundation.vaultUri}secrets/owner-recovery?api-version=7.4`, { audience: 'https://vault.azure.net' })).body;
    const bundle = parseBundle(secret.value);
    await writePrivate(values.output, `${JSON.stringify(bundle, null, 2)}\n`);
    console.log('Recovered the owner bundle to an owner-only local file; no credentials were printed.');
    return;
  }
  if (action === 'start') {
    await providers(azure, false);
    return lifecycle.start();
  }
  if (action === 'status') return lifecycle.status();
  if (action === 'extend') return lifecycle.extend(values['run-id']);
  if (action === 'expire') return lifecycle.expire(values['run-id'], values.confirm);
  if (action === 'reconcile-rejection') return lifecycle.reconcileRejection(values['run-id'], values['submission-id'], values['event-id']);
  return lifecycle.stop(values['run-id'], { confirm: values.confirm });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    if (error instanceof AggregateError) for (const cause of error.errors) console.error(cause.message);
    process.exitCode = 1;
  });
}
