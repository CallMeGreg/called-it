import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Generate WDL rather than duplicating the authentication and failure-handling shapes.
const after = (name, statuses = ['Succeeded']) => ({ [name]: statuses });
const all = ['Succeeded', 'Failed', 'Skipped', 'TimedOut'];
const param = (name) => `parameters('${name}')`;
const body = (name) => `body('${name}')`;
const expr = (value) => `@${value}`;
const terminate = (code, message) => ({
  type: 'Terminate',
  inputs: { runStatus: 'Failed', runError: { code, message } },
  runAfter: {},
});
const http = (method, uri, audience, extra = {}, runAfter = {}) => ({
  type: 'Http',
  inputs: {
    method, uri,
    authentication: {
      type: 'ManagedServiceIdentity',
      identity: expr(param('identityId')),
      audience,
    },
    retryPolicy: { type: 'none' },
    ...extra,
  },
  operationOptions: 'DisableAsyncPattern',
  limit: { timeout: 'PT20S' },
  runAfter,
});
const arm = (method, uri, runAfter = {}) =>
  http(method, expr(`concat('https://management.azure.com',${uri})`), 'https://management.azure.com/', {}, runAfter);
const storage = (method, suffix = '', headers = {}, extra = {}, runAfter = {}) =>
  http(method, expr(`concat(${param('stateUrl')},'${suffix}')`), 'https://storage.azure.com/', {
    headers: { 'x-ms-version': '2023-11-03', 'x-ms-date': "@formatDateTime(utcNow(),'r')", ...headers },
    ...extra,
  }, runAfter);
const lease = (action, runAfter = {}) => storage('PUT', '?comp=lease', {
  'x-ms-lease-action': action,
  ...(action === 'acquire'
    ? { 'x-ms-lease-duration': '60', 'x-ms-proposed-lease-id': "@outputs('Lease_id')" }
    : { 'x-ms-lease-id': "@outputs('Lease_id')" }),
}, {}, runAfter);
const write = (value, runAfter = {}) => storage('PUT', '', {
  'x-ms-blob-type': 'BlockBlob',
  'x-ms-lease-id': "@outputs('Lease_id')",
  'Content-Type': 'application/json',
}, { body: expr(value) }, runAfter);
const condition = (expression, actions, otherwise = {}, runAfter = {}) => ({
  type: 'If', expression: expr(expression), actions, else: { actions: otherwise }, runAfter,
});
const runPrefix = `${param('runGroupId')},'/providers/Microsoft.Resources/deploymentStacks/called-it-test-'`;
const stackPath = `concat(${body('Read_current')}?['stackId'],'?api-version=2024-03-01')`;
const status = (action) => `outputs('${action}')?['statusCode']`;
const succeeded = (action) => `equals(actions('${action}')?['status'],'Succeeded')`;
const due = (name) => `or(equals(${body(name)}?['phase'],'Stopping'),lessOrEquals(ticks(coalesce(${body(name)}?['expiresAt'],'9999-12-31T23:59:59Z')),ticks(utcNow())))`;
const runId = (name) => `${body(name)}?['runId']`;
const removeHex = (value) => [...'0123456789abcdef'].reduce((v, c) => `replace(${v},'${c}','')`, value);
const validActive = (name) => `and(
  equals(${body(name)}?['schemaVersion'],1),
  equals(${body(name)}?['subscriptionId'],${param('subscriptionId')}),
  equals(${body(name)}?['tenantId'],${param('tenantId')}),
  contains(createArray('Starting','Running','Stopping'),${body(name)}?['phase']),
  equals(length(coalesce(${runId(name)},'')),32),
  not(equals(${runId(name)},'00000000000000000000000000000000')),
  empty(${removeHex(`coalesce(${runId(name)},'')`)}),
  equals(${body(name)}?['stackId'],concat(${runPrefix},${runId(name)}))
)`.replace(/\s+/g, ' ');

