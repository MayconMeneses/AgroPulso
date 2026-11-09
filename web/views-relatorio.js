import { decryptBackup, encryptBackup, isEncryptedBackup, MIN_PASSPHRASE } from './app/backup/crypto.js';
import { markBackupDone } from './app/domain/guide.js';
import { unguarded } from './app/domain/readonly-guard.js';
import { exportBackup } from './app/backup/export.js';
import { importBackup, MAX_BACKUP_CHARS } from './app/backup/import.js';
import { buildReport, toCsv } from './app/reports/csv.js';
import { buildLaborReport } from './app/reports/labor.js';
import { toPdf } from './app/reports/pdf.js';
import { download, emptyState, fail, form, h, icon, say } from './ui.js';

// O perfil fica em app_meta e é a mesma fonte que app.js usa ao abrir o banco.
async function readAuthor(db) {
  const rows = await db.all("select value from app_meta where key = 'perfil'");
  return rows[0] ? String(rows[0].value) : '';
}

export async function relatorio(db, rerender, go) {
  const cycles = await db.all('select c.id, t.name as crop, f.name as farm from crop_cycle c join crop_type t on t.id = c.crop_type_id join farm f on f.id = c.farm_id order by f.name, c.created_at');
  if (cycles.length === 0) return [emptyState('Ainda não há relatório', 'O relatório mostra o que você anotou em cada safra, em PDF ou planilha. Abra uma safra e anote algo primeiro.', [['Ver o passo a passo', () => go('painel'), true]])];
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

// Quanto o app já ocupa no aparelho, em palavras simples. Avisa quando passa de 80%.
async function espaco() {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e?.quota) return '';
    const fmt = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} GB` : `${(n / 1024 ** 2).toFixed(n >= 10 * 1024 ** 2 ? 0 : 1).replace('.', ',')} MB`);
    const cheio = e.usage / e.quota > 0.8;
    return h('p', { class: cheio ? 'callout' : 'muted small' }, `Espaço: o app usa ${fmt(e.usage)} dos ${fmt(e.quota)} que o aparelho reserva para ele.${cheio ? ' Está quase cheio. Guarde uma cópia e remova fotos antigas em Safras, Lançamentos.' : ''}`);
  } catch { return ''; }
}

export async function backup(db, rerender) {
  // O navegador decide se guarda os dados de forma permanente; sem essa garantia, a cópia é a única proteção.
  let persisted = false;
  try { persisted = (await navigator.storage?.persisted?.()) === true; } catch { /* sem a API: trata como não garantido */ }
  const aviso = persisted ? '' : h('div', { class: 'callout' }, 'Este navegador não garantiu a guarda permanente dos dados. Ele pode apagá-los se faltar espaço ou se você limpar os dados do site. Baixe uma cópia com frequência.');
  const espacoInfo = await espaco();
  const restore = form([
    { name: 'file', label: 'Arquivo de backup (.json)', type: 'file' },
    { name: 'pass', label: 'Senha do backup', hint: 'só se a cópia foi protegida com senha', type: 'password' },
    { name: 'sure', label: 'Entendo que isto SUBSTITUI todos os dados deste aparelho', type: 'checkbox' },
  ], 'Restaurar backup', async (v) => {
    if (!v.file) { say('Escolha o arquivo.', 'err'); return; }
    if (!v.sure) { say('Marque a confirmação para substituir os dados.', 'err'); return; }
    let text = await v.file.text();
    if (isEncryptedBackup(text)) {
      if (!v.pass) { say('Este backup tem senha. Digite a senha para restaurar.', 'err'); return; }
      text = await decryptBackup(text, v.pass);
    }
    // Mede o texto depois de decifrar: o limite é de caracteres, e o tamanho do arquivo em bytes não é a mesma coisa.
    if (text.length > MAX_BACKUP_CHARS) { say('O arquivo é grande demais para ser um backup do AgroPulso.', 'err'); return; }
    const authorBefore = await readAuthor(db);
    try {
      download(`agropulso-antes-de-restaurar-${today()}.json`, new TextEncoder().encode(await exportBackup(db)), 'application/json');
    } catch (e) {
      console.error(e);
      say('Não foi possível baixar a cópia dos dados atuais. A restauração não foi feita.', 'err');
      return;
    }
    const raw = unguarded(db); // restaurar continua possível com a licença vencida: são os dados do próprio cliente
    await importBackup(raw, text);
    // O download acima disparou sem exceção; o navegador não confirma se o arquivo foi realmente salvo.
    await markBackupDone(raw);
    say('Backup restaurado.');
    if ((await readAuthor(raw)) !== authorBefore) {
      // O nome atual vive no escopo de app.js. Recarregar reabre o banco pelo mesmo caminho e relê o perfil.
      location.reload();
      return;
    }
    await rerender();
  });
  const today = () => new Date().toLocaleDateString('en-CA'); // AAAA-MM-DD no relógio do aparelho
  const protectedCopy = form([
    { name: 'pass', label: 'Senha', hint: `pelo menos ${MIN_PASSPHRASE} caracteres`, type: 'password' },
    { name: 'again', label: 'Repita a senha', type: 'password' },
  ], 'Baixar cópia protegida', async (v) => {
    if (v.pass !== v.again) { say('As duas senhas não são iguais.', 'err'); return; }
    const text = await encryptBackup(await exportBackup(db), v.pass);
    download(`agropulso-backup-protegido-${today()}.json`, new TextEncoder().encode(text), 'application/json');
    await markBackupDone(db);
    say('Cópia protegida gerada. Anote a senha: sem ela, não existe como abrir este arquivo.');
  });
  return [h('div', { class: 'bento' },
    h('section', { class: 'panel w6' }, h('h2', {}, 'Guardar uma cópia'), aviso, espacoInfo,
      h('p', {}, 'Seus dados ficam só neste aparelho. Se ele quebrar ou o navegador limpar os dados, sem cópia não dá para recuperar.'),
      h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        try { download(`agropulso-backup-${today()}.json`, new TextEncoder().encode(await exportBackup(db)), 'application/json'); await markBackupDone(db); say('Cópia gerada. Guarde o arquivo em local seguro: ele contém seus dados financeiros e não tem senha.'); } catch (e) { fail(e); }
      } }, icon('backup'), 'Baixar cópia dos dados'),
      h('details', {}, h('summary', {}, 'Cópia com senha (mais segura)'),
        h('p', { class: 'muted small' }, 'O arquivo fica cifrado: quem pegar não lê nada sem a senha. Se você esquecer a senha, a cópia não abre mais, e eu não tenho como recuperar.'), protectedCopy)),
    h('section', { class: 'panel alt w6' }, h('h2', {}, 'Restaurar'), restore))];
}
