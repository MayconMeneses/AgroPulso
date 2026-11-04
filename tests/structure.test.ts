import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

function* files(dir: string): Generator<string> {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

// RNF-AG-005 / CT-AG-016: sem arquivos gigantes. ~300 linhas é a orientação do spec; passar disso exige revisão, não corte mecânico.
test('nenhum arquivo de código passa de 300 linhas', () => {
  const alvo = ['src', 'web', 'scripts', 'tests'].flatMap((d) => [...files(d)]).filter((f) => /\.(ts|js|mjs|css|html)$/.test(f));
  assert.ok(alvo.length > 30);
  const grandes = alvo.map((f) => [f, readFileSync(f, 'utf8').split('\n').length] as const).filter(([, n]) => n > 300);
  assert.deepEqual(grandes, []);
});
