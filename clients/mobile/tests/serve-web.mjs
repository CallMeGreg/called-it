import { fileURLToPath } from 'node:url';

import { serveStatic } from '../scripts/static-server.mjs';

await serveStatic(fileURLToPath(new URL('../dist', import.meta.url)), Number(process.argv[2] ?? 43817));
