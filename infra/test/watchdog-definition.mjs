import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const protocol = JSON.parse(readFileSync(new URL('protocol.json', import.meta.url), 'utf8'));
const config = JSON.parse(readFileSync(new URL('config.json', import.meta.url), 'utf8'));
const stackStates = Object.fromEntries(Object.entries(protocol.stackStates)
  .map(([kind, values]) => [kind, values.map((value) => value.toLowerCase())]));
const array = (values) => `createArray(${values.map((value) => `'${value}'`).join(',')})`;
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
const stackPhase = (name) => `toLower(coalesce(${body(name)}?['properties']?['provisioningState'],''))`;
const terminal = (value) => `contains(${array(stackStates.terminal)},toLower(coalesce(${value},'')))`;
const operationPhase = `replace(toLower(coalesce(${body('Read_submission_operation')}?['status'],'')),'cancelled','canceled')`;
const pending = `first(${body('Find_pending')})`;
const candidate = body('Read_candidate');
const deployment = body('Read_submission_deployment');
const set = (value, entries) => Object.entries(entries).reduce((result, [key, property]) => `setProperty(${result},'${key}',${property})`, value);
const pendingQuery = (source, runAfter) => ({
  type: 'Query',
  inputs: {
    from: expr(`${body(source)}?['submissions']`),
    where: expr(`not(and(equals(item()?['status'],'terminal'),${terminal("item()?['result']")},contains(createArray('lro','deployment-generation'),item()?['evidence']?['kind']),not(empty(item()?['completedAt']))))`),
  },
  runAfter,
});
const due = (name) => `or(equals(${body(name)}?['phase'],'Stopping'),lessOrEquals(ticks(coalesce(${body(name)}?['expiresAt'],'9999-12-31T23:59:59Z')),ticks(utcNow())))`;
const runId = (name) => `${body(name)}?['runId']`;
const validLocations = `and(equals(${param('controlLocation')},'${config.location}'),equals(${param('workloadLocation')},'${config.workloadLocation}'))`;
const removeHex = (value) => [...'0123456789abcdef'].reduce((v, c) => `replace(${v},'${c}','')`, value);
const guid = (value) => `and(equals(length(coalesce(${value},'')),36),equals(length(replace(coalesce(${value},''),'-','')),32),empty(${removeHex(`toLower(replace(coalesce(${value},''),'-',''))`)}))`;
const validActive = (name) => `and(
  ${validLocations},
  equals(${body(name)}?['schemaVersion'],${protocol.stateVersion}),
  equals(${body(name)}?['subscriptionId'],${param('subscriptionId')}),
  equals(${body(name)}?['tenantId'],${param('tenantId')}),
  contains(createArray('Starting','Running','Stopping'),${body(name)}?['phase']),
  equals(length(coalesce(${runId(name)},'')),32),
  not(equals(${runId(name)},'00000000000000000000000000000000')),
  empty(${removeHex(`coalesce(${runId(name)},'')`)}),
  not(equals(${body(name)}?['submissions'],null)),
  equals(${body(name)}?['stackId'],concat(${runPrefix},${runId(name)}))
)`.replace(/\s+/g, ' ');

