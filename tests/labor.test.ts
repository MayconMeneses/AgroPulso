import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportBackup } from '../src/backup/export.ts';
import { importBackup } from '../src/backup/import.ts';
import { eventsFor } from '../src/domain/audit.ts';
import { createCropType } from '../src/domain/crop-types.ts';
import { cancelCycle, openCycle } from '../src/domain/cycles.ts';
import { DomainError } from '../src/domain/errors.ts';
import { createFarm } from '../src/domain/farms.ts';
import { createCostCategory, listCycleEntries } from '../src/domain/financial.ts';
import { createWorker, dailyCostCents, laborSummary, listWork, listWorkers, monthlyCostCents, recordWork, voidWork } from '../src/domain/labor.ts';
import { cycleResult } from '../src/domain/results.ts';
import { freshDb } from './helpers.ts';

const DAY = 1_000_000;
async function rejectsWith(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof DomainError && e.code === code);
}

async function setup() {
  const db = await freshDb();
  const farm = await createFarm(db, { name: 'Sítio', timezone: 'America/Recife' });
  const crop = await createCropType(db, { name: 'Milho' });
  const cycle = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  const cycle2 = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  return { db, farm, crop, cycle, cycle2 };
}

test('contas: diária (aceita meio dia) e parte do salário do mês, com arredondamento', () => {
  assert.equal(dailyCostCents(15_000, 2.5 * DAY), 37_500);
  assert.equal(dailyCostCents(10_001, 0.5 * DAY), 5_001); // 5000,5 arredonda para cima
  assert.equal(monthlyCostCents(200_000, 40), 80_000);
  assert.equal(monthlyCostCents(100_001, 50), 50_001);
});

test('cadastro: contratado exige valor; família pode ficar sem; nome único; dados válidos', async () => {
  const { db, farm } = await setup();
  await rejectsWith(createWorker(db, { farmId: farm.id, name: ' ', kind: 'CONTRATADO', payType: 'DIARIA', rateCents: 100 }), 'invalido');
  await rejectsWith(createWorker(db, { farmId: farm.id, name: 'João', kind: 'CONTRATADO', payType: 'DIARIA' }), 'invalido');
  await rejectsWith(createWorker(db, { farmId: farm.id, name: 'João', kind: 'CONTRATADO', payType: 'DIARIA', rateCents: 0 }), 'invalido');
  await rejectsWith(createWorker(db, { farmId: farm.id, name: 'João', kind: 'X' as never, payType: 'DIARIA', rateCents: 100 }), 'invalido');
  await rejectsWith(createWorker(db, { farmId: farm.id, name: 'João', kind: 'CONTRATADO', payType: 'SEMANAL' as never, rateCents: 100 }), 'invalido');
  await rejectsWith(createWorker(db, { farmId: 'x', name: 'João', kind: 'FAMILIAR', payType: 'DIARIA' }), 'invalido');
  await createWorker(db, { farmId: farm.id, name: 'João', kind: 'CONTRATADO', payType: 'DIARIA', rateCents: 15_000 });
  await rejectsWith(createWorker(db, { farmId: farm.id, name: 'joão', kind: 'FAMILIAR', payType: 'DIARIA' }), 'duplicado');
  await createWorker(db, { farmId: farm.id, name: 'Filho', kind: 'FAMILIAR', payType: 'DIARIA' });
  assert.equal((await listWorkers(db, farm.id)).length, 2);
});

test('funcionário contratado por diária: vira despesa de mão de obra no custo da safra', async () => {
  const { db, farm, cycle } = await setup();
  const cat = await createCostCategory(db, { name: 'Mão de obra' });
  const w = await createWorker(db, { farmId: farm.id, name: 'João', kind: 'CONTRATADO', payType: 'DIARIA', rateCents: 15_000 });
  const r = await recordWork(db, { workerId: w.id, cycleId: cycle.id, occurredOn: '2026-12-10', daysMicro: 2.5 * DAY, author: 'Ana' });
  assert.equal(r.amountCents, 37_500);
  assert.equal(r.warning, null);
  const res = await cycleResult(db, cycle.id);
  assert.equal(res.custoRegistradoCents, 37_500);
  assert.equal(res.maoDeObraFamiliarCents, 0);
  const e = (await listCycleEntries(db, cycle.id))[0];
  assert.equal(e?.counterparty, 'João');
  assert.equal(e?.categoryId, cat.id);
  assert.match(String(e?.allocationCriterion), /2.5 dia/);
  await rejectsWith(recordWork(db, { workerId: w.id, cycleId: cycle.id, occurredOn: '2026-12-10', author: 'Ana' }), 'invalido');
  await rejectsWith(recordWork(db, { workerId: w.id, cycleId: cycle.id, occurredOn: '2026-12-10', daysMicro: 32 * DAY, author: 'Ana' }), 'invalido');
  await rejectsWith(recordWork(db, { workerId: w.id, cycleId: cycle.id, occurredOn: '2026-12-10', daysMicro: 0, author: 'Ana' }), 'invalido');
  await rejectsWith(recordWork(db, { workerId: w.id, cycleId: cycle.id, occurredOn: '2026-13-10', daysMicro: DAY, author: 'Ana' }), 'invalido');
});

