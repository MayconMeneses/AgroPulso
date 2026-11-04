import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { sha256Hex } from '../src/backup/codec.ts';
import { BackupError } from '../src/backup/errors.ts';
import { exportBackup } from '../src/backup/export.ts';
import { importBackup } from '../src/backup/import.ts';
import { createActivityType, listActivityTypes } from '../src/domain/activities.ts';
import { createCropType, listCropTypes } from '../src/domain/crop-types.ts';
import { openCycle } from '../src/domain/cycles.ts';
import { createFarm, listFarms } from '../src/domain/farms.ts';
import { recordEntry } from '../src/domain/financial.ts';
import { buildReport, toCsv } from '../src/reports/csv.ts';
import { freshDb } from './helpers.ts';

const SQL_TEXT = `x'); drop table farm; --`;

test('SEC: texto com SQL malicioso é gravado como texto e nada é executado', async () => {
  const db = await freshDb();
  const farm = await createFarm(db, { name: SQL_TEXT, timezone: 'America/Recife' });
  await createCropType(db, { name: "' or '1'='1" });
  await createActivityType(db, { name: `a"; delete from farm; --` });
  assert.equal((await listFarms(db))[0]?.name, SQL_TEXT);
  assert.equal((await listCropTypes(db)).length, 1);
  assert.equal((await listActivityTypes(db)).length, 1);
  const crop = (await listCropTypes(db))[0];
  const cycle = await openCycle(db, { farmId: farm.id, cropTypeId: crop?.id as string });
  await recordEntry(db, { farmId: farm.id, cycleId: cycle.id, kind: 'DESPESA', amountCents: 100, occurredOn: '2026-12-01', author: SQL_TEXT, counterparty: SQL_TEXT });
  assert.equal((await db.all('select count(*) as n from farm'))[0]?.n, 1);
});

test('SEC: relatório CSV neutraliza fórmula vinda de dados do usuário', async () => {
  const db = await freshDb();
  const farm = await createFarm(db, { name: 'S', timezone: 'America/Recife' });
  const crop = await createCropType(db, { name: 'M' });
  const cycle = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  await recordEntry(db, { farmId: farm.id, cycleId: cycle.id, kind: 'DESPESA', amountCents: 100, occurredOn: '2026-12-01', author: 'M', counterparty: '=cmd|\' /C calc\'!A0' });
  const csv = toCsv(await buildReport(db, { cycleId: cycle.id }));
  assert.ok(!/(^|;)=cmd/m.test(csv));
  assert.match(csv, /'=cmd/);
});

async function reSigned(file: string, edit: (outer: any, raw: string) => string): Promise<string> {
  const outer = JSON.parse(file);
  outer.payload = edit(outer, outer.payload);
  outer.sha256 = await sha256Hex(outer.payload);
  return JSON.stringify(outer);
}

test('SEC: backup forjado com __proto__ ou tabela maliciosa é recusado e nada global é poluído', async () => {
  const origem = await freshDb();
  await createFarm(origem, { name: 'S', timezone: 'America/Recife' });
  const arquivo = await exportBackup(origem);
  const destino = await freshDb();
  await createFarm(destino, { name: 'Antes', timezone: 'America/Bahia' });

  const proto = await reSigned(arquivo, (_o, raw) => raw.replace('"name":', '"__proto__":{"polluted":"sim"},"name":'));
  await assert.rejects(importBackup(destino, proto), (e: unknown) => e instanceof BackupError);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);

  const tabela = await reSigned(arquivo, (_o, raw) => {
    const p = JSON.parse(raw);
    p.tables['farm"; drop table farm; --'] = [];
    return JSON.stringify(p);
  });
  await assert.rejects(importBackup(destino, tabela), (e: unknown) => e instanceof BackupError && e.code === 'estrutura');
  assert.deepEqual((await listFarms(destino)).map((f) => f.name), ['Antes']);
});

