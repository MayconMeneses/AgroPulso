import type { Database } from '../storage/database.ts';
import { formatMoney, formatQuantity } from '../domain/decimal.ts';
import { DomainError } from '../domain/errors.ts';
import { laborSummary, listWork } from '../domain/labor.ts';
import type { ReportData, ReportFilters } from './csv.ts';

// Relatório de mão de obra por pessoa: usa o mesmo formato do relatório da safra, então sai em PDF e em planilha.
// Os registros anulados não entram nas contas (ficam só citados no fim); o resumo cobre a safra inteira e as linhas, o período.
export async function buildLaborReport(db: Database, f: ReportFilters): Promise<ReportData> {
  const c = (await db.all('select f.name as farm, t.name as crop from crop_cycle c join farm f on f.id = c.farm_id join crop_type t on t.id = c.crop_type_id where c.id = ?', [f.cycleId]))[0];
  if (!c) throw new DomainError('nao_encontrado', 'Safra não encontrada');
  const inRange = (d: string) => (f.from === undefined || d >= f.from) && (f.to === undefined || d <= f.to);
  const all = await listWork(db, f.cycleId);
  const sums = await laborSummary(db, f.cycleId);

  const contratado = sums.filter((s) => s.kind === 'CONTRATADO').reduce((t, s) => t + s.amountCents, 0);
  const familia = sums.filter((s) => s.kind === 'FAMILIAR').reduce((t, s) => t + s.amountCents, 0);
  const summary: [string, string][] = [
    ['Mão de obra contratada (entra no custo registrado)', formatMoney(contratado)],
    ['Mão de obra da família (valor estimado, fora do custo registrado)', formatMoney(familia)],
    ...sums.map((s): [string, string] => [
      `${s.workerName} (${s.kind === 'CONTRATADO' ? 'contratado' : 'família'}, ${s.payType === 'DIARIA' ? 'diária' : 'mensal'})`,
      `${s.payType === 'DIARIA' ? `${formatQuantity(s.daysMicro)} dia(s)` : `${s.sharePercent}% de salário`} - ${s.amountCents > 0 ? formatMoney(s.amountCents) : 'sem valor'}`,
    ]),
  ];

  const rows: ReportData['rows'] = all
    .filter((w) => w.voidedAt === null && inRange(w.occurredOn))
    .map((w) => ({
      section: w.kind === 'FAMILIAR' ? 'Mão de obra familiar' : 'Mão de obra contratada',
      date: w.occurredOn,
      description: [w.workerName, w.payType === 'DIARIA' ? 'diária' : 'mensal', w.note].filter(Boolean).join(' - '),
      quantity: w.payType === 'DIARIA' ? formatQuantity(w.daysMicro ?? 0) : String(w.sharePercent ?? ''),
      unit: w.payType === 'DIARIA' ? 'dia(s)' : '% do mês',
      value: w.amountCents === null ? 'sem valor' : formatMoney(w.amountCents),
      paid: '',
    }));

  const warnings: string[] = [];
  if (sums.some((s) => s.kind === 'FAMILIAR' && s.amountCents === 0)) warnings.push('Há trabalho da família sem valor cadastrado: ele aparece nos dias, mas não entra em nenhum valor.');
  const annulled = all.filter((w) => w.voidedAt !== null).length;
  const excluded = annulled > 0 ? [`${annulled} registro(s) de trabalho anulado(s): continuam guardados, mas não entram nas somas`] : [];

  return {
    title: `${String(c.farm)} - ${String(c.crop)}: mão de obra por pessoa`,
    filters: `Safra ${f.cycleId}; período ${f.from ?? 'início'} a ${f.to ?? 'fim'}. O resumo cobre a safra inteira; as linhas respeitam o período. Valores calculados pelo app a partir da diária ou do salário cadastrado.`,
    generatedAt: new Date().toISOString(),
    summary,
    rows,
    warnings,
    excluded,
  };
}
