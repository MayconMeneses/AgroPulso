import type { Database } from '../storage/database.ts';
import { recordEvent } from './audit.ts';
import { DomainError } from './errors.ts';
import { assertCycleWritable, assertDateText, findByKey, assertNameLength } from './guards.ts';

export interface StockItem {
  id: string;
  farmId: string;
  name: string;
  unitId: string;
  minMicro: number | null;
  balanceMicro: number;
  low: boolean;
}

export interface StockMovement {
  id: string;
  itemId: string;
  kind: 'ENTRADA' | 'SAIDA' | 'AJUSTE';
  deltaMicro: number;
  occurredOn: string;
  cycleId: string | null;
  note: string | null;
  author: string;
}

// Estoque de insumos (adubo, semente, defensivo, ração...). Cada item tem uma unidade só e o saldo é a soma dos
// movimentos: não há saldo gravado que possa sair de acordo. Nada vem cadastrado e não há conversão automática.
export async function createStockItem(db: Database, input: { farmId: string; name: string; unitId: string; minMicro?: number }): Promise<StockItem> {
  const name = input.name.trim();
  assertNameLength(name);
  if (name === '') throw new DomainError('invalido', 'Informe o nome do item');
  if (input.minMicro !== undefined && (!Number.isSafeInteger(input.minMicro) || input.minMicro < 0)) throw new DomainError('invalido', 'O estoque mínimo não pode ser negativo');
  const id = crypto.randomUUID();
  await db.transaction(async () => {
    if ((await db.all('select 1 as ok from farm where id = ?', [input.farmId])).length === 0) throw new DomainError('invalido', 'Propriedade inválida');
    if ((await db.all('select 1 as ok from unit where id = ?', [input.unitId])).length === 0) throw new DomainError('invalido', 'Unidade obrigatória e existente');
    if ((await db.all('select 1 as ok from stock_item where farm_id = ? and lower(name) = lower(?)', [input.farmId, name])).length > 0) {
      throw new DomainError('duplicado', 'Já existe um item com esse nome nesta propriedade');
    }
    await db.run('insert into stock_item (id, farm_id, name, unit_id, min_micro, created_at) values (?, ?, ?, ?, ?, ?)', [id, input.farmId, name, input.unitId, input.minMicro ?? null, new Date().toISOString()]);
    await recordEvent(db, { type: 'stock_item.created', resource: 'stock_item', resourceId: id, after: { name, unitId: input.unitId, minMicro: input.minMicro ?? null } });
  });
  return (await getStockItem(db, id)) as StockItem;
}

const ITEM_SQL = `select i.id, i.farm_id, i.name, i.unit_id, i.min_micro, coalesce((select sum(m.delta_micro) from stock_movement m where m.item_id = i.id), 0) as balance from stock_item i`;

function toItem(r: Record<string, unknown>): StockItem {
  const min = r.min_micro === null || r.min_micro === undefined ? null : Number(r.min_micro);
  const balance = Number(r.balance);
  return { id: String(r.id), farmId: String(r.farm_id), name: String(r.name), unitId: String(r.unit_id), minMicro: min, balanceMicro: balance, low: min !== null && balance <= min };
}

export async function getStockItem(db: Database, id: string): Promise<StockItem | null> {
  const r = (await db.all(`${ITEM_SQL} where i.id = ?`, [id]))[0];
  return r ? toItem(r) : null;
}

export async function listStockItems(db: Database, farmId: string): Promise<StockItem[]> {
  return (await db.all(`${ITEM_SQL} where i.farm_id = ? order by i.name, i.id`, [farmId])).map(toItem);
}

// ENTRADA e SAIDA recebem quantidade positiva. AJUSTE (contagem, perda, quebra) recebe a diferença com sinal e exige motivo.
// O saldo nunca fica negativo: sair mais do que existe é recusado. O histórico só se acrescenta, nunca é apagado.
export async function recordMovement(
  db: Database,
  input: { itemId: string; kind: StockMovement['kind']; quantityMicro: number; occurredOn: string; cycleId?: string; note?: string; author: string; idempotencyKey?: string; justification?: string },
): Promise<StockItem> {
  if (!['ENTRADA', 'SAIDA', 'AJUSTE'].includes(input.kind)) throw new DomainError('invalido', 'Tipo de movimento inválido');
  if (!Number.isSafeInteger(input.quantityMicro) || input.quantityMicro === 0) throw new DomainError('invalido', 'A quantidade deve ser diferente de zero');
  if (input.kind !== 'AJUSTE' && input.quantityMicro < 0) throw new DomainError('invalido', 'A quantidade deve ser maior que zero');
  if (input.kind === 'AJUSTE' && (input.note ?? '').trim() === '') throw new DomainError('invalido', 'Ajuste de estoque exige o motivo');
  assertDateText(input.occurredOn, 'Data do movimento');
  if (input.author.trim() === '') throw new DomainError('invalido', 'Informe quem registrou');
  if (input.cycleId && input.kind !== 'SAIDA') throw new DomainError('invalido', 'Só a saída pode ser ligada a uma safra');
  const delta = input.kind === 'SAIDA' ? -input.quantityMicro : input.quantityMicro;
  const id = crypto.randomUUID();
  return db.transaction(async () => {
    const dup = await findByKey(db, 'stock_movement', input.idempotencyKey);
    const item = await getStockItem(db, input.itemId);
    if (!item) throw new DomainError('invalido', 'Item de estoque inválido');
    if (dup) return item;
    if (input.cycleId) {
      const { farmId } = await assertCycleWritable(db, input.cycleId, input.justification);
      if (farmId !== item.farmId) throw new DomainError('invalido', 'A safra não pertence à propriedade deste item');
    }
    if (item.balanceMicro + delta < 0) throw new DomainError('invalido', 'Não há estoque suficiente: o saldo ficaria negativo');
    await db.run(
      'insert into stock_movement (id, item_id, kind, delta_micro, occurred_on, cycle_id, note, author, idempotency_key, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, input.itemId, input.kind, delta, input.occurredOn, input.cycleId ?? null, input.note?.trim() || null, input.author.trim(), input.idempotencyKey ?? null, new Date().toISOString()],
    );
    await recordEvent(db, { type: `stock.${input.kind.toLowerCase()}`, resource: 'stock_movement', resourceId: id, reason: input.justification ?? input.note ?? null, before: { balanceMicro: item.balanceMicro }, after: { balanceMicro: item.balanceMicro + delta, deltaMicro: delta } });
    return (await getStockItem(db, input.itemId)) as StockItem;
  });
}

export async function listMovements(db: Database, itemId: string): Promise<StockMovement[]> {
  return (await db.all('select id, item_id, kind, delta_micro, occurred_on, cycle_id, note, author from stock_movement where item_id = ? order by occurred_on desc, created_at desc, id', [itemId])).map((r) => ({
    id: String(r.id), itemId: String(r.item_id), kind: String(r.kind) as StockMovement['kind'], deltaMicro: Number(r.delta_micro), occurredOn: String(r.occurred_on),
    cycleId: r.cycle_id === null ? null : String(r.cycle_id), note: r.note === null ? null : String(r.note), author: String(r.author),
  }));
}
