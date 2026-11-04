import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createActivityType, recordActivity } from '../src/domain/activities.ts';
import { createCropType } from '../src/domain/crop-types.ts';
import { openCycle, planCycle, startCycle } from '../src/domain/cycles.ts';
import { createFarm } from '../src/domain/farms.ts';
import { recordEntry } from '../src/domain/financial.ts';
import { recordHarvest, recordSale } from '../src/domain/production.ts';
import { createUnit } from '../src/domain/units.ts';
import { buildReport, csvCell, toCsv } from '../src/reports/csv.ts';
import { dashboard } from '../src/reports/dashboard.ts';
import { reportLines, toPdf } from '../src/reports/pdf.ts';
import { freshDb } from './helpers.ts';

async function setup() {
  const db = await freshDb();
  const farm = await createFarm(db, { name: 'Sítio Água Branca', timezone: 'America/Recife' });
  const crop = await createCropType(db, { name: 'Mandioca' });
  const saca = await createUnit(db, { name: 'saca', kind: 'massa' });
  let c = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  c = await planCycle(db, c.id, c.version, { plannedStart: '2026-12-01', plannedEnd: '2027-03-01' });
  c = await startCycle(db, c.id, c.version, { actualStart: '2026-12-05' });
  const tipo = await createActivityType(db, { name: 'Plantio' });
  await recordEntry(db, { farmId: farm.id, cycleId: c.id, kind: 'DESPESA', amountCents: 150_075, occurredOn: '2026-12-06', author: 'M', counterparty: '=HYPERLINK("http://x")' });
  await recordEntry(db, { farmId: farm.id, cycleId: c.id, kind: 'DESPESA', amountCents: 9_900, occurredOn: '2027-01-15', author: 'M' });
  await recordHarvest(db, { cycleId: c.id, harvestedOn: '2027-02-01', quantityMicro: 12_500_000, unitId: saca.id, author: 'M' });
  await recordSale(db, { cycleId: c.id, soldOn: '2027-02-10', quantityMicro: 4_000_000, unitId: saca.id, amountCents: 400_000, buyer: 'Feira; "central"', author: 'M' });
  await recordActivity(db, { cycleId: c.id, typeId: tipo.id, occurredOn: '2027-03-01', author: 'M', state: 'PLANEJADA' });
  return { db, farm, c };
}

test('célula de CSV neutraliza fórmula e escapa aspas e ponto e vírgula', () => {
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('@soma'), "'@soma");
  assert.equal(csvCell('a;b'), '"a;b"');
  assert.equal(csvCell('diz "oi"'), '"diz ""oi"""');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell('normal'), 'normal');
});

test('CSV repete filtros, unidades, avisos e o que ficou fora; respeita o período', async () => {
  const { db, c } = await setup();
  const csv = toCsv(await buildReport(db, { cycleId: c.id, from: '2027-01-01', to: '2027-02-28' }));
  assert.ok(csv.startsWith('﻿'));
  assert.match(csv, /período 2027-01-01 a 2027-02-28/);
  assert.match(csv, /Resultado parcial/);
  assert.match(csv, /Colhido \(saca\);12,5/);
  assert.match(csv, /saca/);
  assert.match(csv, /2027-01-15/);
  assert.doesNotMatch(csv, /2026-12-06/); // fora do período
  assert.doesNotMatch(csv, /;=HYPERLINK/); // fórmula neutralizada
  assert.match(csv, /"Feira; ""central"""/);
  const todos = toCsv(await buildReport(db, { cycleId: c.id }));
  assert.match(todos, /2026-12-06/);
  assert.match(todos, /'=HYPERLINK/);
});

test('resumo do relatório bate com a soma dos registros', async () => {
  const { db, c } = await setup();
  const r = await buildReport(db, { cycleId: c.id });
  const custo = r.summary.find(([k]) => k.startsWith('Custo registrado'));
  assert.equal(custo?.[1], 'R$ 1.599,75');
  const resultado = r.summary.find(([k]) => k.startsWith('Resultado parcial'));
  assert.equal(resultado?.[1], 'R$ 2.400,25');
});

test('PDF tem estrutura válida (xref confere) e texto com acentos', async () => {
  const { db, c } = await setup();
  const data = await buildReport(db, { cycleId: c.id });
  const bytes = toPdf(data);
  const txt = Buffer.from(bytes).toString('latin1');
  assert.ok(txt.startsWith('%PDF-1.4'));
  assert.ok(txt.trimEnd().endsWith('%%EOF'));
  const start = Number(/startxref\n(\d+)/.exec(txt)?.[1]);
  assert.equal(txt.slice(start, start + 4), 'xref');
  const offsets = [...txt.slice(start).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  offsets.forEach((o, i) => assert.equal(txt.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
  assert.ok(reportLines(data).some((l) => l.includes('Sítio Água Branca')));
  assert.ok(txt.includes('S\xedtio')); // í em Latin-1
});

test('PDF com muitas linhas vira várias páginas', async () => {
  const { db, c } = await setup();
  const data = await buildReport(db, { cycleId: c.id });
  for (let i = 0; i < 200; i++) data.rows.push({ ...(data.rows[0] as (typeof data.rows)[number]) });
  const txt = Buffer.from(toPdf(data)).toString('latin1');
  assert.ok(Number(/\/Count (\d+)/.exec(txt)?.[1]) >= 3);
});

test('painel: safras ativas, pendências, a receber e evolução por mês; só leitura', async () => {
  const { db, c } = await setup();
  const antes = (await db.all('select count(*) as n from audit_event'))[0]?.n;
  const d = await dashboard(db);
  assert.equal(d.activeCycles.length, 1);
  assert.equal(d.activeCycles[0]?.cycleId, c.id);
  assert.equal(d.pendingActivities.length, 1);
  assert.equal(d.salesToReceiveCents, 400_000);
  assert.deepEqual(d.monthly, [
    { month: '2026-12', expensesCents: 150_075, salesCents: 0 },
    { month: '2027-01', expensesCents: 9_900, salesCents: 0 },
    { month: '2027-02', expensesCents: 0, salesCents: 400_000 },
  ]);
  assert.equal((await db.all('select count(*) as n from audit_event'))[0]?.n, antes);
});
