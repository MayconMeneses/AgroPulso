import { LICENSE_ENFORCED } from './app/domain/license-config.js';
import { TRUSTED_PUBLIC_KEYS } from './app/domain/license-keys.js';
import { activateLicense, loadLicense } from './app/domain/license-state.js';
import { browserKeyValueStore } from './app/storage/browser-sqlite.js';
import { form, h, say } from './ui.js';

// Licença no navegador (ADR-014). Guarda o estado em memória, lido da guarda separada do banco (nunca vai na cópia de segurança).
// Com a chave geral desligada (license-config.js), nada aqui bloqueia ou cobra: só a tela de ativação funciona.
const store = browserKeyValueStore();
let view = { enforced: false, status: { state: 'sem_chave', canWrite: true, daysLeft: null, message: '' } };

const today = () => new Date().toLocaleDateString('en-CA'); // AAAA-MM-DD no relógio do aparelho

export async function refreshLicense() {
  view = await loadLicense(store, TRUSTED_PUBLIC_KEYS, today(), LICENSE_ENFORCED);
  return view;
}

// A trava do banco consulta isto a cada gravação (ver readonly-guard).
export const guardPolicy = () => ({ canWrite: () => view.status.canWrite, message: () => view.status.message });

export async function activateFromText(text) {
  const result = await activateLicense(store, text, TRUSTED_PUBLIC_KEYS);
  if (result.ok) await refreshLicense();
  return result;
}

// Link de ativação (#licenca=...): o fragmento não vai para nenhum servidor. Ativa e apaga o endereço, para a chave não
// ficar no histórico nem numa captura de tela. A chave nunca vai para o console.
export async function activateFromLink() {
  const m = /^#licenca=(.+)$/.exec(location.hash);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  let text = '';
  try { text = decodeURIComponent(m[1]); } catch { return { ok: false, message: 'O link de ativação está incompleto. Peça um novo.' }; }
  return activateFromText(text);
}

const PLAN = { anual: 'Plano anual', mensal: 'Plano mensal', interna: 'Licença interna' };

// Faixa no alto de cada tela: só aparece com a cobrança ligada e só quando há o que dizer.
export function licenseStrip(go) {
  if (!view.enforced) return null;
  const { state, message } = view.status;
  if (state === 'ativa') return null;
  const bad = state === 'vencida' || state === 'sem_chave' || state === 'invalida';
  return h('div', { class: bad ? 'callout' : 'aviso', role: bad ? 'alert' : 'status' }, h('p', {}, message),
    h('button', { class: 'btn', type: 'button', onclick: () => go('cadastros') }, bad ? 'Ativar ou renovar licença' : 'Ver licença'));
}

// Bloco "Licença" em Cadastros. Existe mesmo com a cobrança desligada, para o dono ativar a licença interna antes da virada.
export function licencaBlock(rerender) {
  const s = view.status;
  const lines = [];
  if (s.name) lines.push(h('p', {}, `Licenciado para ${s.name}.`));
  if (s.plan) lines.push(h('p', { class: 'muted small' }, `${PLAN[s.plan] ?? s.plan}${s.daysLeft !== null && s.daysLeft >= 0 ? `, ${s.daysLeft} ${s.daysLeft === 1 ? 'dia restante' : 'dias restantes'}` : ''}.`));
  if (!s.name) lines.push(h('p', {}, s.message));
  return h('section', { class: 'panel' }, h('div', { class: 'eyebrow' }, 'Licença'), h('h2', {}, view.enforced ? 'Sua licença' : 'Licença do AgroPulso'), ...lines,
    h('p', { class: 'muted small' }, 'Cole abaixo a chave que você recebeu. Ela vale para até 3 aparelhos. Seus dados nunca são apagados, mesmo com a licença vencida.'),
    form([{ name: 'chave', label: 'Chave de licença', type: 'textarea' }], 'Ativar licença', async (v, _f, showError) => {
      if (!v.chave.trim()) { showError('Cole a chave que você recebeu.'); return; }
      const r = await activateFromText(v.chave);
      if (!r.ok) { showError(r.message); return; }
      say('Licença ativada. Obrigado!');
      await rerender();
    }));
}
