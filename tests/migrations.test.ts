import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrations } from '../src/migrations/migrations.ts';
import { currentVersion, migrate } from '../src/migrations/runner.ts';
import { openNodeSqlite } from '../src/storage/node-sqlite.ts';

async function tableNames(db: ReturnType<typeof openNodeSqlite>): Promise<string[]> {
  const rows = await db.all("select name from sqlite_master where type = 'table' order by name");
  return rows.map((r) => String(r.name));
}

test('migra um banco vazio até a última versão', async () => {
  const db = openNodeSqlite();
  assert.equal(await currentVersion(db), 0);
  assert.equal(await migrate(db, migrations), migrations.length);
  assert.equal(await currentVersion(db), migrations.length);
  assert.deepEqual(await tableNames(db), ['app_meta', 'schema_migrations']);
});

test('rodar de novo não reaplica nada', async () => {
  const db = openNodeSqlite();
  await migrate(db, migrations);
  await migrate(db, migrations);
  const rows = await db.all('select count(*) as n from schema_migrations');
  assert.equal(rows[0]?.n, migrations.length);
});

test('rejeita migrações fora de ordem', async () => {
  const db = openNodeSqlite();
  await assert.rejects(migrate(db, [{ version: 2, name: 'x', sql: 'select 1' }]), /fora de ordem/);
});

test('rejeita banco mais novo que o app', async () => {
  const db = openNodeSqlite();
  await migrate(db, [...migrations, { version: 2, name: 'y', sql: 'create table y (a text) strict' }]);
  await assert.rejects(migrate(db, migrations), /mais nova que este app/);
});

test('migração que falha desfaz tudo e mantém a versão', async () => {
  const db = openNodeSqlite();
  await migrate(db, migrations);
  const ruim = { version: 2, name: 'ruim', sql: 'create table x (a text) strict; isto nao e sql' };
  await assert.rejects(migrate(db, [...migrations, ruim]));
  assert.equal(await currentVersion(db), 1);
  assert.deepEqual(await tableNames(db), ['app_meta', 'schema_migrations']);
});
