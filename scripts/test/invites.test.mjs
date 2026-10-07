import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBundle, editBundle, hashes, parseBundle, readBundle, writePrivate, assertBundleUpdate } from './invites.mjs';
import { ROOT } from './config.mjs';

test('initial one-tester bundle uses fresh 256-bit codes, hashes and stable IDs', () => {
  const first = createBundle();
  const second = createBundle();
  assert.equal(first.testers.length, 1);
  assert.equal(first.testers[0].id, 'tester-1');
  assert.equal(Buffer.from(first.testers[0].code, 'base64url').length, 32);
  assert.notEqual(first.signingKey, second.signingKey);
  assert.notEqual(first.testers[0].code, second.testers[0].code);
  assert.match(hashes(first)[0].codeHash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(hashes(first)).includes(first.testers[0].code), false);
});

test('rotation preserves identity and keys; removed IDs cannot be given to another person', () => {
  const initial = createBundle();
  const rotated = editBundle(initial, 'rotate', 'tester-1');
  assert.equal(rotated.signingKey, initial.signingKey);
  assert.equal(rotated.contactsPepper, initial.contactsPepper);
  assert.equal(rotated.testers[0].id, initial.testers[0].id);
  assert.notEqual(rotated.testers[0].code, initial.testers[0].code);
  assert.throws(() => editBundle(initial, 'remove', 'tester-1'), /last invite/);
  const removed = editBundle(editBundle(initial, 'add', 'tester-2'), 'remove', 'tester-1');
  assert.throws(() => editBundle(removed, 'add', 'tester-1'), /retired/);
  assert.throws(() => editBundle(initial, 'add', 'UPPERCASE'), /Tester IDs/);
  assert.throws(() => assertBundleUpdate(removed, initial), /retired tester IDs/);
  assert.throws(() => assertBundleUpdate(initial, createBundle()), /key regeneration/);
});

test('malformed owner bundle contents are never included in error text', () => {
  assert.throws(() => parseBundle('{"secret":"do-not-print-this'), (error) => !error.message.includes('do-not-print-this'));
});

test('owner material is outside Git, owner-only, non-symlink and never accidentally overwritten', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'called-it-test-files-'));
  // macOS aliases /var to /private/var; resolve the test root before applying the no-symlink policy.
  const { realpath } = await import('node:fs/promises');
  const root = await realpath(temporary);
  const privateDirectory = join(root, 'private');
  await mkdir(privateDirectory, { mode: 0o700 });
  const path = join(privateDirectory, 'owner.json');
  try {
    const bundle = createBundle();
    await writePrivate(path, JSON.stringify(bundle));
    assert.equal((await lstat(path)).mode & 0o077, 0);
    assert.deepEqual(await readBundle(path), bundle);
    await assert.rejects(writePrivate(path, JSON.stringify(createBundle())), /EEXIST/);
    await assert.rejects(writePrivate(join(ROOT, 'test-owner.json'), 'not-secret'), /repository/);
    const link = join(privateDirectory, 'linked.json');
    await symlink(path, link);
    await assert.rejects(readBundle(link), /symlink/);
    await chmod(path, 0o644);
    await assert.rejects(readBundle(path), /0600/);
    await chmod(path, 0o600);
    const rotated = editBundle(bundle, 'rotate', 'tester-1');
    await writePrivate(path, JSON.stringify(rotated), { replace: true });
    assert.deepEqual(await readBundle(path), rotated);
    await mkdir(join(privateDirectory, '.git'));
    await assert.rejects(writePrivate(join(privateDirectory, 'second.json'), 'not-secret'), /Git checkout/);
    assert.equal((await readFile(path, 'utf8')).length > 0, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