function settleSubmission() {
  const proof = "outputs('Chosen_evidence')";
  const matches = `and(equals(item()?['id'],${pending}?['id']),equals(item()?['status'],'pending'))`;
  const preserved = ['id', 'clientRequestId', 'submittedAt', 'previousStackCorrelationId', 'previousDeploymentId', 'previousDeploymentCorrelationId', 'operationUrl'];
  return {
    Chosen_evidence: {
      type: 'Compose',
      inputs: expr(`if(${succeeded('Lro_evidence')},outputs('Lro_evidence'),outputs('Generation_evidence'))`),
      runAfter: {},
    },
    Acquire_settle: lease('acquire', after('Chosen_evidence')),
    Settle_locked: {
      type: 'Scope',
      actions: {
        Read_settle: storage('GET'),
        Same_settle_run: condition(
          `and(${validActive('Read_settle')},equals(${runId('Read_settle')},${runId('Read_current')}),equals(${body('Read_settle')}?['phase'],'Stopping'))`,
          {
            Transform_submissions: {
              type: 'Select',
              inputs: {
                from: expr(`${body('Read_settle')}?['submissions']`),
                select: {
                  ...Object.fromEntries(preserved.map((key) => [key, expr(`item()?['${key}']`)])),
                  status: expr(`if(${matches},'terminal',item()?['status'])`),
                  result: expr(`if(${matches},${proof}?['result'],item()?['result'])`),
                  evidence: expr(`if(${matches},${proof}?['evidence'],item()?['evidence'])`),
                  completedAt: expr(`if(${matches},utcNow(),item()?['completedAt'])`),
                },
              },
              runAfter: {},
            },
            Write_settlement: write(set(body('Read_settle'), {
              submissions: body('Transform_submissions'), updatedAt: 'utcNow()',
            }), after('Transform_submissions')),
          },
          { Settlement_changed: terminate('StateChanged', 'Submission reconciliation cannot change another run.') },
          after('Read_settle'),
        ),
      },
      runAfter: after('Acquire_settle'),
    },
    Release_settle: lease('release', after('Settle_locked', ['Succeeded', 'Failed', 'TimedOut'])),
  };
}

