import type { Database } from '../storage/database.ts';
import { recordEvent } from './audit.ts';
import { DomainError } from './errors.ts';
import { assertCycleWritable, assertDateText, findByKey } from './guards.ts';

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

// RN-AG-019: categorias de custo (adubo, água, mão de obra...) são do usuário; nenhuma vem pronta.
export async function createCostCategory(db: Database, input: { name: string }): Promise<CostCategory> {
  const name = input.name.trim();
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
  return (await db.all(`select ${COLS} from financial_entry where farm_id = ? order by occurred_on, id`, [farmId])).map(toEntry);
}

// RF-AG-005 / RF-AG-008: valor exato em centavos. Sem safra, o custo fica "não alocado" e não entra no resultado da safra.
// Custo (occurredOn) e pagamento (paidOn) são datas distintas (RN-AG-001).
export async function recordEntry(
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
  return db.transaction(async () => {
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
  });
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
