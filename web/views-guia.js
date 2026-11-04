import { createCropType, listCropTypes } from './app/domain/crop-types.js';
import { openCycle } from './app/domain/cycles.js';
import { createFarm, listFarms } from './app/domain/farms.js';
import { backupStatus, dailyAlerts, guideComplete, guideSteps } from './app/domain/guide.js';
import { form, h, icon, openSheet, say } from './ui.js';

// Cidades do Brasil por fuso. A pessoa escolhe a mais perto; não há fuso padrão (RN-AG-022).
export const FUSOS = [['America/Recife', 'Recife'], ['America/Fortaleza', 'Fortaleza'], ['America/Bahia', 'Salvador (Bahia)'], ['America/Maceio', 'Maceió'], ['America/Sao_Paulo', 'São Paulo'], ['America/Manaus', 'Manaus'], ['America/Cuiaba', 'Cuiabá'], ['America/Belem', 'Belém'], ['America/Rio_Branco', 'Rio Branco']];

const localToday = () => new Date().toLocaleDateString('en-CA'); // AAAA-MM-DD no relógio do aparelho

// Painel "Primeiros passos": some sozinho quando os quatro passos estão feitos. Cada botão abre a janela do passo, sem a pessoa
// precisar descobrir onde fica o cadastro.
export async function primeirosPassos(db, go, rerender) {
  const steps = await guideSteps(db);
  if (guideComplete(steps)) return null;
  const next = steps.find((s) => !s.done);
  const done = (close) => async (msg) => { close(); say(msg); await rerender(); };

  const acoes = {
    propriedade: () => openSheet('Sua propriedade', (close) => form([
      { name: 'name', label: 'Nome do sítio, fazenda ou roça' },
      { name: 'tz', label: 'Cidade mais perto de você', type: 'select', options: FUSOS, hint: 'serve para acertar a hora' },
    ], 'Salvar propriedade', async (v) => { await createFarm(db, { name: v.name, timezone: v.tz }); await done(close)('Propriedade salva. Falta só dizer o que você planta.'); })),
    cultura: () => openSheet('O que você planta?', (close) => form([
      { name: 'name', label: 'Nome da cultura', hint: 'ex.: milho, feijão, mandioca' },
    ], 'Salvar cultura', async (v) => { await createCropType(db, { name: v.name }); await done(close)('Cultura salva. Agora abra a primeira safra.'); })),
    safra: async () => {
      const [farms, crops] = await Promise.all([listFarms(db), listCropTypes(db)]);
      openSheet('Primeira safra', (close) => h('div', {}, h('p', { class: 'muted small' }, 'Uma safra é uma plantação do começo ao fim. Você pode ter várias ao mesmo tempo.'), form([
        { name: 'farm', label: 'Em qual propriedade', type: 'select', options: farms.map((f) => [f.id, f.name]) },
        { name: 'crop', label: 'Qual cultura', type: 'select', options: crops.map((c) => [c.id, c.name]) },
      ], 'Abrir safra', async (v) => { await openCycle(db, { farmId: v.farm, cropTypeId: v.crop }); await done(close)('Safra aberta. Em "Safras" você marca quando ela começa.'); })));
    },
    registro: () => go('registrar'),
  };
  const labelBtn = { propriedade: 'Cadastrar propriedade', cultura: 'Cadastrar cultura', safra: 'Abrir safra', registro: 'Ir para Registrar' };

  return h('section', { class: 'panel guia' },
    h('div', { class: 'eyebrow' }, 'Primeiros passos'),
    h('h2', {}, 'Vamos começar? São 4 passos curtos'),
    h('ol', { class: 'passos' }, steps.map((s) => h('li', { class: s.done ? 'feito' : s === next ? 'agora' : '' },
      h('span', { class: 'marca', 'aria-hidden': 'true' }, s.done ? icon('ok') : String(steps.indexOf(s) + 1)),
      h('div', {}, h('strong', {}, s.title), s.done ? h('span', { class: 'muted small' }, ' · feito') : h('div', { class: 'muted small' }, s.help))))),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: acoes[next.id] }, icon(next.id === 'registro' ? 'registrar' : 'propriedade'), labelBtn[next.id])));
}

// Faixa de avisos do dia: cópia de segurança em atraso e tarefas, vendas e estoque que pedem uma ação.
export async function avisos(db, go) {
  const [backup, alertas] = await Promise.all([backupStatus(db), dailyAlerts(db, localToday())]);
  const items = [];
  if (backup.due) {
    items.push(h('div', { class: 'aviso' }, h('p', {}, backup.daysSince === null
      ? 'Você ainda não guardou uma cópia dos seus dados. Se o celular quebrar ou for trocado, tudo o que você anotou se perde.'
      : `Faz ${backup.daysSince} dias que você guardou a última cópia dos seus dados. Guarde uma nova para não perder o que anotou depois.`),
    h('button', { class: 'btn', type: 'button', onclick: () => go('relatorio') }, 'Guardar cópia agora')));
  }
  for (const a of alertas) items.push(h('div', { class: 'aviso' }, h('p', {}, a.text), h('button', { class: 'btn ghost', type: 'button', onclick: () => go(a.go) }, a.go === 'estoque' ? 'Ver estoque' : a.go === 'registrar' ? 'Anotar recebimento' : 'Ver safras')));
  return items.length ? h('section', { class: 'avisos', 'aria-label': 'Avisos' }, h('h2', {}, 'Precisa da sua atenção'), items) : null;
}