test('funcionário mensal: parte do salário por safra, sem passar de 100% no mês', async () => {
  const { db, farm, cycle, cycle2 } = await setup();
  const w = await createWorker(db, { farmId: farm.id, name: 'Maria', kind: 'CONTRATADO', payType: 'MENSAL', rateCents: 200_000 });
  assert.equal((await recordWork(db, { workerId: w.id, cycleId: cycle.id, occurredOn: '2026-12-05', sharePercent: 60, author: 'Ana' })).amountCents, 120_000);
  await rejectsWith(recordWork(db, { workerId: w.id, cycleId: cycle2.id, occurredOn: '2026-12-20', sharePercent: 50, author: 'Ana' }), 'invalido');
  assert.equal((await recordWork(db, { workerId: w.id, cycleId: cycle2.id, occurredOn: '2026-12-20', sharePercent: 40, author: 'Ana' })).amountCents, 80_000);
  assert.equal((await recordWork(db, { workerId: w.id, cycleId: cycle.id, occurredOn: '2027-01-05', sharePercent: 100, author: 'Ana' })).amountCents, 200_000);
  for (const bad of [0, 101, 1.5, -5]) await rejectsWith(recordWork(db, { workerId: w.id, cycleId: cycle.id, occurredOn: '2027-02-05', sharePercent: bad, author: 'Ana' }), 'invalido');
  assert.equal((await cycleResult(db, cycle.id)).custoRegistradoCents, 320_000);
  assert.equal((await cycleResult(db, cycle2.id)).custoRegistradoCents, 80_000);
});

test('pessoa da família: valor estimado fica na linha separada e fora do custo; sem valor cadastrado, só anota e avisa', async () => {
  const { db, farm, cycle } = await setup();
  const comValor = await createWorker(db, { farmId: farm.id, name: 'Filho', kind: 'FAMILIAR', payType: 'DIARIA', rateCents: 10_000 });
  const semValor = await createWorker(db, { farmId: farm.id, name: 'Pai', kind: 'FAMILIAR', payType: 'DIARIA' });
  await recordWork(db, { workerId: comValor.id, cycleId: cycle.id, occurredOn: '2026-12-10', daysMicro: 3 * DAY, author: 'Ana' });
  const r = await recordWork(db, { workerId: semValor.id, cycleId: cycle.id, occurredOn: '2026-12-10', daysMicro: 2 * DAY, author: 'Ana' });
  assert.equal(r.amountCents, null);
  assert.match(String(r.warning), /sem valor/);
  const res = await cycleResult(db, cycle.id);
  assert.equal(res.custoRegistradoCents, 0);
  assert.equal(res.maoDeObraFamiliarCents, 30_000);
  const sum = await laborSummary(db, cycle.id);
  assert.equal(sum.find((s) => s.workerName === 'Pai')?.daysMicro, 2 * DAY);
  assert.equal(sum.find((s) => s.workerName === 'Filho')?.amountCents, 30_000);
});

