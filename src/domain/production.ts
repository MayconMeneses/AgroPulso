import type { Database } from '../storage/database.ts';
import { recordEvent } from './audit.ts';
import { DomainError } from './errors.ts';
import { assertCycleWritable, assertDateText, findByKey } from './guards.ts';

export interface Harvest {
  id: string;
  cycleId: string;
  harvestedOn: string;
  quantityMicro: number;
  unitId: string;
  author: string;
  version: number;
}

export interface Sale {
  id: string;
  cycleId: string;
  harvestId: string | null;
  soldOn: string;
  quantityMicro: number;
  unitId: string;
  amountCents: number;
  buyer: string | null;
  author: string;
  version: number;
}

function positive(v: number, msg: string): void {
  if (!Number.isSafeInteger(v) || v <= 0) throw new DomainError('invalido', msg);
}

async function requireUnit(db: Database, unitId: string): Promise<void> {
  if ((await db.all('select 1 as ok from unit where id = ?', [unitId])).length === 0) {
    throw new DomainError('invalido', 'Unidade física obrigatória e existente'); // RF-AG-006
  }
}

const toHarvest = (r: Record<string, unknown>): Harvest => ({
  id: String(r.id),
  cycleId: String(r.cycle_id),
  harvestedOn: String(r.harvested_on),
  quantityMicro: Number(r.quantity_micro),
  unitId: String(r.unit_id),
  author: String(r.author),
  version: Number(r.version),
});

const toSale = (r: Record<string, unknown>): Sale => ({
  id: String(r.id),
  cycleId: String(r.cycle_id),
  harvestId: r.harvest_id === null ? null : String(r.harvest_id),
  soldOn: String(r.sold_on),
  quantityMicro: Number(r.quantity_micro),
  unitId: String(r.unit_id),
  amountCents: Number(r.amount_cents),
  buyer: r.buyer === null ? null : String(r.buyer),
  author: String(r.author),
  version: Number(r.version),
});

export async function getHarvest(db: Database, id: string): Promise<Harvest | null> {
  const r = (await db.all('select * from harvest_entry where id = ?', [id]))[0];
  return r ? toHarvest(r) : null;
}
export async function listHarvests(db: Database, cycleId: string): Promise<Harvest[]> {
  return (await db.all('select * from harvest_entry where cycle_id = ? order by harvested_on, id', [cycleId])).map(toHarvest);
}
export async function getSale(db: Database, id: string): Promise<Sale | null> {
  const r = (await db.all('select * from sale where id = ?', [id]))[0];
  return r ? toSale(r) : null;
}
export async function listSales(db: Database, cycleId: string): Promise<Sale[]> {
  return (await db.all('select * from sale where cycle_id = ? order by sold_on, id', [cycleId])).map(toSale);
}

// RN-AG-004: colheita parcial, em várias datas, nunca é bloqueada. RN-AG-012: estoque colhido não é caixa.
export async function recordHarvest(
  db: Database,
  input: { cycleId: string; harvestedOn: string; quantityMicro: number; unitId: string; author: string; idempotencyKey?: string; justification?: string },
): Promise<Harvest> {
  assertDateText(input.harvestedOn, 'Data da colheita');
  positive(input.quantityMicro, 'A quantidade deve ser maior que zero');
  if (input.author.trim() === '') throw new DomainError('invalido', 'Informe quem registrou');
  const id = crypto.randomUUID();
  return db.transaction(async () => {
    const dup = await findByKey(db, 'harvest_entry', input.idempotencyKey);
    if (dup) return (await getHarvest(db, dup)) as Harvest;
    await assertCycleWritable(db, input.cycleId, input.justification);
    await requireUnit(db, input.unitId);
    await db.run(
      'insert into harvest_entry (id, cycle_id, harvested_on, quantity_micro, unit_id, author, version, idempotency_key, created_at) values (?, ?, ?, ?, ?, ?, 1, ?, ?)',
      [id, input.cycleId, input.harvestedOn, input.quantityMicro, input.unitId, input.author.trim(), input.idempotencyKey ?? null, new Date().toISOString()],
    );
    await recordEvent(db, {
      type: 'harvest.recorded',
      resource: 'harvest_entry',
      resourceId: id,
      reason: input.justification ?? null,
      after: { cycleId: input.cycleId, quantityMicro: input.quantityMicro, unitId: input.unitId, harvestedOn: input.harvestedOn },
    });
    return (await getHarvest(db, id)) as Harvest;
  });
}

export async function correctHarvest(db: Database, id: string, version: number, change: { quantityMicro: number; justification: string }): Promise<Harvest> {
  if (change.justification.trim() === '') throw new DomainError('invalido', 'Justificativa obrigatória');
  positive(change.quantityMicro, 'A quantidade deve ser maior que zero');
  return db.transaction(async () => {
    const cur = await getHarvest(db, id);
    if (!cur) throw new DomainError('nao_encontrado', 'Colheita não encontrada');
    if (cur.version !== version) throw new DomainError('conflito_de_versao', 'Esta colheita foi alterada por outra ação. Recarregue e tente de novo');
    await db.run('update harvest_entry set quantity_micro = ?, version = version + 1 where id = ? and version = ?', [change.quantityMicro, id, version]);
    await recordEvent(db, {
      type: 'harvest.corrected',
      resource: 'harvest_entry',
      resourceId: id,
      reason: change.justification.trim(),
      before: { quantityMicro: cur.quantityMicro },
      after: { quantityMicro: change.quantityMicro },
    });
    return (await getHarvest(db, id)) as Harvest;
  });
}

