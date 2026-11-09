import type { Database, Row, SqlValue } from '../storage/database.ts';
import { DomainError } from './errors.ts';

// Trava de somente leitura (ADR-014 §6). Toda gravação do app passa por Database.run/exec/all, então a trava fica ali, num
// ponto só, e não em botões escondidos na tela. Quando a licença não permite escrever, qualquer comando que mude o banco é
// recusado, salvo os de `app_meta` (data da última cópia, preferências e a própria licença). Ver, gerar relatório e baixar a
// cópia continuam funcionando. Regra: na dúvida, bloqueia (comando desconhecido conta como gravação).

export const ALWAYS_WRITABLE_TABLES: readonly string[] = ['app_meta'];

export interface SqlClass {
  writes: string[]; // tabelas que o comando altera ('?' = comando de gravação sem tabela reconhecida, como create ou drop)
}

const CONTROL = new Set(['begin', 'commit', 'end', 'rollback', 'savepoint', 'release']);
const READ_FIRST = new Set(['select', 'explain', 'values']);
// PRAGMAs que só leem. Qualquer outra forma (inclusive `nome(valor)` e `nome = valor`) é gravação:
// uma pragma desconhecida não pode ser provada inofensiva, então entra no lado seguro.
const READ_PRAGMAS = new Set([
  'table_info', 'table_xinfo', 'table_list', 'foreign_key_check', 'index_list', 'index_info', 'index_xinfo',
  'database_list', 'compile_options', 'integrity_check', 'quick_check',
]);

// Tira comentários e textos entre aspas simples: o que está dentro deles nunca deve enganar a classificação.
function strip(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
}

const norm = (name: string): string => name.replace(/^main\./i, '').replace(/["`[\]]/g, '').toLowerCase();

// Classifica um texto SQL em "lê só" (writes vazio) ou "grava nestas tabelas".
export function classifySql(sql: string): SqlClass {
  const writes: string[] = [];
  for (const raw of strip(sql).split(';')) {
    const stmt = raw.trim();
    if (stmt === '') continue;
    const first = (/^[a-z]+/i.exec(stmt)?.[0] ?? '').toLowerCase();
    if (CONTROL.has(first) || READ_FIRST.has(first)) continue;
    if (first === 'pragma') {
      const name = /^pragma\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/i.exec(stmt)?.[1]?.toLowerCase();
      if (!name || !READ_PRAGMAS.has(name)) writes.push('?');
      continue;
    }
    // Procura toda gravação dentro do comando (inclusive "with ... insert ..."), cada uma com a sua tabela.
    const found = [...stmt.matchAll(/\b(?:insert\s+(?:or\s+\w+\s+)?into|replace\s+into|(?<!\bdo\s+)update\s+(?:or\s+\w+\s+)?|delete\s+from)\s*((?:main\.)?(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|\w+))/gi)];
    for (const m of found) writes.push(norm(m[1] as string));
    const other = /\b(create|drop|alter|vacuum|reindex|attach|detach|analyze)\b/i.test(stmt);
    if (first === 'with') {
      if (found.length === 0 && !other) continue; // "with" só de leitura
    }
    if (other) writes.push('?');
    if (found.length === 0 && first !== 'with' && !other) writes.push('?'); // primeira palavra desconhecida: bloqueia
  }
  return { writes };
}

export const isWriteAllowedWhenLocked = (c: SqlClass): boolean => c.writes.every((t) => ALWAYS_WRITABLE_TABLES.includes(t));

export interface GuardPolicy {
  canWrite: () => boolean; // consultado a cada comando: ativar uma licença destrava na hora
  message: () => string; // texto mostrado à pessoa
}

const raws = new WeakMap<Database, Database>();

// Devolve o banco original, sem a trava. Só para o que precisa continuar valendo com a licença vencida e já é seguro por
// natureza: restaurar uma cópia de segurança (são os dados do próprio cliente voltando).
export function unguarded(db: Database): Database {
  return raws.get(db) ?? db;
}

export function guardDatabase(db: Database, policy: GuardPolicy): Database {
  const check = (sql: string): void => {
    if (policy.canWrite()) return;
    if (isWriteAllowedWhenLocked(classifySql(sql))) return;
    throw new DomainError('somente_leitura', policy.message());
  };
  const guarded: Database = {
    exec: async (sql: string): Promise<void> => { check(sql); await db.exec(sql); },
    run: async (sql: string, params?: SqlValue[]): Promise<void> => { check(sql); await db.run(sql, params); },
    all: async (sql: string, params?: SqlValue[]): Promise<Row[]> => { check(sql); return db.all(sql, params); },
    transaction: <T>(fn: () => Promise<T>): Promise<T> => db.transaction(fn),
    close: () => db.close(),
  };
  raws.set(guarded, db);
  return guarded;
}
