import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// As telas (web/*.js) e o pacote final não passam por compilador: um erro de sintaxe só aparecia ao abrir o app no navegador
// (tela travada em "Carregando..."). Estes testes pegam isso antes de publicar.

test('HARD: todo arquivo de tela em web/ tem sintaxe válida', () => {
  const bad: string[] = [];
  for (const f of readdirSync('web').filter((n) => n.endsWith('.js'))) {
    const r = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: readFileSync(join('web', f)), encoding: 'utf8' });
    if (r.status !== 0) bad.push(`${f}: ${r.stderr.split('\n').find((l) => /Error/.test(l)) ?? 'erro'}`);
  }
  assert.deepEqual(bad, []);
});

test('HARD: o pacote final (dist/app.js) montado pelo build tem sintaxe válida', () => {
  const build = spawnSync(process.execPath, ['scripts/build.mjs'], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const r = spawnSync(process.execPath, ['--check', 'dist/app.js'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
