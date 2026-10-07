import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.ico': 'image/x-icon', '.png': 'image/png', '.json': 'application/json' };
const port = Number(process.argv[2] ?? 43817);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a loopback preview port between 1024 and 65535.');
const origin = `http://127.0.0.1:${port}`;

await stat(resolve(root, 'index.html'));

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', origin).pathname);
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!path.startsWith(`${root}${sep}`) || pathname.startsWith('/api/')) {
      response.writeHead(404).end('Not found. Browser tests must explicitly intercept API requests.');
      return;
    }
    const info = await stat(path);
    if (!info.isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    const stream = createReadStream(path);
    stream.on('error', (error) => {
      console.error('Static test server stream failure:', error.message);
      response.destroy(error);
    });
    stream.pipe(response);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      response.writeHead(404).end('Not found');
    } else {
      console.error('Static test server failure:', error);
      response.writeHead(500).end('Static test server error');
    }
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Static TEST client: ${origin}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { server.close(); server.closeAllConnections(); });
}
