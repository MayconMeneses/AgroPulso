import { exportBackup } from './app/backup/export.js';
import { importBackup } from './app/backup/import.js';
import { buildReport, toCsv } from './app/reports/csv.js';
import { buildLaborReport } from './app/reports/labor.js';
import { toPdf } from './app/reports/pdf.js';
import { download, form, h, icon, say } from './ui.js';

export async function relatorio(db) {
  const cycles = await db.all('select c.id, t.name as crop, f.name as farm from crop_cycle c join crop_type t on t.id = c.crop_type_id join farm f on f.id = c.farm_id order by f.name, c.created_at');
  if (cycles.length === 0) return [h('section', { class: 'panel' }, h('h2', {}, 'Relatório'), h('p', { class: 'muted' }, 'Ainda não há safras.'))];
  const f = form([
    { name: 'cycle', label: 'Safra', type: 'select', options: cycles.map((c) => [c.id, `${c.farm} · ${c.crop}`]) },
    { name: 'from', label: 'Do dia', hint: 'opcional', type: 'date' },
    { name: 'to', label: 'Até o dia', hint: 'opcional', type: 'date' },
    { name: 'kind', label: 'Qual relatório', type: 'select', options: [['obra', 'Mão de obra por pessoa']], placeholder: 'Relatório completo da safra' },
    { name: 'fmt', label: 'Formato', type: 'select', options: [['pdf', 'PDF'], ['csv', 'Planilha CSV']], placeholder: 'PDF' },
  ], 'Gerar relatório', async (v) => {
    if (!v.cycle) { say('Escolha a safra.', 'err'); return; }
    const filters = { cycleId: v.cycle, from: v.from || undefined, to: v.to || undefined };
    const obra = v.kind === 'obra';
    const data = obra ? await buildLaborReport(db, filters) : await buildReport(db, filters);
    const base = obra ? 'mao-de-obra-agropulso' : 'relatorio-agropulso';
    if (v.fmt === 'csv') download(`${base}.csv`,  new TextEncoder().encode(toCsv(data)), 'text/csv;charset=utf-8');
    else download(`${base}.pdf`, toPdf(data), 'application/pdf');
    say('Relatório gerado. Ele repete os filtros, as unidades e o que ficou fora do cálculo.');
  });
  return [h('section', { class: 'panel' }, h('h2', {}, 'Relatório'), f)];
}

export async function backup(db, rerender) {
  // O navegador decide se guarda os dados de forma permanente; sem essa garantia, a cópia é a única proteção.
  let persisted = false;
  try { persisted = (await navigator.storage?.persisted?.()) === true; } catch { /* sem a API: trata como não garantido */ }
  const aviso = persisted ? '' : h('div', { class: 'callout' }, 'Este navegador não garantiu a guarda permanente dos dados. Ele pode apagá-los se faltar espaço ou se você limpar os dados do site. Baixe uma cópia com frequência.');
  const restore = form([
    { name: 'file', label: 'Arquivo de backup (.json)', type: 'file' },
    { name: 'sure', label: 'Entendo que isto SUBSTITUI todos os dados deste aparelho', type: 'checkbox' },
  ], 'Restaurar backup', async (v) => {
    if (!v.file) { say('Escolha o arquivo.', 'err'); return; }
    if (!v.sure) { say('Marque a confirmação para substituir os dados.', 'err'); return; }
    await importBackup(db, await v.file.text());
    say('Backup restaurado.');
    await rerender();
  });
  return [h('div', { class: 'bento' },
    h('section', { class: 'panel w6' }, h('h2', {}, 'Guardar uma cópia'), aviso,
      h('p', {}, 'Seus dados ficam só neste aparelho. Se ele quebrar ou o navegador limpar os dados, sem cópia não dá para recuperar.'),
      h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        try { download(`agropulso-backup-${new Date().toISOString().slice(0, 10)}.json`, new TextEncoder().encode(await exportBackup(db)), 'application/json'); say('Cópia gerada. Guarde o arquivo em local seguro: ele contém seus dados financeiros.'); } catch (e) { console.error(e); say('Não foi possível gerar a cópia.', 'err'); }
      } }, icon('backup'), 'Baixar cópia dos dados')),
    h('section', { class: 'panel alt w6' }, h('h2', {}, 'Restaurar'), restore))];
}
