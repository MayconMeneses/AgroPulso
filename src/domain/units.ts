import type { Database } from '../storage/database.ts';
import { recordEvent } from './audit.ts';
import { MICRO } from './decimal.ts';
import { DomainError } from './errors.ts';

export type UnitKind = 'area' | 'massa' | 'volume' | 'contagem';
const KINDS: UnitKind[] = ['area', 'massa', 'volume', 'contagem'];

export interface Unit {
  id: string;
  name: string;
  kind: UnitKind;
}

// RN-AG-019: unidades locais (tarefa, saca, caixa...) são cadastradas por quem usa; nenhuma vem pronta.
export async function createUnit(db: Database, input: { name: string; kind: UnitKind }): Promise<Unit> {
  const name = input.name.trim();
  if (name === '') throw new DomainError('invalido', 'Informe o nome da unidade');
  if (!KINDS.includes(input.kind)) throw new DomainError('invalido', 'Tipo de unidade inválido');
  const unit: Unit = { id: crypto.randomUUID(), name, kind: input.kind };
  await db.transaction(async () => {
    const same = await db.all('select 1 as ok from unit where lower(name) = lower(?)', [name]);
    if (same.length > 0) throw new DomainError('duplicado', 'Já existe uma unidade com esse nome');
    await db.run('insert into unit (id, name, kind) values (?, ?, ?)', [unit.id, name, unit.kind]);
    await recordEvent(db, { type: 'unit.created', resource: 'unit', resourceId: unit.id, after: { name, kind: unit.kind } });
  });
  return unit;
}

export async function getUnit(db: Database, id: string): Promise<Unit | null> {
  const r = (await db.all('select id, name, kind from unit where id = ?', [id]))[0];
  return r ? { id: String(r.id), name: String(r.name), kind: String(r.kind) as UnitKind } : null;
}

export async function listUnits(db: Database): Promise<Unit[]> {
  const rows = await db.all('select id, name, kind from unit order by name, id');
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), kind: String(r.kind) as UnitKind }));
}

// RN-AG-011: 1 [from] = factor [to]. Fator informado por quem cadastra, com a origem escrita; sem fator padrão.
// Conversão de produto (saca, caixa) é presa a uma cultura; a de área (ex.: tarefa) pode ser geral.
export async function setConversion(
  db: Database,
  input: { fromUnitId: string; toUnitId: string; factorMicro: number; source: string; cropTypeId?: string | null },
): Promise<void> {
  const source = input.source.trim();
  if (source === '') throw new DomainError('invalido', 'Informe a origem do fator de conversão');
  if (!Number.isSafeInteger(input.factorMicro) || input.factorMicro <= 0) throw new DomainError('invalido', 'Fator deve ser maior que zero');
  if (input.fromUnitId === input.toUnitId) throw new DomainError('invalido', 'Escolha duas unidades diferentes');
  await db.transaction(async () => {
    const a = await getUnit(db, input.fromUnitId);
    const b = await getUnit(db, input.toUnitId);
    if (!a || !b) throw new DomainError('invalido', 'Unidade inexistente');
    if (a.kind !== b.kind) throw new DomainError('invalido', 'Só é possível converter unidades do mesmo tipo');
    const crop = input.cropTypeId ?? null;
    await db.run("delete from unit_conversion where from_unit = ? and to_unit = ? and coalesce(crop_type_id, '') = ?", [
      a.id,
      b.id,
      crop ?? '',
    ]);
    await db.run(
      'insert into unit_conversion (from_unit, to_unit, crop_type_id, factor_micro, source, created_at) values (?, ?, ?, ?, ?, ?)',
      [a.id, b.id, crop, input.factorMicro, source, new Date().toISOString()],
    );
    await recordEvent(db, {
      type: 'unit_conversion.set',
      resource: 'unit',
      resourceId: a.id,
      after: { to: b.id, cropTypeId: crop, factorMicro: input.factorMicro, source },
    });
  });
}

export interface Converted {
  micro: number;
  exact: boolean; // false: o resultado foi arredondado para 6 casas
}

function divRound(n: bigint, d: bigint): Converted {
  const q = n / d;
  const rem = n % d;
  return rem === 0n ? { micro: Number(q), exact: true } : { micro: Number(q + (rem * 2n >= d ? 1n : 0n)), exact: false };
}

// Devolve null quando não existe fator cadastrado: nunca inventa conversão (RN-AG-011).
export async function convert(
  db: Database,
  quantityMicro: number,
  fromUnitId: string,
  toUnitId: string,
  cropTypeId: string | null = null,
): Promise<Converted | null> {
  if (fromUnitId === toUnitId) return { micro: quantityMicro, exact: true };
  const q = BigInt(quantityMicro);
  const find = async (from: string, to: string) => {
    const rows = await db.all(
      'select factor_micro from unit_conversion where from_unit = ? and to_unit = ? and (crop_type_id = ? or crop_type_id is null) order by crop_type_id is null',
      [from, to, cropTypeId],
    );
    return rows[0] ? BigInt(Number(rows[0].factor_micro)) : null;
  };
  const direct = await find(fromUnitId, toUnitId);
  if (direct !== null) return divRound(q * direct, BigInt(MICRO));
  const inverse = await find(toUnitId, fromUnitId);
  if (inverse !== null) return divRound(q * BigInt(MICRO), inverse);
  return null;
}
