import { addCommonActivityTypes } from './app/domain/activities.js';
import { addCommonCategoriesAndUnits } from './app/domain/defaults.js';
import { guardDatabase } from './app/domain/readonly-guard.js';
import { migrations } from './app/migrations/migrations.js';
import { migrate } from './app/migrations/runner.js';
import { openBrowserSqlite } from './app/storage/browser-sqlite.js';
import { StorageError } from './app/storage/saver.js';
import { activateFromLink, guardPolicy, licenseStrip, refreshLicense } from './licenca.js';
import { cadastros } from './views-cadastros.js';
import { estoque } from './views-estoque.js';
import { painel } from './views-painel.js';
import { backup, relatorio } from './views-relatorio.js';
import { registrar } from './views-registrar.js';
import { safras } from './views-safras.js';
import { animatedMark, fail, form, h, icon, prefGet, prefSet, say } from './ui.js';

// [id, rótulo completo, rótulo curto da barra]
const TABS = [['painel', 'Painel', 'Painel'], ['registrar', 'Registrar', 'Registrar'], ['safras', 'Safras', 'Safras'], ['estoque', 'Estoque', 'Estoque'], ['cadastros', 'Cadastros', 'Cadastros'], ['relatorio', 'Relatório e cópia dos dados', 'Relatório']];
const main = document.getElementById('main');
let db;
let tab = 'painel';
let author = '';

// Preferências de tela: só conveniência. Se o navegador bloquear o armazenamento, o app segue funcionando.

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
const go = (id) => { tab = id; say(''); render(); window.scrollTo(0, 0); }; // leva para outra aba (usado pelos botões das telas vazias e dos avisos)
const VIEWS = { painel: (d, r) => painel(d, r, go), registrar: (d, r) => registrar(d, r, author, go), safras: (d, r) => safras(d, r, author), estoque: (d, r) => estoque(d, r, author, go), cadastros, relatorio: async (d, r) => [...(await relatorio(d, r, go)), ...(await backup(d, r))] };

async function render() {
  drawNav();
  try {
    const strip = licenseStrip(go);
    main.replaceChildren(...(strip ? [strip] : []), ...(await VIEWS[tab](db, () => render())));
    if (!main.contains(document.activeElement)) main.focus();
  } catch (e) {
    fail(e);
  }
}

async function askAuthor() {
  const rows = await db.all("select value from app_meta where key = 'perfil'");
  if (rows[0]) { author = String(rows[0].value); return; }
  await new Promise((resolve, reject) => {
    main.replaceChildren(h('section', { class: 'panel' }, animatedMark(), h('h2', {}, 'Bem-vindo'), h('p', {}, 'Tudo o que você anotar fica só neste aparelho. Diga seu nome: ele aparece como autor nos registros.'),
      form([{ name: 'name', label: 'Seu nome' }], 'Começar', async (v, _f, showError) => {
        const name = v.name.trim();
        if (!name) { showError('Informe seu nome.'); return; }
        try {
          await db.run('insert into app_meta (key, value) values (?, ?)', ['perfil', name]);
        } catch (e) {
          const erro = e?.name === 'StorageError'
            ? e
            : new StorageError('Não foi possível salvar seu nome neste aparelho. Nada foi apagado; tente de novo.', { cause: e });
          showError(erro.message);
          reject(erro);
          return;
        }
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
  // A política de Trusted Types da página só aceita scripts por esta política, e ela só deixa passar o sw.js.
  const policy = window.trustedTypes?.createPolicy('agropulso', { createScriptURL: (u) => { if (u !== 'sw.js') throw new TypeError('script não permitido'); return u; } });
  navigator.serviceWorker.register(policy ? policy.createScriptURL('sw.js') : 'sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    const check = () => { if (navigator.onLine) reg.update().catch(() => {}); };
    addEventListener('online', check);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setInterval(check, 60 * 60 * 1000);
    check(); // ao abrir o app também: sem isto, o iPhone só procurava versão nova ao voltar de outro app
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
    const raw = await openBrowserSqlite(SQL);
    await migrate(raw, migrations); // a migração usa o banco sem trava: ela só roda ao abrir e nunca é bloqueada
    await refreshLicense();
    db = guardDatabase(raw, guardPolicy()); // daqui em diante toda gravação passa pela trava da licença
    // Dados iniciais: com a licença vencida a gravação é recusada, e isso não pode derrubar a abertura do app.
    const onlyReadOnly = (e) => { if (e?.code !== 'somente_leitura') throw e; };
    await addCommonActivityTypes(db).catch(onlyReadOnly);
    await addCommonCategoriesAndUnits(db).catch(onlyReadOnly);
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    const linked = await activateFromLink(); // link de ativação enviado pelo WhatsApp (#licenca=...)
    const finish = async () => {
      await render();
      if (linked) say(linked.ok ? 'Licença ativada. Obrigado!' : linked.message, linked.ok ? 'ok' : 'err');
      watchUpdates();
    };
    const retryProfile = async () => {
      try {
        await askAuthor();
        await finish();
      } catch (e) {
        console.error(e);
        if (e?.name === 'StorageError') showProfileError(e);
        else fail(e);
      }
    };
    const showProfileError = (e) => {
      main.replaceChildren(h('section', { class: 'panel' }, h('h2', {}, 'Não foi possível salvar seu nome'),
        h('p', { class: 'callout' }, e.message),
        h('button', { class: 'btn primary', type: 'button', onclick: retryProfile }, 'Tentar de novo')));
    };
    try {
      await askAuthor();
    } catch (e) {
      console.error(e);
      if (e?.name === 'StorageError') showProfileError(e);
      else fail(e);
      return;
    }
    await finish();
  } catch (e) {
    console.error(e);
    main.replaceChildren(h('p', { class: 'callout' }, 'Não foi possível abrir o banco de dados deste aparelho. Nada foi apagado.'));
  }
}
start();
