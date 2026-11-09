// Gera a pasta dist/ (site estático do app) sem dependências de build:
// remove os tipos do TypeScript com o módulo embutido do Node e junta tudo em um único app.js.
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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

async function buildInto(target) {
  await mkdir(join(target, 'vendor'), { recursive: true });
  for (const e of await readdir(join(root, 'web'))) if (!webScripts.includes(e)) await cp(join(root, 'web', e), join(target, e), { recursive: true });
  await writeFile(join(target, 'app.js'), bundle('app.js', modules));
  await cp(join(root, 'node_modules/sql.js/dist/sql-wasm.js'), join(target, 'vendor/sql-wasm.js'));
  await cp(join(root, 'node_modules/sql.js/dist/sql-wasm.wasm'), join(target, 'vendor/sql-wasm.wasm'));

  const files = [];
  for await (const f of walk(target)) {
    const rel = posixRel(target, f);
    if (rel !== 'sw.js') files.push(rel);
  }
  const sw = (await readFile(join(target, 'sw.js'), 'utf8'))
    .replace('__BUILD__', String(Date.now()))
    .replace('const APP_FILES = [];', `const APP_FILES = ${JSON.stringify(files)};`);
  await writeFile(join(target, 'sw.js'), sw);
  return files.length + 1;
}

// O Windows às vezes segura um arquivo do dist/ por alguns instantes (antivírus, navegador aberto).
// Uma nova tentativa curta resolve o EBUSY sem esconder um erro de verdade.
async function removeWithRetry(path) {
  for (let attempt = 0; ; attempt++) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (e) {
      if (attempt >= 4 || !['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(e?.code)) throw e;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

// Monta em uma pasta temporária e só troca no final: uma falha no meio deixa o dist/ anterior inteiro.
const staging = join(root, `.dist-build-${process.pid}`);
await rm(staging, { recursive: true, force: true });
try {
  const total = await buildInto(staging);
  await removeWithRetry(dist);
  await rename(staging, dist);
  console.log(`dist/ pronto: ${modules.size} módulos em 1 arquivo, ${total} arquivos no total`);
} finally {
  await rm(staging, { recursive: true, force: true }).catch(() => {});
}
