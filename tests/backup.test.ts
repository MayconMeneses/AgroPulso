import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sha256Hex } from '../src/backup/codec.ts';
import { BackupError } from '../src/backup/errors.ts';
import { exportBackup } from '../src/backup/export.ts';
import { createCropType } from '../src/domain/crop-types.ts';
import { openCycle } from '../src/domain/cycles.ts';
import { createFarm, listFarms } from '../src/domain/farms.ts';
import { importBackup } from '../src/backup/import.ts';
import { freshDb, seed } from './helpers.ts';

// Reassina o arquivo depois de alterá-lo, para testar as validações além do checksum.
async function forge(file: string, change: (payload: any, outer: any) => void): Promise<string> {
  const outer = JSON.parse(file);
  const payload = JSON.parse(outer.payload);
  change(payload, outer);
  outer.payload = JSON.stringify(payload);
  outer.sha256 = await sha256Hex(outer.payload);
  return JSON.stringify(outer);
}

async function rejectsWith(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (e: unknown) => e instanceof BackupError && e.code === code);
}

test('exportar e importar em um banco novo não perde nada', async () => {
  const origem = await freshDb();
  await seed(origem);
  const arquivo = await exportBackup(origem);

  const destino = await freshDb();
  await importBackup(destino, arquivo);

  assert.equal(await exportBackup(destino), arquivo);
  const lotes = await destino.all('select nome, qtd, foto, obs from lote order by id');
  assert.equal(lotes[0]?.nome, 'Milho\n"1"');
  assert.deepEqual(lotes[0]?.foto, new Uint8Array([0, 1, 2, 255]));
  assert.equal(lotes[0]?.obs, null);
  assert.deepEqual(lotes[1]?.foto, new Uint8Array([]));
});

test('importar o mesmo arquivo duas vezes não duplica', async () => {
  const origem = await freshDb();
  await seed(origem);
  const arquivo = await exportBackup(origem);

  const destino = await freshDb();
  await importBackup(destino, arquivo);
  await importBackup(destino, arquivo);

  const n = await destino.all('select count(*) as n from lote');
  assert.equal(n[0]?.n, 2);
  assert.equal(await exportBackup(destino), arquivo);
});

test('restaurar substitui os dados que já existiam', async () => {
  const origem = await freshDb();
  await seed(origem);
  const arquivo = await exportBackup(origem);

  const destino = await freshDb();
  await destino.run('insert into lote (nome) values (?)', ['velho']);
  await importBackup(destino, arquivo);
  const nomes = await destino.all('select nome from lote order by id');
  assert.deepEqual(nomes.map((r) => r.nome), ['Milho\n"1"', 'Feijão']);
});

test('arquivo adulterado é rejeitado e o banco fica intacto', async () => {
  const origem = await freshDb();
  await seed(origem);
  const arquivo = await exportBackup(origem);
  const adulterado = arquivo.replace('Feij', 'Feiz');
  assert.notEqual(adulterado, arquivo);

  const destino = await freshDb();
  await destino.run('insert into lote (nome) values (?)', ['antes']);
  await rejectsWith(importBackup(destino, adulterado), 'checksum');
  const nomes = await destino.all('select nome from lote');
  assert.deepEqual(nomes.map((r) => r.nome), ['antes']);
});

test('versão errada do formato ou dos dados é rejeitada', async () => {
  const origem = await freshDb();
  await seed(origem);
  const arquivo = await exportBackup(origem);
  const destino = await freshDb();

  const formato = JSON.parse(arquivo);
  formato.formatVersion = 2;
  await rejectsWith(importBackup(destino, JSON.stringify(formato)), 'versao_incompativel');

  // Backup de um esquema MAIS NOVO que o app não vale; os mais antigos valem (ver tests/audit.test.ts).
  const esquema = JSON.parse(arquivo);
  esquema.schemaVersion = 999;
  await rejectsWith(importBackup(destino, JSON.stringify(esquema)), 'versao_incompativel');
  esquema.schemaVersion = 0;
  await rejectsWith(importBackup(destino, JSON.stringify(esquema)), 'estrutura');
});

test('lixo, outro formato e estrutura trocada são rejeitados', async () => {
  const origem = await freshDb();
  await seed(origem);
  const arquivo = await exportBackup(origem);
  const destino = await freshDb();

  await rejectsWith(importBackup(destino, 'isto não é json'), 'arquivo_invalido');
  await rejectsWith(importBackup(destino, '{"format":"outro"}'), 'formato_desconhecido');
  await rejectsWith(
    importBackup(destino, await forge(arquivo, (p) => { p.tables.intrusa = []; })),
    'estrutura',
  );
  await rejectsWith(
    importBackup(destino, await forge(arquivo, (p) => { p.tables.lote[0].coluna_extra = 1; })),
    'estrutura',
  );
  await rejectsWith(
    importBackup(destino, await forge(arquivo, (p) => { p.tables.lote[0].qtd = [1]; })),
    'estrutura',
  );
});

test('backup com registro ligado a algo que não existe é rejeitado e o banco segue usável', async () => {
  const origem = await freshDb();
  const farm = await createFarm(origem, { name: 'Sítio', timezone: 'America/Recife' });
  const crop = await createCropType(origem, { name: 'Milho' });
  await openCycle(origem, { farmId: farm.id, cropTypeId: crop.id });
  const arquivo = await exportBackup(origem);
  const orfao = await forge(arquivo, (p) => { p.tables.crop_cycle[0].farm_id = 'fantasma'; });

  const destino = await freshDb();
  await createFarm(destino, { name: 'Antes', timezone: 'America/Bahia' });
  await rejectsWith(importBackup(destino, orfao), 'estrutura');
  assert.deepEqual((await listFarms(destino)).map((f) => f.name), ['Antes']);
  // a transação foi fechada: o banco aceita novas gravações
  await createFarm(destino, { name: 'Depois', timezone: 'America/Bahia' });
  assert.equal((await listFarms(destino)).length, 2);
});

test('falha no meio da gravação desfaz tudo', async () => {
  const origem = await freshDb();
  await seed(origem);
  const arquivo = await exportBackup(origem);
  // nome é "not null": a segunda linha quebra depois de a primeira já ter sido gravada
  const quebrado = await forge(arquivo, (p) => { p.tables.lote[1].nome = null; });

  const destino = await freshDb();
  await destino.run('insert into lote (nome) values (?)', ['antes']);
  await assert.rejects(importBackup(destino, quebrado));
  const nomes = await destino.all('select nome from lote');
  assert.deepEqual(nomes.map((r) => r.nome), ['antes']);
});
