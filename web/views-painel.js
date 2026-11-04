import { formatMoney, formatQuantity } from './app/domain/decimal.js';
import { dashboard } from './app/reports/dashboard.js';
import { listFarms } from './app/domain/farms.js';
import { chip, h, lines, ring, STATUS, table, tag } from './ui.js';
import { localBlock } from './views-local.js';

let selected = null;

const stat = (label, value, note, extra = '', kind = 'digitado') => h('div', { class: `panel stat half ${extra}`.trim() }, h('span', { class: 'eyebrow' }, label, tag(kind)), h('div', { class: 'stat-value' }, value), note ? h('div', { class: 'stat-note muted small' }, note) : '');

// Painel em mosaico: resultado da safra em destaque, números em blocos e uma linha por mês.
export async function painel(db, rerender) {
  const d = await dashboard(db);
  if (d.activeCycles.length === 0) {
    return [h('section', { class: 'panel' }, h('h2', {}, 'Nenhuma safra ativa'), h('p', { class: 'muted' }, 'Abra uma safra em "Safras" para ver aqui o custo, as vendas e o resultado.'))];
  }
  const cur = d.activeCycles.find((c) => c.cycleId === selected) ?? d.activeCycles[0];
  const r = cur.result;
  const pct = r.receitaVendasCents > 0 ? Math.min(r.recebidoCents / r.receitaVendasCents, 1) : null;

  const picker = d.activeCycles.length > 1
    ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Safra' }, d.activeCycles.map((c) => chip(`${c.farmName} · ${c.cropName}`, c.cycleId === cur.cycleId, () => { selected = c.cycleId; rerender(); })))
    : '';
  const hero = h('section', { class: 'panel hero' },
    h('div', { class: 'hero-main' },
      h('div', { class: 'eyebrow' }, `${cur.farmName} · ${cur.cropName} · ${STATUS[cur.status]}`, tag('calculado')),
      r.resultadoParcialCents === null
        ? h('div', { class: 'hero-value off' }, 'Resultado parcial indisponível')
        : h('div', { class: 'hero-value', 'aria-label': `Resultado parcial ${formatMoney(r.resultadoParcialCents)}` }, formatMoney(r.resultadoParcialCents)),
      h('div', { class: 'muted small' }, 'Resultado parcial: vendas registradas menos o custo registrado. Não é lucro.')),
    h('div', { class: 'hero-side' }, ring(pct, pct === null ? '—' : `${Math.round(pct * 100)}%`, 'recebido')));

  const colheita = h('section', { class: 'panel alt w5' }, h('h2', {}, 'Colheita', tag('digitado')),
    r.estimativaColheita ? h('p', { class: 'small' }, 'Estimativa sua: ', h('strong', {}, `${formatQuantity(r.estimativaColheita.quantityMicro)} ${r.estimativaColheita.unitName}`), tag('estimado')) : '',
    r.colhido.length ? h('ul', { class: 'timeline' }, r.colhido.map((x) => h('li', {}, h('strong', {}, formatQuantity(x.quantityMicro)), ` ${x.unitName} colhidos`))) : h('p', { class: 'muted' }, 'Sem colheita registrada.'),
    (r.produtividade ?? []).map((p) => h('p', {}, h('strong', {}, formatQuantity(p.valueMicro)), ` ${p.harvestUnitName} por ${p.areaUnitName} (área declarada)`)),
    r.produtividade === null && r.semProdutividadeMotivo ? h('p', { class: 'muted small' }, `Produtividade indisponível: ${r.semProdutividadeMotivo}.`) : '');

  const grafico = h('section', { class: 'panel w7' }, h('h2', {}, 'Despesas e vendas por mês'),
    d.monthly.length ? [
      lines(d.monthly, formatMoney),
      h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'l-sale' }), 'Vendas'), h('span', {}, h('i', { class: 'l-exp' }), 'Despesas')),
      h('details', {}, h('summary', {}, 'Ver valores'), table(['Mês', 'Despesas', 'Vendas'], d.monthly.map((m) => [m.month, formatMoney(m.expensesCents), formatMoney(m.salesCents)]))),
    ] : h('p', { class: 'muted' }, 'Ainda não há lançamentos.'));

  const pend = h('section', { class: 'panel alt' }, h('h2', {}, 'Pendências'),
    h('p', {}, `Vendas ainda a receber (todas as safras): `, h('strong', {}, formatMoney(d.salesToReceiveCents))),
    d.pendingActivities.length ? h('ul', { class: 'timeline' }, d.pendingActivities.map((p) => h('li', {}, h('strong', {}, p.occurredOn), ` · ${p.typeName}`))) : h('p', { class: 'muted' }, 'Nenhuma tarefa planejada.'));

  return [
    picker,
    h('div', { class: 'bento' },
      hero,
      stat('Custo registrado', formatMoney(r.custoRegistradoCents), `Mão de obra familiar (fora do custo): ${formatMoney(r.maoDeObraFamiliarCents)}`),
      stat('Vendas registradas', formatMoney(r.receitaVendasCents)),
      stat('Recebido', formatMoney(r.recebidoCents)),
      stat('A receber', formatMoney(r.aReceberCents), '', 'alt', 'calculado'),
      grafico, colheita, pend),
    await localBlock(db, (await listFarms(db)).filter((f) => f.id === cur.farmId), rerender),
    ...r.avisos.map((a) => h('div', { class: 'callout' }, a)), // espalhado: replaceChildren não aceita lista dentro de lista
    r.excluidos.length ? h('p', { class: 'muted small' }, `Fora desta conta: ${r.excluidos.join('; ')}.`) : '',
  ];
}
