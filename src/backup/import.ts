import type { Database, SqlValue } from '../storage/database.ts';
import { currentVersion } from '../migrations/runner.ts';
import { FORMAT, FORMAT_VERSION, decodeRow, sha256Hex } from './codec.ts';
import { BackupError } from './errors.ts';
import { columnNames, quote, userTables } from './schema.ts';

interface BackupFile {
  schemaVersion: number;
  sha256: string;
  payload: string;
}

function parseFile(text: string): BackupFile {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    throw new BackupError('arquivo_invalido', 'O arquivo não é um backup do AgroPulso');
  }
  const f = file as Record<string, unknown> | null;
  if (typeof f !== 'object' || f === null || f.format !== FORMAT) {
    throw new BackupError('formato_desconhecido', 'O arquivo não é um backup do AgroPulso');
  }
  if (f.formatVersion !== FORMAT_VERSION) {
    throw new BackupError('versao_incompativel', 'Este backup foi feito por outra versão do formato');
  }
  if (!Number.isInteger(f.schemaVersion) || typeof f.sha256 !== 'string' || typeof f.payload !== 'string') {
    throw new BackupError('estrutura', 'Backup incompleto');
  }
  return { schemaVersion: f.schemaVersion as number, sha256: f.sha256, payload: f.payload };
}

// Restaurar SUBSTITUI todos os dados atuais. Tudo é validado antes de tocar no banco;
// o que falhar durante a gravação desfaz a transação e deixa os dados como estavam.
// Importar o mesmo arquivo de novo termina no mesmo estado, sem duplicar.
// F1 só aceita backup da mesma versão do esquema; migrar backups antigos fica para depois.
export async function importBackup(db: Database, text: string): Promise<void> {
  const file = parseFile(text);
  const dbVersion = await currentVersion(db);
  if (file.schemaVersion !== dbVersion) {
    throw new BackupError(
      'versao_incompativel',
      `O backup é da versão ${file.schemaVersion} dos dados e este app está na ${dbVersion}`,
    );
  }
  if ((await sha256Hex(file.payload)) !== file.sha256) {
    throw new BackupError('checksum', 'O arquivo está corrompido ou foi alterado');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(file.payload);
  } catch {
    throw new BackupError('estrutura', 'Backup incompleto');
  }
  const tables = (parsed as { tables?: unknown } | null)?.tables;
  if (typeof tables !== 'object' || tables === null || Array.isArray(tables)) {
    throw new BackupError('estrutura', 'Backup incompleto');
  }

  const names = await userTables(db);
  if (JSON.stringify(Object.keys(tables).sort()) !== JSON.stringify(names)) {
    throw new BackupError('estrutura', 'As tabelas do backup não batem com as do app');
  }

  const plan: { table: string; columns: string[]; rows: Record<string, SqlValue>[] }[] = [];
  for (const table of names) {
    const rawRows = (tables as Record<string, unknown>)[table];
    if (!Array.isArray(rawRows)) throw new BackupError('estrutura', `Tabela "${table}" inválida`);
    const columns = await columnNames(db, table);
    const rows = rawRows.map(decodeRow);
    for (const row of rows) {
      if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify([...columns].sort())) {
        throw new BackupError('estrutura', `Colunas da tabela "${table}" não batem com as do app`);
      }
    }
    plan.push({ table, columns, rows });
  }

  await db.transaction(async () => {
    await db.run('pragma defer_foreign_keys = on');
    for (const { table } of plan) await db.run(`delete from ${quote(table)}`);
    for (const { table, columns, rows } of plan) {
      const sql = `insert into ${quote(table)} (${columns.map(quote).join(', ')}) values (${columns.map(() => '?').join(', ')})`;
      for (const row of rows) await db.run(sql, columns.map((c) => row[c] as SqlValue));
    }
  });
}
