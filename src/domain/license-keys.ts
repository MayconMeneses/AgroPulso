// Chaves PÚBLICAS que o app aceita para conferir licenças, por "kid" (ADR-014 §3).
// Aqui entram só chaves públicas (JWK sem o campo "d"). A chave privada fica fora do repositório e do app, em arquivo do dono
// (ou no segredo do servidor de vendas). Há um teste que falha se algum material privado aparecer neste arquivo.
// Vazio de propósito até o dono gerar o par de chaves reais; sem nenhuma chave aqui, nenhuma licença é aceita.
// Para trocar de chave no futuro, acrescente a nova mantendo a antiga por pelo menos duas versões do app.
import type { TrustedKeys } from './license.ts';

export const TRUSTED_PUBLIC_KEYS: TrustedKeys = {};
