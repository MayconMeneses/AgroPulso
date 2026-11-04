import { DomainError } from './errors.ts';

// Quantidades e áreas: inteiro em milionésimos. Dinheiro: inteiro em centavos.
// Só vírgula decimal (pt-BR). Ponto, separador de milhar e casas a mais são recusados:
// nunca se corrige em silêncio o que a pessoa digitou (RN-AG-013).
export const MICRO = 1_000_000;

function parseScaled(input: string, decimals: number, label: string): number {
  const m = /^(\d+)(?:,(\d+))?$/.exec(input.trim());
  if (!m) throw new DomainError('invalido', `${label}: use só dígitos e vírgula decimal (ex.: 12,5), sem ponto de milhar`);
  const frac = m[2] ?? '';
  if (frac.length > decimals) throw new DomainError('invalido', `${label}: no máximo ${decimals} casas decimais`);
  const v = BigInt(m[1] + frac.padEnd(decimals, '0'));
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new DomainError('invalido', `${label}: valor grande demais`);
  return Number(v);
}

export const parseQuantity = (s: string, label: string): number => parseScaled(s, 6, label);
export const parseMoney = (s: string, label: string): number => parseScaled(s, 2, label);

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatQuantity(micro: number): string {
  const s = String(micro).padStart(7, '0');
  const int = s.slice(0, -6);
  const frac = s.slice(-6).replace(/0+$/, '');
  return group(int) + (frac ? `,${frac}` : '');
}

export function formatMoney(cents: number): string {
  const s = String(cents).padStart(3, '0');
  return `R$ ${group(s.slice(0, -2))},${s.slice(-2)}`;
}