function verifiedIdle() {
  return {
    Read_remaining: arm('GET', `concat(${param('runGroupId')},'/resources?api-version=2021-04-01')`),
    Read_managed_group: arm('GET', `concat(${param('managedGroupId')},'?api-version=2024-03-01')`, after('Read_remaining')),
    Check_empty: condition(
      `and(equals(${status('Read_remaining')},200),not(equals(${body('Read_remaining')}?['value'],null)),empty(${body('Read_remaining')}?['value']),empty(${body('Read_remaining')}?['nextLink']),equals(${status('Read_managed_group')},404))`,
      {
        Acquire_finish: lease('acquire'),
        Finish_locked: {
          type: 'Scope',
          actions: {
            Read_finish: storage('GET'),
            Same_run: condition(
              `and(equals(${runId('Read_finish')},${runId('Read_current')}),equals(${body('Read_finish')}?['phase'],'Stopping'))`,
              {
                Write_idle: write(`setProperty(setProperty(setProperty(setProperty(setProperty(setProperty(setProperty(setProperty(${body('Read_finish')},'phase','Idle'),'lastRunId',${runId('Read_current')}),'runId',null),'stackId',null),'expiresAt',null),'url',null),'lastError',null),'updatedAt',utcNow())`),
              },
              { Invalid_finish: terminate('StateChanged', 'Cleanup cannot clear another run. Inspect TEST lifecycle state.') },
              after('Read_finish'),
            ),
          },
          runAfter: after('Acquire_finish'),
        },
        Release_finish: lease('release', after('Finish_locked', all)),
      },
      { Leftovers: terminate('CleanupIncomplete', 'Disposable resources or the ACA-managed group remain. State stays Stopping; cleanup will retry. Data and keys were not targeted.') },
      after('Read_managed_group', ['Succeeded', 'Failed', 'TimedOut']),
    ),
  };
}

function cleanup() {
  return {
    Read_stack: arm('GET', stackPath),
    Stack_result: condition(
      `equals(${status('Read_stack')},404)`,
      verifiedIdle(),
      {
        Stack_exists: condition(
          `equals(${status('Read_stack')},200)`,
          {
            Foreign_resources: {
              type: 'Query',
              inputs: {
                from: expr(`coalesce(${body('Read_stack')}?['properties']?['resources'],json('[]'))`),
                where: expr(`not(startsWith(toLower(item()?['id']),concat(toLower(${param('runGroupId')}),'/providers/')))`) },
              runAfter: {},
            },
            Owned_stack: condition(
              `and(empty(body('Foreign_resources')),not(equals(${body('Read_stack')}?['properties']?['resources'],null)),equals(toLower(${body('Read_stack')}?['id']),toLower(${body('Read_current')}?['stackId'])),equals(${body('Read_stack')}?['tags']?['runId'],${runId('Read_current')}),equals(${body('Read_stack')}?['tags']?['application'],'called-it'),equals(${body('Read_stack')}?['tags']?['environment'],'test'),equals(toLower(${body('Read_stack')}?['properties']?['deploymentScope']),toLower(${param('runGroupId')})),equals(${body('Read_stack')}?['properties']?['denySettings']?['mode'],'none'))`,
              {
                Deployment_busy: condition(
                  `contains(createArray('Creating','Updating','Validating','Deploying','Canceling'),${body('Read_stack')}?['properties']?['provisioningState'])`,
                  {
                    Check_deployment_scope: condition(
                      `startsWith(toLower(coalesce(${body('Read_stack')}?['properties']?['deploymentId'],'')),concat(toLower(${param('runGroupId')}),'/providers/microsoft.resources/deployments/'))`,
                      {
                        Cancel_inflight: arm('POST', `concat(${body('Read_stack')}?['properties']?['deploymentId'],'/cancel?api-version=2022-09-01')`),
                      },
                      { Missing_deployment: terminate('DeploymentBusy', 'Stack deployment is still busy. Retry after it settles; never delete untracked resources.') },
                    ),
                  },
                  {
                    Already_deleting: condition(
                      `equals(${body('Read_stack')}?['properties']?['provisioningState'],'Deleting')`,
                      { Await_provider: { type: 'Compose', inputs: 'Teardown is in progress; the next watchdog check verifies completion.', runAfter: {} } },
                      {
                        Delete_owned_stack: arm('DELETE', `concat(${body('Read_current')}?['stackId'],'?api-version=2024-03-01&unmanageAction.Resources=delete&unmanageAction.ResourceGroups=detach&unmanageAction.ManagementGroups=detach')`),
                      },
                    ),
                  },
                ),
              },
              { Refuse_foreign: terminate('UnsafeStack', 'Refusing a stack with foreign resources, unexpected ownership, scope, or deny settings.') },
              after('Foreign_resources'),
            ),
          },
          { Stack_read_failed: terminate('StackReadFailed', 'Unable to inspect the disposable stack. Cleanup was not attempted.') },
        ),
      },
      after('Read_stack', ['Succeeded', 'Failed', 'TimedOut']),
    ),
    Cleanup_deadline: condition(
      `and(not(${succeeded('Write_idle')}),lessOrEquals(ticks(addMinutes(coalesce(${body('Read_current')}?['stopRequestedAt'],utcNow()),20)),ticks(utcNow())))`,
      { Cleanup_overdue: terminate('CleanupOverdue', 'TEST cleanup is still incomplete after 20 minutes. Inspect stack/provider operations; paid resources may remain. Later checks continue retrying.') },
      {},
      after('Stack_result'),
    ),
  };
}

