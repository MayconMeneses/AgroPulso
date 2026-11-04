import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCropType } from '../src/domain/crop-types.ts';
import { openCycle } from '../src/domain/cycles.ts';
import { COMMON_CATEGORIES, COMMON_UNITS, addCommonCategoriesAndUnits } from '../src/domain/defaults.ts';
import { createFarm } from '../src/domain/farms.ts';
import { createCostCategory, listCostCategories } from '../src/domain/financial.ts';
import { createWorker, recordWork } from '../src/domain/labor.ts';
import { createUnit, listUnits } from '../src/domain/units.ts';
import { buildLaborReport } from '../src/reports/labor.ts';
import { csvCell, toCsv } from '../src/reports/csv.ts';
import { reportLines, toPdf } from '../src/reports/pdf.ts';
import { voidWork } from '../src/domain/labor.ts';
import { freshDb } from './helpers.ts';

test('categorias e unidades comuns: oferecidas uma vez, sem repetir nome existente e sem nenhum fator de conversão', async () => {
  const db = await freshDb();
  await createUnit(db, { name: 'KG', kind: 'massa' });
  await createCostCategory(db, { name: 'mão de obra' });
  const r = await addCommonCategoriesAndUnits(db);
  assert.equal(r.units, COMMON_UNITS.length - 1);
  assert.equal(r.categories, COMMON_CATEGORIES.length - 1);
  assert.equal((await listUnits(db)).length, COMMON_UNITS.length);
  assert.equal((await listCostCategories(db)).length, COMMON_CATEGORIES.length);
  assert.equal((await listUnits(db)).filter((u) => u.name.toLowerCase() === 'kg').length, 1);
  assert.equal(Number((await db.all('select count(*) as n from unit_conversion'))[0]?.n), 0);
  assert.deepEqual(await addCommonCategoriesAndUnits(db), { categories: 0, units: 0 });
  assert.equal((await listUnits(db)).length, COMMON_UNITS.length);
});

test('unidades comuns têm o tipo certo (saca é peso; tarefa e hectare são área)', () => {
  const kinds = Object.fromEntries(COMMON_UNITS);
  assert.equal(kinds.saca, 'massa');
  assert.equal(kinds.tarefa, 'area');
  assert.equal(kinds.hectare, 'area');
  assert.equal(kinds.litro, 'volume');
});

test('a categoria "Mão de obra" oferecida é a que o trabalho usa na despesa', async () => {
  const db = await freshDb();
  await addCommonCategoriesAndUnits(db);
  const farm = await createFarm(db, { name: 'Sítio', timezone: 'America/Recife' });
  const crop = await createCropType(db, { name: 'Milho' });
  const cycle = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  const w = await createWorker(db, { farmId: farm.id, name: 'João', kind: 'CONTRATADO', payType: 'DIARIA', rateCents: 10_000 });
  await recordWork(db, { workerId: w.id, cycleId: cycle.id, occurredOn: '2026-12-10', daysMicro: 1_000_000, author: 'Ana' });
  const row = (await db.all('select k.name from financial_entry e join cost_category k on k.id = e.category_id'))[0];
  assert.equal(row?.name, 'Mão de obra');
});

test('relatório de mão de obra por pessoa: resumo, linhas do período, anulados fora, PDF e CSV seguros', async () => {
  const db = await freshDb();
  const farm = await createFarm(db, { name: 'Sítio', timezone: 'America/Recife' });
  const crop = await createCropType(db, { name: 'Milho' });
  const cycle = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  const joao = await createWorker(db, { farmId: farm.id, name: 'João', kind: 'CONTRATADO', payType: 'DIARIA', rateCents: 15_000 });
  const filho = await createWorker(db, { farmId: farm.id, name: '=HYPERLINK("x")', kind: 'FAMILIAR', payType: 'MENSAL', rateCents: 100_000 });
  const pai = await createWorker(db, { farmId: farm.id, name: 'Pai', kind: 'FAMILIAR', payType: 'DIARIA' });
  await recordWork(db, { workerId: joao.id, cycleId: cycle.id, occurredOn: '2026-12-10', daysMicro: 2_500_000, author: 'Ana' });
  await recordWork(db, { workerId: joao.id, cycleId: cycle.id, occurredOn: '2027-01-10', daysMicro: 1_000_000, author: 'Ana' });
  const errado = await recordWork(db, { workerId: joao.id, cycleId: cycle.id, occurredOn: '2027-01-11', daysMicro: 1_000_000, author: 'Ana' });
  await voidWork(db, errado.id, 'errado');
  await recordWork(db, { workerId: filho.id, cycleId: cycle.id, occurredOn: '2026-12-12', sharePercent: 50, author: 'Ana' });
  await recordWork(db, { workerId: pai.id, cycleId: cycle.id, occurredOn: '2026-12-12', daysMicro: 2_000_000, author: 'Ana' });

  const all = await buildLaborReport(db, { cycleId: cycle.id });
  assert.equal(all.rows.length, 4);
  assert.ok(all.summary.some(([k, v]) => k.startsWith('João') && v.includes('3,5 dia(s)') && v.includes('525,00')));
  assert.ok(all.summary.some(([k, v]) => k.startsWith('Mão de obra contratada') && v.includes('525,00')));
  assert.ok(all.summary.some(([k, v]) => k.startsWith('Mão de obra da família') && v.includes('500,00')));
  assert.ok(all.warnings.some((w) => /sem valor cadastrado/.test(w)));
  assert.ok(all.excluded.some((x) => /1 registro/.test(x)));
  const dez = await buildLaborReport(db, { cycleId: cycle.id, from: '2026-12-01', to: '2026-12-31' });
  assert.equal(dez.rows.length, 3);
  assert.ok(dez.summary.some(([k]) => k.startsWith('João')), 'o resumo cobre a safra inteira');

  const pdf = toPdf(all);
  assert.equal(String.fromCharCode(...pdf.slice(0, 5)), '%PDF-');
  assert.ok(reportLines(all).some((l) => l.includes('mão de obra por pessoa')));
  const csv = toCsv(all);
  assert.ok(csv.includes("'=HYPERLINK("), 'o nome com fórmula aparece com apóstrofo na frente');
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.ok(!csv.split('\r\n').some((l) => l.includes(';=HYPERLINK') || l.startsWith('=HYPERLINK')), 'fórmula neutralizada');
});
