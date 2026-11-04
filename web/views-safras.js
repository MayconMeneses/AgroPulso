import { cancelCycle, closeCycle, listCycles, openCycle, planCycle, startCycle } from './app/domain/cycles.js';
import { listCropTypes } from './app/domain/crop-types.js';
import { listFarms } from './app/domain/farms.js';
import { assignPlot, listPlots } from './app/domain/plots.js';
import { estimativa, lancamentos } from './views-lancamentos.js';
import { form, h, icon, openSheet, say, STATUS } from './ui.js';
import { harvestEstimate } from './app/domain/results.js';

const STEPS = ['RASCUNHO', 'PLANEJADA', 'EM_ANDAMENTO', 'CONCLUIDA'];

// Cada safra é uma trilha: onde está, o que já passou e a única ação que vem agora.
export async function safras(db, rerender) {
  const [farms, crops] = await Promise.all([listFarms(db), listCropTypes(db)]);
  const ok = (close) => async (m) => { close(); say(m); await rerender(); };
  const cropName = new Map(crops.map((c) => [c.id, c.name]));

  const novaSafra = () => openSheet('Nova safra', (close) => h('div', {}, h('p', { class: 'muted' }, 'Cada safra tem histórico próprio. Dá para ter várias na mesma propriedade.'),
    form([
      { name: 'farm', label: 'Propriedade', type: 'select', options: farms.map((f) => [f.id, f.name]) },
      { name: 'crop', label: 'Cultura', type: 'select', options: crops.map((c) => [c.id, c.name]) },
    ], 'Abrir safra', async (v) => { await openCycle(db, { farmId: v.farm, cropTypeId: v.crop }); await ok(close)('Safra aberta como rascunho.'); })));

  const out = [h('div', { class: 'page-head' }, h('h2', {}, 'Suas safras'), h('button', { class: 'btn primary', type: 'button', onclick: novaSafra }, icon('registrar'), 'Nova safra'))];
  if (farms.length === 0 || crops.length === 0) out.push(h('p', { class: 'callout' }, 'Para abrir uma safra, cadastre antes uma propriedade e uma cultura em "Cadastros".'));

  for (const f of farms) {
    const plots = await listPlots(db, f.id);
    for (const c of await listCycles(db, f.id)) {
      const closed = c.status === 'CONCLUIDA' || c.status === 'CANCELADA';
      const at = STEPS.indexOf(c.status);
      const sheet = (title, fields, label, run) => () => openSheet(title, (close) => form(fields, label, async (v) => { await run(v); await ok(close)(`${title}: feito.`); }));
      const hasEstimate = (await harvestEstimate(db, c.id)) !== null;
      const label = `${f.name} · ${cropName.get(c.cropTypeId) ?? ''}`;
      const next = {
        RASCUNHO: ['Planejar', sheet('Planejar', [{ name: 'a', label: 'Início estimado', type: 'date' }, { name: 'b', label: 'Fim estimado', type: 'date' }], 'Planejar', (v) => planCycle(db, c.id, c.version, { plannedStart: v.a, plannedEnd: v.b }))],
        PLANEJADA: ['Iniciar', sheet('Iniciar', [{ name: 'a', label: 'Início real', type: 'date' }], 'Iniciar', (v) => startCycle(db, c.id, c.version, { actualStart: v.a }))],
        EM_ANDAMENTO: ['Concluir', sheet('Concluir safra', [{ name: 'r', label: 'Motivo (vazio se já há colheita)', type: 'textarea' }], 'Concluir', (v) => closeCycle(db, c.id, c.version, { reason: v.r }))],
      }[c.status];
      out.push(h('section', { class: 'panel' },
        h('div', { class: 'eyebrow' }, f.name),
        h('h2', {}, `${cropName.get(c.cropTypeId) ?? ''} · ${STATUS[c.status]}`),
        h('ol', { class: `steps ${c.status === 'CANCELADA' ? 'cancelled' : ''}`.trim() }, STEPS.map((s, i) => h('li', { class: i < at || (c.status === 'CONCLUIDA' && i === at) ? 'done' : i === at ? 'now' : '' }, STATUS[s]))),
        h('p', { class: 'muted small' }, [c.plannedStart ? `Estimada: ${c.plannedStart} a ${c.plannedEnd}. ` : '', c.actualStart ? `Início real: ${c.actualStart}. ` : '', c.reason ? `Motivo: ${c.reason}` : '', c.plotId ? ' Talhão ligado.' : '']),
        h('div', { class: 'row' },
          next ? h('button', { class: 'btn primary', type: 'button', onclick: next[1] }, next[0]) : '',
          !closed && plots.length ? h('button', { class: 'btn', type: 'button', onclick: sheet('Talhão da safra', [{ name: 'p', label: 'Talhão', type: 'select', options: plots.map((p) => [p.id, p.name]) }], 'Salvar', (v) => assignPlot(db, c.id, c.version, v.p)) }, 'Talhão') : '',
          h('button', { class: 'btn', type: 'button', onclick: () => lancamentos(db, c, label, rerender) }, 'Lançamentos'),
          !closed ? h('button', { class: 'btn', type: 'button', onclick: () => estimativa(db, { ...c, hasEstimate }, label, rerender) }, 'Estimativa') : '',
          !closed ? h('button', { class: 'btn danger', type: 'button', onclick: sheet('Cancelar safra', [{ name: 'r', label: 'Motivo do cancelamento', type: 'textarea' }], 'Cancelar safra', (v) => cancelCycle(db, c.id, c.version, { reason: v.r })) }, 'Cancelar') : '')));
    }
  }
  return out;
}
