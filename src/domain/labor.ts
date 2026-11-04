import type { Database } from '../storage/database.ts';
import { recordEvent } from './audit.ts';
import { MICRO } from './decimal.ts';
import { DomainError } from './errors.ts';
import { getEntry, recordEntryTx, voidEntryTx } from './financial.ts';
import { assertCycleWritable, assertDateText, findByKey, assertNameLength } from './guards.ts';

export type WorkerKind = 'CONTRATADO' | 'FAMILIAR';
export type PayType = 'DIARIA' | 'MENSAL';

export interface Worker {
  id: string;
  farmId: string;
  name: string;
  kind: WorkerKind;
  payType: PayType;
  rateCents: number | null; // valor da diária ou do salário do mês
}

export interface WorkRow {
  id: string;
  workerId: string;
  workerName: string;
  kind: WorkerKind;
  payType: PayType;
  occurredOn: string;
  daysMicro: number | null;
  sharePercent: number | null;
  amountCents: number | null;
  note: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface WorkSummary {
  workerId: string;
  workerName: string;
  kind: WorkerKind;
  payType: PayType;
  daysMicro: number; // soma dos dias (diária)
  sharePercent: number; // soma das partes de mensal lançadas nesta safra
  amountCents: number;
}

const MAX_DAYS_MICRO = 31 * MICRO;

// Funcionário contratado: a diária ou o salário do mês é obrigatório, porque o custo da safra sai dele.
// Pessoa da família: o valor é opcional; sem ele, o trabalho fica anotado, mas sem valor (nunca se inventa um).
export async function createWorker(db: Database, input: { farmId: string; name: string; kind: WorkerKind; payType: PayType; rateCents?: number }): Promise<Worker> {
  const name = input.name.trim();
  assertNameLength(name);
  if (name === '') throw new DomainError('invalido', 'Informe o nome da pessoa');
  if (input.kind !== 'CONTRATADO' && input.kind !== 'FAMILIAR') throw new DomainError('invalido', 'Escolha se é funcionário contratado ou da família');
  if (input.payType !== 'DIARIA' && input.payType !== 'MENSAL') throw new DomainError('invalido', 'Escolha o pagamento: diária ou mensal');
  if (input.rateCents !== undefined && (!Number.isSafeInteger(input.rateCents) || input.rateCents <= 0)) throw new DomainError('invalido', 'O valor deve ser maior que zero');
  if (input.kind === 'CONTRATADO' && input.rateCents === undefined) throw new DomainError('invalido', 'Informe o valor da diária ou do salário do funcionário contratado');
  const w: Worker = { id: crypto.randomUUID(), farmId: input.farmId, name, kind: input.kind, payType: input.payType, rateCents: input.rateCents ?? null };
  await db.transaction(async () => {
    if ((await db.all('select 1 as ok from farm where id = ?', [input.farmId])).length === 0) throw new DomainError('invalido', 'Propriedade inválida');
    if ((await db.all('select 1 as ok from worker where farm_id = ? and lower(name) = lower(?)', [input.farmId, name])).length > 0) throw new DomainError('duplicado', 'Já existe uma pessoa com esse nome nesta propriedade');
    await db.run('insert into worker (id, farm_id, name, kind, pay_type, rate_cents, created_at) values (?, ?, ?, ?, ?, ?, ?)', [w.id, w.farmId, name, w.kind, w.payType, w.rateCents, new Date().toISOString()]);
    await recordEvent(db, { type: 'worker.created', resource: 'worker', resourceId: w.id, after: { name, kind: w.kind, payType: w.payType, rateCents: w.rateCents } });
  });
  return w;
}

const toWorker = (r: Record<string, unknown>): Worker => ({
  id: String(r.id), farmId: String(r.farm_id), name: String(r.name), kind: String(r.kind) as WorkerKind, payType: String(r.pay_type) as PayType,
  rateCents: r.rate_cents === null ? null : Number(r.rate_cents),
});

export async function listWorkers(db: Database, farmId: string): Promise<Worker[]> {
  return (await db.all('select id, farm_id, name, kind, pay_type, rate_cents from worker where farm_id = ? order by name, id', [farmId])).map(toWorker);
}

export function dailyCostCents(rateCents: number, daysMicro: number): number {
  return Number((BigInt(rateCents) * BigInt(daysMicro) + BigInt(MICRO / 2)) / BigInt(MICRO));
}
export function monthlyCostCents(rateCents: number, sharePercent: number): number {
  return Number((BigInt(rateCents) * BigInt(sharePercent) + 50n) / 100n);
}

// Diária: informe os dias (aceita metade, 0,5). Mensal: informe que parte do salário do mês vai para esta safra (1 a 100 %);
// o total do mês de uma pessoa não passa de 100 % somando todas as safras. O custo é calculado e lançado como despesa de
// mão de obra: contratado entra no custo registrado; da família fica na linha separada (RN-AG-020), nunca no resultado.
export async function recordWork(
  db: Database,
  input: { workerId: string; cycleId: string; occurredOn: string; daysMicro?: number; sharePercent?: number; note?: string; author: string; idempotencyKey?: string; justification?: string },
): Promise<{ id: string; amountCents: number | null; warning: string | null }> {
  assertDateText(input.occurredOn, 'Data do trabalho');
  if (input.author.trim() === '') throw new DomainError('invalido', 'Informe quem registrou');
  const id = crypto.randomUUID();
  return db.transaction(async () => {
    const dup = await findByKey(db, 'work_entry', input.idempotencyKey);
    if (dup) {
      const r = (await db.all('select amount_cents from work_entry where id = ?', [dup]))[0];
      return { id: dup, amountCents: r?.amount_cents === null || r === undefined ? null : Number(r.amount_cents), warning: null };
    }
    const wr = (await db.all('select id, farm_id, name, kind, pay_type, rate_cents from worker where id = ?', [input.workerId]))[0];
    if (!wr) throw new DomainError('invalido', 'Pessoa inválida');
    const w = toWorker(wr);
    const { farmId } = await assertCycleWritable(db, input.cycleId, input.justification);
    if (farmId !== w.farmId) throw new DomainError('invalido', 'A pessoa e a safra precisam ser da mesma propriedade');

    let days: number | null = null;
    let share: number | null = null;
    let amount: number | null = null;
    if (w.payType === 'DIARIA') {
      days = input.daysMicro ?? 0;
      if (!Number.isSafeInteger(days) || days <= 0 || days > MAX_DAYS_MICRO) throw new DomainError('invalido', 'Informe os dias trabalhados (de 0,5 até 31)');
      if (w.rateCents !== null) amount = dailyCostCents(w.rateCents, days);
    } else {
      share = input.sharePercent ?? 0;
      if (!Number.isInteger(share) || share < 1 || share > 100) throw new DomainError('invalido', 'Informe quantos % do salário do mês vão para esta safra (de 1 a 100)');
      const used = Number((await db.all("select coalesce(sum(share_percent), 0) as t from work_entry where worker_id = ? and voided_at is null and substr(occurred_on, 1, 7) = ?", [w.id, input.occurredOn.slice(0, 7)]))[0]?.t ?? 0);
      if (used + share > 100) throw new DomainError('invalido', `Este mês de ${w.name} já tem ${used}% lançado. Sobram ${100 - used}%`);
      if (w.rateCents !== null) amount = monthlyCostCents(w.rateCents, share);
    }
    if (amount !== null && amount <= 0) throw new DomainError('invalido', 'O valor calculado ficou zero. Confira os dias ou a parte do mês');

    let finId: string | null = null;
    if (amount !== null) {
      const cat = (await db.all("select id from cost_category where lower(name) in ('mão de obra', 'mao de obra') limit 1"))[0];
      const how = w.payType === 'DIARIA' ? `${(days as number) / MICRO} dia(s) x diária` : `${share}% do salário do mês`;
      const e = await recordEntryTx(db, {
        farmId, cycleId: input.cycleId, kind: 'DESPESA', categoryId: cat ? String(cat.id) : undefined, amountCents: amount, occurredOn: input.occurredOn,
        counterparty: w.name, familyLabor: w.kind === 'FAMILIAR', allocationCriterion: `Mão de obra: ${how}`, author: input.author, justification: input.justification,
      });
      finId = e.id;
    }
    await db.run(
      'insert into work_entry (id, worker_id, cycle_id, occurred_on, days_micro, share_percent, amount_cents, financial_entry_id, note, author, idempotency_key, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, w.id, input.cycleId, input.occurredOn, days, share, amount, finId, input.note?.trim() || null, input.author.trim(), input.idempotencyKey ?? null, new Date().toISOString()],
    );
    await recordEvent(db, { type: 'work.recorded', resource: 'work_entry', resourceId: id, reason: input.justification ?? null, after: { workerId: w.id, cycleId: input.cycleId, occurredOn: input.occurredOn, daysMicro: days, sharePercent: share, amountCents: amount } });
    return { id, amountCents: amount, warning: amount === null ? 'Trabalho anotado sem valor: esta pessoa da família não tem diária nem salário cadastrado, então nada entrou na conta.' : null };
  });
}

// Anular o trabalho anula também a despesa que ele gerou, com o mesmo motivo. O histórico fica.
export async function voidWork(db: Database, id: string, reason: string): Promise<void> {
  if (reason.trim() === '') throw new DomainError('invalido', 'Informe o motivo de anular');
  await db.transaction(async () => {
    const r = (await db.all('select financial_entry_id, voided_at from work_entry where id = ?', [id]))[0];
    if (!r) throw new DomainError('nao_encontrado', 'Registro de trabalho não encontrado');
    if (r.voided_at !== null) throw new DomainError('transicao_invalida', 'Este registro já foi anulado');
    if (r.financial_entry_id !== null) {
      const e = await getEntry(db, String(r.financial_entry_id));
      if (e) await voidEntryTx(db, e.id, e.version, reason);
    }
    await db.run('update work_entry set voided_at = ?, void_reason = ? where id = ?', [new Date().toISOString(), reason.trim(), id]);
    await recordEvent(db, { type: 'work.voided', resource: 'work_entry', resourceId: id, reason: reason.trim() });
  });
}

const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function listWork(db: Database, cycleId: string): Promise<WorkRow[]> {
  const rows = await db.all(
    'select e.id, e.worker_id, w.name, w.kind, w.pay_type, e.occurred_on, e.days_micro, e.share_percent, e.amount_cents, e.note, e.voided_at, e.void_reason from work_entry e join worker w on w.id = e.worker_id where e.cycle_id = ? order by e.occurred_on, e.id',
    [cycleId],
  );
  return rows.map((r) => ({
    id: String(r.id), workerId: String(r.worker_id), workerName: String(r.name), kind: String(r.kind) as WorkerKind, payType: String(r.pay_type) as PayType,
    occurredOn: String(r.occurred_on), daysMicro: n(r.days_micro), sharePercent: n(r.share_percent), amountCents: n(r.amount_cents), note: r.note === null ? null : String(r.note),
    voidedAt: r.voided_at === null ? null : String(r.voided_at), voidReason: r.void_reason === null ? null : String(r.void_reason),
  }));
}

export async function laborSummary(db: Database, cycleId: string): Promise<WorkSummary[]> {
  const rows = await db.all(
    'select w.id, w.name, w.kind, w.pay_type, coalesce(sum(e.days_micro), 0) as d, coalesce(sum(e.share_percent), 0) as s, coalesce(sum(e.amount_cents), 0) as a from work_entry e join worker w on w.id = e.worker_id where e.cycle_id = ? and e.voided_at is null group by w.id, w.name, w.kind, w.pay_type order by w.name',
    [cycleId],
  );
  return rows.map((r) => ({ workerId: String(r.id), workerName: String(r.name), kind: String(r.kind) as WorkerKind, payType: String(r.pay_type) as PayType, daysMicro: Number(r.d), sharePercent: Number(r.s), amountCents: Number(r.a) }));
}
