import test from 'node:test';
import assert from 'node:assert/strict';
import { Azure } from './azure.mjs';
import { CONFIG, GROUP_ID, DATA_GROUP_ID, assertFoundation, assertDigest, stackId } from './config.mjs';
import { FOUNDATION, RUN_ID } from './test-fixtures.mjs';

const account = { id: CONFIG.subscriptionId, tenantId: CONFIG.tenantId, state: 'Enabled' };
const context = { AZURE_CONFIG_DIR: '/isolated/test-only-cli' };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('wrong subscription, tenant, or disabled subscription fails before mutation', async () => {
  for (const patch of [{ id: 'wrong' }, { tenantId: 'wrong' }, { state: 'Disabled' }]) {
    const commands = [];
    const azure = new Azure({
      env: context,
      execute: async (file, args) => { commands.push([file, ...args]); return { stdout: JSON.stringify({ ...account, ...patch }) }; },
    });
    await assert.rejects(azure.az(['deployment', 'group', 'create'], { mutate: true }));
    assert.deepEqual(commands.map((command) => command.slice(0, 3)), [['az', 'account', 'show']]);
    assert.equal(azure.verified, false);
  }
});

test('isolated explicit context is mandatory', async () => {
  let executed = false;
  const azure = new Azure({ env: {}, execute: async () => { executed = true; } });
  await assert.rejects(azure.guard(), /isolated/);
  assert.equal(executed, false);
});

test('every CLI cloud mutation specifies the fixed subscription and rechecks context', async () => {
  const commands = [];
  const azure = new Azure({
    env: context,
    execute: async (_file, args) => {
      commands.push(args);
      return { stdout: args[0] === 'account' ? JSON.stringify(account) : '{}' };
    },
  });
  await azure.az(['provider', 'register', '--namespace', 'Microsoft.App'], { mutate: true });
  assert.equal(commands.length, 2);
  assert.equal(commands[1][commands[1].indexOf('--subscription') + 1], CONFIG.subscriptionId);
  assert.ok(!commands.flat().includes('set'));
});

test('ARM and data-plane endpoint escapes are rejected before sending a token', async () => {
  let fetched = false;
  const azure = new Azure({ fetcher: async () => { fetched = true; } });
  azure.verified = true;
  azure.foundationConfig = FOUNDATION;
  for (const [url, audience] of [
    ['https://example.com/steal', 'https://management.azure.com/'],
    ['https://management.azure.com/subscriptions/another/resourceGroups/x', 'https://management.azure.com/'],
    ['https://unrelated.blob.core.windows.net/lifecycle/state.json', 'https://storage.azure.com/'],
    ['https://wrong.vault.azure.net/secrets/key', 'https://vault.azure.net'],
  ]) await assert.rejects(azure.request(url, { audience }), /Refusing/);
  assert.equal(fetched, false);
});

test('credentials and malformed secret JSON are not echoed in errors', async () => {
  const privateValue = 'never-print-this-private-value';
  const azure = new Azure({ execute: async () => { throw { code: 1, stderr: privateValue }; } });
  await assert.rejects(azure.command('az', ['deployment', 'create'], { sensitive: true }), (error) => !error.message.includes(privateValue));
  azure.verified = true;
  azure.token = async () => 'fake-token';
  azure.fetcher = async () => new Response(`{"value":"${privateValue}`, { headers: { 'content-type': 'application/json' } });
  await assert.rejects(azure.arm(`${GROUP_ID}?api-version=2024-03-01`), (error) => !error.message.includes(privateValue));
});

test('foundation reads use data-group Reader instead of subscription deployment permissions', async () => {
  let args;
  const azure = new Azure();
  azure.az = async (arguments_) => { args = arguments_; return FOUNDATION; };
  assert.deepEqual(await azure.foundation(), FOUNDATION);
  assert.deepEqual(args.slice(0, 3), ['deployment', 'group', 'show']);
});

test('foundation outputs, state endpoints, runtime identity, SQL and image digests are strict', () => {
  assert.equal(assertFoundation(FOUNDATION), FOUNDATION);
  for (const patch of [
    { stateUrl: `${FOUNDATION.stateUrl}?sig=not-allowed` },
    { runtimeIdentityId: `${DATA_GROUP_ID}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/administrator` },
    { sqlServerId: `${DATA_GROUP_ID}/providers/Microsoft.Sql/servers/other` },
    { runtimeClientId: '-'.repeat(36) }, { dataGroup: CONFIG.runGroup },
  ]) assert.throws(() => assertFoundation({ ...FOUNDATION, ...patch }));
  const registry = `cittest${RUN_ID.slice(0, 20)}.azurecr.io`;
  assert.doesNotThrow(() => assertDigest(`${registry}/called-it-api@sha256:${'a'.repeat(64)}`, registry, 'called-it-api'));
  for (const image of [`${registry}/called-it-api:latest`, `other.azurecr.io/called-it-api@sha256:${'a'.repeat(64)}`]) {
    assert.throws(() => assertDigest(image, registry, 'called-it-api'));
  }
  assert.throws(() => stackId('0'.repeat(32)));
});

test('safe Azure errors expose status and code, not service response messages', async () => {
  const azure = new Azure({ fetcher: async () => response({ error: { code: 'Forbidden', message: 'private-secret' } }, 403) });
  azure.verified = true;
  azure.token = async () => 'not-a-live-token';
  await assert.rejects(azure.arm(`${GROUP_ID}?api-version=2024-03-01`), (error) => error.status === 403 && !error.message.includes('private-secret'));
});

test('tokens refresh using real expiry minus a margin, independently for each resource', async () => {
  let now = Date.parse('2026-10-07T00:00:00Z');
  const calls = [];
  const azure = new Azure({ now: () => now });
  azure.verified = true;
  azure.az = async (args, options) => {
    assert.equal(options.sensitive, true);
    assert.equal(options.raw, undefined);
    assert.ok(args.includes('{accessToken:accessToken,expires_on:expires_on}'));
    calls.push(args[args.indexOf('--resource') + 1]);
    return { accessToken: `${calls.length}`.repeat(120), expires_on: Math.floor(now / 1000) + 600 };
  };
  const arm = 'https://management.azure.com/';
  const storage = 'https://storage.azure.com/';
  const first = await azure.token(arm);
  assert.equal(await azure.token(arm), first);
  await azure.token(storage);
  assert.equal(calls.length, 2);
  now += 11 * 60_000;
  assert.notEqual(await azure.token(arm), first);
  assert.equal(calls.length, 3);
  assert.equal(calls[2], arm);
  await azure.token(storage);
  assert.equal(calls.length, 4);
});

test('tokens without valid Unix expiry never receive a success-shaped cache fallback', async () => {
  const now = Date.parse('2026-10-07T00:00:00Z');
  for (const expiry of [undefined, null, '', 'tomorrow', '1e20', -1, 1.5, Infinity, now / 1000 + 30]) {
    const azure = new Azure({ now: () => now });
    azure.verified = true;
    azure.az = async () => ({ accessToken: 'synthetic-test-token'.repeat(10), expires_on: expiry });
    await assert.rejects(azure.token('https://management.azure.com/'), /expiry|expired/);
    assert.equal(azure.tokens.size, 0);
  }
});
