import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventsFor } from '../src/domain/audit.ts';
import { cancelCycle, closeCycle, getCycle, listCycles, openCycle, planCycle, startCycle } from '../src/domain/cycles.ts';
import { createCropType, listCropTypes } from '../src/domain/crop-types.ts';
import { DomainError } from '../src/domain/errors.ts';
import { createFarm, listFarms } from '../src/domain/farms.ts';
import { exportBackup } from '../src/backup/export.ts';
import { importBackup } from '../src/backup/import.ts';
import { freshDb } from './helpers.ts';

async function rejectsWith(promise: Promise<unknown> | unknown, code: string): Promise<void> {
  await assert.rejects(Promise.resolve(promise), (e: unknown) => e instanceof DomainError && e.code === code);
}

async function setup() {
  const db = await freshDb();
  const farm = await createFarm(db, { name: ' Sítio Boa Vista ', timezone: 'America/Recife' });
  const crop = await createCropType(db, { name: 'Mandioca' });
  return { db, farm, crop };
}

test('propriedade nasce sem mapa, sem área e sem fuso padrão', async () => {
  const db = await freshDb();
  const farm = await createFarm(db, { name: ' Sítio Boa Vista ', timezone: 'America/Fortaleza' });
  assert.equal(farm.name, 'Sítio Boa Vista');
  assert.equal((await listFarms(db)).length, 1);
  await rejectsWith(createFarm(db, { name: '  ', timezone: 'America/Recife' }), 'invalido');
  await rejectsWith(createFarm(db, { name: 'X', timezone: '' }), 'invalido');
  await rejectsWith(createFarm(db, { name: 'X', timezone: 'Marte/Olimpo' }), 'invalido');
  assert.equal((await listFarms(db)).length, 1);
});

test('nenhuma cultura vem cadastrada e nome repetido é recusado', async () => {
  const db = await freshDb();
  assert.deepEqual(await listCropTypes(db), []);
  await createCropType(db, { name: 'Feijão' });
  await rejectsWith(createCropType(db, { name: 'feijão' }), 'duplicado');
  await rejectsWith(createCropType(db, { name: ' ' }), 'invalido');
  assert.equal((await listCropTypes(db)).length, 1);
});

test('uma propriedade pode ter várias safras com histórico independente', async () => {
  const { db, farm, crop } = await setup();
  const a = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  const b = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  await planCycle(db, a.id, a.version, { plannedStart: '2026-12-01', plannedEnd: '2027-03-01' });
  assert.equal((await listCycles(db, farm.id)).length, 2);
  assert.equal((await getCycle(db, b.id))?.status, 'RASCUNHO');
  assert.equal((await eventsFor(db, 'crop_cycle', b.id)).length, 1);
  assert.equal((await eventsFor(db, 'crop_cycle', a.id)).length, 2);
});

test('safra exige propriedade e cultura existentes', async () => {
  const { db, farm, crop } = await setup();
  await rejectsWith(openCycle(db, { farmId: 'nao-existe', cropTypeId: crop.id }), 'invalido');
  await rejectsWith(openCycle(db, { farmId: farm.id, cropTypeId: 'nao-existe' }), 'invalido');
  assert.equal((await listCycles(db, farm.id)).length, 0);
});

test('percorre RASCUNHO, PLANEJADA, EM_ANDAMENTO e CONCLUIDA com um evento por passo', async () => {
  const { db, farm, crop } = await setup();
  let c = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  c = await planCycle(db, c.id, c.version, { plannedStart: '2026-12-01', plannedEnd: '2027-03-01' });
  assert.equal(c.status, 'PLANEJADA');
  c = await startCycle(db, c.id, c.version, { actualStart: '2026-12-05' });
  assert.equal(c.status, 'EM_ANDAMENTO');
  assert.equal(c.actualStart, '2026-12-05');
  c = await closeCycle(db, c.id, c.version, { reason: 'Perda total por seca' });
  assert.equal(c.status, 'CONCLUIDA');
  assert.equal(c.reason, 'Perda total por seca');
  assert.equal(c.version, 4);
  const tipos = (await eventsFor(db, 'crop_cycle', c.id)).map((e) => e.type);
  assert.deepEqual(tipos, ['crop_cycle.opened', 'crop_cycle.planned', 'crop_cycle.started', 'crop_cycle.closed']);
});

