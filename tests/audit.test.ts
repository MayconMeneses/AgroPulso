import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BackupError } from '../src/backup/errors.ts';
import { exportBackup } from '../src/backup/export.ts';
import { MAX_BACKUP_CHARS, importBackup } from '../src/backup/import.ts';
import { sha256Hex } from '../src/backup/codec.ts';
import { createFarm, listFarms } from '../src/domain/farms.ts';
import { createPlot, listPlots } from '../src/domain/plots.ts';
import { migrations } from '../src/migrations/migrations.ts';
import { currentVersion, migrate } from '../src/migrations/runner.ts';
import { openNodeSqlite } from '../src/storage/node-sqlite.ts';
import { StorageError, createSaver } from '../src/storage/saver.ts';
import { freshDb } from './helpers.ts';

async function rejectsBackup(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof BackupError && e.code === code);
}

// Refaz o arquivo com o hash certo depois de mexer no conteúdo (simula um arquivo editado por quem sabe recalcular o hash).
async function forge(text: string, edit: (payload: { tables: Record<string, Record<string, unknown>[]> }) => void, schemaVersion?: number): Promise<string> {
  const f = JSON.parse(text);
  const payload = JSON.parse(f.payload);
  edit(payload);
  f.payload = JSON.stringify(payload);
  f.sha256 = await sha256Hex(f.payload);
  if (schemaVersion !== undefined) f.schemaVersion = schemaVersion;
  return JSON.stringify(f);
}

async function currentDb() {
  const db = openNodeSqlite();
  await migrate(db, migrations);
  return db;
}

test('AUD-01: backup feito antes de uma atualização continua valendo (o app se atualiza sozinho)', async () => {
  for (const old of [5, 6, 8]) {
    const antigo = openNodeSqlite();
    await migrate(antigo, migrations.slice(0, old));
    await antigo.run("insert into farm (id, name, timezone, version, created_at) values ('f1', 'Sítio', 'America/Recife', 1, '2026-01-01')");
    const arquivo = await exportBackup(antigo);
    assert.equal(JSON.parse(arquivo).schemaVersion, old);

    const atual = await currentDb();
    await createFarm(atual, { name: 'Será substituída', timezone: 'America/Recife' });
    await importBackup(atual, arquivo);
    assert.deepEqual((await listFarms(atual)).map((f) => f.name), ['Sítio'], `v${old}`);
    assert.equal(await currentVersion(atual), migrations.length, 'o banco continua na versão atual');
    for (const t of ['worker', 'work_entry', 'stock_item']) {
      if (old < 9 || t.startsWith('stock')) assert.equal(Number((await atual.all(`select count(*) as n from ${t}`))[0]?.n), 0, `${t} fica vazia`);
    }
  }
});

test('AUD-02: backup de esquema mais novo que o app, tabela desconhecida e coluna desconhecida são recusados', async () => {
  const atual = await currentDb();
  await createFarm(atual, { name: 'Sítio', timezone: 'America/Recife' });
  const arquivo = await exportBackup(atual);
  const velho = openNodeSqlite();
  await migrate(velho, migrations.slice(0, 8));
  await rejectsBackup(importBackup(velho, arquivo), 'versao_incompativel');

  const outro = await currentDb();
  await rejectsBackup(importBackup(outro, await forge(arquivo, (p) => { p.tables.tabela_inventada = []; })), 'estrutura');
  await rejectsBackup(importBackup(outro, await forge(arquivo, (p) => { p.tables.farm![0]!.coluna_inventada = 'x'; })), 'estrutura');
  await rejectsBackup(importBackup(outro, await forge(arquivo, (p) => { delete p.tables.farm![0]!.name; })), 'estrutura');
  assert.equal((await listFarms(outro)).length, 0, 'nada foi gravado');
});

