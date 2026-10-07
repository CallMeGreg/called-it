import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

export async function serveStatic(directory, port, restrictConnections = false) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a loopback port between 1024 and 65535.');
  const root = resolve(directory);
  const origin = `http://127.0.0.1:${port}`;
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.ico': 'image/x-icon', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
  await stat(resolve(root, 'index.html'));

  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (restrictConnections) response.setHeader('Content-Security-Policy', "connect-src 'none'; form-action 'none'; base-uri 'none'");
    if (restrictConnections && ![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(request.headers.host?.toLowerCase() ?? '')) {
      response.writeHead(403).end('LOCAL PLAYGROUND only accepts literal loopback hosts.');
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', origin).pathname);
      const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!path.startsWith(`${root}${sep}`) || pathname.startsWith('/api/')) {
        response.writeHead(404).end('This loopback server serves static files only. No API is connected.');
        return;
      }
      const info = await stat(path);
      if (!info.isFile()) {
        response.writeHead(404).end('Not found');
        return;
      }
      response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' });
      const stream = createReadStream(path);
      stream.on('error', (error) => {
        console.error('Local static server stream failure:', error.message);
        response.destroy(error);
      });
      stream.pipe(response);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        response.writeHead(404).end('Not found');
      } else {
        console.error('Local static server failure:', error);
        response.writeHead(500).end('Local static server error');
      }
    }
  });

  await new Promise((ready, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => ready());
  });
  console.log(`${restrictConnections ? 'LOCAL PLAYGROUND (no backend)' : 'Static TEST client'}: ${origin}`);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { server.close(); server.closeAllConnections(); });
  }
  return server;
}
