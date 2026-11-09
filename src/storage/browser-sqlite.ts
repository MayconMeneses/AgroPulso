import type { Database, Row, SqlValue } from './database.ts';
import type { KeyValueStore } from './key-value.ts';
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

// Uma única conexão por aba, aberta uma vez e reaproveitada. Antes cada leitura e cada gravação abria uma conexão nova e
// nunca fechava, e elas se acumulavam durante o uso.
let connection: Promise<IDBDatabase> | null = null;
function idb(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => {
      req.result.onversionchange = () => { req.result.close(); connection = null; }; // outra aba ou limpeza pediu para trocar ou apagar o banco
      resolve(req.result);
    };
    req.onerror = () => { connection = null; reject(req.error); };
  });
  return connection;
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

// Mesma gaveta do IndexedDB que guarda os bytes do banco, com outras chaves. Quem limpa os dados do site apaga as duas
// coisas juntas (não dá para zerar só a licença ou o relógio). Nada disto entra na exportação, que lê só as tabelas do SQLite.
export function browserKeyValueStore(): KeyValueStore {
  return {
    async get(key) {
      const db = await idb();
      return new Promise((resolve, reject) => {
        const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(`kv:${key}`);
        req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
        req.onerror = () => reject(req.error);
      });
    },
    async set(key, value) {
      const db = await idb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, `kv:${key}`);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
}

export async function openBrowserSqlite(SQL: SqlJsStatic): Promise<Database> {
  const saved = await readBytes();
  let raw = new SQL.Database(saved ?? undefined);
  raw.run('pragma foreign_keys = on');
  let inTransaction = false;
  // Últimos bytes gravados com sucesso: servem para desfazer o COMMIT se a gravação seguinte falhar.
  let savedBytes: Uint8Array | null = saved;

  // Grava no IndexedDB depois de cada mudança concluída. export() do sql.js reinicia as pragmas da conexão,
  // então a chave estrangeira é religada logo depois.
  const persist = createSaver(async () => {
    const bytes = raw.export();
    raw.run('pragma foreign_keys = on');
    await writeBytes(bytes);
    savedBytes = bytes;
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
        try {
          await persist();
        } catch (error) {
          // export() do sql.js recusa com transação aberta, então o COMMIT não pode vir depois da gravação. Se a
          // gravação falhar, voltamos à última imagem durável para o chamador ver tudo desfeito, como o contrato promete.
          raw.close();
          raw = new SQL.Database(savedBytes ?? undefined);
          raw.run('pragma foreign_keys = on');
          throw error;
        }
        return result;
      } catch (error) {
        if (inTransaction) raw.exec('ROLLBACK');
        inTransaction = false;
        throw error;
      }
    },
    async close() {
      await persist(); // espera a fila esvaziar; falha de gravação vai para quem chamou
      raw.close();
      raw = undefined as never;
    },
  };
}
