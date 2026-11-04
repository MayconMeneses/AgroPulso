// Gera a pasta dist/ (site estático do app) sem dependências de build:
// remove os tipos do TypeScript com o módulo embutido do Node e junta tudo em um único app.js.
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from './bundle.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const posixRel = (from, to) => relative(from, to).replaceAll('\\', '/');

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

// Módulos em memória: src/*.ts viram app/*.js; os arquivos de tela de web/*.js entram como estão.
const modules = new Map();
for await (const file of walk(join(root, 'src'))) {
  if (!file.endsWith('.ts') || file.endsWith('node-sqlite.ts')) continue; // o adaptador do Node não vai para o navegador
  const js = stripTypeScriptTypes(await readFile(file, 'utf8')).replace(/(from\s+['"][^'"]+)\.ts(['"])/g, '$1.js$2');
  modules.set(`app/${posixRel(join(root, 'src'), file).replace(/\.ts$/, '.js')}`, js);
}
const webScripts = [];
for (const e of await readdir(join(root, 'web'))) {
  if (e.endsWith('.js') && e !== 'sw.js' && e !== 'guard.js') {
    modules.set(e, await readFile(join(root, 'web', e), 'utf8'));
    webScripts.push(e);
  }
}

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'vendor'), { recursive: true });
for (const e of await readdir(join(root, 'web'))) if (!webScripts.includes(e)) await cp(join(root, 'web', e), join(dist, e), { recursive: true });
await writeFile(join(dist, 'app.js'), bundle('app.js', modules));
await cp(join(root, 'node_modules/sql.js/dist/sql-wasm.js'), join(dist, 'vendor/sql-wasm.js'));
await cp(join(root, 'node_modules/sql.js/dist/sql-wasm.wasm'), join(dist, 'vendor/sql-wasm.wasm'));

const files = [];
for await (const f of walk(dist)) {
  const rel = posixRel(dist, f);
  if (rel !== 'sw.js') files.push(rel);
}
const sw = (await readFile(join(dist, 'sw.js'), 'utf8'))
  .replace('__BUILD__', String(Date.now()))
  .replace('const APP_FILES = [];', `const APP_FILES = ${JSON.stringify(files)};`);
await writeFile(join(dist, 'sw.js'), sw);
console.log(`dist/ pronto: ${modules.size} módulos em 1 arquivo, ${files.length + 1} arquivos no total`);