test('SEC: backup com tipo de valor perigoso (objeto, lista, booleano) é recusado', async () => {
  const origem = await freshDb();
  await createFarm(origem, { name: 'S', timezone: 'America/Recife' });
  const arquivo = await exportBackup(origem);
  const destino = await freshDb();
  for (const valor of ['{"a":1}', '[1]', 'true']) {
    const ruim = await reSigned(arquivo, (_o, raw) => {
      const p = JSON.parse(raw);
      p.tables.farm[0].version = '__V__';
      return JSON.stringify(p).replace('"__V__"', valor);
    });
    await assert.rejects(importBackup(destino, ruim), (e: unknown) => e instanceof BackupError);
  }
  assert.equal((await listFarms(destino)).length, 0);
});

function* files(dir: string): Generator<string> {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

test('SEC: nenhum código do app usa eval, innerHTML ou escreve HTML a partir de dados', () => {
  const alvo = [...files('src'), ...files('web')].filter((f) => /\.(ts|js|html)$/.test(f));
  assert.ok(alvo.length > 20);
  for (const f of alvo) {
    const txt = readFileSync(f, 'utf8');
    assert.doesNotMatch(txt, /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|\beval\(|new Function\(|document\.write/, f);
  }
});

test('SEC: página tem política de conteúdo (CSP) restritiva e sem scripts de terceiros', () => {
  const html = readFileSync('web/index.html', 'utf8');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /connect-src 'self'/);
  // Só dois serviços externos, ambos opcionais e acionados por botão: previsão (Open-Meteo) e quadros do mapa (OpenStreetMap)
  assert.equal(/connect-src ([^;]+)/.exec(csp)?.[1], "'self' https://api.open-meteo.com");
  assert.equal(/img-src ([^;]+)/.exec(csp)?.[1], "'self' https://tile.openstreetmap.org");
  for (const d of ["frame-src 'none'", "media-src 'none'", "require-trusted-types-for 'script'", 'trusted-types agropulso', 'upgrade-insecure-requests', "base-uri 'none'", "form-action 'none'"]) assert.ok(csp.includes(d), d);
  assert.ok(html.includes('<script src="guard.js"></script>'), 'a guarda anti-moldura roda no <head>');
  assert.match(readFileSync('web/styles.css', 'utf8'), /html:not\(\.live\) body \{ visibility: hidden; \}/);
  assert.doesNotMatch(csp, /default-src[^;]*https?:|script-src[^;]*https?:|style-src[^;]*https?:/);
  // 'wasm-unsafe-eval' é exigido só para carregar o SQLite em WebAssembly; 'unsafe-eval' e 'unsafe-inline' ficam proibidos
  assert.doesNotMatch(csp, /'unsafe-inline'|'unsafe-eval'/);
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
  assert.doesNotMatch(html, /onclick=|onload=/);
});

test('SEC: guarda anti-moldura só libera a página quando ela não está dentro de outro site', () => {
  const code = readFileSync('web/guard.js', 'utf8');
  const run = (win: Record<string, unknown>) => {
    const doc = { documentElement: { className: '' } };
    new Function('window', 'document', code)(win, doc);
    return doc.documentElement.className.includes('live');
  };
  const self: Record<string, unknown> = { location: { href: 'https://x/' } };
  self.self = self;
  self.top = self;
  assert.equal(run(self), true, 'página no topo: liberada');
  const emMoldura: Record<string, unknown> = { location: { href: 'https://x/' }, top: { location: {} } };
  emMoldura.self = emMoldura;
  assert.equal(run(emMoldura), false, 'dentro de moldura: continua escondida');
  const bloqueada: Record<string, unknown> = { location: { href: 'https://x/' } };
  bloqueada.self = bloqueada;
  Object.defineProperty(bloqueada, 'top', { get() { throw new Error('acesso bloqueado entre origens'); } });
  assert.equal(run(bloqueada), false, 'sem acesso ao topo: trata como moldura');
});