test('concluir exige motivo; não há rendimento zero automático', async () => {
  const { db, farm, crop } = await setup();
  let c = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  c = await planCycle(db, c.id, c.version, { plannedStart: '2026-12-01', plannedEnd: '2027-03-01' });
  c = await startCycle(db, c.id, c.version, { actualStart: '2026-12-05' });
  await rejectsWith(closeCycle(db, c.id, c.version, { reason: '   ' }), 'invalido');
  assert.equal((await getCycle(db, c.id))?.status, 'EM_ANDAMENTO');
});

test('cancelar exige motivo, preserva o histórico e é definitivo', async () => {
  const { db, farm, crop } = await setup();
  const c = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  await rejectsWith(cancelCycle(db, c.id, c.version, { reason: '' }), 'invalido');
  const x = await cancelCycle(db, c.id, c.version, { reason: 'Sem chuva' });
  assert.equal(x.status, 'CANCELADA');
  assert.equal(x.reason, 'Sem chuva');
  const tipos = (await eventsFor(db, 'crop_cycle', c.id)).map((e) => e.type);
  assert.deepEqual(tipos, ['crop_cycle.opened', 'crop_cycle.cancelled']);
  await rejectsWith(planCycle(db, c.id, x.version, { plannedStart: '2026-12-01', plannedEnd: '2027-01-01' }), 'transicao_invalida');
  await rejectsWith(cancelCycle(db, c.id, x.version, { reason: 'de novo' }), 'transicao_invalida');
});

test('transições fora da ordem são recusadas e nada muda', async () => {
  const { db, farm, crop } = await setup();
  const c = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  await rejectsWith(startCycle(db, c.id, c.version, { actualStart: '2026-12-05' }), 'transicao_invalida');
  await rejectsWith(closeCycle(db, c.id, c.version, { reason: 'x' }), 'transicao_invalida');
  const depois = await getCycle(db, c.id);
  assert.equal(depois?.status, 'RASCUNHO');
  assert.equal(depois?.version, c.version);
  assert.equal((await eventsFor(db, 'crop_cycle', c.id)).length, 1);
});

test('datas inválidas ou incoerentes não são corrigidas em silêncio', async () => {
  const { db, farm, crop } = await setup();
  const c = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  await rejectsWith(planCycle(db, c.id, c.version, { plannedStart: '2027-03-01', plannedEnd: '2026-12-01' }), 'invalido');
  await rejectsWith(planCycle(db, c.id, c.version, { plannedStart: '01/12/2026', plannedEnd: '2027-03-01' }), 'invalido');
  await rejectsWith(planCycle(db, c.id, c.version, { plannedStart: '2026-02-30', plannedEnd: '2027-03-01' }), 'invalido');
  assert.equal((await getCycle(db, c.id))?.status, 'RASCUNHO');
});

test('versão desatualizada gera conflito legível e não altera a safra', async () => {
  const { db, farm, crop } = await setup();
  const c = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  await planCycle(db, c.id, c.version, { plannedStart: '2026-12-01', plannedEnd: '2027-03-01' });
  await rejectsWith(cancelCycle(db, c.id, c.version, { reason: 'tarde demais' }), 'conflito_de_versao');
  assert.equal((await getCycle(db, c.id))?.status, 'PLANEJADA');
});

test('o banco recusa safra de propriedade inexistente (chave estrangeira ligada)', async () => {
  const { db, crop } = await setup();
  await assert.rejects(
    db.run(
      "insert into crop_cycle (id, farm_id, crop_type_id, status, version, created_at) values ('c', 'fantasma', ?, 'RASCUNHO', 1, 'x')",
      [crop.id],
    ),
  );
});

test('backup e restauração preservam propriedade, cultura, safras e eventos', async () => {
  const { db, farm, crop } = await setup();
  let c = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  c = await planCycle(db, c.id, c.version, { plannedStart: '2026-12-01', plannedEnd: '2027-03-01' });
  const arquivo = await exportBackup(db);

  const destino = await freshDb();
  await createFarm(destino, { name: 'Outra', timezone: 'America/Bahia' });
  await importBackup(destino, arquivo);
  await importBackup(destino, arquivo);

  assert.equal(await exportBackup(destino), arquivo);
  assert.deepEqual((await listFarms(destino)).map((f) => f.name), ['Sítio Boa Vista']);
  const volta = await getCycle(destino, c.id);
  assert.equal(volta?.status, 'PLANEJADA');
  assert.equal((await eventsFor(destino, 'crop_cycle', c.id)).length, 2);
});
