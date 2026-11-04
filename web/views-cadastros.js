import { createActivityType, listActivityTypes } from './app/domain/activities.js';
import { createCropType, listCropTypes } from './app/domain/crop-types.js';
import { parseQuantity } from './app/domain/decimal.js';
import { createFarm, listFarms } from './app/domain/farms.js';
import { createCostCategory, listCostCategories } from './app/domain/financial.js';
import { createPlot, listPlots } from './app/domain/plots.js';
import { createUnit, listUnits, setConversion } from './app/domain/units.js';
import { localBlock } from './views-local.js';
import { form, h, icon, openSheet, say } from './ui.js';

// Fusos do Brasil. O usuário escolhe; não há fuso padrão (RN-AG-022).
const FUSOS = [['America/Recife', 'Recife'], ['America/Fortaleza', 'Fortaleza'], ['America/Bahia', 'Salvador (Bahia)'], ['America/Maceio', 'Maceió'], ['America/Sao_Paulo', 'São Paulo'], ['America/Manaus', 'Manaus'], ['America/Cuiaba', 'Cuiabá'], ['America/Belem', 'Belém'], ['America/Rio_Branco', 'Rio Branco']];

// Cadastros em blocos: cada bloco mostra o que já existe e abre uma gaveta para adicionar.
export async function cadastros(db, rerender) {
  const [farms, crops, units, actTypes, cats] = await Promise.all([listFarms(db), listCropTypes(db), listUnits(db), listActivityTypes(db), listCostCategories(db)]);
  const plots = [];
  for (const f of farms) for (const p of await listPlots(db, f.id)) plots.push({ ...p, label: `${p.name} (${f.name})` });
  const areaUnits = units.filter((u) => u.kind === 'area');
  const add = (title, build) => () => openSheet(title, (close) => build(async (msg) => { close(); say(msg); await rerender(); }));
  const opts = (list) => list.map((x) => [x.id, x.name]);

  const blocks = [
    ['propriedade', 'Propriedade', farms.map((x) => x.name), add('Nova propriedade', (ok) => form([
      { name: 'name', label: 'Nome da propriedade' },
      { name: 'tz', label: 'Fuso horário', type: 'select', options: FUSOS, hint: 'obrigatório' },
    ], 'Salvar propriedade', async (v) => { await createFarm(db, { name: v.name, timezone: v.tz }); await ok('Propriedade salva.'); }))],
    ['safras', 'Cultura', crops.map((x) => x.name), add('Nova cultura', (ok) => form([{ name: 'name', label: 'Nome da cultura' }], 'Salvar cultura', async (v) => { await createCropType(db, { name: v.name }); await ok('Cultura salva.'); }))],
    ['unidade', 'Unidade de medida', units.map((x) => x.name), add('Nova unidade', (ok) => form([
      { name: 'name', label: 'Nome (ex.: kg, saca, tarefa)' },
      { name: 'kind', label: 'Tipo', type: 'select', options: [['massa', 'Peso'], ['area', 'Área'], ['volume', 'Volume'], ['contagem', 'Contagem']] },
    ], 'Salvar unidade', async (v) => { await createUnit(db, { name: v.name, kind: v.kind }); await ok('Unidade salva.'); }))],
    ['fator', 'Fator de conversão', [], add('Fator de conversão', (ok) => h('div', {}, h('p', { class: 'muted' }, 'Você informa o fator e de onde ele veio. O app não traz fator pronto.'), form([
      { name: 'from', label: 'De', type: 'select', options: opts(units) },
      { name: 'to', label: 'Para', type: 'select', options: opts(units) },
      { name: 'factor', label: 'Quanto vale 1 da primeira na segunda', hint: 'ex.: 60 ou 0,4356', inputmode: 'decimal' },
      { name: 'crop', label: 'Só para a cultura', type: 'select', options: opts(crops), placeholder: 'Todas (ex.: medidas de área)' },
      { name: 'source', label: 'Origem do fator', hint: 'ex.: costume da região' },
    ], 'Salvar fator', async (v) => { await setConversion(db, { fromUnitId: v.from, toUnitId: v.to, factorMicro: parseQuantity(v.factor, 'Fator'), source: v.source, cropTypeId: v.crop || null }); await ok('Fator salvo.'); })))],
    ['talhao', 'Talhão (opcional)', plots.map((x) => x.label), add('Novo talhão', (ok) => form([
      { name: 'farm', label: 'Propriedade', type: 'select', options: opts(farms) },
      { name: 'name', label: 'Nome do talhão' },
      { name: 'decl', label: 'Área declarada', hint: 'opcional', inputmode: 'decimal' },
      { name: 'meas', label: 'Área medida', hint: 'opcional', inputmode: 'decimal' },
      { name: 'unit', label: 'Unidade da área', type: 'select', options: opts(areaUnits), placeholder: 'Sem área' },
    ], 'Salvar talhão', async (v) => {
      await createPlot(db, { farmId: v.farm, name: v.name, areaDeclaredMicro: v.decl ? parseQuantity(v.decl, 'Área declarada') : undefined, areaMeasuredMicro: v.meas ? parseQuantity(v.meas, 'Área medida') : undefined, areaUnitId: v.unit || undefined });
      await ok('Talhão salvo.');
    }))],
    ['atividade', 'Tipo de atividade', actTypes.map((x) => x.name), add('Novo tipo de atividade', (ok) => form([
      { name: 'name', label: 'Nome (ex.: plantio, capina, irrigação)' },
      { name: 'app', label: 'É aplicação de produto', type: 'checkbox' },
    ], 'Salvar tipo', async (v) => { await createActivityType(db, { name: v.name, isApplication: v.app }); await ok('Tipo salvo.'); }))],
    ['cadastros', 'Categoria de custo', cats.map((x) => x.name), add('Nova categoria', (ok) => form([{ name: 'name', label: 'Nome (ex.: adubo, água, mão de obra)' }], 'Salvar categoria', async (v) => { await createCostCategory(db, { name: v.name }); await ok('Categoria salva.'); }))],
  ];

  const local = await localBlock(db, farms, rerender);
  return [local, h('div', { class: 'cad-grid' }, blocks.map(([ic, title, names, open], i) => h('section', { class: `panel ${i % 2 ? 'alt' : ''}`.trim() },
    h('div', { class: 'cad-head' }, icon(ic), h('h2', {}, title)),
    names.length ? h('div', { class: 'names' }, names.map((n) => h('span', {}, n))) : h('p', { class: 'muted small' }, 'Nenhum ainda.'),
    h('button', { class: 'btn', type: 'button', onclick: open }, icon('registrar'), 'Adicionar'))))];
}
