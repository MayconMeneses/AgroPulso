import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createActivityType, recordActivity } from '../src/domain/activities.ts';
import { createCropType } from '../src/domain/crop-types.ts';
import { openCycle } from '../src/domain/cycles.ts';
import { createFarm } from '../src/domain/farms.ts';
import { backupStatus, dailyAlerts, guideComplete, guideSteps, markBackupDone } from '../src/domain/guide.ts';
import { recordSale, recordReceipt } from '../src/domain/production.ts';
import { createStockItem, recordMovement } from '../src/domain/stock.ts';
import { createUnit } from '../src/domain/units.ts';
import { exportBackup } from '../src/backup/export.ts';
import { importBackup } from '../src/backup/import.ts';
import { freshDb } from './helpers.ts';

const stepIds = async (db: Awaited<ReturnType<typeof freshDb>>) => (await guideSteps(db)).filter((s) => s.done).map((s) => s.id);

test('primeiros passos: avançam na ordem e só terminam com uma anotação de verdade', async () => {
  const db = await freshDb();
  assert.deepEqual(await stepIds(db), []);
  const farm = await createFarm(db, { name: 'Sítio', timezone: 'America/Recife' });
  assert.deepEqual(await stepIds(db), ['propriedade']);
  const crop = await createCropType(db, { name: 'Milho' });
  const cycle = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  assert.deepEqual(await stepIds(db), ['propriedade', 'cultura', 'safra']);
  assert.equal(guideComplete(await guideSteps(db)), false);
  const t = await createActivityType(db, { name: 'Plantio' });
  await recordActivity(db, { cycleId: cycle.id, typeId: t.id, occurredOn: '2026-12-01', author: 'Ana' });
  assert.equal(guideComplete(await guideSteps(db)), true);
  for (const s of await guideSteps(db)) assert.ok(s.title.length > 5 && s.help.length > 10);
});

test('lembrete de cópia: só para quem já anotou algo, e depois de 30 dias', async () => {
  const db = await freshDb();
  const agora = new Date('2026-12-10T12:00:00Z');
  assert.equal((await backupStatus(db, agora)).due, false, 'instalação nova não precisa de cópia');
  const farm = await createFarm(db, { name: 'Sítio', timezone: 'America/Recife' });
  const crop = await createCropType(db, { name: 'Milho' });
  const cycle = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  const t = await createActivityType(db, { name: 'Plantio' });
  await recordActivity(db, { cycleId: cycle.id, typeId: t.id, occurredOn: '2026-12-01', author: 'Ana' });
  let s = await backupStatus(db, agora);
  assert.deepEqual([s.hasData, s.due, s.lastAt, s.daysSince], [true, true, null, null]);
  await markBackupDone(db, new Date('2026-12-05T12:00:00Z'));
  s = await backupStatus(db, agora);
  assert.deepEqual([s.due, s.daysSince], [false, 5]);
  s = await backupStatus(db, new Date('2027-01-04T12:00:00Z'));
  assert.deepEqual([s.due, s.daysSince], [true, 30]);
  await markBackupDone(db, new Date('2027-01-04T12:00:00Z'));
  await markBackupDone(db, new Date('2027-01-04T12:00:00Z'));
  assert.equal((await backupStatus(db, new Date('2027-01-05T00:00:00Z'))).due, false);
  await db.run("update app_meta set value = 'lixo' where key = 'ultima_copia'");
  assert.equal((await backupStatus(db, agora)).due, true, 'data ilegível vale como "nunca fez"');
});

test('a data da última cópia entra no backup e volta na restauração', async () => {
  const db = await freshDb();
  await markBackupDone(db, new Date('2026-12-05T12:00:00Z'));
  const outro = await freshDb();
  await importBackup(outro, await exportBackup(db));
  assert.equal((await backupStatus(outro, new Date('2026-12-06T12:00:00Z'))).daysSince, 1);
});

test('avisos do dia: tarefa atrasada, venda sem receber há mais de 30 dias e estoque no fim', async () => {
  const db = await freshDb();
  const farm = await createFarm(db, { name: 'Sítio', timezone: 'America/Recife' });
  const crop = await createCropType(db, { name: 'Milho' });
  const kg = await createUnit(db, { name: 'kg', kind: 'massa' });
  const cycle = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  const t = await createActivityType(db, { name: 'Capina' });
  assert.deepEqual(await dailyAlerts(db, '2026-12-10'), []);
  await recordActivity(db, { cycleId: cycle.id, typeId: t.id, occurredOn: '2026-12-05', author: 'Ana', state: 'PLANEJADA' });
  await recordActivity(db, { cycleId: cycle.id, typeId: t.id, occurredOn: '2026-12-20', author: 'Ana', state: 'PLANEJADA' });
  let a = await dailyAlerts(db, '2026-12-10');
  assert.equal(a.length, 1);
  assert.match(a[0]!.text, /Tarefa atrasada: Capina, marcada para 2026-12-05/);
  assert.equal(a[0]!.go, 'safras');
  const venda = await recordSale(db, { cycleId: cycle.id, soldOn: '2026-11-01', quantityMicro: 1_000_000, unitId: kg.id, amountCents: 10_000, author: 'Ana' });
  a = await dailyAlerts(db, '2026-12-10');
  assert.ok(a.some((x) => x.kind === 'receber' && /Uma venda/.test(x.text)));
  await recordReceipt(db, { saleId: venda.id, receivedOn: '2026-12-01', amountCents: 4_000 });
  assert.ok((await dailyAlerts(db, '2026-12-10')).some((x) => x.kind === 'receber'), 'recebido pela metade ainda avisa');
  await recordReceipt(db, { saleId: venda.id, receivedOn: '2026-12-02', amountCents: 6_000 });
  assert.ok(!(await dailyAlerts(db, '2026-12-10')).some((x) => x.kind === 'receber'));
  assert.ok(!(await dailyAlerts(db, '2026-11-20')).some((x) => x.kind === 'receber'));
  const item = await createStockItem(db, { farmId: farm.id, name: 'Adubo', unitId: kg.id, minMicro: 5_000_000 });
  await recordMovement(db, { itemId: item.id, kind: 'ENTRADA', quantityMicro: 4_000_000, occurredOn: '2026-12-01', author: 'Ana' });
  assert.ok((await dailyAlerts(db, '2026-12-10')).some((x) => x.kind === 'estoque' && /Está acabando: Adubo/.test(x.text)));
  await recordMovement(db, { itemId: item.id, kind: 'SAIDA', quantityMicro: 4_000_000, occurredOn: '2026-12-02', author: 'Ana' });
  assert.ok((await dailyAlerts(db, '2026-12-10')).some((x) => /Acabou: Adubo/.test(x.text)));
});

test('tarefa atrasada de safra encerrada não gera aviso', async () => {
  const { cancelCycle } = await import('../src/domain/cycles.ts');
  const db = await freshDb();
  const farm = await createFarm(db, { name: 'Sítio', timezone: 'America/Recife' });
  const crop = await createCropType(db, { name: 'Milho' });
  const cycle = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  const t = await createActivityType(db, { name: 'Capina' });
  await recordActivity(db, { cycleId: cycle.id, typeId: t.id, occurredOn: '2026-12-05', author: 'Ana', state: 'PLANEJADA' });
  assert.equal((await dailyAlerts(db, '2026-12-10')).length, 1);
  await cancelCycle(db, cycle.id, cycle.version, { reason: 'seca' });
  assert.equal((await dailyAlerts(db, '2026-12-10')).length, 0);
});
