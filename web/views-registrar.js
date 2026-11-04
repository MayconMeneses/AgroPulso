import { listActivityTypes, recordActivity } from './app/domain/activities.js';
import { addAttachment } from './app/domain/attachments.js';
import { formatMoney, parseMoney, parseQuantity } from './app/domain/decimal.js';
import { listCostCategories, recordEntry } from './app/domain/financial.js';
import { listWorkers, recordWork } from './app/domain/labor.js';
import { listHarvests, listSales, recordHarvest, recordReceipt, recordSale } from './app/domain/production.js';
import { listUnits } from './app/domain/units.js';
import { chip, form, h, icon, openSheet, say } from './ui.js';

let selected = '';

const ACTIONS = [
  ['activity', 'atividade', 'Atividade de campo'],
  ['work', 'trabalho', 'Dia de trabalho'],
  ['expense', 'despesa', 'Despesa'],
  ['income', 'entrada', 'Entrada de caixa'],
  ['harvest', 'colheita', 'Colheita'],
  ['sale', 'venda', 'Venda'],
  ['receipt', 'recebimento', 'Recebimento'],
];

// Registrar vira uma grade de ações grandes; cada uma abre uma gaveta só com os campos daquela ação.
// A chave de repetição nasce quando a gaveta abre: clicar duas vezes em "Salvar" não duplica o registro (RN-AG-006).
export async function registrar(db, rerender, author) {
  const cycles = await db.all("select c.id, c.farm_id, c.status, t.name as crop, f.name as farm from crop_cycle c join crop_type t on t.id = c.crop_type_id join farm f on f.id = c.farm_id where c.status not in ('CONCLUIDA','CANCELADA') order by f.name, c.created_at");
  if (cycles.length === 0) return [h('section', { class: 'panel' }, h('h2', {}, 'Nada para registrar ainda'), h('p', { class: 'muted' }, 'Cadastre uma propriedade e uma cultura, e abra uma safra em "Safras".'))];
  if (!cycles.some((c) => c.id === selected)) selected = String(cycles[0].id);
  const cycle = cycles.find((c) => c.id === selected);
  const picker = cycles.length > 1 ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Safra' }, cycles.map((c) => chip(`${c.farm} · ${c.crop}`, c.id === selected, () => { selected = String(c.id); rerender(); }))) : '';

  const done = (close) => async (msg) => { close(); say(msg); await rerender(); };

  async function build(kind, title) {
    const units = (await listUnits(db)).map((u) => [u.id, u.name]);
    const key = crypto.randomUUID();
    openSheet(title, (close) => {
      const ok = done(close);
      const box = h('div');
      (async () => {
        const cycleId = selected;
        if (kind === 'activity') {
          const types = (await listActivityTypes(db)).map((t) => [t.id, t.name]);
          box.append(form([
            { name: 'type', label: 'Tipo de atividade', type: 'select', options: types },
            { name: 'date', label: 'Data', type: 'date' },
            { name: 'state', label: 'Situação', type: 'select', options: [['REALIZADA', 'Realizada'], ['PLANEJADA', 'Planejada (tarefa)']], placeholder: 'Realizada' },
            { name: 'notes', label: 'Observações', type: 'textarea' },
            { name: 'photo', label: 'Foto ou PDF (opcional, até 5 MB)', type: 'file' },
          ], 'Salvar atividade', async (v) => {
            const a = await recordActivity(db, { cycleId, typeId: v.type, occurredOn: v.date, author, state: v.state || 'REALIZADA', notes: v.notes, idempotencyKey: key });
            if (v.photo) await addAttachment(db, { activityId: a.id, name: v.photo.name, bytes: new Uint8Array(await v.photo.arrayBuffer()) });
            await ok(a.notice ? `Atividade salva. ${a.notice}` : 'Atividade salva.');
          }));
        } else if (kind === 'work') {
          const people = await listWorkers(db, String(cycle.farm_id));
          box.append(people.length === 0 ? h('p', { class: 'callout' }, 'Cadastre antes a pessoa em "Cadastros", em "Pessoas".') : h('div', {}, h('p', { class: 'muted small' }, 'O app calcula o custo pela diária ou pelo salário cadastrado e lança a despesa de mão de obra. Pessoa da família entra na linha separada, fora do custo.'), form([
            { name: 'who', label: 'Pessoa', type: 'select', options: people.map((p) => [p.id, `${p.name} (${p.payType === 'DIARIA' ? 'diária' : 'mensal'})`]) },
            { name: 'date', label: 'Data', type: 'date' },
            { name: 'days', label: 'Dias trabalhados (para diária)', hint: 'ex.: 1 ou 0,5', inputmode: 'decimal' },
            { name: 'pct', label: '% do salário do mês nesta safra (para mensal)', hint: '1 a 100', inputmode: 'numeric' },
            { name: 'note', label: 'Observação', hint: 'opcional' },
          ], 'Salvar trabalho', async (v) => {
            const person = people.find((p) => p.id === v.who);
            const r = await recordWork(db, { workerId: v.who, cycleId, occurredOn: v.date, daysMicro: person?.payType === 'DIARIA' ? parseQuantity(v.days, 'Dias') : undefined, sharePercent: person?.payType === 'MENSAL' ? Number(v.pct.trim()) : undefined, note: v.note, author, idempotencyKey: key });
            await ok(r.warning ? `Trabalho salvo. Atenção: ${r.warning}` : `Trabalho salvo${r.amountCents === null ? '' : `: ${formatMoney(r.amountCents)}`}.`);
          })));
        } else if (kind === 'expense' || kind === 'income') {
          const cats = (await listCostCategories(db)).map((c) => [c.id, c.name]);
          const expense = kind === 'expense';
          box.append(form([
            { name: 'amount', label: 'Valor em reais', hint: 'ex.: 1234,56', inputmode: 'decimal' },
            { name: 'date', label: expense ? 'Data do custo' : 'Data da entrada', type: 'date' },
            ...(expense ? [{ name: 'paid', label: 'Data do pagamento', hint: 'vazio se ainda não pagou', type: 'date' }, { name: 'cat', label: 'Categoria', type: 'select', options: cats, placeholder: 'Sem categoria' }, { name: 'family', label: 'É mão de obra da própria família', type: 'checkbox' }] : []),
            { name: 'who', label: expense ? 'Para quem foi pago' : 'De quem veio' },
            { name: 'src', label: 'Fonte do dinheiro', hint: 'opcional' },
          ], 'Salvar', async (v) => {
            await recordEntry(db, { farmId: String(cycle.farm_id), cycleId, kind: expense ? 'DESPESA' : 'ENTRADA', amountCents: parseMoney(v.amount, 'Valor'), occurredOn: v.date, paidOn: v.paid || undefined, categoryId: v.cat || undefined, familyLabor: v.family === true, counterparty: v.who, source: v.src, author, idempotencyKey: key });
            await ok('Lançamento salvo.');
          }));
        } else if (kind === 'harvest') {
          box.append(form([
            { name: 'qty', label: 'Quantidade colhida', inputmode: 'decimal' },
            { name: 'unit', label: 'Unidade', type: 'select', options: units },
            { name: 'date', label: 'Data da colheita', type: 'date' },
          ], 'Salvar colheita', async (v) => { const hv = await recordHarvest(db, { cycleId, harvestedOn: v.date, quantityMicro: parseQuantity(v.qty, 'Quantidade'), unitId: v.unit, author, idempotencyKey: key }); await ok(hv.warning ? `Colheita salva. Atenção: ${hv.warning}` : 'Colheita salva.'); }));
        } else if (kind === 'sale') {
          const hs = (await listHarvests(db, cycleId)).map((x) => [x.id, x.harvestedOn]);
          box.append(form([
            { name: 'qty', label: 'Quantidade vendida', inputmode: 'decimal' },
            { name: 'unit', label: 'Unidade', type: 'select', options: units },
            { name: 'amount', label: 'Valor da venda em reais', inputmode: 'decimal' },
            { name: 'date', label: 'Data da venda', type: 'date' },
            { name: 'buyer', label: 'Comprador', hint: 'opcional' },
            { name: 'harvest', label: 'Ligar a uma colheita', type: 'select', options: hs, placeholder: 'Sem ligação' },
          ], 'Salvar venda', async (v) => { const sv = await recordSale(db, { cycleId, harvestId: v.harvest || undefined, soldOn: v.date, quantityMicro: parseQuantity(v.qty, 'Quantidade'), unitId: v.unit, amountCents: parseMoney(v.amount, 'Valor'), buyer: v.buyer, author, idempotencyKey: key }); await ok(sv.warning ? `Venda salva. Atenção: ${sv.warning}` : 'Venda salva.'); }));
        } else {
          const sales = (await listSales(db, cycleId)).map((s) => [s.id, `${s.soldOn} - ${formatMoney(s.amountCents)}`]);
          box.append(h('p', { class: 'muted' }, 'Recebimento é o dinheiro que entrou. Venda registrada não é dinheiro recebido.'), sales.length ? form([
            { name: 'sale', label: 'Venda', type: 'select', options: sales },
            { name: 'amount', label: 'Valor recebido em reais', inputmode: 'decimal' },
            { name: 'date', label: 'Data do recebimento', type: 'date' },
          ], 'Salvar recebimento', async (v) => { await recordReceipt(db, { saleId: v.sale, receivedOn: v.date, amountCents: parseMoney(v.amount, 'Valor'), idempotencyKey: key }); await ok('Recebimento salvo.'); }) : h('p', {}, 'Esta safra ainda não tem vendas.'));
        }
      })().catch((e) => box.append(h('p', { class: 'callout' }, `Não foi possível abrir: ${e.message}`)));
      return box;
    });
  }

  return [
    picker,
    h('p', { class: 'muted' }, `Registrando em: ${cycle.farm} · ${cycle.crop}`),
    h('div', { class: 'actions' }, ACTIONS.map(([kind, ic, label]) => h('button', { class: 'action', type: 'button', onclick: () => build(kind, label) }, icon(ic), label))),
  ];
}
