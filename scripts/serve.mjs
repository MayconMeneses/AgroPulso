// Servidor estático mínimo para ver dist/ no navegador durante o desenvolvimento (localhost).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const port = Number(process.env.PORT ?? 5173);

createServer(async (req, res) => {
  let path;
  try {
    path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^([/\\])+/, '');
  } catch {
    res.writeHead(400).end(); // endereço com % quebrado: antes derrubava o servidor
    return;
  }
  const file = join(dist, path === '' ? 'index.html' : path);
  if (file !== dist && !file.startsWith(dist + sep)) { res.writeHead(403).end(); return; } // dist + sep: não deixa sair para pastas vizinhas como dist2
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Página não encontrada');
  }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`));
