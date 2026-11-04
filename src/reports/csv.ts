import type { Database } from '../storage/database.ts';
import { formatMoney, formatQuantity } from '../domain/decimal.ts';
import { DomainError } from '../domain/errors.ts';
import { cycleResult } from '../domain/results.ts';

export interface ReportFilters {
  cycleId: string;
  from?: string; // AAAA-MM-DD, inclusive
  to?: string;
}

// Planilhas abrem fórmulas que começam com = + - @. O texto do usuário é neutralizado com apóstrofo (injeção de fórmula).
export function csvCell(value: string | number | null): string {
  let s = value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function inRange(date: string, f: ReportFilters): boolean {
  return (f.from === undefined || date >= f.from) && (f.to === undefined || date <= f.to);
}

export interface ReportData {
  title: string;
  filters: string;
  generatedAt: string;
  summary: [string, string][];
  rows: { section: string; date: string; description: string; quantity: string; unit: string; value: string; paid: string }[];
  warnings: string[];
  excluded: string[];
}

// RF-AG-012 / CT-AG-012: o relatório repete os filtros, as unidades e de onde cada número veio.
export async function buildReport(db: Database, f: ReportFilters): Promise<ReportData> {
  const c = (await db.all('select c.id, f.name as farm, t.name as crop from crop_cycle c join farm f on f.id = c.farm_id join crop_type t on t.id = c.crop_type_id where c.id = ?', [f.cycleId]))[0];
  if (!c) throw new DomainError('nao_encontrado', 'Safra não encontrada');
  const r = await cycleResult(db, f.cycleId);
  const rows: ReportData['rows'] = [];

  for (const e of await db.all('select e.kind, e.occurred_on, e.paid_on, e.amount_cents, e.family_labor, e.counterparty, k.name as cat from financial_entry e left join cost_category k on k.id = e.category_id where e.cycle_id = ? order by e.occurred_on, e.id', [f.cycleId])) {
    if (!inRange(String(e.occurred_on), f)) continue;
    rows.push({
      section: e.kind === 'DESPESA' ? (Number(e.family_labor) === 1 ? 'Mão de obra familiar' : 'Despesa') : 'Entrada de caixa',
      date: String(e.occurred_on),
      description: [e.cat, e.counterparty].filter(Boolean).join(' - '),
      quantity: '',
      unit: '',
      value: formatMoney(Number(e.amount_cents)),
      paid: e.paid_on ? `pago em ${e.paid_on}` : 'não pago',
    });
  }
  for (const h of await db.all('select h.harvested_on, h.quantity_micro, u.name as unit from harvest_entry h join unit u on u.id = h.unit_id where h.cycle_id = ? order by h.harvested_on, h.id', [f.cycleId])) {
    if (!inRange(String(h.harvested_on), f)) continue;
    rows.push({ section: 'Colheita declarada', date: String(h.harvested_on), description: '', quantity: formatQuantity(Number(h.quantity_micro)), unit: String(h.unit), value: '', paid: '' });
  }
  for (const s of await db.all('select s.id, s.sold_on, s.quantity_micro, s.amount_cents, s.buyer, u.name as unit, (select coalesce(sum(amount_cents), 0) from sale_receipt where sale_id = s.id) as recebido from sale s join unit u on u.id = s.unit_id where s.cycle_id = ? order by s.sold_on, s.id', [f.cycleId])) {
    if (!inRange(String(s.sold_on), f)) continue;
    rows.push({
      section: 'Venda',
      date: String(s.sold_on),
      description: String(s.buyer ?? ''),
      quantity: formatQuantity(Number(s.quantity_micro)),
      unit: String(s.unit),
      value: formatMoney(Number(s.amount_cents)),
      paid: `recebido ${formatMoney(Number(s.recebido))}`,
    });
  }
  for (const a of await db.all('select a.occurred_on, a.state, a.notes, t.name from field_activity a join activity_type t on t.id = a.type_id where a.cycle_id = ? order by a.occurred_on, a.id', [f.cycleId])) {
    if (!inRange(String(a.occurred_on), f)) continue;
    rows.push({ section: `Atividade (${String(a.state).toLowerCase()})`, date: String(a.occurred_on), description: [a.name, a.notes].filter(Boolean).join(' - '), quantity: '', unit: '', value: '', paid: '' });
  }
  rows.sort((x, y) => x.date.localeCompare(y.date) || x.section.localeCompare(y.section));

  const summary: [string, string][] = [
    ['Custo registrado (soma das despesas da safra, sem mão de obra familiar)', formatMoney(r.custoRegistradoCents)],
    ['Mão de obra familiar (fora do custo registrado)', formatMoney(r.maoDeObraFamiliarCents)],
    ['Vendas registradas', formatMoney(r.receitaVendasCents)],
    ['Recebido', formatMoney(r.recebidoCents)],
    ['A receber', formatMoney(r.aReceberCents)],
    ['Resultado parcial (vendas - custo registrado)', r.resultadoParcialCents === null ? 'indisponível' : formatMoney(r.resultadoParcialCents)],
    ...r.colhido.map((h): [string, string] => [`Colhido (${h.unitName})`, formatQuantity(h.quantityMicro)]),
    ...(r.produtividade ?? []).map((p): [string, string] => [`Produtividade (${p.harvestUnitName} por ${p.areaUnitName}, área declarada)`, formatQuantity(p.valueMicro)]),
  ];
  if (r.produtividade === null && r.semProdutividadeMotivo) summary.push(['Produtividade', `indisponível: ${r.semProdutividadeMotivo}`]);

  return {
    title: `${String(c.farm)} - ${String(c.crop)}`,
    filters: `Safra ${f.cycleId}; período ${f.from ?? 'início'} a ${f.to ?? 'fim'}. Totais do resumo cobrem a safra inteira; as linhas respeitam o período.`,
    generatedAt: new Date().toISOString(),
    summary,
    rows,
    warnings: r.avisos,
    excluded: r.excluidos,
  };
}

export function toCsv(d: ReportData): string {
  const lines: string[] = [];
  lines.push(['Relatório', d.title].map(csvCell).join(';'));
  lines.push(['Filtros', d.filters].map(csvCell).join(';'));
  lines.push(['Gerado em (UTC)', d.generatedAt].map(csvCell).join(';'));
  lines.push('');
  for (const [k, v] of d.summary) lines.push([k, v].map(csvCell).join(';'));
  for (const w of d.warnings) lines.push(['Aviso', w].map(csvCell).join(';'));
  for (const x of d.excluded) lines.push(['Fora do cálculo', x].map(csvCell).join(';'));
  lines.push('');
  lines.push(['Tipo', 'Data', 'Descrição', 'Quantidade', 'Unidade', 'Valor', 'Pagamento/recebimento'].map(csvCell).join(';'));
  for (const r of d.rows) lines.push([r.section, r.date, r.description, r.quantity, r.unit, r.value, r.paid].map(csvCell).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`; // BOM para o Excel abrir acentos
}
