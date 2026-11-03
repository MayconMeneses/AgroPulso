import type { Migration } from './runner.ts';

// Fase 1: só a base. Tabelas de domínio (propriedade, safra, custo...) entram nas fases 2 a 4.
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'base',
    sql: 'create table app_meta (key text primary key, value text not null) strict',
  },
];
