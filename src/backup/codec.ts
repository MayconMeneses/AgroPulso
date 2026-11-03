import type { Row, SqlValue } from '../storage/database.ts';
import { BackupError } from './errors.ts';

export const FORMAT = 'agropulso-backup';
export const FORMAT_VERSION = 1;

export type JsonValue = string | number | null | { $blob: string };
export type JsonRow = Record<string, JsonValue>;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeRow(row: Row): JsonRow {
  const out: JsonRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Uint8Array) out[key] = { $blob: toBase64(value) };
    else if (typeof value === 'bigint') {
      throw new BackupError('valor_nao_suportado', `Coluna "${key}" tem inteiro fora do alcance seguro`);
    } else out[key] = value;
  }
  return out;
}

export function decodeRow(row: unknown): Record<string, SqlValue> {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new BackupError('estrutura', 'Linha inválida no arquivo de backup');
  }
  const out: Record<string, SqlValue> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || typeof value === 'string' || typeof value === 'number') out[key] = value;
    else if (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      typeof (value as { $blob?: unknown }).$blob === 'string'
    ) {
      out[key] = fromBase64((value as { $blob: string }).$blob);
    } else throw new BackupError('estrutura', `Valor inválido na coluna "${key}"`);
  }
  return out;
}
