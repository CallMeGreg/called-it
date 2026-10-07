import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Azure, sleep } from './azure.mjs';
import { CONFIG, GROUP_ID, DATA_GROUP_ID, MANAGED_GROUP_ID, STACK_API, assertDigest, requireValue, stackId } from './config.mjs';
import { StateStore, idleState, startState, extendState, stopState, validateState } from './state.mjs';
import { hashes, readBundle, parseBundle, writePrivate, assertBundleUpdate } from './invites.mjs';

const TERMINAL_FAILURE = ['Failed', 'Canceled', 'Cancelled', 'DeploymentFailed', 'DeleteFailed'];
const BUSY = ['Creating', 'Updating', 'Validating', 'Deploying', 'Canceling'];
const SECRET_NAMES = { signingKey: 'auth-signing-key', contactsPepper: 'contacts-pepper', invitesJson: 'test-invites' };
const printable = (state) => ({
  phase: state.phase, runId: state.runId, expiresAt: state.expiresAt, url: state.url,
  lastError: state.lastError ?? null,
  retained: ['SQL accounts/results', 'Key Vault keys/invites', 'lifecycle controller'],
});

export function assertOwnedStack(stack, state) {
  validateState(state);
  requireValue(stack?.id?.toLowerCase() === state.stackId.toLowerCase(), 'Unexpected deployment stack ID.');
  requireValue(stack.tags?.runId === state.runId && stack.tags?.application === 'called-it'
    && stack.tags?.environment === 'test', 'Stack ownership tags do not match this TEST run.');
  requireValue(stack.properties?.deploymentScope?.toLowerCase() === GROUP_ID.toLowerCase()
    && stack.properties.denySettings?.mode === 'none', 'Refusing a stack with unexpected deployment scope or deny settings.');
  requireValue(Array.isArray(stack.properties.resources), 'Stack resource inventory is unavailable.');
  for (const resource of stack.properties.resources) {
    requireValue(typeof resource.id === 'string'
      && resource.id.toLowerCase().startsWith(`${GROUP_ID.toLowerCase()}/providers/`),
    'Refusing teardown: the stack owns a resource outside the disposable TEST group.');
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

  async verifyOff() {
    const remaining = await this.resources();
    requireValue(remaining.length === 0, 'Paid or unknown resources remain in the disposable group. Refusing to mark Off or start a new run.');
    const managed = await this.azure.arm(`${MANAGED_GROUP_ID}?api-version=2024-03-01`, { allowed: [200, 404] });
    requireValue(managed.status === 404, 'The ACA service-managed group still exists. Wait for provider cleanup; never delete it directly.');
  }

  async watcherReady() {
    const workflow = (await this.azure.arm(`${this.foundation.watchdogId}?api-version=2019-05-01`)).body;
    requireValue(workflow?.properties?.state === 'Enabled', 'The independent expiry watchdog is not enabled. Refusing Start/Extend.');
    requireValue(workflow.properties.definition?.triggers?.Check_expiry?.recurrence?.interval === 5
      && workflow.properties.definition.triggers.Check_expiry.recurrence.frequency === 'Minute'
      && workflow.properties.definition.triggers.Check_expiry.runtimeConfiguration?.concurrency?.runs === 1,
      'The expiry watchdog schedule differs from the reviewed five-minute guard.');
    for (const [key, expected] of Object.entries({
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
    await this.store.locked(async (current, _write, signal) => {
      requireValue(current.runId === runId && current.phase === 'Starting'
        && Date.parse(current.expiresAt) > this.now().getTime(), 'Start lost its lifecycle claim.');
      await this.azure.arm(`${current.stackId}?api-version=${STACK_API}`, {
        method: 'PUT', allowed: [200, 201], signal,
        body: {
          location: CONFIG.location,
          tags: { application: 'called-it', environment: 'test', runId },
          properties: {
            actionOnUnmanage: { resources: 'delete', resourceGroups: 'detach', managementGroups: 'detach' },
            denySettings: { mode: 'none' },
            deploymentScope: GROUP_ID,
            template,
            parameters: Object.fromEntries(Object.entries({
              runId, foundation: this.foundation, migrationImage, apiImage, secretUris,
            }).map(([name, value]) => [name, { value }])),
          },
        },
      });
    });
    for (let attempt = 0; attempt < 360; attempt++) {
      const current = await this.active(runId);
      const stack = (await this.azure.arm(`${current.stackId}?api-version=${STACK_API}`)).body;
      const phase = stack.properties?.provisioningState;
      if (phase === 'Succeeded') {
        assertOwnedStack(stack, current);
        return Object.fromEntries(Object.entries(stack.properties.outputs ?? {}).map(([name, output]) => [name, output.value]));
      }
      requireValue(!TERMINAL_FAILURE.includes(phase), `Run stack deployment ${phase}. See Azure deployment operations; private SQL was not opened.`);
      await this.pause(10_000);
    }
    throw new Error('Run stack deployment timed out. Guarded cleanup is required.');
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
    await this.azure.token('https://management.azure.com/');
    await this.store.locked(async (current, _write, signal) => {
      requireValue(current.runId === runId && current.phase === 'Starting'
        && Date.parse(current.expiresAt) > this.now().getTime(), 'Start lost ownership before migration.');
      const result = await this.azure.arm(`${jobId}/start?api-version=2025-01-01`, { method: 'POST', allowed: [200, 202], signal });
      executionName = result.body?.name;
      requireValue(typeof executionName === 'string' && /^[a-z0-9-]+$/.test(executionName), 'Azure did not identify the migration execution.');
    });
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
      requireValue(/^https:\/\/[a-z0-9.-]+\.azurecontainerapps\.io$/.test(app.appUrl), 'Azure returned an unexpected phone URL.');
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
        const current = await this.store.read();
        if (current.phase === 'Idle' && current.lastRunId === runId) {
          await this.verifyOff();
          return;
        }
        requireValue(current.runId === runId && current.phase === 'Stopping', 'Cleanup lost ownership; refusing any more mutations.');
        const result = await this.azure.arm(`${current.stackId}?api-version=${STACK_API}`, { allowed: [200, 404] });
        if (result.status === 404) {
          const remaining = await this.resources();
          const managed = await this.azure.arm(`${MANAGED_GROUP_ID}?api-version=2024-03-01`, { allowed: [200, 404] });
          if (remaining.length === 0 && managed.status === 404) {
            await this.store.locked(async (latest, write) => {
              requireValue(latest.runId === runId && latest.phase === 'Stopping', 'Cleanup cannot clear a different run.');
              await write({ ...idleState(this.now()), lastRunId: runId });
            });
            console.log('TEST runtime is off. Accounts, results, keys, and the independent expiry controller are retained.');
            return;
          }
        } else {
          assertOwnedStack(result.body, current);
          const phase = result.body.properties.provisioningState;
          if (BUSY.includes(phase)) {
            const deploymentId = result.body.properties.deploymentId;
            requireValue(typeof deploymentId === 'string'
              && deploymentId.toLowerCase().startsWith(`${GROUP_ID.toLowerCase()}/providers/microsoft.resources/deployments/`),
            'Cannot safely cancel the in-flight stack deployment; wait for it to settle.');
            await this.azure.arm(`${deploymentId}/cancel?api-version=2022-09-01`, { method: 'POST', allowed: [200, 202, 204, 409] });
          } else if (phase !== 'Deleting') {
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
          await write({ ...current, lastError: 'Runtime cleanup failed or timed out. Inspect stack operations and the expiry workflow; paid resources may remain.', updatedAt: this.now().toISOString() });
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

async function bootstrap(azure, register) {
  const account = await azure.guard();
  requireValue(account.user?.type === 'user', 'Foundation bootstrap requires the authorized human operator, not the workflow UAMI.');
  for (const [name, lifecycle] of [[CONFIG.dataGroup, 'persistent'], [CONFIG.runGroup, 'disposable']]) {
    const existing = await azure.arm(`/subscriptions/${CONFIG.subscriptionId}/resourceGroups/${name}?api-version=2024-03-01`, { allowed: [200, 404] });
    requireValue(existing.status === 404 || (existing.body.tags?.application === 'called-it'
      && existing.body.tags?.environment === 'test' && existing.body.tags?.lifecycle === lifecycle),
    'Refusing to adopt a preexisting resource group without matching TEST ownership tags.');
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
    `budgetStartDate=${budgetStart}`,
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
      confirm: { type: 'string' }, file: { type: 'string' }, output: { type: 'string' },
    },
  });
  const [action] = positionals;
  requireValue(positionals.length === 1, 'Specify exactly one TEST lifecycle action.');
  requireValue(['preflight', 'bootstrap', 'publish-secrets', 'recover-secrets', 'start', 'status', 'extend', 'stop', 'expire'].includes(action),
    'Use preflight, bootstrap, publish-secrets, recover-secrets, start, status, extend, stop, or expire.');
  const allowedOptions = {
    preflight: [], bootstrap: ['register-providers'], 'publish-secrets': ['file'],
    'recover-secrets': ['output'], start: [], status: [], extend: ['run-id'],
    stop: ['run-id', 'confirm'], expire: ['run-id', 'confirm'],
  }[action];
  requireValue(Object.keys(values).every((key) => allowedOptions.includes(key)), 'Unexpected options for this TEST lifecycle action.');
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
  return lifecycle.stop(values['run-id'], { confirm: values.confirm });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    if (error instanceof AggregateError) for (const cause of error.errors) console.error(cause.message);
    process.exitCode = 1;
  });
}