test('anular o trabalho anula a despesa dele; histórico e motivo ficam', async () => {
  const { db, farm, cycle } = await setup();
  const w = await createWorker(db, { farmId: farm.id, name: 'João', kind: 'CONTRATADO', payType: 'DIARIA', rateCents: 15_000 });
  const r = await recordWork(db, { workerId: w.id, cycleId: cycle.id, occurredOn: '2026-12-10', daysMicro: DAY, author: 'Ana' });
  await rejectsWith(voidWork(db, r.id, ' '), 'invalido');
  await rejectsWith(voidWork(db, 'nao-existe', 'x'), 'nao_encontrado');
  await voidWork(db, r.id, 'dia lançado errado');
  assert.equal((await cycleResult(db, cycle.id)).custoRegistradoCents, 0);
  assert.equal((await laborSummary(db, cycle.id)).length, 0);
  const row = (await listWork(db, cycle.id))[0];
  assert.equal(row?.voidReason, 'dia lançado errado');
  assert.equal((await listCycleEntries(db, cycle.id))[0]?.voidReason, 'dia lançado errado');
  assert.equal((await eventsFor(db, 'work_entry', r.id)).filter((e) => e.type === 'work.voided').length, 1);
  await rejectsWith(voidWork(db, r.id, 'de novo'), 'transicao_invalida');
});

test('regras: mesma propriedade, repetição, safra encerrada e cópia de segurança', async () => {
  const { db, farm, crop, cycle } = await setup();
  const w = await createWorker(db, { farmId: farm.id, name: 'João', kind: 'CONTRATADO', payType: 'DIARIA', rateCents: 15_000 });
  const outra = await createFarm(db, { name: 'Outro sítio', timezone: 'America/Recife' });
  const alheia = await openCycle(db, { farmId: outra.id, cropTypeId: crop.id });
  await rejectsWith(recordWork(db, { workerId: w.id, cycleId: alheia.id, occurredOn: '2026-12-10', daysMicro: DAY, author: 'Ana' }), 'invalido');
  await rejectsWith(recordWork(db, { workerId: 'x', cycleId: cycle.id, occurredOn: '2026-12-10', daysMicro: DAY, author: 'Ana' }), 'invalido');
  const input = { workerId: w.id, cycleId: cycle.id, occurredOn: '2026-12-10', daysMicro: DAY, author: 'Ana', idempotencyKey: 'k1' };
  const a = await recordWork(db, input);
  const b = await recordWork(db, input);
  assert.equal(a.id, b.id);
  assert.equal((await listWork(db, cycle.id)).length, 1);
  assert.equal((await cycleResult(db, cycle.id)).custoRegistradoCents, 15_000);
  const other = await freshDb();
  await importBackup(other, await exportBackup(db));
  assert.equal((await laborSummary(other, cycle.id))[0]?.amountCents, 15_000);
  await cancelCycle(db, cycle.id, cycle.version, { reason: 'seca' });
  await rejectsWith(recordWork(db, { workerId: w.id, cycleId: cycle.id, occurredOn: '2026-12-11', daysMicro: DAY, author: 'Ana' }), 'transicao_invalida');
  const late = await recordWork(db, { workerId: w.id, cycleId: cycle.id, occurredOn: '2026-12-11', daysMicro: DAY, author: 'Ana', justification: 'dia esquecido' });
  assert.equal(late.amountCents, 15_000);
});

test('data impossível (mês 13, dia 40) vira mensagem de erro, não falha interna', async () => {
  const { db, cycle } = await setup();
  const { planCycle } = await import('../src/domain/cycles.ts');
  for (const bad of ['2026-13-10', '2026-02-30', '2026-00-10', '2026-12-40']) {
    await rejectsWith(planCycle(db, cycle.id, cycle.version, { plannedStart: bad, plannedEnd: '2027-12-01' }), 'invalido');
  }
});

test('a despesa que nasceu de um dia de trabalho só se anula pelo trabalho', async () => {
  const { db, farm, cycle } = await setup();
  const { voidEntry } = await import('../src/domain/financial.ts');
  const w = await createWorker(db, { farmId: farm.id, name: 'João', kind: 'CONTRATADO', payType: 'DIARIA', rateCents: 15_000 });
  const r = await recordWork(db, { workerId: w.id, cycleId: cycle.id, occurredOn: '2026-12-10', daysMicro: DAY, author: 'Ana' });
  const e = (await listCycleEntries(db, cycle.id))[0];
  assert.equal(e?.workId, r.id);
  await rejectsWith(voidEntry(db, String(e?.id), Number(e?.version), 'quero tirar'), 'transicao_invalida');
  assert.equal((await cycleResult(db, cycle.id)).custoRegistradoCents, 15_000);
  await voidWork(db, r.id, 'ok');
  assert.equal((await cycleResult(db, cycle.id)).custoRegistradoCents, 0);
});
