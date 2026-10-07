import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ROOT, requireValue } from './config.mjs';

const randomSecret = () => randomBytes(32).toString('base64url');
const validId = (id) => typeof id === 'string' && /^[a-z0-9_-]{1,64}$/.test(id);

export function validateBundle(bundle) {
  requireValue(bundle?.schemaVersion === 1, 'Unsupported owner-bundle version.');
  for (const key of ['signingKey', 'contactsPepper']) {
    requireValue(typeof bundle[key] === 'string' && bundle[key].length >= 43, `Invalid owner-bundle ${key}.`);
  }
  requireValue(Array.isArray(bundle.testers) && bundle.testers.length >= 1 && bundle.testers.length <= 100,
    'The backend requires 1..100 active invites.');
  const ids = new Set();
  const codes = new Set();
  for (const tester of bundle.testers) {
    requireValue(validId(tester.id) && !ids.has(tester.id), 'Invalid or duplicate tester ID.');
    requireValue(typeof tester.code === 'string' && /^[A-Za-z0-9_-]{43}$/.test(tester.code)
      && !codes.has(tester.code), 'Invalid or duplicate private invite.');
    ids.add(tester.id);
    codes.add(tester.code);
  }
  requireValue(Array.isArray(bundle.retiredIds) && bundle.retiredIds.every((id) => validId(id) && !ids.has(id)),
    'Invalid retired tester IDs.');
  requireValue(Buffer.byteLength(JSON.stringify(bundle), 'utf8') <= 25 * 1024, 'Owner bundle exceeds the Key Vault secret size limit.');
  return bundle;
}

export function assertBundleUpdate(previous, next) {
  validateBundle(previous);
  validateBundle(next);
  requireValue(previous.signingKey === next.signingKey && previous.contactsPepper === next.contactsPepper,
    'Refusing accidental key regeneration. Recover the existing owner bundle before changing invites.');
  requireValue(previous.retiredIds.every((id) => next.retiredIds.includes(id))
    && previous.testers.every(({ id }) => next.testers.some((tester) => tester.id === id) || next.retiredIds.includes(id)),
  'The bundle would forget retired tester IDs. Recover the current bundle before editing it.');
}

export function createBundle(count = 1) {
  requireValue(Number.isInteger(count) && count >= 1 && count <= 100, 'Invite count must be between 1 and 100.');
  return validateBundle({
    schemaVersion: 1,
    signingKey: randomSecret(),
    contactsPepper: randomSecret(),
    testers: Array.from({ length: count }, (_, i) => ({ id: `tester-${i + 1}`, code: randomSecret() })),
    retiredIds: [],
  });
}

export function hashes(bundle) {
  return validateBundle(bundle).testers.map(({ id, code }) => ({
    id, codeHash: createHash('sha256').update(code, 'utf8').digest('hex'),
  }));
}

export function editBundle(bundle, action, id) {
  validateBundle(bundle);
  requireValue(validId(id), 'Tester IDs use 1..64 lowercase letters, digits, underscores, or hyphens.');
  const next = structuredClone(bundle);
  const existing = next.testers.find((tester) => tester.id === id);
  if (action === 'add') {
    requireValue(!existing && !next.retiredIds.includes(id), 'Do not reuse an active or retired tester ID for a new person.');
    next.testers.push({ id, code: randomSecret() });
  } else if (action === 'rotate') {
    requireValue(existing, 'Tester ID not found.');
    existing.code = randomSecret();
  } else if (action === 'remove') {
    requireValue(existing, 'Tester ID not found.');
    requireValue(next.testers.length > 1, 'Cannot remove the last invite. Stop the run, or add its replacement before removing it.');
    next.testers = next.testers.filter((tester) => tester.id !== id);
    next.retiredIds.push(id);
  } else {
    throw new Error('Unknown invite action.');
  }
  return validateBundle(next);
}

async function inspectParents(path) {
  let current = parse(path).root;
  for (const part of path.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part);
    const info = await lstat(current);
    requireValue(info.isDirectory() && !info.isSymbolicLink(), 'Secret output cannot traverse symlinks.');
    try {
      await lstat(join(current, '.git'));
      throw new Error('Owner secrets must be outside every Git checkout.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

export async function privatePath(path, { createDirectory = false } = {}) {
  requireValue(typeof path === 'string' && isAbsolute(path), 'Use an absolute owner-only path outside Git.');
  const target = resolve(path);
  requireValue(target !== ROOT && !target.startsWith(`${ROOT}/`), 'Owner secrets must not be stored in this repository.');
  const parent = dirname(target);
  if (createDirectory) {
    try { await lstat(parent); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await inspectParents(dirname(parent));
      await mkdir(parent, { mode: 0o700 });
    }
  }
  await inspectParents(parent);
  const info = await lstat(parent);
  requireValue((info.mode & 0o077) === 0 && info.uid === process.getuid(),
    'Use a directory owned by you with mode 0700; existing directory permissions are never changed automatically.');
  requireValue(await realpath(parent) === parent, 'Secret output cannot traverse symlinks.');
  return target;
}

export async function writePrivate(path, content, { replace = false } = {}) {
  const target = await privatePath(path, { createDirectory: true });
  if (!replace) {
    const file = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(content); } finally { await file.close(); }
    return;
  }
  await readPrivate(target);
  const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writePrivate(temporary, content);
    await rename(temporary, target);
  } finally {
    try { await unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export async function readPrivate(path) {
  const target = await privatePath(path);
  const info = await lstat(target);
  requireValue(info.isFile() && !info.isSymbolicLink() && info.uid === process.getuid() && (info.mode & 0o077) === 0,
    'Owner bundle must be a regular owner-only file (0600), not a symlink.');
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return await file.readFile('utf8'); } finally { await file.close(); }
}

export async function readBundle(path) {
  return parseBundle(await readPrivate(path));
}

export function parseBundle(text) {
  let bundle;
  try { bundle = JSON.parse(text); } catch {
    throw new Error('Owner bundle is not valid JSON. Its contents are not logged.');
  }
  return validateBundle(bundle);
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: 'string' }, file: { type: 'string' }, id: { type: 'string' }, count: { type: 'string' },
    },
  });
  const [action] = positionals;
  if (action === 'init') {
    await writePrivate(values.output, `${JSON.stringify(createBundle(Number(values.count ?? 1)), null, 2)}\n`);
    console.log('Created owner-only bundle. Read/copy it locally; do not paste it into logs or chat.');
    return;
  }
  const bundle = await readBundle(values.file);
  if (action === 'list') {
    console.log(bundle.testers.map(({ id }) => id).join('\n'));
  } else if (action === 'export-invite') {
    const tester = bundle.testers.find(({ id }) => id === values.id);
    requireValue(tester, 'Tester ID not found.');
    await writePrivate(values.output, `${tester.code}\n`);
    console.log('Wrote the selected invite to an owner-only file. Share through your private channel, not a URL.');
  } else {
    const updated = editBundle(bundle, action, values.id);
    await writePrivate(values.file, `${JSON.stringify(updated, null, 2)}\n`, { replace: true });
    console.log('Updated the private bundle. Publish it while TEST is off; stable IDs and signing keys were preserved.');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
