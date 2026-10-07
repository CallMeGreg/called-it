import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Lifecycle, publishSecrets } from './lifecycle.mjs';
import { createBundle, hashes, writePrivate } from './invites.mjs';
import { FOUNDATION, MemoryAzure } from './test-fixtures.mjs';

test('identical recovery material still repairs a partially applied app secret deployment', async (context) => {
  context.mock.method(console, 'log', () => {});
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'called-it-secret-publication-')));
  const file = join(directory, 'owner.json');
  const bundle = createBundle();
  await writePrivate(file, JSON.stringify(bundle));
  const azure = new MemoryAzure();
  const request = azure.request.bind(azure);
  let broken = true;
  let deployments = 0;
  let deploymentReady = false;
  let temporaryPath;
  azure.request = async (url, options) => {
    if (!url.startsWith(FOUNDATION.vaultUri)) return request(url, options);
    assert.ok(azure.leaseId, 'Secret reconciliation must hold the lifecycle lease.');
    const name = new URL(url).pathname.split('/').at(-1);
    const values = {
      'owner-recovery': JSON.stringify(bundle),
      'auth-signing-key': bundle.signingKey,
      'contacts-pepper': bundle.contactsPepper,
      'test-invites': JSON.stringify(hashes(bundle)),
    };
    if (name === 'test-invites' && broken) return { status: 404 };
    return { status: 200, body: { value: values[name] } };
  };
  azure.az = async (args, options) => {
    assert.equal(options.sensitive, true);
    assert.equal(options.mutate, true);
    assert.ok(azure.leaseId);
    temporaryPath = args.at(-1).slice(1);
    const parameters = JSON.parse(await readFile(temporaryPath, 'utf8')).parameters;
    assert.equal(parameters.signingKey.value, bundle.signingKey);
    deployments++;
    broken = false;
    deploymentReady = true;
  };
  azure.arm = async () => ({ status: 200, body: { properties: { provisioningState: deploymentReady ? 'Succeeded' : 'Failed' } } });
  const lifecycle = new Lifecycle(azure, FOUNDATION);
  try {
    await publishSecrets(azure, lifecycle, file);
    assert.equal(deployments, 1);
    await assert.rejects(readFile(temporaryPath), /ENOENT/);
    await publishSecrets(azure, lifecycle, file);
    assert.equal(deployments, 1, 'A fully reconciled repeat must not create another secret version.');
    deploymentReady = false;
    await publishSecrets(azure, lifecycle, file);
    assert.equal(deployments, 2, 'A failed role-assignment deployment must be retried even when secret values match.');
    assert.equal(azure.leaseId, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
