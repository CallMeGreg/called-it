import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const CONFIG = Object.freeze(JSON.parse(readFileSync(new URL('../../infra/test/config.json', import.meta.url), 'utf8')));
export const GROUP_ID = `/subscriptions/${CONFIG.subscriptionId}/resourceGroups/${CONFIG.runGroup}`;
export const DATA_GROUP_ID = `/subscriptions/${CONFIG.subscriptionId}/resourceGroups/${CONFIG.dataGroup}`;
export const MANAGED_GROUP_ID = `/subscriptions/${CONFIG.subscriptionId}/resourceGroups/${CONFIG.managedGroup}`;
export const STACK_API = '2024-03-01';

export function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function stackId(runId) {
  requireValue(typeof runId === 'string' && /^[a-f0-9]{32}$/.test(runId) && !/^0+$/.test(runId), 'Invalid TEST run ID.');
  return `${GROUP_ID}/providers/Microsoft.Resources/deploymentStacks/${CONFIG.stackPrefix}${runId}`;
}

export function assertFoundation(value) {
  requireValue(value && typeof value === 'object', 'Missing TEST foundation outputs. Run operator bootstrap first.');
  for (const key of ['subscriptionId', 'tenantId', 'location', 'dataGroup', 'runGroup', 'managedGroup']) {
    requireValue(value[key] === CONFIG[key], `Foundation ${key} does not match the approved TEST scope.`);
  }
  for (const key of ['runtimeIdentityId', 'migratorIdentityId', 'sqlServerId', 'watchdogId']) {
    requireValue(typeof value[key] === 'string' && value[key].startsWith(`${DATA_GROUP_ID}/providers/`),
      `Foundation ${key} is outside the persistent TEST group.`);
  }
  for (const key of ['runtimeClientId', 'runtimePrincipalId', 'migratorClientId', 'migratorPrincipalId', 'deployerClientId', 'deployerPrincipalId']) {
    requireValue(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value[key] ?? '')
      && value[key] !== '00000000-0000-0000-0000-000000000000', `Invalid foundation ${key}.`);
  }
  requireValue(value.runtimeIdentityId === `${DATA_GROUP_ID}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/called-it-test-runtime`
    && value.migratorIdentityId === `${DATA_GROUP_ID}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/called-it-test-migrator`
    && value.runtimeIdentityName === 'called-it-test-runtime', 'Unexpected TEST runtime/migrator identity.');
  requireValue(value.watchdogId === `${DATA_GROUP_ID}/providers/Microsoft.Logic/workflows/called-it-test-expiry`,
    'Unexpected TEST watchdog resource.');
  requireValue(/^cittestctl[a-z0-9]+$/.test(value.storageName), 'Invalid lifecycle storage name.');
  requireValue(value.stateUrl === `https://${value.storageName}.blob.core.windows.net/${CONFIG.stateContainer}/${CONFIG.stateBlob}`,
    'Refusing an unexpected lifecycle state endpoint.');
  requireValue(/^cit-test-kv-[a-z0-9]+$/.test(value.vaultName), 'Invalid TEST vault name.');
  requireValue(value.vaultUri === `https://${value.vaultName}.vault.azure.net/`, 'Invalid TEST vault endpoint.');
  requireValue(/^called-it-test-sql-[a-z0-9]+\.database\.windows\.net$/.test(value.sqlFqdn), 'Invalid TEST SQL endpoint.');
  requireValue(value.sqlServerId === `${DATA_GROUP_ID}/providers/Microsoft.Sql/servers/${value.sqlServerName}`
    && value.sqlFqdn === `${value.sqlServerName}.database.windows.net`, 'SQL identity and hostname do not match.');
  requireValue(value.databaseName === 'calledit', 'Invalid TEST database name.');
  return value;
}

export function assertDigest(image, registryServer, repository) {
  requireValue(typeof image === 'string'
    && image.startsWith(`${registryServer}/${repository}@sha256:`)
    && /^[a-f0-9]{64}$/.test(image.split('@sha256:')[1] ?? ''),
  'A release requires an immutable digest from this run\'s TEST registry.');
}
