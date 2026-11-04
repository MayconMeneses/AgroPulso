import { FORMAT, FORMAT_VERSION } from './codec.ts';
import { BackupError } from './errors.ts';

// Cópia de segurança protegida por senha (opcional). O arquivo de backup viaja por WhatsApp, e-mail e pastas na nuvem,
// então quem quiser pode cifrá-lo: AES-256-GCM com chave derivada da senha por PBKDF2-HMAC-SHA256. O GCM também autentica:
// senha errada ou arquivo mexido falham do mesmo jeito, e ninguém forja um backup válido sem saber a senha.
// Iterações: 600.000, o valor que a OWASP recomenda para PBKDF2-HMAC-SHA256 (Password Storage Cheat Sheet). O navegador
// não traz Argon2id, que seria a primeira escolha, e não vale puxar biblioteca de terceiros por causa disso.
// Esquecer a senha significa perder esta cópia: não existe recuperação.
export const KDF = 'PBKDF2-SHA256';
export const ITERATIONS = 600_000;
const MIN_ITERATIONS = 200_000; // contra arquivo que declara poucas iterações para facilitar adivinhar a senha
const MAX_ITERATIONS = 5_000_000; // contra arquivo que declara um número absurdo para travar o aparelho
export const MIN_PASSPHRASE = 10;

interface Envelope {
  format: string;
  formatVersion: number;
  encrypted: { kdf: string; iterations: number; salt: string; iv: string; data: string };
}

const b64 = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (text: string): Uint8Array => {
  try {
    const s = atob(text);
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  } catch {
    throw new BackupError('arquivo_invalido', 'O arquivo protegido está danificado');
  }
};

// Os campos do cabeçalho entram como dados autenticados: trocar qualquer um deles faz a decifragem falhar.
const aad = (e: Envelope['encrypted'], format: string, version: number): Uint8Array =>
  new TextEncoder().encode(`${format}|${version}|${e.kdf}|${e.iterations}|${e.salt}|${e.iv}`);

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function isEncryptedBackup(text: string): boolean {
  if (text.length > 300 * 1024 * 1024 || !text.includes('"encrypted"')) return false;
  try {
    return typeof (JSON.parse(text) as { encrypted?: unknown })?.encrypted === 'object';
  } catch {
    return false;
  }
}

export async function encryptBackup(plain: string, passphrase: string): Promise<string> {
  if (passphrase.length < MIN_PASSPHRASE) throw new BackupError('senha_fraca', `A senha precisa ter pelo menos ${MIN_PASSPHRASE} caracteres`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12)); // novo a cada cifragem, nunca repetido com a mesma chave
  const header = { kdf: KDF, iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: '' };
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(header, FORMAT, FORMAT_VERSION) }, key, new TextEncoder().encode(plain));
  header.data = b64(new Uint8Array(cipher));
  const env: Envelope = { format: FORMAT, formatVersion: FORMAT_VERSION, encrypted: header };
  return JSON.stringify(env);
}

export async function decryptBackup(text: string, passphrase: string): Promise<string> {
  let env: Envelope;
  try {
    env = JSON.parse(text) as Envelope;
  } catch {
    throw new BackupError('arquivo_invalido', 'O arquivo não é um backup do AgroPulso');
  }
  const e = env?.encrypted;
  if (env?.format !== FORMAT || env.formatVersion !== FORMAT_VERSION || typeof e !== 'object' || e === null || e.kdf !== KDF
    || typeof e.salt !== 'string' || typeof e.iv !== 'string' || typeof e.data !== 'string' || !Number.isInteger(e.iterations)) {
    throw new BackupError('estrutura', 'Backup protegido incompleto');
  }
  if (e.iterations < MIN_ITERATIONS || e.iterations > MAX_ITERATIONS) throw new BackupError('estrutura', 'Backup protegido com parâmetros fora do aceitável');
  const salt = unb64(e.salt);
  const iv = unb64(e.iv);
  if (salt.length < 16 || iv.length !== 12) throw new BackupError('estrutura', 'Backup protegido incompleto');
  const key = await deriveKey(passphrase, salt, e.iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(e, env.format, env.formatVersion) }, key, unb64(e.data));
    return new TextDecoder().decode(plain);
  } catch {
    throw new BackupError('senha', 'Senha incorreta, ou o arquivo foi alterado');
  }
}
