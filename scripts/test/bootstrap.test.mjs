import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from './lifecycle.mjs';
import { CONFIG, DATA_GROUP_ID, GROUP_ID } from './config.mjs';
import { AzureError } from './azure.mjs';
import { idleState } from './state.mjs';
import { FOUNDATION, GUID, MemoryAzure, TEST_NOW } from './test-fixtures.mjs';

function partialFoundation({ budgetExists = true } = {}) {
  const azure = new MemoryAzure(null);
  const deployments = [];
  let ready = false;
  let attempts = 0;
  let outputReads = 0;
  azure.guard = async () => ({ user: { type: 'user' } });
  azure.token = async () => `header.${Buffer.from(JSON.stringify({ oid: GUID })).toString('base64url')}.signature`;
  azure.arm = async (path) => {
    if (path.includes('/Microsoft.Consumption/budgets/')) return budgetExists ? {
      status: 200, body: { properties: { timePeriod: { startDate: '2026-01-01T00:00:00Z' } } },
    } : { status: 404 };
    const id = path.split('?')[0];
    assert.ok([DATA_GROUP_ID, GROUP_ID].includes(id));
    return {
      status: 200, body: {
        location: 'eastus2',
        tags: { application: 'called-it', environment: 'test', lifecycle: id === DATA_GROUP_ID ? 'persistent' : 'disposable' },
      },
    };
  };
  azure.az = async (args, options) => {
    if (args[0] === 'provider') {
      assert.equal(args[1], 'show');
      return 'Registered';
    }
    assert.equal(options.mutate, true);
    deployments.push(args);
    attempts++;
    if (attempts === 1) throw new AzureError('foundation deployment', 'ProvisioningDisabled');
    ready = true;
  };
  azure.foundation = async () => {
    outputReads++;
    assert.equal(ready, true, 'Failed/partial deployment outputs must not be required before retry.');
    return FOUNDATION;
  };
  return { azure, deployments, outputReads: () => outputReads };
}

test('partial bootstrap retries without prior outputs, preserving metadata, budget start and existing state', async (context) => {
  context.mock.method(console, 'log', () => {});
  const fixture = partialFoundation();
  const { azure, deployments } = fixture;
  await assert.rejects(bootstrap(azure, true), /ProvisioningDisabled/);
  assert.equal(fixture.outputReads(), 0);
  assert.equal(azure.calls.length, 0);
  await bootstrap(azure, true);
  assert.equal(fixture.outputReads(), 1);
  assert.equal(azure.state.schemaVersion, 2);
  assert.equal(azure.state.phase, 'Idle');
  for (const args of deployments) {
    assert.equal(args[args.indexOf('--name') + 1], CONFIG.foundationDeployment);
    assert.equal(args[args.indexOf('--location') + 1], 'eastus2');
    assert.ok(args.includes('location=eastus2'));
    assert.ok(args.includes('workloadLocation=centralus'));
    assert.ok(args.includes('budgetStartDate=2026-01-01T00:00:00Z'));
  }
  const preserved = { ...idleState(TEST_NOW), lastRunId: '1234567890abcdef1234567890abcdef' };
  azure.state = structuredClone(preserved);
  await bootstrap(azure, false);
  assert.deepEqual(azure.state, preserved);
  assert.ok(azure.calls.filter(({ method }) => method === 'PUT').every(({ headers }) => headers['If-None-Match'] === '*'));
});

test('bootstrap refuses to relocate existing group metadata before any deployment', async () => {
  const { azure, deployments } = partialFoundation();
  const read = azure.arm;
  azure.arm = async (path) => {
    const result = await read(path);
    if (path.startsWith(`${GROUP_ID}?`)) result.body.location = 'centralus';
    return result;
  };
  await assert.rejects(bootstrap(azure, false), /retained metadata region/);
  assert.equal(deployments.length, 0);
});

test('retry also tolerates a missing dependent budget without requiring failed outputs', async (context) => {
  context.mock.method(console, 'log', () => {});
  const { azure, deployments, outputReads } = partialFoundation({ budgetExists: false });
  await assert.rejects(bootstrap(azure, false), /ProvisioningDisabled/);
  assert.equal(outputReads(), 0);
  await bootstrap(azure, false);
  assert.equal(outputReads(), 1);
  const monthStart = `${new Date().toISOString().slice(0, 7)}-01T00:00:00Z`;
  assert.ok(deployments.every((args) => args.includes(`budgetStartDate=${monthStart}`)));
  assert.equal(azure.state.phase, 'Idle');
});
