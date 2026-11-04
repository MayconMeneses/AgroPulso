import { formatQuantity, parseQuantity } from './app/domain/decimal.js';
import { listFarms } from './app/domain/farms.js';
import { createStockItem, listMovements, listStockItems, recordMovement } from './app/domain/stock.js';
import { listUnits } from './app/domain/units.js';
import { chip, emptyState, form, h, icon, openSheet, say, tag } from './ui.js';

let selectedFarm = '';
const KINDS = { ENTRADA: 'Entrada', SAIDA: 'Saída', AJUSTE: 'Ajuste' };

// Estoque de insumos por propriedade. Mostra o saldo de cada item, avisa quando chega ao mínimo e abre uma gaveta
// por ação. O saldo é calculado a partir dos movimentos; saída maior que o saldo é recusada pelo domínio.
export async function estoque(db, rerender, author, go) {
  const [farms, units] = await Promise.all([listFarms(db), listUnits(db)]);
  if (farms.length === 0) return [emptyState('Estoque', 'O estoque guarda o que você tem de adubo, semente, ração e outros insumos. Para começar, cadastre sua propriedade.', [['Ver o passo a passo', () => go('painel'), true]])];
  if (!farms.some((f) => f.id === selectedFarm)) selectedFarm = farms[0].id;
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const items = await listStockItems(db, selectedFarm);
  const cycles = await db.all("select c.id, t.name as crop from crop_cycle c join crop_type t on t.id = c.crop_type_id where c.farm_id = ? and c.status not in ('CONCLUIDA','CANCELADA') order by c.created_at", [selectedFarm]);
  const ok = (close) => async (m) => { close(); say(m); await rerender(); };
  const picker = farms.length > 1 ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Propriedade' }, farms.map((f) => chip(f.name, f.id === selectedFarm, () => { selectedFarm = f.id; rerender(); }))) : '';

  const novoItem = () => openSheet('Novo item de estoque', (close) => (units.length === 0
    ? h('p', { class: 'callout' }, 'Cadastre antes uma unidade (kg, saco, litro...) em "Cadastros".')
    : form([
      { name: 'name', label: 'Nome do item', hint: 'ex.: adubo NPK, semente de milho' },
      { name: 'unit', label: 'Unidade', type: 'select', options: units.map((u) => [u.id, u.name]) },
      { name: 'min', label: 'Avisar quando chegar a', hint: 'opcional', inputmode: 'decimal' },
    ], 'Salvar item', async (v) => {
      await createStockItem(db, { farmId: selectedFarm, name: v.name, unitId: v.unit, minMicro: v.min ? parseQuantity(v.min, 'Estoque mínimo') : undefined });
      await ok(close)('Item salvo.');
    })));

  // A chave de repetição nasce quando a gaveta abre: tocar duas vezes em "Salvar" não duplica o movimento.
  const mover = (item, kind) => openSheet(`${KINDS[kind]}: ${item.name}`, (close) => {
    const key = crypto.randomUUID();
    const fields = [
      { name: 'qty', label: kind === 'AJUSTE' ? `Diferença em ${unitName.get(item.unitId)}` : `Quantidade em ${unitName.get(item.unitId)}`, hint: kind === 'AJUSTE' ? 'negativo tira, ex.: -2' : undefined, inputmode: 'decimal' },
      { name: 'date', label: 'Data', type: 'date' },
      ...(kind === 'SAIDA' && cycles.length ? [{ name: 'cycle', label: 'Usado na safra', type: 'select', options: cycles.map((c) => [c.id, c.crop]), placeholder: 'Sem safra' }] : []),
      { name: 'note', label: kind === 'AJUSTE' ? 'Motivo (obrigatório)' : 'Observação', hint: kind === 'AJUSTE' ? 'ex.: contagem, perda' : 'opcional' },
    ];
    return h('div', {}, h('p', { class: 'muted' }, `Saldo agora: ${formatQuantity(item.balanceMicro)} ${unitName.get(item.unitId)}`), form(fields, 'Salvar', async (v) => {
      const raw = String(v.qty).trim();
      const negative = kind === 'AJUSTE' && raw.startsWith('-');
      const micro = parseQuantity(negative ? raw.slice(1) : raw, 'Quantidade');
      await recordMovement(db, { itemId: item.id, kind, quantityMicro: negative ? -micro : micro, occurredOn: v.date, cycleId: v.cycle || undefined, note: v.note, author, idempotencyKey: key });
      await ok(close)('Movimento salvo.');
    }));
  });

  const historico = async (item) => {
    const rows = await listMovements(db, item.id);
    openSheet(`Histórico: ${item.name}`, () => (rows.length
      ? h('ul', { class: 'timeline' }, rows.map((m) => h('li', {}, h('strong', {}, `${m.deltaMicro > 0 ? '+' : ''}${formatQuantity(m.deltaMicro)} ${unitName.get(item.unitId)}`), ` · ${KINDS[m.kind]} · ${m.occurredOn} · ${m.author}`, m.note ? h('div', { class: 'muted small' }, m.note) : '')))
      : h('p', { class: 'muted' }, 'Sem movimentos ainda.')));
  };

  const card = (item, i) => h('section', { class: `panel ${i % 2 ? 'alt' : ''}`.trim() },
    h('div', { class: 'eyebrow' }, item.name),
    h('div', { class: 'stat-value' }, `${formatQuantity(item.balanceMicro)} ${unitName.get(item.unitId)}`, tag('calculado')),
    item.low ? h('p', { class: 'callout' }, item.balanceMicro === 0 ? 'Acabou. Hora de repor.' : `Estoque baixo (mínimo ${formatQuantity(item.minMicro)}).`) : '',
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: () => mover(item, 'ENTRADA') }, 'Entrada'),
      h('button', { class: 'btn', type: 'button', onclick: () => mover(item, 'SAIDA') }, 'Saída'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => mover(item, 'AJUSTE') }, 'Ajuste'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => historico(item) }, 'Histórico')));

  return [
    h('div', { class: 'page-head' }, h('h2', {}, 'Estoque'), h('button', { class: 'btn primary', type: 'button', onclick: novoItem }, icon('registrar'), 'Novo item')),
    picker,
    items.length ? h('div', { class: 'cad-grid' }, items.map(card)) : h('section', { class: 'panel' }, h('h2', {}, 'Nenhum item ainda'), h('p', {}, 'Cadastre aqui o que você guarda: adubo, semente, defensivo, ração. Depois anote as entradas (compras) e as saídas (uso), e o app calcula quanto sobra e avisa quando estiver acabando.')),
  ];
}
