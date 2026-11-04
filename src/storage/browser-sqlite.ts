import type { Database, Row, SqlValue } from './database.ts';
import { createSaver } from './saver.ts';

// Adaptador para o navegador: SQLite compilado para WebAssembly (sql.js) com os bytes do banco guardados no
// IndexedDB. Só roda no navegador; os testes automáticos não o exercitam (ver docs/reports/FASE-05.md).
interface SqlJsStatement {
  bind(params: unknown[]): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): boolean;
}
interface SqlJsDb {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): unknown;
  prepare(sql: string): SqlJsStatement;
  export(): Uint8Array;
  close(): void;
}
export interface SqlJsStatic {
  Database: new (data?: Uint8Array) => SqlJsDb;
}

const IDB_NAME = 'agropulso';
const IDB_STORE = 'db';
const IDB_KEY = 'bytes';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readBytes(): Promise<Uint8Array | null> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function writeBytes(bytes: Uint8Array): Promise<void> {
  const db = await idb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function openBrowserSqlite(SQL: SqlJsStatic): Promise<Database> {
  const saved = await readBytes();
  let raw = new SQL.Database(saved ?? undefined);
  raw.run('pragma foreign_keys = on');
  let inTransaction = false;

  // Grava no IndexedDB depois de cada mudança concluída. export() do sql.js reinicia as pragmas da conexão,
  // então a chave estrangeira é religada logo depois.
  const persist = createSaver(async () => {
    const bytes = raw.export();
    raw.run('pragma foreign_keys = on');
    await writeBytes(bytes);
  });

  const write = async (fn: () => void): Promise<void> => {
    fn();
    if (!inTransaction) await persist();
  };

  return {
    async exec(sql) {
      await write(() => raw.exec(sql));
    },
    async run(sql, params: SqlValue[] = []) {
      await write(() => raw.run(sql, params));
    },
    async all(sql, params: SqlValue[] = []) {
      const stmt = raw.prepare(sql);
      try {
        stmt.bind(params);
        const rows: Row[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as Row);
        return rows;
      } finally {
        stmt.free();
      }
    },
    async transaction(fn) {
      if (inTransaction) throw new Error('Transações aninhadas não são suportadas');
      raw.exec('BEGIN IMMEDIATE');
      inTransaction = true;
      try {
        const result = await fn();
        raw.exec('COMMIT');
        inTransaction = false;
        await persist();
        return result;
      } catch (error) {
        if (inTransaction) raw.exec('ROLLBACK');
        inTransaction = false;
        throw error;
      }
    },
    async close() {
      await persist().catch(() => undefined); // espera a fila esvaziar
      raw.close();
      raw = undefined as never;
    },
  };
}