test('AUD-03: arquivo gigante, base64 quebrado, chave __proto__ e anexo que mente sobre o tipo são recusados', async () => {
  const db = await currentDb();
  await rejectsBackup(importBackup(db, 'x'.repeat(MAX_BACKUP_CHARS + 1)), 'arquivo_grande');
  const base = await exportBackup(db);
  await db.run("insert into farm (id, name, timezone, version, created_at) values ('f1', 'Sítio', 'America/Recife', 1, '2026-01-01')");
  await db.run("insert into crop_type (id, name, created_at) values ('c1', 'Milho', '2026-01-01')");
  await db.run("insert into crop_cycle (id, farm_id, crop_type_id, status, version, created_at) values ('y1', 'f1', 'c1', 'RASCUNHO', 1, '2026-01-01')");
  await db.run("insert into activity_type (id, name, is_application) values ('t1', 'Plantio', 0)");
  await db.run("insert into field_activity (id, cycle_id, type_id, occurred_on, state, author, version, created_at) values ('a1', 'y1', 't1', '2026-01-01', 'REALIZADA', 'Ana', 1, '2026-01-01')");
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  await db.run("insert into attachment (id, activity_id, name, mime, size, data, created_at) values ('x1', 'a1', 'f.png', 'image/png', ?, ?, '2026-01-01')", [png.byteLength, png]);
  const bom = await exportBackup(db);
  const alvo = await currentDb();
  await importBackup(alvo, bom); // o legítimo passa

  await rejectsBackup(importBackup(alvo, await forge(bom, (p) => { p.tables.attachment![0]!.data = { $blob: '@@não é base64@@' }; })), 'estrutura');
  await rejectsBackup(importBackup(alvo, await forge(bom, (p) => { p.tables.attachment![0]!.mime = 'image/svg+xml'; })), 'estrutura');
  await rejectsBackup(importBackup(alvo, await forge(bom, (p) => { p.tables.attachment![0]!.size = 999; })), 'estrutura');
  await rejectsBackup(importBackup(alvo, await forge(bom, (p) => { p.tables.attachment![0]!.data = { $blob: btoa('<svg onload=alert(1)>') }; })), 'estrutura');
  const proto = JSON.parse(base);
  const pl = JSON.parse(proto.payload);
  pl.tables.farm = [JSON.parse('{"__proto__": {"$blob": "AA=="}, "id": "f9", "name": "x", "timezone": "America/Recife", "version": 1, "created_at": "d"}')];
  proto.payload = JSON.stringify(pl);
  proto.sha256 = await sha256Hex(proto.payload);
  await rejectsBackup(importBackup(alvo, JSON.stringify(proto)), 'estrutura');
  assert.equal(({} as Record<string, unknown>).$blob, undefined, 'Object.prototype intacto');
  assert.equal((await alvo.all('select count(*) as n from attachment'))[0]?.n, 1, 'o dado anterior ficou como estava');
});

test('AUD-10: o limite do arquivo de backup acomoda os anexos no teto em base64', async () => {
  const { MAX_ATTACHMENTS_TOTAL_BYTES } = await import('../src/domain/attachments.ts');
  const piorCaso = Math.ceil(MAX_ATTACHMENTS_TOTAL_BYTES / 3) * 4; // base64 ocupa 4/3 dos bytes
  assert.ok(MAX_BACKUP_CHARS >= piorCaso + 8 * 1024 * 1024, 'o JSON em volta e os demais dados têm folga');
  assert.ok(MAX_BACKUP_CHARS <= piorCaso + 32 * 1024 * 1024, 'a folga continua pequena');
});

test('AUD-04: contorno de talhão ilegível (backup mexido ou antigo) não derruba a lista nem entra no banco', async () => {
  const db = await currentDb();
  const farm = await createFarm(db, { name: 'Sítio', timezone: 'America/Recife' });
  const plot = await createPlot(db, { farmId: farm.id, name: 'A' });
  await db.run('update plot set outline_json = ? where id = ?', ['isso nao e json', plot.id]);
  assert.equal((await listPlots(db, farm.id))[0]?.outline, null, 'vale como sem contorno');
  await db.run('update plot set outline_json = ? where id = ?', ['[{"latMicro": 1, "lonMicro": 2}]', plot.id]);
  assert.equal((await listPlots(db, farm.id))[0]?.outline, null, 'poucos pontos também');

  const bom = await exportBackup(db);
  const alvo = await currentDb();
  await rejectsBackup(importBackup(alvo, await forge(bom, (p) => { p.tables.plot![0]!.outline_json = '{"a": 1}'; })), 'estrutura');
});

