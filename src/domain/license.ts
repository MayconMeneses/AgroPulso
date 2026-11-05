import { DomainError } from './errors.ts';

// Licença do AgroPulso (ADR-014). Uma chave é um texto "AGP1.<dados>.<assinatura>" que o app confere SEM internet:
// os dados (nome, plano, datas) vêm assinados com ECDSA P-256 / SHA-256 pela WebCrypto, e a chave pública fica no app.
// A chave PRIVADA nunca entra neste repositório nem no app (ver license-keys.ts e .gitignore).
// Este módulo só confere e interpreta a chave. Não guarda nada, não usa rede e não decide o que a tela faz.

export const LICENSE_PREFIX = 'AGP1';
export const TRIAL_DAYS = 7; // teste grátis contado da instalação (decisão do dono, ADR-014 §12)
export const WARN_DAYS = 30; // aviso de vencimento
export const MAX_LICENSE_CHARS = 2000; // uma chave de verdade tem cerca de 250; o teto evita processar lixo enorme

export type Plan = 'anual' | 'mensal' | 'interna'; // "interna" é a do dono: não vence e não é vendida

export interface LicensePayload {
  v: 1;
  kid: string; // qual chave pública conferiu a assinatura (permite trocar de chave no futuro)
  id: string; // número da licença, sem relação com o cliente
  nome: string; // o que aparece em "Licenciado para"
  plano: Plan;
  emitida: string; // AAAA-MM-DD
  valida_ate?: string; // AAAA-MM-DD; só a licença interna não tem
  aparelhos: number; // limite combinado em contrato; o app offline não consegue contar (informativo)
}

export type VerifyFailure = 'formato' | 'versao' | 'chave_desconhecida' | 'assinatura' | 'conteudo';
export type VerifyResult = { ok: true; payload: LicensePayload } | { ok: false; reason: VerifyFailure; message: string };
export type TrustedKeys = Readonly<Record<string, JsonWebKey>>;

const fail = (reason: VerifyFailure, message: string): VerifyResult => ({ ok: false, reason, message });

export function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

// Estrito: só o alfabeto do base64url, sem espaço nem "=". Devolve null se o texto não for base64url bem formado.
function base64urlDecode(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const padded = text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

const isRealDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const FIELDS = new Set(['v', 'kid', 'id', 'nome', 'plano', 'emitida', 'valida_ate', 'aparelhos']);
const PLANS: readonly string[] = ['anual', 'mensal', 'interna'];

// Confere o conteúdo SÓ depois da assinatura: dado de fora nunca é interpretado antes de provar de onde veio.
function readPayload(raw: unknown): LicensePayload | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!FIELDS.has(k)) return null; // campo desconhecido: formato novo, que este app não entende
  if (o.v !== 1) return null;
  if (typeof o.kid !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(o.kid)) return null;
  if (typeof o.id !== 'string' || !/^[A-Za-z0-9_-]{8,40}$/.test(o.id)) return null;
  // Nome: é o cliente que escolhe, então vai para a tela como texto puro. Sem caractere de controle e com tamanho limitado.
  if (typeof o.nome !== 'string' || o.nome.trim() !== o.nome || o.nome.length < 1 || o.nome.length > 40 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(o.nome)) return null;
  if (typeof o.plano !== 'string' || !PLANS.includes(o.plano)) return null;
  if (!isRealDate(o.emitida)) return null;
  if (typeof o.aparelhos !== 'number' || !Number.isInteger(o.aparelhos) || o.aparelhos < 1 || o.aparelhos > 10) return null;
  if (o.plano === 'interna') {
    if ('valida_ate' in o) return null;
  } else if (!isRealDate(o.valida_ate) || o.valida_ate < o.emitida) return null;
  return { v: 1, kid: o.kid, id: o.id, nome: o.nome, plano: o.plano as Plan, emitida: o.emitida, ...(o.valida_ate !== undefined ? { valida_ate: o.valida_ate as string } : {}), aparelhos: o.aparelhos };
}

