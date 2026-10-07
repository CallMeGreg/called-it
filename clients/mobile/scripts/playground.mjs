import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { serveStatic } from './static-server.mjs';

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--port')) {
  throw new Error('Usage: npm run playground -- [--port 43819]');
}
const port = Number(args[1] ?? 43819);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a loopback port between 1024 and 65535.');
const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
console.log('Building LOCAL PLAYGROUND. No backend, Azure, invite code, or real authentication is used.');
const builder = spawn(process.execPath, [
  require.resolve('expo/bin/cli'), 'export', '--platform', 'web', '--dev', '--output-dir', '.playground-dist',
], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    CI: '1',
    EXPO_OFFLINE: '1',
    EXPO_NO_TELEMETRY: '1',
    EXPO_NO_DOTENV: '1',
    EXPO_PUBLIC_API_BASE_URL: '',
    EXPO_PUBLIC_LOCAL_PLAYGROUND: '1',
  },
});
await new Promise((ready, reject) => {
  builder.once('error', reject);
  builder.once('exit', (code, signal) => code === 0 ? ready() : reject(new Error(`Playground build failed (${signal ?? code}).`)));
});
await serveStatic(fileURLToPath(new URL('../.playground-dist', import.meta.url)), port, true);