test('AUD-05: depois de uma gravação que falha, as seguintes voltam a gravar (a fila não fica envenenada)', async () => {
  let falhar = true;
  const gravadas: number[] = [];
  let n = 0;
  const salvar = createSaver(async () => {
    n++;
    if (falhar) throw new Error('cota estourada');
    gravadas.push(n);
  });
  await assert.rejects(salvar(), (e: unknown) => e instanceof StorageError && /Não foi possível gravar/.test(e.message));
  falhar = false;
  await salvar();
  await salvar();
  assert.deepEqual(gravadas, [2, 3]);
  // pedidos em sequência rápida continuam em ordem, e um que falha não impede o seguinte
  falhar = true;
  const a = salvar().catch((e) => e);
  falhar = false;
  const b = salvar();
  assert.ok((await a) instanceof Error || (await a) === undefined);
  await b;
});

test('AUD-06: o app recusa o hash certo com conteúdo alterado e aceita o mesmo arquivo duas vezes', async () => {
  const db = await currentDb();
  await createFarm(db, { name: 'Sítio', timezone: 'America/Recife' });
  const arquivo = await exportBackup(db);
  const adulterado = JSON.parse(arquivo);
  adulterado.payload = adulterado.payload.replace('Sítio', 'Hack!');
  await rejectsBackup(importBackup(db, JSON.stringify(adulterado)), 'checksum');
  const alvo = await freshDb().then(() => currentDb());
  await importBackup(alvo, arquivo);
  await importBackup(alvo, arquivo);
  assert.equal((await listFarms(alvo)).length, 1);
});

test('AUD-07: backup protegido por senha: cifra, decifra, recusa senha errada, arquivo mexido e parâmetros fracos', async () => {
  const { decryptBackup, encryptBackup, isEncryptedBackup, ITERATIONS } = await import('../src/backup/crypto.ts');
  const db = await currentDb();
  await createFarm(db, { name: 'Sítio da Maria', timezone: 'America/Recife' });
  const plain = await exportBackup(db);
  await rejectsBackup(encryptBackup(plain, 'curta'), 'senha_fraca');
  const cifrado = await encryptBackup(plain, 'uma senha bem longa 123');
  assert.equal(isEncryptedBackup(cifrado), true);
  assert.equal(isEncryptedBackup(plain), false);
  assert.ok(!cifrado.includes('Maria'), 'nada legível no arquivo cifrado');
  assert.ok(!cifrado.includes('Sítio'));
  assert.equal(JSON.parse(cifrado).encrypted.iterations, ITERATIONS);
  assert.equal(await decryptBackup(cifrado, 'uma senha bem longa 123'), plain);
  await rejectsBackup(decryptBackup(cifrado, 'senha errada errada'), 'senha');
  // o app não restaura arquivo cifrado sem a senha
  const alvo = await currentDb();
  await rejectsBackup(importBackup(alvo, cifrado), 'senha_necessaria');
  await importBackup(alvo, await decryptBackup(cifrado, 'uma senha bem longa 123'));
  assert.equal((await listFarms(alvo)).length, 1);
  // cada cifragem usa sal e IV novos
  const outro = await encryptBackup(plain, 'uma senha bem longa 123');
  assert.notEqual(JSON.parse(outro).encrypted.salt, JSON.parse(cifrado).encrypted.salt);
  assert.notEqual(JSON.parse(outro).encrypted.iv, JSON.parse(cifrado).encrypted.iv);
  // adulteração: um byte do conteúdo, o IV, o sal e as iterações declaradas
  const mexe = (edit: (e: Record<string, unknown>) => void) => { const o = JSON.parse(cifrado); edit(o.encrypted); return JSON.stringify(o); };
  const data = JSON.parse(cifrado).encrypted.data as string;
  const trocado = (data[10] === 'A' ? 'B' : 'A');
  await rejectsBackup(decryptBackup(mexe((e) => { e.data = data.slice(0, 10) + trocado + data.slice(11); }), 'uma senha bem longa 123'), 'senha');
  await rejectsBackup(decryptBackup(mexe((e) => { e.iv = JSON.parse(outro).encrypted.iv; }), 'uma senha bem longa 123'), 'senha');
  await rejectsBackup(decryptBackup(mexe((e) => { e.iterations = 1000; }), 'uma senha bem longa 123'), 'estrutura');
  await rejectsBackup(decryptBackup(mexe((e) => { e.iterations = 10_000_000_000; }), 'uma senha bem longa 123'), 'estrutura');
  await rejectsBackup(decryptBackup(mexe((e) => { e.kdf = 'MD5'; }), 'uma senha bem longa 123'), 'estrutura');
  await rejectsBackup(decryptBackup(mexe((e) => { e.salt = '@@@'; }), 'uma senha bem longa 123'), 'arquivo_invalido');
  await rejectsBackup(decryptBackup('lixo', 'uma senha bem longa 123'), 'arquivo_invalido');
});

