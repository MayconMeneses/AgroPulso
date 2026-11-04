import type { Database } from '../storage/database.ts';
import { recordEvent } from './audit.ts';
import { DomainError } from './errors.ts';
import { assertCycleWritable, assertDateText, findByKey, assertNameLength } from './guards.ts';

export interface CostCategory {
  id: string;
  name: string;
}

export interface FinancialEntry {
  id: string;
  farmId: string;
  cycleId: string | null;
  kind: 'DESPESA' | 'ENTRADA';
  categoryId: string | null;
  amountCents: number;
  occurredOn: string;
  paidOn: string | null;
  source: string | null;
  counterparty: string | null;
  familyLabor: boolean;
  allocationCriterion: string | null;
  author: string;
  version: number;
}

// RN-AG-019: as categorias de custo são do usuário. Só nomes comuns são oferecidos uma vez (defaults.ts).
export async function createCostCategory(db: Database, input: { name: string }): Promise<CostCategory> {
  const name = input.name.trim();
  assertNameLength(name);
  if (name === '') throw new DomainError('invalido', 'Informe o nome da categoria');
  const c = { id: crypto.randomUUID(), name };
  await db.transaction(async () => {
    if ((await db.all('select 1 as ok from cost_category where lower(name) = lower(?)', [name])).length > 0) {
      throw new DomainError('duplicado', 'Já existe uma categoria com esse nome');
    }
    await db.run('insert into cost_category (id, name) values (?, ?)', [c.id, name]);
    await recordEvent(db, { type: 'cost_category.created', resource: 'cost_category', resourceId: c.id, after: { name } });
  });
  return c;
}

export async function listCostCategories(db: Database): Promise<CostCategory[]> {
  return (await db.all('select id, name from cost_category order by name, id')).map((r) => ({ id: String(r.id), name: String(r.name) }));
}

const COLS =
  'id, farm_id, cycle_id, kind, category_id, amount_cents, occurred_on, paid_on, source, counterparty, family_labor, allocation_criterion, author, version';

