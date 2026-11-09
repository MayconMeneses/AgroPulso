import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportBackup } from '../src/backup/export.ts';
import { importBackup } from '../src/backup/import.ts';
import { eventsFor } from '../src/domain/audit.ts';
import { createCropType } from '../src/domain/crop-types.ts';
import { cancelCycle, closeCycle, openCycle, planCycle, startCycle } from '../src/domain/cycles.ts';
import { DomainError } from '../src/domain/errors.ts';
import { createFarm } from '../src/domain/farms.ts';
import { correctEntry, createCostCategory, listEntries, recordEntry } from '../src/domain/financial.ts';
import { assignPlot, createPlot } from '../src/domain/plots.ts';
import { correctHarvest, correctSale, listHarvests, listSales, recordHarvest, recordReceipt, recordSale } from '../src/domain/production.ts';
import { cycleResult } from '../src/domain/results.ts';
import { createUnit } from '../src/domain/units.ts';
import { freshDb } from './helpers.ts';

async function rejectsWith(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof DomainError && e.code === code);
}

async function setup() {
  const db = await freshDb();
  const farm = await createFarm(db, { name: 'Sítio', timezone: 'America/Recife' });
  const crop = await createCropType(db, { name: 'Milho' });
  const kg = await createUnit(db, { name: 'kg', kind: 'massa' });
  const saca = await createUnit(db, { name: 'saca', kind: 'massa' });
  const ha = await createUnit(db, { name: 'ha', kind: 'area' });
  let cycle = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  cycle = await planCycle(db, cycle.id, cycle.version, { plannedStart: '2026-12-01', plannedEnd: '2027-03-01' });
  cycle = await startCycle(db, cycle.id, cycle.version, { actualStart: '2026-12-05' });
  return { db, farm, crop, kg, saca, ha, cycle };
}

const despesa = (s: Awaited<ReturnType<typeof setup>>, extra: object = {}) => ({
  farmId: s.farm.id,
  cycleId: s.cycle.id,
  kind: 'DESPESA' as const,
  amountCents: 10_000,
  occurredOn: '2026-12-06',
  author: 'M',
  ...extra,
});

test('despesa: valor exato, categoria do usuário, custo e pagamento separados', async () => {
  const s = await setup();
  const adubo = await createCostCategory(s.db, { name: 'Adubo' });
  await rejectsWith(createCostCategory(s.db, { name: 'adubo' }), 'duplicado');
  const e = await recordEntry(s.db, despesa(s, { categoryId: adubo.id, amountCents: 123_456, paidOn: '2026-12-20', counterparty: 'Loja' }));
  assert.equal(e.amountCents, 123_456);
  assert.equal(e.occurredOn, '2026-12-06');
  assert.equal(e.paidOn, '2026-12-20');
  for (const ruim of [0, -5, 1.5, Number.NaN]) {
    await rejectsWith(recordEntry(s.db, despesa(s, { amountCents: ruim })), 'invalido');
  }
  await rejectsWith(recordEntry(s.db, despesa(s, { categoryId: 'nada' })), 'invalido');
  await rejectsWith(recordEntry(s.db, despesa(s, { farmId: 'nada' })), 'invalido');
  await rejectsWith(recordEntry(s.db, despesa(s, { occurredOn: '06/12/2026' })), 'invalido');
  await rejectsWith(recordEntry(s.db, { ...despesa(s), kind: 'ENTRADA', familyLabor: true }), 'invalido');
});

test('a safra precisa ser da propriedade; encerrada exige justificativa', async () => {
  const s = await setup();
  const outra = await createFarm(s.db, { name: 'Outra', timezone: 'America/Bahia' });
  await rejectsWith(recordEntry(s.db, despesa(s, { farmId: outra.id })), 'invalido');
  const c2 = await openCycle(s.db, { farmId: s.farm.id, cropTypeId: s.crop.id });
  await cancelCycle(s.db, c2.id, c2.version, { reason: 'x' });
  await rejectsWith(recordEntry(s.db, despesa(s, { cycleId: c2.id })), 'transicao_invalida');
  const e = await recordEntry(s.db, despesa(s, { cycleId: c2.id, justification: 'esquecido' }));
  assert.equal((await eventsFor(s.db, 'financial_entry', e.id))[0]?.reason, 'esquecido');
});

