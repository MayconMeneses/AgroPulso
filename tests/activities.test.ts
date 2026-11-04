import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportBackup } from '../src/backup/export.ts';
import { importBackup } from '../src/backup/import.ts';
import {
  APPLICATION_NOTICE,
  createActivityType,
  getActivity,
  listActivities,
  listActivityTypes,
  recordActivity,
  updateActivity,
} from '../src/domain/activities.ts';
import { addAttachment, listAttachments, readAttachment, sniffMime } from '../src/domain/attachments.ts';
import { eventsFor } from '../src/domain/audit.ts';
import { createCropType } from '../src/domain/crop-types.ts';
import { cancelCycle, openCycle } from '../src/domain/cycles.ts';
import { DomainError } from '../src/domain/errors.ts';
import { createFarm } from '../src/domain/farms.ts';
import { freshDb } from './helpers.ts';

async function rejectsWith(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof DomainError && e.code === code);
}

async function setup() {
  const db = await freshDb();
  const farm = await createFarm(db, { name: 'Sítio', timezone: 'America/Recife' });
  const crop = await createCropType(db, { name: 'Milho' });
  const cycle = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  const capina = await createActivityType(db, { name: 'Capina' });
  const defensivo = await createActivityType(db, { name: 'Aplicação', isApplication: true });
  return { db, farm, cycle, capina, defensivo };
}

const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]);

test('nenhum tipo de atividade vem pronto; nome repetido é recusado', async () => {
  const db = await freshDb();
  assert.deepEqual(await listActivityTypes(db), []);
  await createActivityType(db, { name: 'Plantio' });
  await rejectsWith(createActivityType(db, { name: 'plantio' }), 'duplicado');
});

test('atividade grava autor e data; aplicação traz o aviso e o sistema não prescreve', async () => {
  const { db, cycle, capina, defensivo } = await setup();
  const a = await recordActivity(db, { cycleId: cycle.id, typeId: capina.id, occurredOn: '2026-12-10', author: 'Maycon' });
  assert.equal(a.author, 'Maycon');
  assert.equal(a.state, 'REALIZADA');
  assert.equal(a.notice, null);
  const b = await recordActivity(db, { cycleId: cycle.id, typeId: defensivo.id, occurredOn: '2026-12-11', author: 'Maycon', notes: 'produto declarado' });
  assert.equal(b.notice, APPLICATION_NOTICE);
  await rejectsWith(recordActivity(db, { cycleId: cycle.id, typeId: capina.id, occurredOn: '2026-12-10', author: ' ' }), 'invalido');
  await rejectsWith(recordActivity(db, { cycleId: cycle.id, typeId: capina.id, occurredOn: '10/12/2026', author: 'M' }), 'invalido');
  await rejectsWith(recordActivity(db, { cycleId: 'x', typeId: capina.id, occurredOn: '2026-12-10', author: 'M' }), 'invalido');
  await rejectsWith(recordActivity(db, { cycleId: cycle.id, typeId: 'x', occurredOn: '2026-12-10', author: 'M' }), 'invalido');
  assert.equal((await listActivities(db, cycle.id)).length, 2);
});

test('a mesma chave reenviada não duplica a atividade', async () => {
  const { db, cycle, capina } = await setup();
  const base = { cycleId: cycle.id, typeId: capina.id, occurredOn: '2026-12-10', author: 'M', idempotencyKey: 'k1' };
  const a = await recordActivity(db, base);
  const b = await recordActivity(db, base);
  assert.equal(a.id, b.id);
  assert.equal((await listActivities(db, cycle.id)).length, 1);
  assert.equal((await eventsFor(db, 'field_activity', a.id)).length, 1);
});

test('tarefa planejada vira realizada; edição deixa histórico com antes e depois', async () => {
  const { db, cycle, capina } = await setup();
  const t = await recordActivity(db, { cycleId: cycle.id, typeId: capina.id, occurredOn: '2026-12-20', author: 'M', state: 'PLANEJADA' });
  assert.equal(t.state, 'PLANEJADA');
  const feita = await updateActivity(db, t.id, t.version, { state: 'REALIZADA', occurredOn: '2026-12-21', notes: 'feito' }, 'Maria');
  assert.equal(feita.state, 'REALIZADA');
  assert.equal(feita.version, 2);
  const ev = await eventsFor(db, 'field_activity', t.id);
  assert.deepEqual(ev.map((e) => e.type), ['activity.recorded', 'activity.updated']);
  assert.match(String(ev[1]?.before_json), /PLANEJADA/);
  assert.match(String(ev[1]?.after_json), /Maria/);
  await rejectsWith(updateActivity(db, t.id, t.version, { notes: 'tarde' }, 'M'), 'conflito_de_versao');
  await rejectsWith(updateActivity(db, t.id, feita.version, { state: 'REALIZADA' }, 'M'), 'transicao_invalida');
});

test('safra cancelada só aceita registro com justificativa, que fica no evento', async () => {
  const { db, cycle, capina } = await setup();
  await cancelCycle(db, cycle.id, cycle.version, { reason: 'seca' });
  const input = { cycleId: cycle.id, typeId: capina.id, occurredOn: '2026-12-10', author: 'M' };
  await rejectsWith(recordActivity(db, input), 'transicao_invalida');
  const a = await recordActivity(db, { ...input, justification: 'lançamento esquecido' });
  assert.equal((await eventsFor(db, 'field_activity', a.id))[0]?.reason, 'lançamento esquecido');
});

test('anexo: tipo vem do conteúdo, tamanho limitado, nome saneado', async () => {
  const { db, cycle, capina } = await setup();
  const a = await recordActivity(db, { cycleId: cycle.id, typeId: capina.id, occurredOn: '2026-12-10', author: 'M' });
  const foto = await addAttachment(db, { activityId: a.id, name: '../../etc/passwd.jpg', bytes: JPG });
  assert.equal(foto.mime, 'image/jpeg');
  assert.equal(foto.name, 'passwd.jpg');
  assert.deepEqual(await readAttachment(db, foto.id), JPG);
  // extensão enganosa: o conteúdo manda
  await rejectsWith(addAttachment(db, { activityId: a.id, name: 'foto.jpg', bytes: new TextEncoder().encode('<script>alert(1)</script>') }), 'invalido');
  await rejectsWith(addAttachment(db, { activityId: a.id, name: 'a.png', bytes: new Uint8Array(0) }), 'invalido');
  await rejectsWith(addAttachment(db, { activityId: a.id, name: 'g.png', bytes: new Uint8Array(5 * 1024 * 1024 + 1).fill(0x89) }), 'invalido');
  await rejectsWith(addAttachment(db, { activityId: 'nada', name: 'a.png', bytes: PNG }), 'invalido');
  assert.equal(sniffMime(PNG), 'image/png');
  assert.equal((await listAttachments(db, a.id)).length, 1);
});

test('backup preserva atividades e fotos byte a byte', async () => {
  const { db, cycle, capina } = await setup();
  const a = await recordActivity(db, { cycleId: cycle.id, typeId: capina.id, occurredOn: '2026-12-10', author: 'M' });
  const foto = await addAttachment(db, { activityId: a.id, name: 'f.jpg', bytes: JPG });
  const arquivo = await exportBackup(db);
  const destino = await freshDb();
  await importBackup(destino, arquivo);
  assert.deepEqual(await readAttachment(destino, foto.id), JPG);
  assert.equal((await getActivity(destino, a.id))?.author, 'M');
  assert.equal(await exportBackup(destino), arquivo);
});