// RN-AG-004 / RN-AG-008: venda parcial, em datas diferentes. Receita = vendas registradas; recebimento é outro conceito.
export async function recordSale(
  db: Database,
  input: {
    cycleId: string;
    harvestId?: string;
    soldOn: string;
    quantityMicro: number;
    unitId: string;
    amountCents: number;
    buyer?: string;
    author: string;
    idempotencyKey?: string;
    justification?: string;
  },
): Promise<Sale> {
  assertDateText(input.soldOn, 'Data da venda');
  positive(input.quantityMicro, 'A quantidade deve ser maior que zero');
  positive(input.amountCents, 'O valor deve ser maior que zero');
  if (input.author.trim() === '') throw new DomainError('invalido', 'Informe quem registrou');
  const id = crypto.randomUUID();
  return db.transaction(async () => {
    const dup = await findByKey(db, 'sale', input.idempotencyKey);
    if (dup) return (await getSale(db, dup)) as Sale;
    await assertCycleWritable(db, input.cycleId, input.justification);
    await requireUnit(db, input.unitId);
    if (input.harvestId) {
      const h = await getHarvest(db, input.harvestId);
      if (!h || h.cycleId !== input.cycleId) throw new DomainError('invalido', 'A colheita precisa ser da mesma safra');
      if (h.unitId !== input.unitId) throw new DomainError('invalido', 'A venda ligada a uma colheita usa a mesma unidade dela');
    }
    await db.run(
      'insert into sale (id, cycle_id, harvest_id, sold_on, quantity_micro, unit_id, amount_cents, buyer, author, version, idempotency_key, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
      [id, input.cycleId, input.harvestId ?? null, input.soldOn, input.quantityMicro, input.unitId, input.amountCents, input.buyer?.trim() || null, input.author.trim(), input.idempotencyKey ?? null, new Date().toISOString()],
    );
    await recordEvent(db, {
      type: 'sale.recorded',
      resource: 'sale',
      resourceId: id,
      reason: input.justification ?? null,
      after: { cycleId: input.cycleId, amountCents: input.amountCents, quantityMicro: input.quantityMicro, soldOn: input.soldOn },
    });
    return (await getSale(db, id)) as Sale;
  });
}

export async function correctSale(
  db: Database,
  id: string,
  version: number,
  change: { amountCents?: number; quantityMicro?: number; justification: string },
): Promise<Sale> {
  if (change.justification.trim() === '') throw new DomainError('invalido', 'Justificativa obrigatória');
  if (change.amountCents !== undefined) positive(change.amountCents, 'O valor deve ser maior que zero');
  if (change.quantityMicro !== undefined) positive(change.quantityMicro, 'A quantidade deve ser maior que zero');
  return db.transaction(async () => {
    const cur = await getSale(db, id);
    if (!cur) throw new DomainError('nao_encontrado', 'Venda não encontrada');
    if (cur.version !== version) throw new DomainError('conflito_de_versao', 'Esta venda foi alterada por outra ação. Recarregue e tente de novo');
    const amount = change.amountCents ?? cur.amountCents;
    const qty = change.quantityMicro ?? cur.quantityMicro;
    await db.run('update sale set amount_cents = ?, quantity_micro = ?, version = version + 1 where id = ? and version = ?', [amount, qty, id, version]);
    await recordEvent(db, {
      type: 'sale.corrected',
      resource: 'sale',
      resourceId: id,
      reason: change.justification.trim(),
      before: { amountCents: cur.amountCents, quantityMicro: cur.quantityMicro },
      after: { amountCents: amount, quantityMicro: qty },
    });
    return (await getSale(db, id)) as Sale;
  });
}

// Recebimento é separado da venda (RN-AG-001): o mesmo valor pode chegar em parcelas, em datas diferentes.
export async function recordReceipt(
  db: Database,
  input: { saleId: string; receivedOn: string; amountCents: number; idempotencyKey?: string },
): Promise<{ id: string }> {
  assertDateText(input.receivedOn, 'Data do recebimento');
  positive(input.amountCents, 'O valor deve ser maior que zero');
  const id = crypto.randomUUID();
  return db.transaction(async () => {
    if (input.idempotencyKey) {
      const dup = await db.all('select id from sale_receipt where idempotency_key = ?', [input.idempotencyKey]);
      if (dup[0]) return { id: String(dup[0].id) };
    }
    if (!(await getSale(db, input.saleId))) throw new DomainError('invalido', 'Venda inválida');
    await db.run('insert into sale_receipt (id, sale_id, received_on, amount_cents, idempotency_key, created_at) values (?, ?, ?, ?, ?, ?)', [
      id,
      input.saleId,
      input.receivedOn,
      input.amountCents,
      input.idempotencyKey ?? null,
      new Date().toISOString(),
    ]);
    await recordEvent(db, { type: 'sale.receipt_recorded', resource: 'sale', resourceId: input.saleId, after: { amountCents: input.amountCents, receivedOn: input.receivedOn } });
    return { id };
  });
}