export function watchdogDefinition() {
  return {
    $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
    contentVersion: '1.0.0.0',
    parameters: Object.fromEntries(['stateUrl', 'runGroupId', 'managedGroupId', 'subscriptionId', 'tenantId', 'identityId']
      .map((name) => [name, { type: 'String' }])),
    triggers: {
      Check_expiry: {
        type: 'Recurrence',
        recurrence: { frequency: 'Minute', interval: 5 },
        runtimeConfiguration: { concurrency: { runs: 1 } },
      },
    },
    actions: {
      Read_state: storage('GET'),
      Idle: condition(
        `and(equals(${body('Read_state')}?['schemaVersion'],1),equals(${body('Read_state')}?['subscriptionId'],${param('subscriptionId')}),equals(${body('Read_state')}?['tenantId'],${param('tenantId')}),equals(${body('Read_state')}?['phase'],'Idle'))`,
        {},
        {
          Valid_run: condition(validActive('Read_state'), {
            Is_due: condition(due('Read_state'), {
              Lease_id: { type: 'Compose', inputs: '@guid()', runAfter: {} },
              Acquire_state: lease('acquire', after('Lease_id')),
              Claim_locked: {
                type: 'Scope',
                actions: {
                  Read_current: storage('GET'),
                  Still_due: condition(
                    `and(${validActive('Read_current')},equals(${runId('Read_current')},${runId('Read_state')}),${due('Read_current')})`,
                    { Mark_stopping: write(`setProperty(setProperty(setProperty(${body('Read_current')},'phase','Stopping'),'stopRequestedAt',coalesce(${body('Read_current')}?['stopRequestedAt'],utcNow())),'updatedAt',utcNow())`) },
                    {},
                    after('Read_current'),
                  ),
                },
                runAfter: after('Acquire_state'),
              },
              Release_state: lease('release', after('Claim_locked', ['Succeeded', 'Failed', 'TimedOut'])),
              Lease_unavailable: condition(
                `equals(${status('Acquire_state')},409)`,
                { Busy: { type: 'Compose', inputs: 'A lifecycle transition holds the short lease. Recheck next tick.', runAfter: {} } },
                { Lease_failed: terminate('LeaseFailed', 'The lifecycle lease could not be acquired. No resource deletion was attempted.') },
                after('Acquire_state', ['Failed', 'TimedOut']),
              ),
            }),
          }, { Invalid_state: terminate('InvalidState', 'Invalid TEST lifecycle state. Refusing any resource mutation.') }),
        },
        after('Read_state'),
      ),
      Clean_claimed_run: condition(
        `and(${succeeded('Mark_stopping')},${succeeded('Release_state')})`,
        cleanup(),
        {},
        after('Idle'),
      ),
    },
    outputs: {},
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = new URL('watchdog.json', import.meta.url);
  const generated = `${JSON.stringify(watchdogDefinition(), null, 2)}\n`;
  if (process.argv.includes('--write')) writeFileSync(path, generated);
  else if (readFileSync(path, 'utf8') !== generated) throw new Error('watchdog.json is stale; run node infra/test/watchdog-definition.mjs --write');
}
