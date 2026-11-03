import { migrations } from '../src/migrations/migrations.ts';
import { migrate } from '../src/migrations/runner.ts';
import type { Migration } from '../src/migrations/runner.ts';
import { openNodeSqlite } from '../src/storage/node-sqlite.ts';
import type { Database } from '../src/storage/database.ts';

// Tabela só de teste: serve para provar que o backup preserva dados de qualquer tipo
// sem puxar tabelas de domínio das fases 2 a 4.
export const testTable: Migration = {
  version: 2,
  name: 'tabela_de_teste',
  sql: 'create table lote (id integer primary key, nome text not null, qtd real, foto blob, obs text) strict',
};

export async function freshDb(): Promise<Database> {
  const db = openNodeSqlite();
  await migrate(db, [...migrations, testTable]);
  return db;
}

export async function seed(db: Database): Promise<void> {
  await db.run('insert into app_meta (key, value) values (?, ?)', ['perfil', 'João da Roça ✓']);
  await db.run('insert into lote (nome, qtd, foto, obs) values (?, ?, ?, ?)', [
    'Milho\n"1"',
    12.5,
    new Uint8Array([0, 1, 2, 255]),
    null,
  ]);
  await db.run('insert into lote (nome, qtd, foto, obs) values (?, ?, ?, ?)', ['Feijão', 0, new Uint8Array([]), 'ok']);
}