function str(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

function toEntry(r: Record<string, unknown>): FinancialEntry {
  return {
    id: String(r.id),
    farmId: String(r.farm_id),
    cycleId: str(r.cycle_id),
    kind: String(r.kind) as FinancialEntry['kind'],
    categoryId: str(r.category_id),
    amountCents: Number(r.amount_cents),
    occurredOn: String(r.occurred_on),
    paidOn: str(r.paid_on),
    source: str(r.source),
    counterparty: str(r.counterparty),
    familyLabor: Number(r.family_labor) === 1,
    allocationCriterion: str(r.allocation_criterion),
    author: String(r.author),
    version: Number(r.version),
  };
}

export async function getEntry(db: Database, id: string): Promise<FinancialEntry | null> {
  const r = (await db.all(`select ${COLS} from financial_entry where id = ?`, [id]))[0];
  return r ? toEntry(r) : null;
}

export async function listEntries(db: Database, farmId: string): Promise<FinancialEntry[]> {
  return (await db.all(`select ${COLS} from financial_entry where farm_id = ? and voided_at is null order by occurred_on, id`, [farmId])).map(toEntry);
}

export interface EntryRow extends FinancialEntry {
  voidedAt: string | null;
  voidReason: string | null;
  workId: string | null; // preenchido quando a despesa nasceu de um dia de trabalho (anula-se pelo trabalho)
}

// Para a tela de lançamentos de uma safra: mostra também os anulados, riscados, para o histórico ficar visível.
export async function listCycleEntries(db: Database, cycleId: string): Promise<EntryRow[]> {
  const rows = await db.all(`select ${COLS}, voided_at, void_reason, (select w.id from work_entry w where w.financial_entry_id = financial_entry.id) as work_id from financial_entry where cycle_id = ? order by occurred_on, id`, [cycleId]);
  return rows.map((r) => ({ ...toEntry(r), voidedAt: str(r.voided_at), voidReason: str(r.void_reason), workId: str(r.work_id) }));
}

// "Apagar" um lançamento é anular: ele sai das contas, dos painéis e dos relatórios, mas continua gravado com o motivo,
// a data e quem era o valor, para o histórico não se perder (RN-AG-003). Não há como desfazer pela tela; lança-se de novo.
export async function voidEntryTx(db: Database, id: string, version: number, reason: string): Promise<void> {
  if (reason.trim() === '') throw new DomainError('invalido', 'Informe o motivo de anular o lançamento');
  {
    const cur = await getEntry(db, id);
    if (!cur) throw new DomainError('nao_encontrado', 'Lançamento não encontrado');
    if ((await db.all('select 1 as ok from financial_entry where id = ? and voided_at is not null', [id])).length > 0) throw new DomainError('transicao_invalida', 'Este lançamento já foi anulado');
    if (cur.version !== version) throw new DomainError('conflito_de_versao', 'Este lançamento foi alterado por outra ação. Recarregue e tente de novo');
    if (cur.cycleId) await assertCycleWritable(db, cur.cycleId, reason);
    await db.run('update financial_entry set voided_at = ?, void_reason = ?, version = version + 1 where id = ? and version = ?', [new Date().toISOString(), reason.trim(), id, version]);
    await recordEvent(db, { type: 'expense.voided', resource: 'financial_entry', resourceId: id, reason: reason.trim(), before: { amountCents: cur.amountCents, kind: cur.kind, occurredOn: cur.occurredOn } });
  }
}

export async function voidEntry(db: Database, id: string, version: number, reason: string): Promise<void> {
  await db.transaction(async () => {
    if ((await db.all('select 1 as ok from work_entry where financial_entry_id = ?', [id])).length > 0) throw new DomainError('transicao_invalida', 'Esta despesa veio de um dia de trabalho. Anule o trabalho, e a despesa sai junto');
    await voidEntryTx(db, id, version, reason);
  });
}

// RF-AG-005 / RF-AG-008: valor exato em centavos. Sem safra, o custo fica "não alocado" e não entra no resultado da safra.
// Custo (occurredOn) e pagamento (paidOn) são datas distintas (RN-AG-001).
export async function recordEntryTx(
  db: Database,
  input: {
    farmId: string;
    cycleId?: string;
    kind: 'DESPESA' | 'ENTRADA';
    categoryId?: string;
    amountCents: number;
    occurredOn: string;
    paidOn?: string;
    source?: string;
    counterparty?: string;
    familyLabor?: boolean;
    allocationCriterion?: string;
    author: string;
    idempotencyKey?: string;
    justification?: string;
  },
): Promise<FinancialEntry> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new DomainError('invalido', 'O valor deve ser maior que zero');
  if (input.kind !== 'DESPESA' && input.kind !== 'ENTRADA') throw new DomainError('invalido', 'Tipo de lançamento inválido');
  assertDateText(input.occurredOn, 'Data do lançamento');
  if (input.paidOn !== undefined) assertDateText(input.paidOn, 'Data do pagamento');
  if (input.author.trim() === '') throw new DomainError('invalido', 'Informe quem registrou');
  if (input.familyLabor && input.kind !== 'DESPESA') throw new DomainError('invalido', 'Mão de obra familiar só vale em despesa');
  const id = crypto.randomUUID();
  {
    const dup = await findByKey(db, 'financial_entry', input.idempotencyKey);
    if (dup) return (await getEntry(db, dup)) as FinancialEntry;
    if ((await db.all('select 1 as ok from farm where id = ?', [input.farmId])).length === 0) throw new DomainError('invalido', 'Propriedade inválida');
    if (input.cycleId) {
      const { farmId } = await assertCycleWritable(db, input.cycleId, input.justification);
      if (farmId !== input.farmId) throw new DomainError('invalido', 'A safra não pertence a essa propriedade');
    }
    if (input.categoryId && (await db.all('select 1 as ok from cost_category where id = ?', [input.categoryId])).length === 0) {
      throw new DomainError('invalido', 'Categoria inválida');
    }
    await db.run(
      `insert into financial_entry (${COLS.replace(', version', '')}, version, idempotency_key, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        id,
        input.farmId,
        input.cycleId ?? null,
        input.kind,
        input.categoryId ?? null,
        input.amountCents,
        input.occurredOn,
        input.paidOn ?? null,
        input.source?.trim() || null,
        input.counterparty?.trim() || null,
        input.familyLabor ? 1 : 0,
        input.allocationCriterion?.trim() || null,
        input.author.trim(),
        input.idempotencyKey ?? null,
        new Date().toISOString(),
      ],
    );
    await recordEvent(db, {
      type: 'expense.recorded',
      resource: 'financial_entry',
      resourceId: id,
      reason: input.justification ?? null,
      after: { kind: input.kind, amountCents: input.amountCents, cycleId: input.cycleId ?? null, occurredOn: input.occurredOn },
    });
    return (await getEntry(db, id)) as FinancialEntry;
  }
}

export async function recordEntry(db: Database, input: Parameters<typeof recordEntryTx>[1]): Promise<FinancialEntry> {
  return db.transaction(() => recordEntryTx(db, input));
}

// RN-AG-003: ajuste só por evento e com justificativa; o valor anterior fica no histórico.
export async function correctEntry(
  db: Database,
  id: string,
  version: number,
  change: { amountCents?: number; paidOn?: string | null; justification: string },
): Promise<FinancialEntry> {
  if (change.justification.trim() === '') throw new DomainError('invalido', 'Justificativa obrigatória');
  if (change.amountCents !== undefined && (!Number.isSafeInteger(change.amountCents) || change.amountCents <= 0)) {
    throw new DomainError('invalido', 'O valor deve ser maior que zero');
  }
  if (typeof change.paidOn === 'string') assertDateText(change.paidOn, 'Data do pagamento');
  return db.transaction(async () => {
    const cur = await getEntry(db, id);
    if (!cur) throw new DomainError('nao_encontrado', 'Lançamento não encontrado');
    if (cur.version !== version) throw new DomainError('conflito_de_versao', 'Este lançamento foi alterado por outra ação. Recarregue e tente de novo');
    if ((await db.all('select 1 as ok from financial_entry where id = ? and voided_at is not null', [id])).length > 0) throw new DomainError('transicao_invalida', 'Lançamento anulado não pode ser corrigido');
    if ((await db.all('select 1 as ok from work_entry where financial_entry_id = ?', [id])).length > 0) throw new DomainError('transicao_invalida', 'Esta despesa veio de um dia de trabalho: anule o trabalho e lance de novo');
    const amount = change.amountCents ?? cur.amountCents;
    const paidOn = change.paidOn === undefined ? cur.paidOn : change.paidOn;
    await db.run('update financial_entry set amount_cents = ?, paid_on = ?, version = version + 1 where id = ? and version = ?', [amount, paidOn, id, version]);
    await recordEvent(db, {
      type: 'expense.corrected',
      resource: 'financial_entry',
      resourceId: id,
      reason: change.justification.trim(),
      before: { amountCents: cur.amountCents, paidOn: cur.paidOn },
      after: { amountCents: amount, paidOn },
    });
    return (await getEntry(db, id)) as FinancialEntry;
  });
}
