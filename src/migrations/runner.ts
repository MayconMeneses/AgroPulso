import type { Database } from '../storage/database.ts';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

function assertSequential(migrations: Migration[]): void {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(`Migrações fora de ordem: esperada a versão ${i + 1}, encontrada ${m.version}`);
    }
  });
}

export async function currentVersion(db: Database): Promise<number> {
  const hasTable = await db.all("select 1 as ok from sqlite_master where type = 'table' and name = 'schema_migrations'");
  if (hasTable.length === 0) return 0;
  const rows = await db.all('select max(version) as v from schema_migrations');
  return Number(rows[0]?.v ?? 0);
}

// Aplica só para frente, uma migração por transação. Devolve a versão final.
export async function migrate(db: Database, migrations: Migration[]): Promise<number> {
  assertSequential(migrations);
  const current = await currentVersion(db);
  if (current > migrations.length) {
    throw new Error(`O banco está na versão ${current}, mais nova que este app (${migrations.length}). Atualize o app.`);
  }
  await db.exec(
    'create table if not exists schema_migrations (version integer primary key, name text not null, applied_at text not null)',
  );
  for (const m of migrations.slice(current)) {
    await db.transaction(async () => {
      await db.exec(m.sql);
      await db.run('insert into schema_migrations (version, name, applied_at) values (?, ?, ?)', [
        m.version,
        m.name,
        new Date().toISOString(),
      ]);
    });
  }
  return migrations.length;
}
