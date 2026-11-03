import { DatabaseSync } from 'node:sqlite';
import type { Database, Row } from './database.ts';

// Adaptador para desenvolvimento e testes (Node 24, sem dependências).
// Os adaptadores de Android, iOS e Windows entram quando a entrega for decidida (DP-011).
export function openNodeSqlite(path = ':memory:'): Database {
  const raw = new DatabaseSync(path);
  let inTransaction = false;

  return {
    async exec(sql) {
      raw.exec(sql);
    },
    async run(sql, params = []) {
      raw.prepare(sql).run(...params);
    },
    async all(sql, params = []) {
      return raw.prepare(sql).all(...params) as Row[];
    },
    async transaction(fn) {
      if (inTransaction) throw new Error('Transações aninhadas não são suportadas');
      raw.exec('BEGIN IMMEDIATE');
      inTransaction = true;
      try {
        const result = await fn();
        raw.exec('COMMIT');
        return result;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      } finally {
        inTransaction = false;
      }
    },
    async close() {
      raw.close();
    },
  };
}
