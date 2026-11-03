import type { Migration } from './runner.ts';

// v1: base (Fase 1). v2: núcleo rural (Fase 2): propriedade, cultura, safra e trilha de eventos.
// Custos, colheitas e vendas entram na Fase 4. As chaves estrangeiras ficam sem ON DELETE: o padrão
// (NO ACTION) deixa a restauração de backup apagar tudo e regravar na mesma transação.
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'base',
    sql: 'create table app_meta (key text primary key, value text not null) strict',
  },
  {
    version: 2,
    name: 'nucleo_rural',
    sql: `
      create table farm (
        id text primary key,
        name text not null check (length(trim(name)) > 0),
        timezone text not null,
        version integer not null,
        created_at text not null
      ) strict;
      create table crop_type (
        id text primary key,
        name text not null check (length(trim(name)) > 0),
        created_at text not null
      ) strict;
      create table crop_cycle (
        id text primary key,
        farm_id text not null references farm(id),
        crop_type_id text not null references crop_type(id),
        status text not null check (status in ('RASCUNHO','PLANEJADA','EM_ANDAMENTO','CONCLUIDA','CANCELADA')),
        planned_start text,
        planned_end text,
        actual_start text,
        reason text,
        version integer not null,
        created_at text not null
      ) strict;
      create index crop_cycle_farm on crop_cycle (farm_id);
      create table audit_event (
        seq integer primary key,
        type text not null,
        resource text not null,
        resource_id text not null,
        occurred_at text not null,
        reason text,
        before_json text,
        after_json text
      ) strict;
      create index audit_event_resource on audit_event (resource, resource_id, seq);
    `,
  },
];
