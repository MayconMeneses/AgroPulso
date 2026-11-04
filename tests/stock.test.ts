import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportBackup } from '../src/backup/export.ts';
import { importBackup } from '../src/backup/import.ts';
import { eventsFor } from '../src/domain/audit.ts';
import { createCropType } from '../src/domain/crop-types.ts';
import { cancelCycle, openCycle } from '../src/domain/cycles.ts';
import { DomainError } from '../src/domain/errors.ts';
import { createFarm } from '../src/domain/farms.ts';
import { createStockItem, listMovements, listStockItems, recordMovement } from '../src/domain/stock.ts';
import { createUnit } from '../src/domain/units.ts';
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
  const item = await createStockItem(db, { farmId: farm.id, name: 'Adubo NPK', unitId: kg.id, minMicro: 10 * KG });
  const cycle = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  return { db, farm, crop, kg, item, cycle };
}

test('o saldo é a soma das entradas, saídas e ajustes', async () => {
  const { db, item } = await setup();
  await recordMovement(db, { itemId: item.id, kind: 'ENTRADA', quantityMicro: 50 * KG, occurredOn: '2026-12-01', author: 'Ana' });
  await recordMovement(db, { itemId: item.id, kind: 'SAIDA', quantityMicro: 20 * KG, occurredOn: '2026-12-05', author: 'Ana' });
  const after = await recordMovement(db, { itemId: item.id, kind: 'AJUSTE', quantityMicro: -2 * KG, occurredOn: '2026-12-06', note: 'saco rasgado', author: 'Ana' });
  assert.equal(after.balanceMicro, 28 * KG);
  assert.equal(after.low, false);
  assert.equal((await listMovements(db, item.id)).length, 3);
});

test('avisa quando o saldo chega ao mínimo', async () => {
  const { db, item, farm } = await setup();
  await recordMovement(db, { itemId: item.id, kind: 'ENTRADA', quantityMicro: 12 * KG, occurredOn: '2026-12-01', author: 'Ana' });
  const after = await recordMovement(db, { itemId: item.id, kind: 'SAIDA', quantityMicro: 3 * KG, occurredOn: '2026-12-02', author: 'Ana' });
  assert.equal(after.low, true);
  assert.equal((await listStockItems(db, farm.id))[0]?.low, true);
});

test('recusa saída maior que o saldo e não grava nada', async () => {
  const { db, item } = await setup();
  await recordMovement(db, { itemId: item.id, kind: 'ENTRADA', quantityMicro: 5 * KG, occurredOn: '2026-12-01', author: 'Ana' });
  await rejectsWith(recordMovement(db, { itemId: item.id, kind: 'SAIDA', quantityMicro: 6 * KG, occurredOn: '2026-12-02', author: 'Ana' }), 'invalido');
  await rejectsWith(recordMovement(db, { itemId: item.id, kind: 'AJUSTE', quantityMicro: -6 * KG, occurredOn: '2026-12-02', note: 'perda', author: 'Ana' }), 'invalido');
  assert.equal((await listMovements(db, item.id)).length, 1);
});

test('valida quantidade, data, autor e motivo do ajuste', async () => {
  const { db, item } = await setup();
  const base = { itemId: item.id, occurredOn: '2026-12-01', author: 'Ana' };
  await rejectsWith(recordMovement(db, { ...base, kind: 'ENTRADA', quantityMicro: 0 }), 'invalido');
  await rejectsWith(recordMovement(db, { ...base, kind: 'ENTRADA', quantityMicro: -KG }), 'invalido');
  await rejectsWith(recordMovement(db, { ...base, kind: 'ENTRADA', quantityMicro: 1.5 }), 'invalido');
  await rejectsWith(recordMovement(db, { ...base, kind: 'ENTRADA', quantityMicro: KG, occurredOn: '2026-02-30' }), 'invalido');
  await rejectsWith(recordMovement(db, { ...base, kind: 'ENTRADA', quantityMicro: KG, author: ' ' }), 'invalido');
  await rejectsWith(recordMovement(db, { ...base, kind: 'AJUSTE', quantityMicro: KG }), 'invalido');
  await rejectsWith(recordMovement(db, { ...base, kind: 'ENTRADA', quantityMicro: KG, itemId: 'nao-existe' }), 'invalido');
});

