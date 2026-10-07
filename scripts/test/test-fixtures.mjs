import { CONFIG, DATA_GROUP_ID, GROUP_ID } from './config.mjs';
import { AzureError } from './azure.mjs';
import { idleState } from './state.mjs';

export const TEST_NOW = new Date('2026-01-01T12:00:00.000Z');
export const RUN_ID = '1234567890abcdef1234567890abcdef';
export const GUID = '12345678-1234-1234-1234-123456789abc';
export const EVENT_ID = '87654321-4321-4321-4321-cba987654321';
export const RUN_GROUP = {
  id: GROUP_ID, location: CONFIG.location,
  tags: { application: 'called-it', environment: 'test', lifecycle: 'disposable' },
};

export function rejectedStackResponse(stackId) {
  return { status: 400, headers: new Headers(), body: { error: {
    code: 'InvalidDeployment',
    message: `The 'location' property is not allowed for '${stackId.split('/').at(-1)}' at resource group scope.`,
  } } };
}

export function rejectionEvent(state) {
  const submission = state.submissions.at(-1);
  return {
    eventDataId: EVENT_ID, correlationId: GUID, eventTimestamp: submission.submittedAt,
    subscriptionId: CONFIG.subscriptionId, resourceGroupName: CONFIG.runGroup,
    resourceProviderName: { value: 'Microsoft.Resources' }, resourceId: state.stackId,
    eventName: { value: 'EndRequest', localizedValue: 'End request' },
    operationName: { value: 'Microsoft.Resources/deploymentStacks/write' },
    status: { value: 'Failed' }, subStatus: { value: 'BadRequest' },
    httpRequest: { method: 'PUT', clientRequestId: submission.clientRequestId,
      uri: `https://management.azure.com${state.stackId}?api-version=2024-03-01` },
    properties: { entity: state.stackId, statusCode: 'BadRequest',
      statusMessage: JSON.stringify(rejectedStackResponse(state.stackId).body) },
  };
}

export const FOUNDATION = {
  ...CONFIG,
  runtimeIdentityId: `${DATA_GROUP_ID}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/called-it-test-runtime`,
  runtimeIdentityName: 'called-it-test-runtime',
  migratorIdentityId: `${DATA_GROUP_ID}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/called-it-test-migrator`,
  sqlServerName: 'called-it-test-sql-fixture',
  sqlServerId: `${DATA_GROUP_ID}/providers/Microsoft.Sql/servers/called-it-test-sql-fixture`,
  sqlFqdn: 'called-it-test-sql-fixture.database.windows.net',
  databaseName: 'calledit',
  watchdogId: `${DATA_GROUP_ID}/providers/Microsoft.Logic/workflows/called-it-test-expiry`,
  runtimeClientId: GUID, runtimePrincipalId: GUID, migratorClientId: GUID, migratorPrincipalId: GUID,
  deployerClientId: GUID, deployerPrincipalId: GUID,
  storageName: 'cittestctlfixture',
  stateUrl: 'https://cittestctlfixture.blob.core.windows.net/lifecycle/state.json',
  vaultName: 'cit-test-kv-fixture',
  vaultUri: 'https://cit-test-kv-fixture.vault.azure.net/',
};

export class MemoryAzure {
  constructor(state = idleState(TEST_NOW)) {
    this.state = structuredClone(state);
    this.leaseId = null;
    this.calls = [];
    this.failRenewal = false;
  }

  async token() { return 'not-a-live-token'; }

  async request(url, options = {}) {
    this.calls.push({ url, ...options });
    options.signal?.throwIfAborted();
    const headers = options.headers ?? {};
    if (url.endsWith('?comp=lease')) {
      const action = headers['x-ms-lease-action'];
      if (action === 'acquire') {
        if (this.leaseId) throw new AzureError('lease acquire', 409);
        this.leaseId = headers['x-ms-proposed-lease-id'];
        return { status: 201 };
      }
      if (headers['x-ms-lease-id'] !== this.leaseId || (action === 'renew' && this.failRenewal)) {
        throw new AzureError(`lease ${action}`, 409);
      }
      if (action === 'release') this.leaseId = null;
      return { status: 200 };
    }
    if (options.method === 'GET') return { status: 200, body: structuredClone(this.state) };
    if (headers['If-None-Match'] === '*' && this.state) return { status: 412 };
    if (this.leaseId && headers['x-ms-lease-id'] !== this.leaseId) throw new AzureError('state write', 412);
    this.state = structuredClone(options.body);
    return { status: 201 };
  }
}
