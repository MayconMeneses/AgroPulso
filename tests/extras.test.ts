import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createActivityType, recordActivity } from '../src/domain/activities.ts';
import { addAttachment, listAttachments, removeAttachment } from '../src/domain/attachments.ts';
import { eventsFor } from '../src/domain/audit.ts';
import { createCropType } from '../src/domain/crop-types.ts';
import { cancelCycle, openCycle } from '../src/domain/cycles.ts';
import { DomainError } from '../src/domain/errors.ts';
import { createFarm } from '../src/domain/farms.ts';
import { correctEntry, getEntry, listCycleEntries, recordEntry, voidEntry } from '../src/domain/financial.ts';
import { areaHectares, fromPct, gridFor, toPct } from '../src/domain/geo.ts';
import { createPlot, getPlot, setPlotOutline } from '../src/domain/plots.ts';
import { recordHarvest, recordSale, setHarvestEstimate } from '../src/domain/production.ts';
import { cycleResult } from '../src/domain/results.ts';
import { createUnit } from '../src/domain/units.ts';
import { buildReport, toCsv } from '../src/reports/csv.ts';
import { dashboard } from '../src/reports/dashboard.ts';
import { freshDb } from './helpers.ts';

const KG = 1_000_000;
async function rejectsWith(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof DomainError && e.code === code);
}

async function setup() {
  const db = await freshDb();
  const farm = await createFarm(db, { name: 'Sítio', timezone: 'America/Recife' });
  const crop = await createCropType(db, { name: 'Milho' });
  const kg = await createUnit(db, { name: 'kg', kind: 'massa' });
  const saca = await createUnit(db, { name: 'saca', kind: 'massa' });
  const cycle = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  return { db, farm, crop, kg, saca, cycle };
}

test('anular despesa: sai das contas, do painel e do CSV, mas o histórico fica', async () => {
  const { db, farm, cycle } = await setup();
  const keep = await recordEntry(db, { farmId: farm.id, cycleId: cycle.id, kind: 'DESPESA', amountCents: 10_000, occurredOn: '2026-12-01', author: 'Ana' });
  const gone = await recordEntry(db, { farmId: farm.id, cycleId: cycle.id, kind: 'DESPESA', amountCents: 5_000, occurredOn: '2026-12-02', author: 'Ana' });
  assert.equal((await cycleResult(db, cycle.id)).custoRegistradoCents, 15_000);
  assert.equal((await dashboard(db)).monthly[0]?.expensesCents, 15_000);
  await rejectsWith(voidEntry(db, gone.id, gone.version, '  '), 'invalido');
  await voidEntry(db, gone.id, gone.version, 'lançado em duplicidade');
  assert.equal((await cycleResult(db, cycle.id)).custoRegistradoCents, 10_000);
  assert.equal((await dashboard(db)).monthly[0]?.expensesCents, 10_000);
  assert.ok(!toCsv(await buildReport(db, { cycleId: cycle.id })).includes('50,00'));
  const rows = await listCycleEntries(db, cycle.id);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.id === gone.id)?.voidReason, 'lançado em duplicidade');
  assert.equal(rows.find((r) => r.id === keep.id)?.voidedAt, null);
  const ev = (await eventsFor(db, 'financial_entry', gone.id)).find((e) => e.type === 'expense.voided');
  assert.equal(ev?.reason, 'lançado em duplicidade');
  assert.equal(JSON.parse(String(ev?.before_json)).amountCents, 5_000);
  const g = (await getEntry(db, gone.id)) as { version: number };
  await rejectsWith(voidEntry(db, gone.id, g.version, 'de novo'), 'transicao_invalida');
  await rejectsWith(correctEntry(db, gone.id, g.version, { amountCents: 1, justification: 'x' }), 'transicao_invalida');
});

test('anular: conflito de versão recusado; em safra encerrada o motivo serve de justificativa', async () => {
  const { db, farm, cycle } = await setup();
  const e = await recordEntry(db, { farmId: farm.id, cycleId: cycle.id, kind: 'DESPESA', amountCents: 100, occurredOn: '2026-12-01', author: 'Ana' });
  await rejectsWith(voidEntry(db, e.id, e.version + 5, 'x'), 'conflito_de_versao');
  await cancelCycle(db, cycle.id, cycle.version, { reason: 'seca' });
  await voidEntry(db, e.id, e.version, 'foi lançada na safra errada');
  assert.equal((await cycleResult(db, cycle.id)).custoRegistradoCents, 0);
});

test('remover anexo: o arquivo some, o registro de que existiu fica', async () => {
  const { db, cycle } = await setup();
  const t = await createActivityType(db, { name: 'Plantio' });
  const a = await recordActivity(db, { cycleId: cycle.id, typeId: t.id, occurredOn: '2026-12-01', author: 'Ana' });
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const att = await addAttachment(db, { activityId: a.id, name: 'foto.png', bytes: png });
  await rejectsWith(removeAttachment(db, att.id, ''), 'invalido');
  await rejectsWith(removeAttachment(db, 'nao-existe', 'x'), 'nao_encontrado');
  await removeAttachment(db, att.id, 'foto errada');
  assert.equal((await listAttachments(db, a.id)).length, 0);
  const ev = (await eventsFor(db, 'attachment', att.id)).find((e) => e.type === 'attachment.removed');
  assert.equal(ev?.reason, 'foto errada');
  assert.equal(JSON.parse(String(ev?.before_json)).name, 'foto.png');
});

