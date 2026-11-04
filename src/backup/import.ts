import type { Database, SqlValue } from '../storage/database.ts';
import { sniffMime } from '../domain/attachments.ts';
import { assertOutline } from '../domain/geo.ts';
import { currentVersion } from '../migrations/runner.ts';
import { FORMAT, FORMAT_VERSION, decodeRow, sha256Hex } from './codec.ts';
import { BackupError } from './errors.ts';
import { columnNames, quote, userTables } from './schema.ts';

// Um backup legítimo é bem menor que isso (fotos ficam limitadas a 5 MB cada). O teto evita travar o aparelho
// ao abrir por engano um arquivo gigante.
export const MAX_BACKUP_CHARS = 120 * 1024 * 1024;

interface BackupFile {
  schemaVersion: number;
  sha256: string;
  payload: string;
}

function parseFile(text: string): BackupFile {
  if (text.length > MAX_BACKUP_CHARS) throw new BackupError('arquivo_grande', 'O arquivo é grande demais para ser um backup do AgroPulso');
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    throw new BackupError('arquivo_invalido', 'O arquivo não é um backup do AgroPulso');
  }
  const f = file as Record<string, unknown> | null;
  if (typeof f === 'object' && f !== null && f.format === FORMAT && typeof f.encrypted === 'object') {
    throw new BackupError('senha_necessaria', 'Este backup tem senha. Informe a senha para restaurar');
  }
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

// O app se atualiza sozinho, então um backup feito antes de uma atualização tem que continuar valendo. Backup de uma versão
// ANTERIOR do esquema é aceito quando só traz tabelas e colunas que o app atual ainda tem: o que o backup não conhece fica
// vazio ou no padrão da coluna. Se uma atualização futura mudar o significado de dados antigos, ela precisa trazer a sua
// própria conversão (e um teste). Backup de versão MAIS NOVA que o app é recusado.
// Restaurar SUBSTITUI todos os dados atuais. Tudo é validado antes de tocar no banco; o que falhar durante a gravação desfaz
// a transação e deixa os dados como estavam. Importar o mesmo arquivo de novo termina no mesmo estado, sem duplicar.
export async function importBackup(db: Database, text: string): Promise<void> {
  const file = parseFile(text);
  const dbVersion = await currentVersion(db);
  if (file.schemaVersion > dbVersion) {
    throw new BackupError('versao_incompativel', `O backup é da versão ${file.schemaVersion} dos dados e este app está na ${dbVersion}. Atualize o app antes de restaurar`);
  }
  if (file.schemaVersion < 1) throw new BackupError('estrutura', 'Backup incompleto');
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
  const inFile = Object.keys(tables);
  const older = file.schemaVersion < dbVersion;
  if (older ? !inFile.every((t) => names.includes(t)) : JSON.stringify([...inFile].sort()) !== JSON.stringify(names)) {
    throw new BackupError('estrutura', 'As tabelas do backup não batem com as do app');
  }

  const plan: { table: string; columns: string[]; rows: Record<string, SqlValue>[] }[] = [];
  for (const table of names) {
    const rawRows = (tables as Record<string, unknown>)[table];
    if (rawRows === undefined && older) {
      plan.push({ table, columns: [], rows: [] }); // tabela criada depois do backup: fica vazia
      continue;
    }
    if (!Array.isArray(rawRows)) throw new BackupError('estrutura', `Tabela "${table}" inválida`);
    const current = await columnNames(db, table);
    const rows = rawRows.map(decodeRow);
    const columns = rows[0] ? Object.keys(rows[0]) : [];
    for (const row of rows) {
      const keys = Object.keys(row);
      const same = keys.length === columns.length && keys.every((k) => columns.includes(k));
      const known = keys.every((k) => current.includes(k));
      const complete = older || keys.length === current.length;
      if (!same || !known || !complete) throw new BackupError('estrutura', `Colunas da tabela "${table}" não batem com as do app`);
      checkRow(table, row);
    }
    plan.push({ table, columns, rows });
  }

  await db.transaction(async () => {
    await db.run('pragma defer_foreign_keys = on');
    for (const { table } of plan) await db.run(`delete from ${quote(table)}`);
    for (const { table, columns, rows } of plan) {
      if (rows.length === 0) continue;
      const sql = `insert into ${quote(table)} (${columns.map(quote).join(', ')}) values (${columns.map(() => '?').join(', ')})`;
      for (const row of rows) await db.run(sql, columns.map((c) => row[c] as SqlValue));
    }
    // As chaves estrangeiras estão adiadas até o COMMIT; checar aqui faz a falha virar BackupError
    // e desfazer a transação antes de o COMMIT ser tentado.
    const orfaos = await db.all('pragma foreign_key_check');
    if (orfaos.length > 0) {
      throw new BackupError('estrutura', 'O backup tem registros ligados a dados que não existem');
    }
  });
}

// Conteúdo que o app mostra ou usa depois sem desconfiar: o tipo do anexo vem do conteúdo, e o contorno do talhão é
// uma lista de pontos. Um arquivo de backup editado à mão não pode contrabandear nada diferente disso.
function checkRow(table: string, row: Record<string, SqlValue>): void {
  if (table === 'attachment') {
    const data = row.data;
    if (!(data instanceof Uint8Array) || sniffMime(data) !== row.mime || row.size !== data.byteLength) {
      throw new BackupError('estrutura', 'Um anexo do backup não confere com o próprio conteúdo');
    }
  }
  if (table === 'plot' && typeof row.outline_json === 'string') {
    try {
      assertOutline(JSON.parse(row.outline_json));
    } catch {
      throw new BackupError('estrutura', 'O contorno de um talhão no backup é inválido');
    }
  }
}
