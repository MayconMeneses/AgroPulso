import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

// Estas verificações guardam o que a auditoria de segurança corrigiu, para não voltar sem ninguém perceber.

test('HARD: toda ação do GitHub Actions está presa a um commit exato (40 caracteres), nunca a uma tag que pode mudar', () => {
  const dir = '.github/workflows';
  const files = readdirSync(dir).filter((f) => f.endsWith('.yml'));
  assert.ok(files.length >= 2);
  for (const f of files) {
    const text = readFileSync(`${dir}/${f}`, 'utf8');
    for (const m of text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
      assert.match(m[1] as string, /@[0-9a-f]{40}$/, `${f}: ${m[1]}`);
    }
    assert.match(text, /^permissions:\s*\{\}\s*$/m, `${f}: permissões começam vazias`);
  }
});

test('HARD: o publicador não dá permissão de escrita ao job que roda o código do projeto', () => {
  const text = readFileSync('.github/workflows/pages.yml', 'utf8');
  const build = text.slice(text.indexOf('  build:'), text.indexOf('  deploy:'));
  assert.match(build, /contents: read/);
  assert.doesNotMatch(build, /pages: write|id-token: write/);
  assert.match(build, /persist-credentials: false/);
  assert.match(build, /npm ci --ignore-scripts/);
  assert.match(build, /npm audit/);
});

test('HARD: segredos e arquivos locais não são versionados', () => {
  const ignore = readFileSync('.gitignore', 'utf8');
  for (const item of ['node_modules/', '.env', '*.sqlite', '*.pdf', 'dist/', '.claude/']) assert.ok(ignore.split(/\r?\n/).includes(item), item);
});

test('HARD: páginas do app: 404 própria, robots, security.txt e sem indexação', () => {
  assert.ok(existsSync('web/404.html'));
  assert.match(readFileSync('web/404.html', 'utf8'), /default-src 'none'/);
  assert.match(readFileSync('web/robots.txt', 'utf8'), /Disallow: \//);
  const sec = readFileSync('web/.well-known/security.txt', 'utf8');
  assert.match(sec, /^Contact: https:\/\//m);
  assert.match(sec, /^Expires: /m);
  assert.match(readFileSync('web/index.html', 'utf8'), /<meta name="robots" content="noindex, nofollow">/);
});

test('HARD: o código do app não tem sinais de armadilha: eval, innerHTML, document.write, console.log, segredo no texto', () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  const files = [...walk('src'), ...readdirSync('web').filter((f) => f.endsWith('.js')).map((f) => `web/${f}`)];
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    assert.doesNotMatch(t, /\beval\(|new Function\(|\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|console\.log\(/, f);
    assert.doesNotMatch(t, /(api[_-]?key|secret|passw(or)?d)\s*[:=]\s*['"][^'"]{6,}/i, f);
  }
});

test('HARD: nomes têm teto de tamanho em todos os cadastros', async () => {
  const { freshDb } = await import('./helpers.ts');
  const { createFarm } = await import('../src/domain/farms.ts');
  const { createCropType } = await import('../src/domain/crop-types.ts');
  const { createUnit } = await import('../src/domain/units.ts');
  const { createCostCategory } = await import('../src/domain/financial.ts');
  const { createActivityType } = await import('../src/domain/activities.ts');
  const { createPlot } = await import('../src/domain/plots.ts');
  const { createWorker } = await import('../src/domain/labor.ts');
  const { createStockItem } = await import('../src/domain/stock.ts');
  const db = await freshDb();
  const longo = 'x'.repeat(81);
  const ok = 'x'.repeat(80);
  const farm = await createFarm(db, { name: ok, timezone: 'America/Recife' });
  const kg = await createUnit(db, { name: 'kg', kind: 'massa' });
  const recusa = (p: Promise<unknown>) => assert.rejects(p, (e: { code?: string }) => e.code === 'invalido');
  await recusa(createFarm(db, { name: longo, timezone: 'America/Recife' }));
  await recusa(createCropType(db, { name: longo }));
  await recusa(createUnit(db, { name: longo, kind: 'massa' }));
  await recusa(createCostCategory(db, { name: longo }));
  await recusa(createActivityType(db, { name: longo }));
  await recusa(createPlot(db, { farmId: farm.id, name: longo }));
  await recusa(createWorker(db, { farmId: farm.id, name: longo, kind: 'FAMILIAR', payType: 'DIARIA' }));
  await recusa(createStockItem(db, { farmId: farm.id, name: longo, unitId: kg.id }));
  await createCropType(db, { name: ok });
});