test('a mesma chave reenviada não duplica despesa, colheita nem venda', async () => {
  const s = await setup();
  const a = await recordEntry(s.db, despesa(s, { idempotencyKey: 'd1' }));
  const b = await recordEntry(s.db, despesa(s, { idempotencyKey: 'd1' }));
  assert.equal(a.id, b.id);
  assert.equal((await listEntries(s.db, s.farm.id)).length, 1);
  const h1 = await recordHarvest(s.db, { cycleId: s.cycle.id, harvestedOn: '2027-02-01', quantityMicro: 10_000_000, unitId: s.saca.id, author: 'M', idempotencyKey: 'h1' });
  const h2 = await recordHarvest(s.db, { cycleId: s.cycle.id, harvestedOn: '2027-02-01', quantityMicro: 10_000_000, unitId: s.saca.id, author: 'M', idempotencyKey: 'h1' });
  assert.equal(h1.id, h2.id);
  assert.equal((await listHarvests(s.db, s.cycle.id)).length, 1);
  const v = { cycleId: s.cycle.id, soldOn: '2027-02-10', quantityMicro: 4_000_000, unitId: s.saca.id, amountCents: 80_000, author: 'M', idempotencyKey: 'v1' };
  assert.equal((await recordSale(s.db, v)).id, (await recordSale(s.db, v)).id);
  assert.equal((await listSales(s.db, s.cycle.id)).length, 1);
});

test('colheita exige unidade existente e quantidade positiva; parcial em datas diferentes', async () => {
  const s = await setup();
  const base = { cycleId: s.cycle.id, harvestedOn: '2027-02-01', quantityMicro: 5_000_000, unitId: s.saca.id, author: 'M' };
  await rejectsWith(recordHarvest(s.db, { ...base, unitId: 'nada' }), 'invalido');
  await rejectsWith(recordHarvest(s.db, { ...base, quantityMicro: 0 }), 'invalido');
  await recordHarvest(s.db, base);
  await recordHarvest(s.db, { ...base, harvestedOn: '2027-02-15', quantityMicro: 3_000_000 });
  assert.equal((await listHarvests(s.db, s.cycle.id)).length, 2);
});

test('venda parcial em datas diferentes; recebimento é outra coisa', async () => {
  const s = await setup();
  const h = await recordHarvest(s.db, { cycleId: s.cycle.id, harvestedOn: '2027-02-01', quantityMicro: 10_000_000, unitId: s.saca.id, author: 'M' });
  const v1 = await recordSale(s.db, { cycleId: s.cycle.id, harvestId: h.id, soldOn: '2027-02-10', quantityMicro: 4_000_000, unitId: s.saca.id, amountCents: 80_000, author: 'M' });
  await recordSale(s.db, { cycleId: s.cycle.id, harvestId: h.id, soldOn: '2027-03-10', quantityMicro: 3_000_000, unitId: s.saca.id, amountCents: 66_000, author: 'M' });
  await rejectsWith(recordSale(s.db, { cycleId: s.cycle.id, harvestId: h.id, soldOn: '2027-03-10', quantityMicro: 1_000_000, unitId: s.kg.id, amountCents: 1, author: 'M' }), 'invalido');
  await rejectsWith(recordSale(s.db, { cycleId: s.cycle.id, harvestId: 'nada', soldOn: '2027-03-10', quantityMicro: 1_000_000, unitId: s.saca.id, amountCents: 1, author: 'M' }), 'invalido');
  const antes = await cycleResult(s.db, s.cycle.id);
  assert.equal(antes.receitaVendasCents, 146_000);
  assert.equal(antes.recebidoCents, 0);
  assert.equal(antes.aReceberCents, 146_000);
  await recordReceipt(s.db, { saleId: v1.id, receivedOn: '2027-02-20', amountCents: 50_000 });
  const depois = await cycleResult(s.db, s.cycle.id);
  assert.equal(depois.recebidoCents, 50_000);
  assert.equal(depois.aReceberCents, 96_000);
  assert.equal(depois.receitaVendasCents, 146_000);
});