test('AUD-08: chave geral dos recursos de internet: ligada por padrão, desligar vale e fica auditado', async () => {
  const { onlineFeaturesEnabled, setOnlineFeatures } = await import('../src/domain/location.ts');
  const { eventsFor } = await import('../src/domain/audit.ts');
  const db = await currentDb();
  assert.equal(await onlineFeaturesEnabled(db), true);
  await setOnlineFeatures(db, false);
  assert.equal(await onlineFeaturesEnabled(db), false);
  await setOnlineFeatures(db, false);
  await setOnlineFeatures(db, true);
  assert.equal(await onlineFeaturesEnabled(db), true);
  assert.equal((await eventsFor(db, 'app_meta', 'recursos_online')).length, 3);
  const outro = await currentDb();
  await importBackup(outro, await exportBackup(db));
  assert.equal(await onlineFeaturesEnabled(outro), true);
});

test('AUD-09: o total de anexos tem teto, e remover um anexo libera espaço', async () => {
  const { addAttachment, removeAttachment, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_TOTAL_BYTES } = await import('../src/domain/attachments.ts');
  const db = await currentDb();
  await db.run("insert into farm (id, name, timezone, version, created_at) values ('f1', 'S', 'America/Recife', 1, 'd')");
  await db.run("insert into crop_type (id, name, created_at) values ('c1', 'M', 'd')");
  await db.run("insert into crop_cycle (id, farm_id, crop_type_id, status, version, created_at) values ('y1', 'f1', 'c1', 'RASCUNHO', 1, 'd')");
  await db.run("insert into activity_type (id, name, is_application) values ('t1', 'P', 0)");
  await db.run("insert into field_activity (id, cycle_id, type_id, occurred_on, state, author, version, created_at) values ('a1', 'y1', 't1', '2026-01-01', 'REALIZADA', 'Ana', 1, 'd')");
  const png = new Uint8Array(MAX_ATTACHMENT_BYTES);
  png.set([0x89, 0x50, 0x4e, 0x47]);
  const ids: string[] = [];
  for (let i = 0; i < Math.floor(MAX_ATTACHMENTS_TOTAL_BYTES / MAX_ATTACHMENT_BYTES); i++) ids.push((await addAttachment(db, { activityId: 'a1', name: `f${i}.png`, bytes: png })).id);
  await assert.rejects(addAttachment(db, { activityId: 'a1', name: 'mais.png', bytes: png }), /limite/);
  await removeAttachment(db, ids[0] as string, 'liberar espaço');
  await addAttachment(db, { activityId: 'a1', name: 'cabe.png', bytes: png });
});
