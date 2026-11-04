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
export async function findByKey(db: Database, table: 'field_activity' | 'financial_entry' | 'harvest_entry' | 'sale' | 'stock_movement' | 'work_entry', key: string | undefined): Promise<string | null> {
  if (!key) return null;
  const rows = await db.all(`select id from ${table} where idempotency_key = ?`, [key]);
  return rows[0] ? String(rows[0].id) : null;
}

export function assertDateText(value: string, label: string): void {
  // Data impossível (mês 13, dia 40) faz Date ficar inválida e toISOString lançar RangeError: tratar antes, para virar mensagem em português.
  const d = new Date(`${value}T00:00:00Z`);
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
  if (!ok) throw new DomainError('invalido', `${label}: use uma data válida no formato AAAA-MM-DD`);
}

// Nomes (propriedade, cultura, pessoa, item...) são curtos. Sem teto, um texto enorme estoura a tela e o banco.
export const MAX_NAME = 80;
export function assertNameLength(name: string): void {
  if (name.length > MAX_NAME) throw new DomainError('invalido', `O nome pode ter no máximo ${MAX_NAME} caracteres`);
}