test('a receber por venda: recebimento maior numa venda não esconde a outra em aberto', async () => {
  const s = await setup();
  const v1 = await recordSale(s.db, { cycleId: s.cycle.id, soldOn: '2027-02-10', quantityMicro: 1_000_000, unitId: s.saca.id, amountCents: 10_000, author: 'M' });
  await recordSale(s.db, { cycleId: s.cycle.id, soldOn: '2027-02-11', quantityMicro: 1_000_000, unitId: s.saca.id, amountCents: 10_000, author: 'M' });
  await recordReceipt(s.db, { saleId: v1.id, receivedOn: '2027-02-15', amountCents: 15_000 });
  const r = await cycleResult(s.db, s.cycle.id);
  assert.equal(r.recebidoCents, 15_000);
  assert.equal(r.aReceberCents, 10_000);
});

test('correção exige justificativa e deixa antes e depois', async () => {
  const s = await setup();
  const e = await recordEntry(s.db, despesa(s));
  await rejectsWith(correctEntry(s.db, e.id, e.version, { amountCents: 20_000, justification: ' ' }), 'invalido');
  const c = await correctEntry(s.db, e.id, e.version, { amountCents: 20_000, justification: 'valor digitado errado' });
  assert.equal(c.amountCents, 20_000);
  await rejectsWith(correctEntry(s.db, e.id, e.version, { amountCents: 1, justification: 'x' }), 'conflito_de_versao');
  const ev = await eventsFor(s.db, 'financial_entry', e.id);
  assert.deepEqual(ev.map((x) => x.type), ['expense.recorded', 'expense.corrected']);
  assert.match(String(ev[1]?.before_json), /10000/);
  const h = await recordHarvest(s.db, { cycleId: s.cycle.id, harvestedOn: '2027-02-01', quantityMicro: 5_000_000, unitId: s.saca.id, author: 'M' });
  const h2 = await correctHarvest(s.db, h.id, h.version, { quantityMicro: 6_000_000, justification: 'balança' });
  assert.equal(h2.quantityMicro, 6_000_000);
  const v = await recordSale(s.db, { cycleId: s.cycle.id, soldOn: '2027-02-10', quantityMicro: 1_000_000, unitId: s.saca.id, amountCents: 1000, author: 'M' });
  const v2 = await correctSale(s.db, v.id, v.version, { amountCents: 2000, justification: 'preço' });
  assert.equal(v2.amountCents, 2000);
  await rejectsWith(correctSale(s.db, v.id, v2.version, { amountCents: 5, justification: '' }), 'invalido');
});

test('concluir: colheita registrada ou motivo; sem nenhum dos dois, não conclui', async () => {
  const a = await setup();
  await rejectsWith(closeCycle(a.db, a.cycle.id, a.cycle.version, {}), 'invalido');
  await recordHarvest(a.db, { cycleId: a.cycle.id, harvestedOn: '2027-02-01', quantityMicro: 1_000_000, unitId: a.saca.id, author: 'M' });
  const fim = await closeCycle(a.db, a.cycle.id, a.cycle.version, {});
  assert.equal(fim.status, 'CONCLUIDA');
  const b = await setup();
  const perda = await closeCycle(b.db, b.cycle.id, b.cycle.version, { reason: 'perda total por seca' });
  assert.equal(perda.status, 'CONCLUIDA');
  assert.equal((await cycleResult(b.db, b.cycle.id)).colhido.length, 0);
});

test('safra sem dados não mostra resultado inventado', async () => {
  const s = await setup();
  const r = await cycleResult(s.db, s.cycle.id);
  assert.equal(r.semDados, true);
  assert.equal(r.resultadoParcialCents, null);
  assert.equal(r.produtividade, null);
  assert.ok(r.semProdutividadeMotivo);
  assert.equal(r.custoRegistradoCents, 0);
});

test('despesa desconhecida não vira zero: sem custos ou sem vendas não há resultado', async () => {
  const s = await setup();
  await recordSale(s.db, { cycleId: s.cycle.id, soldOn: '2027-02-10', quantityMicro: 1_000_000, unitId: s.saca.id, amountCents: 50_000, author: 'M' });
  assert.equal((await cycleResult(s.db, s.cycle.id)).resultadoParcialCents, null);
  await recordEntry(s.db, despesa(s, { amountCents: 20_000 }));
  const r = await cycleResult(s.db, s.cycle.id);
  assert.equal(r.resultadoParcialCents, 30_000);
  assert.match(r.avisos.join(' '), /Resultado parcial/);
});

