import { listActivities } from './app/domain/activities.js';
import { listAttachments, readAttachment, removeAttachment } from './app/domain/attachments.js';
import { laborSummary, listWork, voidWork } from './app/domain/labor.js';
import { formatMoney, formatQuantity, parseQuantity } from './app/domain/decimal.js';
import { listCycleEntries, voidEntry } from './app/domain/financial.js';
import { setHarvestEstimate } from './app/domain/production.js';
import { listUnits } from './app/domain/units.js';
import { download, fail, form, h, openSheet, say, tag } from './ui.js';

// Lançamentos de uma safra: despesas e entradas (dá para anular com motivo) e anexos das atividades (dá para remover com
// motivo). Nada é apagado de verdade no histórico: o que sai das contas continua registrado, riscado, com o motivo.
export function lancamentos(db, cycle, title, rerender) {
  openSheet(`Lançamentos: ${title}`, () => {
    const box = h('div');
    const draw = async () => {
      const [entries, acts, work, sums] = await Promise.all([listCycleEntries(db, cycle.id), listActivities(db, cycle.id), listWork(db, cycle.id), laborSummary(db, cycle.id)]);
      const reasonSheet = (what, run) => openSheet(what, (close) => form([{ name: 'r', label: 'Motivo (obrigatório)', type: 'textarea' }], 'Confirmar', async (v) => {
        await run(v.r);
        close(); say('Feito. O histórico guarda o motivo.'); await draw(); await rerender();
      }));
      const parts = [h('h3', {}, 'Despesas e entradas')];
      if (entries.length === 0) parts.push(h('p', { class: 'muted small' }, 'Nenhum lançamento nesta safra.'));
      for (const e of entries) {
        const voided = e.voidedAt !== null;
        parts.push(h('div', { class: `entry ${voided ? 'void' : ''}`.trim() },
          h('div', { class: 'grow' }, h('strong', {}, formatMoney(e.amountCents)), ` · ${e.kind === 'DESPESA' ? 'Despesa' : 'Entrada'} · ${e.occurredOn}${e.counterparty ? ` · ${e.counterparty}` : ''}`),
          voided ? h('span', { class: 'muted small' }, `Anulado: ${e.voidReason}`) : e.workId ? h('span', { class: 'muted small' }, 'Vem da mão de obra') : h('button', { class: 'btn ghost', type: 'button', onclick: () => reasonSheet('Anular lançamento', (r) => voidEntry(db, e.id, e.version, r)) }, 'Anular')));
      }
      parts.push(h('h3', {}, 'Mão de obra'));
      if (work.length === 0) parts.push(h('p', { class: 'muted small' }, 'Nenhum dia de trabalho nesta safra.'));
      for (const s of sums) parts.push(h('p', { class: 'small' }, h('strong', {}, s.workerName), ` · ${s.kind === 'CONTRATADO' ? 'contratado' : 'família'} · ${s.payType === 'DIARIA' ? `${formatQuantity(s.daysMicro)} dia(s)` : `${s.sharePercent}% de salário`} · ${s.amountCents ? formatMoney(s.amountCents) : 'sem valor'}`, tag(s.kind === 'FAMILIAR' ? 'estimado' : 'calculado')));
      for (const w of work) {
        const voided = w.voidedAt !== null;
        parts.push(h('div', { class: `entry ${voided ? 'void' : ''}`.trim() },
          h('div', { class: 'grow' }, `${w.occurredOn} · ${w.workerName} · ${w.payType === 'DIARIA' ? `${formatQuantity(w.daysMicro ?? 0)} dia(s)` : `${w.sharePercent}% do mês`} · ${w.amountCents === null ? 'sem valor' : formatMoney(w.amountCents)}`),
          voided ? h('span', { class: 'muted small' }, `Anulado: ${w.voidReason}`) : h('button', { class: 'btn ghost', type: 'button', onclick: () => reasonSheet('Anular trabalho', (r) => voidWork(db, w.id, r)) }, 'Anular')));
      }
      parts.push(h('h3', {}, 'Anexos das atividades'));
      let any = false;
      for (const a of acts) {
        for (const f of await listAttachments(db, a.id)) {
          any = true;
          parts.push(h('div', { class: 'entry' }, h('div', { class: 'grow' }, `${f.name} · ${a.occurredOn} · ${Math.max(1, Math.round(f.size / 1024))} KB`),
            h('button', { class: 'btn ghost', type: 'button', onclick: async () => { try { const bytes = await readAttachment(db, f.id); if (bytes) download(f.name, bytes, f.mime); } catch (e) { fail(e); } } }, 'Baixar'),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => reasonSheet('Remover anexo', (r) => removeAttachment(db, f.id, r)) }, 'Remover')));
        }
      }
      if (!any) parts.push(h('p', { class: 'muted small' }, 'Nenhum anexo.'));
      parts.push(h('p', { class: 'muted small' }, 'Anular tira o lançamento das contas, do painel e do relatório, mas ele continua guardado com o motivo. Remover um anexo apaga a foto ou o arquivo; fica só o registro de que existiu.'));
      box.replaceChildren(...parts);
    };
    draw().catch(fail);
    return box;
  });
}

// Estimativa de colheita (RN-AG-014): é palpite seu, guardado à parte do que foi colhido. Serve para o app avisar se a colheita passar dela.
export async function estimativa(db, cycle, title, rerender) {
  const units = (await listUnits(db)).map((u) => [u.id, u.name]);
  openSheet(`Estimativa de colheita: ${title}`, (close) => (units.length === 0
    ? h('p', { class: 'callout' }, 'Cadastre antes uma unidade (kg, saca...) em "Cadastros".')
    : h('div', {}, h('p', { class: 'muted small' }, 'Quanto você espera colher. Fica marcado como estimado, e o app avisa se a colheita registrada passar disso.'), tag('estimado'),
      form([
        { name: 'qty', label: 'Quantidade esperada', inputmode: 'decimal' },
        { name: 'unit', label: 'Unidade', type: 'select', options: units },
      ], 'Salvar estimativa', async (v) => {
        await setHarvestEstimate(db, cycle.id, cycle.version, { quantityMicro: parseQuantity(v.qty, 'Quantidade'), unitId: v.unit });
        close(); say(`Estimativa salva: ${formatQuantity(parseQuantity(v.qty, 'Quantidade'))}.`); await rerender();
      }),
      cycle.hasEstimate ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { try { await setHarvestEstimate(db, cycle.id, cycle.version, null); close(); say('Estimativa removida.'); await rerender(); } catch (e) { fail(e); } } }, 'Remover a estimativa') : '')));
}
