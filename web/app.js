import { migrations } from './app/migrations/migrations.js';
import { migrate } from './app/migrations/runner.js';
import { openBrowserSqlite } from './app/storage/browser-sqlite.js';
import { cadastros } from './views-cadastros.js';
import { painel } from './views-painel.js';
import { backup, relatorio } from './views-relatorio.js';
import { registrar } from './views-registrar.js';
import { safras } from './views-safras.js';
import { fail, form, h, icon, say } from './ui.js';

// [id, rótulo completo, rótulo curto da barra]
const TABS = [['painel', 'Painel', 'Painel'], ['registrar', 'Registrar', 'Registrar'], ['safras', 'Safras', 'Safras'], ['cadastros', 'Cadastros', 'Cadastros'], ['relatorio', 'Relatório', 'Relatório'], ['backup', 'Cópia dos dados', 'Cópia']];
const main = document.getElementById('main');
let db;
let tab = 'painel';
let author = '';

// Preferências de tela: só conveniência. Se o navegador bloquear o armazenamento, o app segue funcionando.
function prefGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function prefSet(k, v) { try { localStorage.setItem(k, v); } catch { /* sem armazenamento: ignora */ } }

// A identidade do app é preto e verde: o padrão é o tema escuro. "Automático" segue o sistema; "Claro" fica à escolha da pessoa.
const systemLight = matchMedia('(prefers-color-scheme: light)');
const THEMES = [['dark', 'Escuro', 'escuro'], ['light', 'Claro', 'claro'], ['auto', 'Automático', 'auto']];
let theme = THEMES.some(([k]) => k === prefGet('theme')) ? prefGet('theme') : 'dark';
const themeBtn = document.getElementById('theme');
function applyTheme() {
  document.documentElement.dataset.theme = theme === 'auto' ? (systemLight.matches ? 'light' : 'dark') : theme;
  const [, name, ic] = THEMES.find(([k]) => k === theme);
  themeBtn.replaceChildren(icon(ic));
  themeBtn.setAttribute('aria-label', `Tema: ${name}. Toque para trocar`);
  themeBtn.title = `Tema: ${name}`;
}
themeBtn.addEventListener('click', () => { theme = THEMES[(THEMES.findIndex(([k]) => k === theme) + 1) % THEMES.length][0]; prefSet('theme', theme); applyTheme(); });
systemLight.addEventListener('change', () => { if (theme === 'auto') applyTheme(); });
applyTheme();

const net = document.getElementById('net');
function showNet() {
  net.textContent = navigator.onLine ? 'Com internet' : 'Sem internet: tudo continua funcionando';
  net.className = navigator.onLine ? 'badge' : 'badge off';
}
addEventListener('online', showNet);
addEventListener('offline', showNet);
showNet();

const nav = document.getElementById('nav');
function drawNav() {
  nav.replaceChildren(...TABS.map(([id, label, short]) => h('button', { type: 'button', 'aria-label': label, 'aria-current': id === tab ? 'page' : null, onclick: () => { tab = id; say(''); render(); } }, icon(id), h('span', { class: 'label' }, short))));
  document.getElementById('section-title').textContent = TABS.find(([id]) => id === tab)[1];
}

const VIEWS = { painel, registrar: (d, r) => registrar(d, r, author), safras, cadastros, relatorio, backup };

async function render() {
  drawNav();
  try {
    main.replaceChildren(...(await VIEWS[tab](db, () => render())));
  } catch (e) {
    fail(e);
  }
}

async function askAuthor() {
  const rows = await db.all("select value from app_meta where key = 'perfil'");
  if (rows[0]) { author = String(rows[0].value); return; }
  await new Promise((resolve) => {
    main.replaceChildren(h('section', { class: 'panel' }, h('h2', {}, 'Bem-vindo'), h('p', {}, 'Tudo o que você anotar fica só neste aparelho. Diga seu nome: ele aparece como autor nos registros.'),
      form([{ name: 'name', label: 'Seu nome' }], 'Começar', async (v) => {
        const name = v.name.trim();
        if (!name) { say('Informe seu nome.', 'err'); return; }
        await db.run('insert into app_meta (key, value) values (?, ?)', ['perfil', name]);
        author = name;
        resolve();
      })));
  });
}

// Duas abas abertas teriam cada uma sua cópia do banco na memória, e a última a gravar apagaria o trabalho da outra.
// O bloqueio abaixo é mantido enquanto esta aba existir; a segunda aba recebe um aviso e não abre o banco.
async function ownDatabase() {
  if (!navigator.locks) return true;
  return new Promise((resolve) => {
    navigator.locks.request('agropulso-db', { ifAvailable: true }, (lock) => {
      resolve(lock !== null);
      return lock ? new Promise(() => {}) : undefined;
    });
  });
}

async function start() {
  if (!(await ownDatabase())) {
    main.replaceChildren(h('p', { class: 'callout' }, 'O AgroPulso já está aberto em outra aba ou janela. Feche esta e use a outra, para não perder registros.'));
    return;
  }
  try {
    const SQL = await initSqlJs({ locateFile: (f) => `vendor/${f}` });
    db = await openBrowserSqlite(SQL);
    await migrate(db, migrations);
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    await askAuthor();
    await render();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Sem modo offline:', e));
  } catch (e) {
    console.error(e);
    main.replaceChildren(h('p', { class: 'callout' }, 'Não foi possível abrir o banco de dados deste aparelho. Nada foi apagado.'));
  }
}
start();