function reconciliation() {
  const url = `${pending}?['operationUrl']`;
  const lowerUrl = `toLower(coalesce(${url},''))`;
  const providerRoot = `concat('https://management.azure.com/subscriptions/',${param('subscriptionId')},'/providers/microsoft.resources/')`;
  const scopedRoot = `concat('https://management.azure.com',toLower(${body('Read_current')}?['stackId']))`;
  const deploymentRoot = `concat(toLower(${param('runGroupId')}),'/providers/microsoft.resources/deployments/')`;
  const query = `uriQuery(${url})`;
  const validQuery = `or(
    and(startsWith(${query},'?api-version='),or(equals(length(split(${query},'&')),1),
      and(equals(length(split(${query},'&')),2),or(endsWith(${query},'&monitor=true'),endsWith(${query},'&monitor=false'))))),
    and(equals(length(split(${query},'&')),2),or(startsWith(${query},'?monitor=true&api-version='),startsWith(${query},'?monitor=false&api-version=')))
  )`;
  const urlRootOperation = ['operations', 'operationStatuses', 'operationResults', 'deploymentStackOperationStatuses', 'deploymentStackOperationResults']
    .map((kind) => `startsWith(${lowerUrl},concat(${providerRoot},'${kind.toLowerCase()}/'))`).join(',');
  const validUrl = `and(
    ${validLocations},
    or(startsWith(${lowerUrl},concat(${providerRoot},'locations/',${param('controlLocation')},'/')),
       ${urlRootOperation},
       startsWith(${lowerUrl},concat(${scopedRoot},'/')),
       startsWith(${lowerUrl},concat(${scopedRoot},'?')),
       and(startsWith(${lowerUrl},concat('https://management.azure.com',${deploymentRoot})),or(contains(${lowerUrl},'/operationstatuses/'),contains(${lowerUrl},'/operationresults/'),contains(${lowerUrl},'/operations/')))),
    not(contains(${url},'%')),not(contains(${url},'..')),not(contains(${url},'#')),not(contains(${url},'\\\\')),
    ${validQuery}
  )`.replace(/\s+/g, ' ');
  const candidateMatches = `and(
    equals(${status('Read_candidate')},200),
    equals(toLower(coalesce(${candidate}?['id'],'')),toLower(${body('Read_current')}?['stackId'])),
    equals(${candidate}?['location'],${param('controlLocation')}),
    equals(${candidate}?['tags']?['runId'],${runId('Read_current')}),
    equals(${candidate}?['tags']?['application'],'called-it'),equals(${candidate}?['tags']?['environment'],'test'),
    equals(toLower(coalesce(${candidate}?['properties']?['deploymentScope'],'')),toLower(${param('runGroupId')})),
    equals(${candidate}?['tags']?['submissionId'],${pending}?['id']),
    equals(${candidate}?['properties']?['parameters']?['submissionId']?['value'],${pending}?['id']),
    ${guid(`${candidate}?['properties']?['correlationId']`)},
    not(equals(toLower(coalesce(${candidate}?['properties']?['correlationId'],'')),toLower(coalesce(${pending}?['previousStackCorrelationId'],'')))),
    startsWith(toLower(coalesce(${candidate}?['properties']?['deploymentId'],'')),${deploymentRoot}),
    not(contains(coalesce(${candidate}?['properties']?['deploymentId'],''),'..')),
    not(contains(coalesce(${candidate}?['properties']?['deploymentId'],''),'%'))
  )`.replace(/\s+/g, ' ');
  const generationMatches = `and(
    equals(${status('Read_submission_deployment')},200),
    equals(toLower(coalesce(${deployment}?['id'],'')),toLower(${candidate}?['properties']?['deploymentId'])),
    equals(${deployment}?['properties']?['parameters']?['submissionId']?['value'],${pending}?['id']),
    ${guid(`${deployment}?['properties']?['correlationId']`)},
    or(not(equals(toLower(coalesce(${deployment}?['id'],'')),toLower(coalesce(${pending}?['previousDeploymentId'],'')))),
       not(equals(toLower(coalesce(${deployment}?['properties']?['correlationId'],'')),toLower(coalesce(${pending}?['previousDeploymentCorrelationId'],''))))),
    ${terminal(`${candidate}?['properties']?['provisioningState']`)},
    ${terminal(`${deployment}?['properties']?['provisioningState']`)},
    or(not(equals(${stackPhase('Read_candidate')},'succeeded')),equals(${stackPhase('Read_submission_deployment')},'succeeded'))
  )`.replace(/\s+/g, ' ');
  return {
    Read_submission_state: storage('GET'),
    Find_pending: pendingQuery('Read_submission_state', after('Read_submission_state')),
    Has_pending_submission: condition(
      `not(empty(${body('Find_pending')}))`,
      {
        Read_candidate: arm('GET', stackPath),
        Has_operation_url: condition(
          `not(empty(${url}))`,
          {
            Safe_operation_url: condition(validUrl, {
              Read_submission_operation: http('GET', expr(url), 'https://management.azure.com/'),
              Operation_terminal: condition(
                `and(equals(${status('Read_submission_operation')},200),${terminal(operationPhase)})`,
                {
                  Lro_evidence: {
                    type: 'Compose',
                    inputs: {
                      result: expr(operationPhase),
                      evidence: { kind: 'lro', operationUrl: expr(url) },
                    },
                    runAfter: {},
                  },
                },
                {},
                after('Read_submission_operation', ['Succeeded', 'Failed', 'TimedOut']),
              ),
            }, { Unsafe_operation_url: terminate('UnsafeOperationUrl', 'Refusing a submission operation URL outside the approved ARM scope.') }),
          },
          {},
          after('Read_candidate', ['Succeeded', 'Failed', 'TimedOut']),
        ),
        Need_generation_evidence: condition(
          `not(${succeeded('Lro_evidence')})`,
          {
            Candidate_generation: condition(candidateMatches, {
              Read_submission_deployment: arm('GET', `concat(${candidate}?['properties']?['deploymentId'],'?api-version=2022-09-01')`),
              Generation_terminal: condition(generationMatches, {
                Generation_evidence: {
                  type: 'Compose',
                  inputs: {
                    result: expr(stackPhase('Read_candidate')),
                    evidence: {
                      kind: 'deployment-generation',
                      stackCorrelationId: expr(`${candidate}?['properties']?['correlationId']`),
                      deploymentId: expr(`${deployment}?['id']`),
                      deploymentCorrelationId: expr(`${deployment}?['properties']?['correlationId']`),
                    },
                  },
                  runAfter: {},
                },
              }, {}, after('Read_submission_deployment', ['Succeeded', 'Failed', 'TimedOut'])),
            }),
          },
          {},
          after('Has_operation_url'),
        ),
        Submission_evidence_ready: condition(
          `or(${succeeded('Lro_evidence')},${succeeded('Generation_evidence')})`,
          settleSubmission(),
          { Submission_unresolved: terminate('UnresolvedSubmission', expr(`concat('Stack submission ',${pending}?['id'],' / client request ',${pending}?['clientRequestId'],' is unresolved. State stays Stopping; no delete or new Start is safe. Inspect its operation URL and Azure deployment/activity history. A 404 or empty inventory is not completion evidence.')`)) },
          after('Need_generation_evidence'),
        ),
      },
      {},
      after('Find_pending'),
    ),
  };
}

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
            Finish_pending: pendingQuery('Read_finish', after('Read_finish')),
            Same_run: condition(
              `and(${validActive('Read_finish')},equals(${runId('Read_finish')},${runId('Read_current')}),equals(${body('Read_finish')}?['phase'],'Stopping'),empty(${body('Finish_pending')}))`,
              {
                Write_idle: write(set(body('Read_finish'), {
                  phase: "'Idle'", lastRunId: runId('Read_current'), runId: 'null', stackId: 'null', expiresAt: 'null',
                  url: 'null', lastError: 'null', updatedAt: 'utcNow()', lastSubmissions: `${body('Read_finish')}?['submissions']`, submissions: "json('[]')",
                })),
              },
              { Invalid_finish: terminate('StateChanged', 'Cleanup cannot clear another run. Inspect TEST lifecycle state.') },
              after('Finish_pending'),
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
              `and(equals(${body('Read_stack')}?['location'],${param('controlLocation')}),empty(body('Foreign_resources')),not(equals(${body('Read_stack')}?['properties']?['resources'],null)),equals(toLower(${body('Read_stack')}?['id']),toLower(${body('Read_current')}?['stackId'])),equals(${body('Read_stack')}?['tags']?['runId'],${runId('Read_current')}),equals(${body('Read_stack')}?['tags']?['application'],'called-it'),equals(${body('Read_stack')}?['tags']?['environment'],'test'),equals(toLower(${body('Read_stack')}?['properties']?['deploymentScope']),toLower(${param('runGroupId')})),equals(${body('Read_stack')}?['properties']?['denySettings']?['mode'],'none'),contains(${array(Object.values(stackStates).flat())},${stackPhase('Read_stack')}))`,
              {
                Deployment_busy: condition(
                  `contains(${array(stackStates.inFlight)},${stackPhase('Read_stack')})`,
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
                      `contains(${array(stackStates.deleting)},${stackPhase('Read_stack')})`,
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
    contentVersion: protocol.controllerVersion,
    parameters: Object.fromEntries(['stateUrl', 'runGroupId', 'managedGroupId', 'subscriptionId', 'tenantId', 'identityId', 'controlLocation', 'workloadLocation']
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
        `and(${validLocations},equals(${body('Read_state')}?['schemaVersion'],${protocol.stateVersion}),equals(${body('Read_state')}?['subscriptionId'],${param('subscriptionId')}),equals(${body('Read_state')}?['tenantId'],${param('tenantId')}),equals(${body('Read_state')}?['phase'],'Idle'),equals(${body('Read_state')}?['submissions'],json('[]')))`,
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
      Reconcile_claimed_run: condition(
        `and(${succeeded('Mark_stopping')},${succeeded('Release_state')})`,
        reconciliation(),
        {},
        after('Idle'),
      ),
      Clean_claimed_run: condition(
        `and(${succeeded('Mark_stopping')},${succeeded('Release_state')})`,
        {
          Read_cleanup_state: storage('GET'),
          Cleanup_pending: pendingQuery('Read_cleanup_state', after('Read_cleanup_state')),
          All_submissions_settled: condition(
            `and(${validActive('Read_cleanup_state')},equals(${runId('Read_cleanup_state')},${runId('Read_current')}),equals(${body('Read_cleanup_state')}?['phase'],'Stopping'),empty(${body('Cleanup_pending')}))`,
            cleanup(),
            { Refuse_unsettled_cleanup: terminate('UnresolvedSubmission', 'Every submission must be conclusively reconciled before deletion. Keep the run owned in Stopping.') },
            after('Cleanup_pending'),
          ),
        },
        {},
        after('Reconcile_claimed_run'),
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
