import { migrations } from './app/migrations/migrations.js';
import { migrate } from './app/migrations/runner.js';
import { openBrowserSqlite } from './app/storage/browser-sqlite.js';
import { cadastros } from './views-cadastros.js';
import { estoque } from './views-estoque.js';
import { painel } from './views-painel.js';
import { backup, relatorio } from './views-relatorio.js';
import { registrar } from './views-registrar.js';
import { safras } from './views-safras.js';
import { fail, form, h, icon, say } from './ui.js';

// [id, rótulo completo, rótulo curto da barra]
const TABS = [['painel', 'Painel', 'Painel'], ['registrar', 'Registrar', 'Registrar'], ['safras', 'Safras', 'Safras'], ['estoque', 'Estoque', 'Estoque'], ['cadastros', 'Cadastros', 'Cadastros'], ['relatorio', 'Relatório e cópia dos dados', 'Relatório']];
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

// Relatório e cópia de segurança dividem a mesma aba, para a barra de baixo caber em telas de 320 px.
const VIEWS = { painel, registrar: (d, r) => registrar(d, r, author), safras, estoque: (d, r) => estoque(d, r, author), cadastros, relatorio: async (d, r) => [...(await relatorio(d, r)), ...(await backup(d, r))] };

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

// Atualização: o navegador busca sw.js de novo ao abrir, ao voltar para o app e ao reconectar. Se houver versão nova,
// ela baixa em segundo plano e o app mostra um aviso; só troca de código quando a pessoa toca em "Atualizar".
// Os dados já estão gravados no aparelho a cada registro, então recarregar não perde nada.
function watchUpdates() {
  if (!('serviceWorker' in navigator)) return;
  const box = document.getElementById('update');
  let accepted = false;
  const offer = (worker) => {
    box.replaceChildren(h('span', {}, 'Há uma versão nova do AgroPulso.'), h('button', { class: 'btn primary', type: 'button', onclick: () => { accepted = true; box.hidden = true; worker.postMessage({ type: 'SKIP_WAITING' }); } }, 'Atualizar agora'), h('button', { class: 'btn ghost', type: 'button', onclick: () => { box.hidden = true; } }, 'Depois'));
    box.hidden = false;
  };
  navigator.serviceWorker.register('sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    const check = () => { if (navigator.onLine) reg.update().catch(() => {}); };
    addEventListener('online', check);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setInterval(check, 60 * 60 * 1000);
  }).catch((e) => console.warn('Sem modo offline:', e));
  // Só recarrega depois que a pessoa aceitou: a primeira instalação também troca o controlador e não deve recarregar.
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (accepted) location.reload(); });
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
    watchUpdates();
  } catch (e) {
    console.error(e);
    main.replaceChildren(h('p', { class: 'callout' }, 'Não foi possível abrir o banco de dados deste aparelho. Nada foi apagado.'));
  }
}
start();
