import { readFileSync } from 'node:fs';
import { CONFIG, GROUP_ID, requireValue } from './config.mjs';

export const PROTOCOL = JSON.parse(readFileSync(new URL('../../infra/test/protocol.json', import.meta.url), 'utf8'));
export const STACK_STATES = Object.fromEntries(Object.entries(PROTOCOL.stackStates)
  .map(([kind, states]) => [kind, states.map((state) => state.toLowerCase())]));

export function stackPhase(value) {
  requireValue(typeof value === 'string', 'Missing deployment-stack provisioning state.');
  const phase = value.toLowerCase();
  requireValue(Object.values(STACK_STATES).some((states) => states.includes(phase)),
    'Unrecognized deployment-stack provisioning state; refusing to assume completion.');
  return phase;
}

export function operationUrl(value, provider, resourceId) {
  requireValue(typeof value === 'string' && value.length > 0, 'Missing ARM operation URL.');
  const region = provider === 'Microsoft.Resources' ? CONFIG.location
    : provider === 'Microsoft.App' ? CONFIG.workloadLocation : null;
  requireValue(region, 'Unapproved ARM operation provider.');
  const url = new URL(value, 'https://management.azure.com');
  const path = url.pathname.toLowerCase();
  const subscription = `/subscriptions/${CONFIG.subscriptionId}`;
  const providerRoot = `${subscription}/providers/${provider.toLowerCase()}/`;
  const regional = `${providerRoot}locations/${region}/`;
  const scoped = `${resourceId.toLowerCase()}/`;
  const rootOperation = ['operations', 'operationStatuses', 'operationResults', 'deploymentStackOperationStatuses', 'deploymentStackOperationResults']
    .some((kind) => path.startsWith(`${providerRoot}${kind.toLowerCase()}/`));
  const deploymentOperation = provider === 'Microsoft.Resources'
    && path.startsWith(`${GROUP_ID.toLowerCase()}/providers/microsoft.resources/deployments/`)
    && /\/operation(?:statuses|results|s)\//.test(path);
  const receipt = PROTOCOL.signedStackOperation;
  const signedEndpoint = provider === 'Microsoft.Resources' && receipt.paths.some((kind) => {
    const prefix = `${regional}${kind.toLowerCase()}/`;
    return path.startsWith(prefix) && path.length > prefix.length && !path.slice(prefix.length).includes('/');
  });
  const parts = url.search.split('&');
  const signedQuery = signedEndpoint && value.length <= receipt.maxUrlLength
    && !/[\s%\\]/.test(value) && !value.includes('..')
    && parts.length === receipt.queryParameters.length + 1
    && parts[0] === `?api-version=${receipt.apiVersion}`
    && /^t=\d{1,20}$/.test(parts[1] ?? '')
    && receipt.queryParameters.every((key, index) =>
      parts[index + 1]?.startsWith(`${key}=`) && parts[index + 1].length > key.length + 1);
  const keys = [...url.searchParams.keys()];
  const ordinaryQuery = keys.length === new Set(keys).size
    && keys.every((key) => ['api-version', 'monitor'].includes(key))
    && (!url.searchParams.has('monitor') || ['true', 'false'].includes(url.searchParams.get('monitor')))
    && /^\d{4}-\d{2}-\d{2}(?:-preview)?$/.test(url.searchParams.get('api-version') ?? '');
  requireValue(url.origin === 'https://management.azure.com' && !url.username && !url.password && !url.hash
    && !url.pathname.includes('%') && !url.pathname.includes('..')
    && (path.startsWith(regional) || path.startsWith(scoped) || path === resourceId.toLowerCase() || rootOperation || deploymentOperation)
    && (ordinaryQuery || signedQuery),
  'Refusing an ARM operation URL outside the approved subscription, provider, region, or resource.');
  requireValue(resourceId.toLowerCase().startsWith(`${GROUP_ID.toLowerCase()}/providers/${provider.toLowerCase()}/`),
    'The operation resource is outside the disposable TEST group.');
  return url.href;
}

export function operationUrlForDisplay(value) {
  if (!value) return null;
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

export function responseOperationUrls(response, provider, resourceId) {
  const asynchronous = response.headers?.get('azure-asyncoperation');
  const location = response.headers?.get('location');
  return {
    asynchronous: asynchronous ? operationUrl(asynchronous, provider, resourceId) : null,
    location: location ? operationUrl(location, provider, resourceId) : null,
  };
}

export function responseOperationUrl(response, provider, resourceId) {
  const { asynchronous, location } = responseOperationUrls(response, provider, resourceId);
  return asynchronous ?? location;
}

export function armPath(url) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

export function operationPhase(response) {
  const value = response.body?.status;
  if (value === undefined || value === null) return null;
  requireValue(typeof value === 'string', 'Invalid ARM long-running operation status.');
  const phase = value.toLowerCase();
  requireValue(phase.length > 0, 'Missing ARM long-running operation status.');
  return phase === 'cancelled' ? 'canceled' : phase;
}
