// Serves the static web export with a single-page fallback, the way Vercel
// does in production: /direction and /ma-cross resolve to their HTML files,
// anything unknown to index.html.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };

async function resolve(url) {
  const path = normalize(decodeURIComponent(url.split('?')[0]));
  for (const candidate of [path, `${path}.html`, join(path, 'index.html')]) {
    const full = join(root, candidate);
    try {
      if ((await stat(full)).isFile()) return full;
    } catch {}
  }
  return join(root, 'index.html');
}

createServer(async (req, res) => {
  const file = await resolve(req.url ?? '/');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(Number(process.env.PORT ?? 8092));