test('a mesma chave de repetição não duplica o movimento', async () => {
  const { db, item } = await setup();
  const m = { itemId: item.id, kind: 'ENTRADA' as const, quantityMicro: 10 * KG, occurredOn: '2026-12-01', author: 'Ana', idempotencyKey: 'k1' };
  await recordMovement(db, m);
  const again = await recordMovement(db, m);
  assert.equal(again.balanceMicro, 10 * KG);
  assert.equal((await listMovements(db, item.id)).length, 1);
});

test('saída ligada à safra: encerrada exige justificativa; outra propriedade é recusada; entrada não liga', async () => {
  const { db, item, cycle, crop } = await setup();
  await recordMovement(db, { itemId: item.id, kind: 'ENTRADA', quantityMicro: 40 * KG, occurredOn: '2026-12-01', author: 'Ana' });
  const ok = await recordMovement(db, { itemId: item.id, kind: 'SAIDA', quantityMicro: 5 * KG, occurredOn: '2026-12-02', cycleId: cycle.id, author: 'Ana' });
  assert.equal(ok.balanceMicro, 35 * KG);
  await rejectsWith(recordMovement(db, { itemId: item.id, kind: 'ENTRADA', quantityMicro: KG, occurredOn: '2026-12-02', cycleId: cycle.id, author: 'Ana' }), 'invalido');
  const outra = await createFarm(db, { name: 'Outro sítio', timezone: 'America/Recife' });
  const alheia = await openCycle(db, { farmId: outra.id, cropTypeId: crop.id });
  await rejectsWith(recordMovement(db, { itemId: item.id, kind: 'SAIDA', quantityMicro: KG, occurredOn: '2026-12-02', cycleId: alheia.id, author: 'Ana' }), 'invalido');
  const closed = await cancelCycle(db, cycle.id, cycle.version, { reason: 'seca' });
  assert.equal(closed.status, 'CANCELADA');
  await rejectsWith(recordMovement(db, { itemId: item.id, kind: 'SAIDA', quantityMicro: KG, occurredOn: '2026-12-03', cycleId: cycle.id, author: 'Ana' }), 'transicao_invalida');
  const late = await recordMovement(db, { itemId: item.id, kind: 'SAIDA', quantityMicro: KG, occurredOn: '2026-12-03', cycleId: cycle.id, author: 'Ana', justification: 'lançamento esquecido' });
  assert.equal(late.balanceMicro, 34 * KG);
});

test('item: nome obrigatório, sem repetição na propriedade, unidade existente, mínimo não negativo', async () => {
  const { db, farm, kg } = await setup();
  await rejectsWith(createStockItem(db, { farmId: farm.id, name: ' ', unitId: kg.id }), 'invalido');
  await rejectsWith(createStockItem(db, { farmId: farm.id, name: 'adubo npk', unitId: kg.id }), 'duplicado');
  await rejectsWith(createStockItem(db, { farmId: farm.id, name: 'Semente', unitId: 'x' }), 'invalido');
  await rejectsWith(createStockItem(db, { farmId: farm.id, name: 'Semente', unitId: kg.id, minMicro: -1 }), 'invalido');
  await rejectsWith(createStockItem(db, { farmId: 'x', name: 'Semente', unitId: kg.id }), 'invalido');
});

test('cada movimento deixa um evento de auditoria com o saldo antes e depois', async () => {
  const { db, item } = await setup();
  await recordMovement(db, { itemId: item.id, kind: 'ENTRADA', quantityMicro: 8 * KG, occurredOn: '2026-12-01', author: 'Ana' });
  const mv = (await listMovements(db, item.id))[0];
  const ev = await eventsFor(db, 'stock_movement', mv?.id ?? '');
  assert.equal(ev.length, 1);
  assert.equal(JSON.parse(String(ev[0]?.after_json)).balanceMicro, 8 * KG);
});

test('o estoque entra na cópia de segurança e volta igual', async () => {
  const { db, farm, item } = await setup();
  await recordMovement(db, { itemId: item.id, kind: 'ENTRADA', quantityMicro: 7 * KG, occurredOn: '2026-12-01', author: 'Ana' });
  const file = await exportBackup(db);
  const other = await freshDb();
  await importBackup(other, file);
  assert.equal((await listStockItems(other, farm.id))[0]?.balanceMicro, 7 * KG);
});
