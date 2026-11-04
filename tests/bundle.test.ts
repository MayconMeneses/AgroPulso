import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bundle } from '../scripts/bundle.mjs';

async function run(code: string): Promise<Record<string, unknown>> {
  const url = `data:text/javascript;base64,${Buffer.from(`${code}\nexport { __mods };`).toString('base64')}`;
  return (await import(url)).__mods as Record<string, unknown>;
}

test('bundle: roda dependências antes, resolve caminhos relativos e isola nomes iguais', async () => {
  const m = new Map([
    ['main.js', "import { soma } from './lib/a.js';\nimport { dobro as d } from './lib/b.js';\nexport const total = d(soma(1, 2));"],
    ['lib/a.js', "import { util } from './u.js';\nconst nome = 'a';\nexport function soma(x, y) { return util(x + y, nome); }"],
    ['lib/b.js', "const nome = 'b';\nexport async function dobro(x) { return x * 2 + nome.length; }"],
    ['lib/u.js', 'export const util = (v) => v;'],
  ]);
  const mods = (await run(bundle('main.js', m))) as Record<string, Record<string, unknown>>;
  assert.equal(typeof mods['main.js']?.total, 'object'); // dobro é async: devolve Promise
  assert.equal(await (mods['main.js']?.total as Promise<number>), 7);
  assert.deepEqual(Object.keys(mods), ['lib/u.js', 'lib/a.js', 'lib/b.js', 'main.js']);
});

test('bundle: dependência circular, módulo ausente e forma não suportada falham o build', () => {
  assert.throws(() => bundle('a.js', new Map([['a.js', "import { y } from './b.js';\nexport const x = 1;"], ['b.js', "import { x } from './a.js';\nexport const y = 2;"]])), /circular/);
  assert.throws(() => bundle('a.js', new Map([['a.js', "import { y } from './nao.js';"]])), /não encontrado/);
  assert.throws(() => bundle('a.js', new Map([['a.js', 'const x = 1;\nexport { x };']])), /não suportada/);
  assert.throws(() => bundle('a.js', new Map([['a.js', "import * as z from './b.js';"], ['b.js', '']])), /não suportada/);
});