export async function verifyLicense(text: string, trusted: TrustedKeys): Promise<VerifyResult> {
  // Quem copia do WhatsApp pode trazer espaço e quebra de linha; o alfabeto da chave não tem nenhum, então tudo isso é descartado.
  if (typeof text !== 'string' || text.length > MAX_LICENSE_CHARS * 2) return fail('formato', 'Esta chave não parece uma chave do AgroPulso.');
  const compact = text.replace(/\s+/g, '');
  if (compact.length === 0 || compact.length > MAX_LICENSE_CHARS) return fail('formato', 'Esta chave não parece uma chave do AgroPulso.');
  const parts = compact.split('.');
  if (parts.length !== 3) return fail('formato', 'Esta chave não parece uma chave do AgroPulso.');
  const [prefix, payloadText, signatureText] = parts as [string, string, string];
  if (prefix !== LICENSE_PREFIX) {
    return /^AGP\d+$/.test(prefix) ? fail('versao', 'Esta chave é de um formato mais novo. Atualize o AgroPulso e tente de novo.') : fail('formato', 'Esta chave não parece uma chave do AgroPulso.');
  }
  const payloadBytes = base64urlDecode(payloadText);
  const signature = base64urlDecode(signatureText);
  if (!payloadBytes || !signature || signature.length !== 64) return fail('formato', 'Esta chave está incompleta ou com algum caractere errado.');

  // O único campo lido antes da assinatura é o "kid", só para escolher qual chave pública usar.
  let kid: unknown;
  try {
    kid = (JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes)) as { kid?: unknown } | null)?.kid;
  } catch {
    return fail('formato', 'Esta chave está incompleta ou com algum caractere errado.');
  }
  if (typeof kid !== 'string' || !Object.hasOwn(trusted, kid)) return fail('chave_desconhecida', 'Este app não reconhece esta chave. Atualize o AgroPulso ou fale com o suporte.');

  let valid: boolean;
  try {
    const key = await crypto.subtle.importKey('jwk', trusted[kid] as JsonWebKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, new TextEncoder().encode(`${prefix}.${payloadText}`));
  } catch {
    return fail('assinatura', 'Não foi possível conferir esta chave.');
  }
  if (!valid) return fail('assinatura', 'Esta chave não é válida. Confira se copiou inteira, ou peça uma nova.');

  let payload: LicensePayload | null;
  try {
    payload = readPayload(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes)));
  } catch {
    payload = null;
  }
  if (!payload) return fail('conteudo', 'Esta chave tem dados que o app não entende. Atualize o AgroPulso ou fale com o suporte.');
  return { ok: true, payload };
}

// ---- Estado da licença (o que o app pode fazer) ----

export type LicenseState = 'teste' | 'ativa' | 'vencendo' | 'vencida' | 'sem_chave' | 'invalida';

export interface LicenseStatus {
  state: LicenseState;
  // Escrever (criar e alterar registros). Ler, gerar relatório e baixar a cópia dos dados NUNCA dependem disto (ADR-014 §6).
  canWrite: boolean;
  daysLeft: number | null; // dias até vencer a licença, ou até acabar o teste; null na licença interna
  plan?: Plan;
  name?: string;
  // Maior data que o app já viu; quem chama deve guardar este valor (ajuda contra relógio voltado para trás; checagem fraca).
  seenOn: string;
  message: string;
}

const dayNumber = (d: string): number => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
const assertDay = (d: string, label: string): void => {
  if (!isRealDate(d)) throw new DomainError('invalido', `${label}: use uma data válida no formato AAAA-MM-DD`);
};

export function evaluateLicense(input: { license: VerifyResult | null; installedOn: string; today: string; latestSeenOn?: string }): LicenseStatus {
  assertDay(input.installedOn, 'Data da instalação');
  assertDay(input.today, 'Data de hoje');
  if (input.latestSeenOn !== undefined) assertDay(input.latestSeenOn, 'Última data vista');
  // Vale a maior entre o relógio do aparelho e a maior data já vista: voltar o relógio não devolve dias.
  const seenOn = input.latestSeenOn !== undefined && input.latestSeenOn > input.today ? input.latestSeenOn : input.today;
  const trialLeft = TRIAL_DAYS - Math.max(0, dayNumber(seenOn) - dayNumber(input.installedOn));

  const withoutKey = (state: 'sem_chave' | 'invalida', problem: string): LicenseStatus => {
    if (trialLeft > 0) return { state: 'teste', canWrite: true, daysLeft: trialLeft, seenOn, message: `Teste grátis: faltam ${trialLeft} ${trialLeft === 1 ? 'dia' : 'dias'}.` };
    return { state, canWrite: false, daysLeft: null, seenOn, message: `${problem} Você ainda pode ver seus dados, gerar relatório e baixar a cópia. Para voltar a anotar, ative uma licença.` };
  };

  if (input.license === null) return withoutKey('sem_chave', 'O teste grátis acabou.');
  if (!input.license.ok) return withoutKey('invalida', 'A licença guardada neste aparelho não é mais válida.');
  const p = input.license.payload;
  const base = { plan: p.plano, name: p.nome, seenOn };
  if (p.plano === 'interna' || p.valida_ate === undefined) return { ...base, state: 'ativa', canWrite: true, daysLeft: null, message: `Licenciado para ${p.nome}.` };

  const daysLeft = dayNumber(p.valida_ate) - dayNumber(seenOn); // o último dia (valida_ate) ainda vale
  if (daysLeft < 0) {
    return { ...base, state: 'vencida', canWrite: false, daysLeft, message: 'Sua licença venceu. Você ainda pode ver seus dados, gerar relatório e baixar a cópia. Renove para voltar a anotar.' };
  }
  if (daysLeft <= WARN_DAYS) {
    return { ...base, state: 'vencendo', canWrite: true, daysLeft, message: daysLeft === 0 ? 'Sua licença vence hoje.' : `Sua licença vence em ${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'}.` };
  }
  return { ...base, state: 'ativa', canWrite: true, daysLeft, message: `Licenciado para ${p.nome}.` };
}
