import type { Database } from '../storage/database.ts';
import { recordEvent } from './audit.ts';
import { DomainError } from './errors.ts';

export type CycleStatus = 'RASCUNHO' | 'PLANEJADA' | 'EM_ANDAMENTO' | 'CONCLUIDA' | 'CANCELADA';

export interface Cycle {
  id: string;
  farmId: string;
  cropTypeId: string;
  status: CycleStatus;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  reason: string | null;
  version: number;
}

const COLUMNS = 'id, farm_id, crop_type_id, status, planned_start, planned_end, actual_start, reason, version';

function text(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

function toCycle(r: Record<string, unknown>): Cycle {
  return {
    id: String(r.id),
    farmId: String(r.farm_id),
    cropTypeId: String(r.crop_type_id),
    status: String(r.status) as CycleStatus,
    plannedStart: text(r.planned_start),
    plannedEnd: text(r.planned_end),
    actualStart: text(r.actual_start),
    reason: text(r.reason),
    version: Number(r.version),
  };
}

// Data de calendário AAAA-MM-DD, sem hora e sem fuso. Não corrige nada em silêncio (RN-AG-013).
function assertDate(value: string, label: string): void {
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!ok) throw new DomainError('invalido', `${label}: use uma data válida no formato AAAA-MM-DD`);
}

export async function getCycle(db: Database, id: string): Promise<Cycle | null> {
  const rows = await db.all(`select ${COLUMNS} from crop_cycle where id = ?`, [id]);
  return rows[0] ? toCycle(rows[0]) : null;
}

export async function listCycles(db: Database, farmId: string): Promise<Cycle[]> {
  const rows = await db.all(`select ${COLUMNS} from crop_cycle where farm_id = ? order by created_at, id`, [farmId]);
  return rows.map(toCycle);
}

// RF-AG-003: uma propriedade pode ter várias safras, cada uma com histórico próprio.
export async function openCycle(db: Database, input: { farmId: string; cropTypeId: string }): Promise<Cycle> {
  const id = crypto.randomUUID();
  await db.transaction(async () => {
    const farm = await db.all('select 1 as ok from farm where id = ?', [input.farmId]);
    const crop = await db.all('select 1 as ok from crop_type where id = ?', [input.cropTypeId]);
    if (farm.length === 0 || crop.length === 0) throw new DomainError('invalido', 'Propriedade ou cultura inválida');
    await db.run(
      "insert into crop_cycle (id, farm_id, crop_type_id, status, version, created_at) values (?, ?, ?, 'RASCUNHO', 1, ?)",
      [id, input.farmId, input.cropTypeId, new Date().toISOString()],
    );
    await recordEvent(db, {
      type: 'crop_cycle.opened',
      resource: 'crop_cycle',
      resourceId: id,
      after: { status: 'RASCUNHO', farmId: input.farmId, cropTypeId: input.cropTypeId },
    });
  });
  return (await getCycle(db, id)) as Cycle;
}

interface Step {
  from: CycleStatus[];
  to: CycleStatus;
  event: string;
  set: Record<string, string>; // colunas internas, nunca vindas do usuário
  reason?: string;
}

// Muda de estado com controle de versão (RN-AG-007) e evento na mesma transação (§6, §21).
async function step(db: Database, id: string, expectedVersion: number, s: Step): Promise<Cycle> {
  return db.transaction(async () => {
    const cur = await getCycle(db, id);
    if (!cur) throw new DomainError('nao_encontrado', 'Safra não encontrada');
    if (cur.version !== expectedVersion) {
      throw new DomainError('conflito_de_versao', 'Esta safra foi alterada por outra ação. Recarregue e tente de novo');
    }
    if (!s.from.includes(cur.status)) {
      throw new DomainError('transicao_invalida', `Uma safra ${cur.status} não pode ir para ${s.to}`);
    }
    const cols = Object.keys(s.set);
    const sets = [...cols.map((c) => `${c} = ?`), 'status = ?', 'version = version + 1'].join(', ');
    await db.run(`update crop_cycle set ${sets} where id = ? and version = ?`, [
      ...cols.map((c) => s.set[c] as string),
      s.to,
      id,
      expectedVersion,
    ]);
    const next = (await getCycle(db, id)) as Cycle;
    await recordEvent(db, {
      type: s.event,
      resource: 'crop_cycle',
      resourceId: id,
      reason: s.reason ?? null,
      before: { status: cur.status, version: cur.version },
      after: { status: next.status, version: next.version },
    });
    return next;
  });
}

export async function planCycle(db: Database, id: string, version: number, input: { plannedStart: string; plannedEnd: string }) {
  assertDate(input.plannedStart, 'Início estimado');
  assertDate(input.plannedEnd, 'Fim estimado');
  if (input.plannedEnd < input.plannedStart) throw new DomainError('invalido', 'Datas incoerentes: o fim vem antes do início');
  return await step(db, id, version, {
    from: ['RASCUNHO'],
    to: 'PLANEJADA',
    event: 'crop_cycle.planned',
    set: { planned_start: input.plannedStart, planned_end: input.plannedEnd },
  });
}

export async function startCycle(db: Database, id: string, version: number, input: { actualStart: string }) {
  assertDate(input.actualStart, 'Início real');
  return await step(db, id, version, {
    from: ['PLANEJADA'],
    to: 'EM_ANDAMENTO',
    event: 'crop_cycle.started',
    set: { actual_start: input.actualStart },
  });
}

// RN-AG-021 pede colheita registrada OU motivo explícito. Ainda não há módulo de colheita (Fase 4),
// então por enquanto só o caminho do motivo existe. Nada é tratado como "rendimento zero".
export async function closeCycle(db: Database, id: string, version: number, input: { reason: string }) {
  const reason = input.reason.trim();
  if (reason === '') throw new DomainError('invalido', 'Informe a colheita ou o motivo para concluir');
  return await step(db, id, version, {
    from: ['EM_ANDAMENTO'],
    to: 'CONCLUIDA',
    event: 'crop_cycle.closed',
    set: { reason },
    reason,
  });
}

// RN-AG-002: cancelar exige motivo. O histórico fica (RN-AG-003).
export async function cancelCycle(db: Database, id: string, version: number, input: { reason: string }) {
  const reason = input.reason.trim();
  if (reason === '') throw new DomainError('invalido', 'Motivo obrigatório para cancelar');
  return await step(db, id, version, {
    from: ['RASCUNHO', 'PLANEJADA', 'EM_ANDAMENTO'],
    to: 'CANCELADA',
    event: 'crop_cycle.cancelled',
    set: { reason },
    reason,
  });
}