test('mão de obra familiar e custos não alocados ficam fora do custo registrado e são listados', async () => {
  const s = await setup();
  await recordEntry(s.db, despesa(s, { amountCents: 10_000 }));
  await recordEntry(s.db, despesa(s, { amountCents: 40_000, familyLabor: true }));
  await recordEntry(s.db, { farmId: s.farm.id, kind: 'DESPESA', amountCents: 7_000, occurredOn: '2026-12-07', author: 'M', allocationCriterion: 'a ratear depois' });
  const r = await cycleResult(s.db, s.cycle.id);
  assert.equal(r.custoRegistradoCents, 10_000);
  assert.equal(r.maoDeObraFamiliarCents, 40_000);
  assert.equal(r.custosNaoAlocadosDaPropriedadeCents, 7_000);
  assert.ok(r.excluidos.some((x) => /familiar/i.test(x)));
  assert.ok(r.excluidos.some((x) => /não alocados/.test(x)));
  assert.equal(r.custoPagoCents, 0);
  assert.equal(r.custoAPagarCents, 10_000);
});

test('colheita em unidades diferentes nunca é somada', async () => {
  const s = await setup();
  await recordHarvest(s.db, { cycleId: s.cycle.id, harvestedOn: '2027-02-01', quantityMicro: 2_000_000, unitId: s.saca.id, author: 'M' });
  await recordHarvest(s.db, { cycleId: s.cycle.id, harvestedOn: '2027-02-02', quantityMicro: 30_000_000, unitId: s.kg.id, author: 'M' });
  const r = await cycleResult(s.db, s.cycle.id);
  assert.deepEqual(r.colhido.map((x) => [x.unitName, x.quantityMicro]), [['kg', 30_000_000], ['saca', 2_000_000]]);
});

test('produtividade só com área declarada; área medida aparece e a divergência é avisada', async () => {
  const s = await setup();
  await recordHarvest(s.db, { cycleId: s.cycle.id, harvestedOn: '2027-02-01', quantityMicro: 20_000_000, unitId: s.saca.id, author: 'M' });
  assert.equal((await cycleResult(s.db, s.cycle.id)).produtividade, null);
  const semArea = await createPlot(s.db, { farmId: s.farm.id, name: 'Sem área' });
  await assignPlot(s.db, s.cycle.id, s.cycle.version, semArea.id);
  assert.match((await cycleResult(s.db, s.cycle.id)).semProdutividadeMotivo ?? '', /área declarada/);
  const comArea = await createPlot(s.db, { farmId: s.farm.id, name: 'Com área', areaDeclaredMicro: 4_000_000, areaMeasuredMicro: 3_500_000, areaUnitId: s.ha.id });
  await assignPlot(s.db, s.cycle.id, s.cycle.version + 1, comArea.id);
  const r = await cycleResult(s.db, s.cycle.id);
  assert.deepEqual(r.produtividade, [{ harvestUnitName: 'saca', areaUnitName: 'ha', valueMicro: 5_000_000, exact: true }]);
  assert.equal(r.areaDeclaradaMicro, 4_000_000);
  assert.equal(r.areaMedidaMicro, 3_500_000);
  assert.match(r.avisos.join(' '), /área medida é diferente/);
});

test('backup preserva custos, colheitas, vendas e recebimentos', async () => {
  const s = await setup();
  await recordEntry(s.db, despesa(s));
  const h = await recordHarvest(s.db, { cycleId: s.cycle.id, harvestedOn: '2027-02-01', quantityMicro: 5_000_000, unitId: s.saca.id, author: 'M' });
  const v = await recordSale(s.db, { cycleId: s.cycle.id, harvestId: h.id, soldOn: '2027-02-10', quantityMicro: 2_000_000, unitId: s.saca.id, amountCents: 33_333, author: 'M' });
  await recordReceipt(s.db, { saleId: v.id, receivedOn: '2027-02-12', amountCents: 10_000 });
  const antes = await cycleResult(s.db, s.cycle.id);
  const arquivo = await exportBackup(s.db);
  const destino = await freshDb();
  await importBackup(destino, arquivo);
  await importBackup(destino, arquivo);
  assert.deepEqual(await cycleResult(destino, s.cycle.id), antes);
  assert.equal(await exportBackup(destino), arquivo);
});
