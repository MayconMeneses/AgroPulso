import type { Database } from '../storage/database.ts';

// Nomes vêm do próprio banco (nunca do arquivo de backup); mesmo assim são escapados.
export function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

// Tabelas de dados do usuário: tudo, menos o controle interno de migrações.
export async function userTables(db: Database): Promise<string[]> {
  const rows = await db.all(
    "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name <> 'schema_migrations' order by name",
  );
  return rows.map((r) => String(r.name));
}

export async function columnNames(db: Database, table: string): Promise<string[]> {
  const rows = await db.all(`pragma table_info(${quote(table)})`);
  return rows.map((r) => String(r.name));
}