test('avisos: colheita acima da estimativa e venda acima da colheita (só avisam, nunca bloqueiam)', async () => {
  const { db, cycle, kg, saca } = await setup();
  await setHarvestEstimate(db, cycle.id, cycle.version, { quantityMicro: 100 * KG, unitId: kg.id });
  const h1 = await recordHarvest(db, { cycleId: cycle.id, harvestedOn: '2027-03-01', quantityMicro: 80 * KG, unitId: kg.id, author: 'Ana' });
  assert.equal(h1.warning, null);
  const h2 = await recordHarvest(db, { cycleId: cycle.id, harvestedOn: '2027-03-02', quantityMicro: 30 * KG, unitId: kg.id, author: 'Ana' });
  assert.match(String(h2.warning), /passou da sua estimativa/);
  const s1 = await recordSale(db, { cycleId: cycle.id, soldOn: '2027-03-05', quantityMicro: 110 * KG, unitId: kg.id, amountCents: 5_000, author: 'Ana' });
  assert.equal(s1.warning, null);
  const s2 = await recordSale(db, { cycleId: cycle.id, soldOn: '2027-03-06', quantityMicro: 5 * KG, unitId: kg.id, amountCents: 300, author: 'Ana' });
  assert.match(String(s2.warning), /vendeu mais/);
  await recordSale(db, { cycleId: cycle.id, soldOn: '2027-03-07', quantityMicro: 1 * KG, unitId: saca.id, amountCents: 300, author: 'Ana' });
  const r = await cycleResult(db, cycle.id);
  assert.ok(r.avisos.some((a) => /passou da sua estimativa/.test(a)));
  assert.ok(r.avisos.some((a) => /vendeu mais/.test(a)));
  assert.ok(r.avisos.some((a) => /sem colheita nessa unidade/.test(a)));
  assert.equal(r.estimativaColheita?.quantityMicro, 100 * KG);
});

test('venda sem nenhuma colheita avisa; sem estimativa não há aviso de estimativa; estimativa tem versão e validação', async () => {
  const { db, cycle, kg } = await setup();
  const s = await recordSale(db, { cycleId: cycle.id, soldOn: '2027-03-06', quantityMicro: KG, unitId: kg.id, amountCents: 300, author: 'Ana' });
  assert.match(String(s.warning), /nenhuma colheita/);
  await rejectsWith(setHarvestEstimate(db, cycle.id, cycle.version + 9, { quantityMicro: KG, unitId: kg.id }), 'conflito_de_versao');
  await rejectsWith(setHarvestEstimate(db, cycle.id, cycle.version, { quantityMicro: 0, unitId: kg.id }), 'invalido');
  await rejectsWith(setHarvestEstimate(db, cycle.id, cycle.version, { quantityMicro: KG, unitId: 'x' }), 'invalido');
  assert.equal((await cycleResult(db, cycle.id)).estimativaColheita, null);
});

test('mapa: toque e posição são inversos; contorno do talhão validado e guardado; área estimada em hectares', async () => {
  const loc = { latMicro: -8_047_562, lonMicro: -34_877_000 };
  const g = gridFor(loc, 17);
  const p = toPct(g, loc);
  assert.ok(p.x > 100 / 3 && p.x < 200 / 3 && p.y > 100 / 3 && p.y < 200 / 3);
  const back = fromPct(g, p.x, p.y);
  assert.ok(Math.abs(back.latMicro - loc.latMicro) <= 2 && Math.abs(back.lonMicro - loc.lonMicro) <= 2);
  const d = 900; // micrograus: cerca de 100 m
  const sq = [0, 1, 2, 3].map((i) => ({ latMicro: loc.latMicro + (i === 1 || i === 2 ? d : 0), lonMicro: loc.lonMicro + (i >= 2 ? d : 0) }));
  const ha = areaHectares(sq);
  assert.ok(ha > 0.9 && ha < 1.1, String(ha));
  assert.throws(() => areaHectares(sq.slice(0, 2)), DomainError);
  const { db, farm } = await setup();
  const plot = await createPlot(db, { farmId: farm.id, name: 'Baixada' });
  assert.equal(plot.outline, null);
  await setPlotOutline(db, plot.id, sq);
  assert.equal((await getPlot(db, plot.id))?.outline?.length, 4);
  await rejectsWith(setPlotOutline(db, plot.id, sq.slice(0, 2)), 'invalido');
  await rejectsWith(setPlotOutline(db, plot.id, [...sq, { latMicro: 99_000_000, lonMicro: 0 }]), 'invalido');
  await rejectsWith(setPlotOutline(db, 'nao-existe', sq), 'nao_encontrado');
  await setPlotOutline(db, plot.id, null);
  assert.equal((await getPlot(db, plot.id))?.outline, null);
  assert.equal((await eventsFor(db, 'plot', plot.id)).filter((e) => e.type === 'plot.outline_set').length, 2);
});
