import type { Database } from '../storage/database.ts';
import { DomainError } from './errors.ts';

// RN-AG-003: safra concluída ou cancelada preserva o histórico. Registro novo nela só com justificativa,
// que fica no evento de auditoria. Deve ser chamado dentro da transação da operação.
export async function assertCycleWritable(db: Database, cycleId: string, justification?: string): Promise<{ farmId: string }> {
  const r = (await db.all('select farm_id, status from crop_cycle where id = ?', [cycleId]))[0];
  if (!r) throw new DomainError('invalido', 'Safra inválida');
  const closed = r.status === 'CONCLUIDA' || r.status === 'CANCELADA';
  if (closed && (justification ?? '').trim() === '') {
    throw new DomainError('transicao_invalida', 'Safra encerrada: informe a justificativa para registrar nela');
  }
  return { farmId: String(r.farm_id) };
}

// RN-AG-006: a mesma ação reenviada com a mesma chave não duplica o registro.
export async function findByKey(db: Database, table: 'field_activity' | 'financial_entry' | 'harvest_entry' | 'sale', key: string | undefined): Promise<string | null> {
  if (!key) return null;
  const rows = await db.all(`select id from ${table} where idempotency_key = ?`, [key]);
  return rows[0] ? String(rows[0].id) : null;
}

export function assertDateText(value: string, label: string): void {
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!ok) throw new DomainError('invalido', `${label}: use uma data válida no formato AAAA-MM-DD`);
}
