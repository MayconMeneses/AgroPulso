import { listActivities, listActivityTypes, updateActivity } from './app/domain/activities.js';
import { formatMoney, formatQuantity, parseMoney, parseQuantity } from './app/domain/decimal.js';
import { DomainError } from './app/domain/errors.js';
import { correctHarvest, correctSale, harvestWarning, listHarvests, listSales, saleWarning } from './app/domain/production.js';
import { listUnits } from './app/domain/units.js';
import { form, h, openSheet, say } from './ui.js';

// Corrigir o que já foi registrado (colheita, venda, atividade). Cada correção guarda o valor de antes e o de depois no
// histórico (RN-AG-003); colheita e venda exigem o motivo. Campo vazio em venda significa "deixar como está".
export async function correcoes(db, cycle, author, refresh) {
  const [harvests, sales, acts, types, units] = await Promise.all([listHarvests(db, cycle.id), listSales(db, cycle.id), listActivities(db, cycle.id), listActivityTypes(db), listUnits(db)]);
  const unit = new Map(units.map((u) => [u.id, u.name]));
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const sheet = (title, intro, fields, label, run) => openSheet(title, (close) => h('div', {}, h('p', { class: 'muted small' }, intro), form(fields, label, async (v) => {
    await run(v);
    close();
    const warn = (await saleWarning(db, cycle.id)) ?? (await harvestWarning(db, cycle.id));
    say(`Correção salva. O valor de antes fica no histórico.${warn ? ` Atenção: ${warn}` : ''}`);
    await refresh();
  })));
  const reason = { name: 'why', label: 'Motivo da correção (obrigatório)', type: 'textarea' };
  const row = (text, onclick, label = 'Corrigir') => h('div', { class: 'entry' }, h('div', { class: 'grow' }, text), h('button', { class: 'btn ghost', type: 'button', onclick }, label));
  const parts = [];

  parts.push(h('h3', {}, 'Colheitas'));
  if (harvests.length === 0) parts.push(h('p', { class: 'muted small' }, 'Nenhuma colheita nesta safra.'));
  for (const x of harvests) {
    parts.push(row(`${x.harvestedOn} · ${formatQuantity(x.quantityMicro)} ${unit.get(x.unitId)}`, () => sheet('Corrigir colheita', `Hoje: ${formatQuantity(x.quantityMicro)} ${unit.get(x.unitId)}. A unidade não muda; para trocar de unidade, registre de novo.`,
      [{ name: 'qty', label: 'Quantidade certa', inputmode: 'decimal' }, reason], 'Salvar correção',
      (v) => correctHarvest(db, x.id, x.version, { quantityMicro: parseQuantity(v.qty, 'Quantidade'), justification: v.why }))));
  }

  parts.push(h('h3', {}, 'Vendas'));
  if (sales.length === 0) parts.push(h('p', { class: 'muted small' }, 'Nenhuma venda nesta safra.'));
  for (const s of sales) {
    parts.push(row(`${s.soldOn} · ${formatQuantity(s.quantityMicro)} ${unit.get(s.unitId)} · ${formatMoney(s.amountCents)}${s.buyer ? ` · ${s.buyer}` : ''}`, () => sheet('Corrigir venda', `Hoje: ${formatQuantity(s.quantityMicro)} ${unit.get(s.unitId)} por ${formatMoney(s.amountCents)}. Deixe em branco o que não muda.`,
      [{ name: 'qty', label: 'Quantidade certa', hint: 'vazio = igual', inputmode: 'decimal' }, { name: 'amount', label: 'Valor certo em reais', hint: 'vazio = igual', inputmode: 'decimal' }, reason], 'Salvar correção',
      (v) => {
        if (!v.qty.trim() && !v.amount.trim()) throw new DomainError('invalido', 'Informe a quantidade ou o valor que mudou');
        return correctSale(db, s.id, s.version, { quantityMicro: v.qty.trim() ? parseQuantity(v.qty, 'Quantidade') : undefined, amountCents: v.amount.trim() ? parseMoney(v.amount, 'Valor') : undefined, justification: v.why });
      })));
  }

  parts.push(h('h3', {}, 'Atividades'));
  if (acts.length === 0) parts.push(h('p', { class: 'muted small' }, 'Nenhuma atividade nesta safra.'));
  for (const a of acts) {
    const planned = a.state === 'PLANEJADA';
    parts.push(row(`${a.occurredOn} · ${typeName.get(a.typeId) ?? 'Atividade'} · ${planned ? 'planejada' : 'realizada'}${a.notes ? ` · ${a.notes}` : ''}`, () => sheet(planned ? 'Atividade planejada' : 'Corrigir atividade', 'A data e a observação podem mudar; o histórico guarda o antes e o depois.',
      [{ name: 'date', label: 'Data', type: 'date' }, { name: 'notes', label: 'Observação', type: 'textarea' }, ...(planned ? [{ name: 'done', label: 'Já foi feita (marcar como realizada)', type: 'checkbox' }] : [])], 'Salvar',
      (v) => updateActivity(db, a.id, a.version, { occurredOn: v.date || undefined, notes: v.notes.trim() ? v.notes : undefined, state: v.done === true ? 'REALIZADA' : undefined }, author)), planned ? 'Marcar ou mudar' : 'Corrigir'));
  }
  return parts;
}
