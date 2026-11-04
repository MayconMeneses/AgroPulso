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
  {
    version: 3,
    name: 'unidades_e_talhoes',
    sql: `
      create table unit (
        id text primary key,
        name text not null check (length(trim(name)) > 0),
        kind text not null check (kind in ('area','massa','volume','contagem'))
      ) strict;
      create table unit_conversion (
        from_unit text not null references unit(id),
        to_unit text not null references unit(id),
        crop_type_id text references crop_type(id),
        factor_micro integer not null check (factor_micro > 0),
        source text not null check (length(trim(source)) > 0),
        created_at text not null
      ) strict;
      create table plot (
        id text primary key,
        farm_id text not null references farm(id),
        name text not null check (length(trim(name)) > 0),
        area_declared_micro integer check (area_declared_micro > 0),
        area_measured_micro integer check (area_measured_micro > 0),
        area_unit_id text references unit(id),
        created_at text not null
      ) strict;
      create index plot_farm on plot (farm_id);
      alter table crop_cycle add column plot_id text references plot(id);
    `,
  },
  {
    version: 4,
    name: 'atividades_e_anexos',
    sql: `
      create table activity_type (
        id text primary key,
        name text not null check (length(trim(name)) > 0),
        is_application integer not null check (is_application in (0, 1))
      ) strict;
      create table field_activity (
        id text primary key,
        cycle_id text not null references crop_cycle(id),
        type_id text not null references activity_type(id),
        occurred_on text not null,
        state text not null check (state in ('PLANEJADA','REALIZADA')),
        notes text,
        author text not null check (length(trim(author)) > 0),
        version integer not null,
        idempotency_key text unique,
        created_at text not null
      ) strict;
      create index field_activity_cycle on field_activity (cycle_id, occurred_on);
      create table attachment (
        id text primary key,
        activity_id text not null references field_activity(id),
        name text not null,
        mime text not null,
        size integer not null check (size > 0),
        data blob not null,
        created_at text not null
      ) strict;
      create index attachment_activity on attachment (activity_id);
    `,
  },
  {
    version: 5,
    name: 'custos_e_producao',
    sql: `
      create table cost_category (
        id text primary key,
        name text not null check (length(trim(name)) > 0)
      ) strict;
      create table financial_entry (
        id text primary key,
        farm_id text not null references farm(id),
        cycle_id text references crop_cycle(id),
        kind text not null check (kind in ('DESPESA','ENTRADA')),
        category_id text references cost_category(id),
        amount_cents integer not null check (amount_cents > 0),
        occurred_on text not null,
        paid_on text,
        source text,
        counterparty text,
        family_labor integer not null check (family_labor in (0, 1)),
        allocation_criterion text,
        author text not null check (length(trim(author)) > 0),
        version integer not null,
        idempotency_key text unique,
        created_at text not null
      ) strict;
      create index financial_entry_farm on financial_entry (farm_id, occurred_on);
      create index financial_entry_cycle on financial_entry (cycle_id);
      create table harvest_entry (
        id text primary key,
        cycle_id text not null references crop_cycle(id),
        harvested_on text not null,
        quantity_micro integer not null check (quantity_micro > 0),
        unit_id text not null references unit(id),
        author text not null check (length(trim(author)) > 0),
        version integer not null,
        idempotency_key text unique,
        created_at text not null
      ) strict;
      create index harvest_entry_cycle on harvest_entry (cycle_id, harvested_on);
      create table sale (
        id text primary key,
        cycle_id text not null references crop_cycle(id),
        harvest_id text references harvest_entry(id),
        sold_on text not null,
        quantity_micro integer not null check (quantity_micro > 0),
        unit_id text not null references unit(id),
        amount_cents integer not null check (amount_cents > 0),
        buyer text,
        author text not null check (length(trim(author)) > 0),
        version integer not null,
        idempotency_key text unique,
        created_at text not null
      ) strict;
      create index sale_cycle on sale (cycle_id, sold_on);
      create table sale_receipt (
        id text primary key,
        sale_id text not null references sale(id),
        received_on text not null,
        amount_cents integer not null check (amount_cents > 0),
        idempotency_key text unique,
        created_at text not null
      ) strict;
      create index sale_receipt_sale on sale_receipt (sale_id);
    `,
  },
  {
    version: 6,
    name: 'estoque',
    sql: `
      create table stock_item (
        id text primary key,
        farm_id text not null references farm(id),
        name text not null check (length(trim(name)) > 0),
        unit_id text not null references unit(id),
        min_micro integer check (min_micro >= 0),
        created_at text not null
      ) strict;
      create index stock_item_farm on stock_item (farm_id);
      create table stock_movement (
        id text primary key,
        item_id text not null references stock_item(id),
        kind text not null check (kind in ('ENTRADA','SAIDA','AJUSTE')),
        delta_micro integer not null check (delta_micro <> 0),
        occurred_on text not null,
        cycle_id text references crop_cycle(id),
        note text,
        author text not null check (length(trim(author)) > 0),
        idempotency_key text unique,
        created_at text not null
      ) strict;
      create index stock_movement_item on stock_movement (item_id, occurred_on);
    `,
  },
  {
    version: 7,
    name: 'local_da_propriedade',
    sql: `
      alter table farm add column lat_micro integer;
      alter table farm add column lon_micro integer;
    `,
  },
  {
    version: 8,
    name: 'anulacao_estimativa_e_contorno',
    sql: `
      alter table financial_entry add column voided_at text;
      alter table financial_entry add column void_reason text;
      alter table crop_cycle add column harvest_estimate_micro integer;
      alter table crop_cycle add column harvest_estimate_unit_id text references unit(id);
      alter table plot add column outline_json text;
    `,
  },
];
