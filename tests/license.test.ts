import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { base64urlEncode, evaluateLicense, LICENSE_PREFIX, TRIAL_DAYS, verifyLicense } from '../src/domain/license.ts';
import type { TrustedKeys, VerifyResult } from '../src/domain/license.ts';
import { TRUSTED_PUBLIC_KEYS } from '../src/domain/license-keys.ts';

// Pares de chaves só para teste, gerados na hora. Nenhuma chave real existe neste repositório.
async function newPair() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  return { priv: pair.privateKey, pub: await crypto.subtle.exportKey('jwk', pair.publicKey) };
}
const A = await newPair();
const B = await newPair();
const trusted: TrustedKeys = { k1: A.pub };

const base = { v: 1, kid: 'k1', id: 'lic_12345678', nome: 'Maria da Roça', plano: 'anual', emitida: '2026-12-01', valida_ate: '2027-12-01', aparelhos: 3 };

async function sign(payload: unknown, priv = A.priv, prefix = LICENSE_PREFIX): Promise<string> {
  const p = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, new TextEncoder().encode(`${prefix}.${p}`)));
  return `${prefix}.${p}.${base64urlEncode(sig)}`;
}
const reason = (r: VerifyResult) => (r.ok ? 'ok' : r.reason);

test('uma chave assinada de verdade é aceita e traz os dados', async () => {
  const r = await verifyLicense(await sign(base), trusted);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.payload, base);
});

test('chave copiada do WhatsApp, com espaço e quebra de linha no meio, ainda vale', async () => {
  const key = await sign(base);
  const wrapped = `  ${key.slice(0, 40)}\n${key.slice(40, 90)} \r\n${key.slice(90)}\n`;
  assert.equal((await verifyLicense(wrapped, trusted)).ok, true);
});

test('dados mexidos depois de assinar são recusados (trocar o plano para "interna" não funciona)', async () => {
  const [prefix, , sig] = (await sign(base)).split('.') as [string, string, string];
  const forged = base64urlEncode(new TextEncoder().encode(JSON.stringify({ v: 1, kid: 'k1', id: base.id, nome: base.nome, plano: 'interna', emitida: base.emitida, aparelhos: 3 })));
  assert.equal(reason(await verifyLicense(`${prefix}.${forged}.${sig}`, trusted)), 'assinatura');
});

test('assinatura com um byte trocado, e assinatura de outra chave, são recusadas', async () => {
  const [prefix, p, sig] = (await sign(base)).split('.') as [string, string, string];
  const bytes = Buffer.from(sig, 'base64url');
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  assert.equal(reason(await verifyLicense(`${prefix}.${p}.${base64urlEncode(bytes)}`, trusted)), 'assinatura');
  assert.equal(reason(await verifyLicense(await sign(base, B.priv), trusted)), 'assinatura', 'mesmo kid, chave privada diferente');
});

test('o prefixo entra na assinatura: trocar AGP1 por outro prefixo assinado não passa', async () => {
  const k = await sign(base, A.priv, 'AGP1');
  const [, p, s] = k.split('.') as [string, string, string];
  assert.equal(reason(await verifyLicense(`AGP2.${p}.${s}`, trusted)), 'versao');
});

test('kid desconhecido, kid perigoso e nenhuma chave confiável', async () => {
  assert.equal(reason(await verifyLicense(await sign({ ...base, kid: 'k2' }), trusted)), 'chave_desconhecida');
  assert.equal(reason(await verifyLicense(await sign({ ...base, kid: '__proto__' }), trusted)), 'chave_desconhecida');
  assert.equal(reason(await verifyLicense(await sign({ ...base, kid: 'constructor' }), trusted)), 'chave_desconhecida');
  assert.equal(reason(await verifyLicense(await sign(base), {})), 'chave_desconhecida');
});

test('textos que não são chave: vazio, partes a mais ou a menos, caracteres estranhos, lixo, tamanho enorme', async () => {
  const good = await sign(base);
  const [pre, p, s] = good.split('.') as [string, string, string];
  for (const bad of ['', '   ', 'abc', `${pre}.${p}`, `${good}.x`, `${pre}.${p}.${s.slice(0, -4)}`, `${pre}.${p}!.${s}`, `${pre}.${p}=.${s}`, `${pre}..${s}`, `${pre}.${p}.`, 'x'.repeat(5000), `${pre}.${'A'.repeat(1990)}.${s}`]) {
    assert.equal(reason(await verifyLicense(bad, trusted)), 'formato', JSON.stringify(bad.slice(0, 30)));
  }
  assert.equal(reason(await verifyLicense(`${pre}.${base64urlEncode(new Uint8Array([0xff, 0xfe, 0x00]))}.${s}`, trusted)), 'formato', 'bytes que não são texto UTF-8');
  assert.equal(reason(await verifyLicense(`${pre}.${base64urlEncode(new TextEncoder().encode('[1,2]'))}.${s}`, trusted)), 'chave_desconhecida', 'JSON que não é objeto não traz kid');
  assert.equal(reason(await verifyLicense(`${pre}.${base64urlEncode(new TextEncoder().encode('null'))}.${s}`, trusted)), 'chave_desconhecida');
  assert.equal(reason(await verifyLicense(undefined as unknown as string, trusted)), 'formato');
});

test('dados assinados mas inválidos são recusados pelo conteúdo', async () => {
  const bad: Array<[string, Record<string, unknown>]> = [
    ['versão 2', { ...base, v: 2 }],
    ['campo extra', { ...base, extra: 1 }],
    ['nome vazio', { ...base, nome: '' }],
    ['nome com 41 letras', { ...base, nome: 'a'.repeat(41) }],
    ['nome com espaço nas pontas', { ...base, nome: ' Maria' }],
    ['nome com caractere de controle', { ...base, nome: 'Ma\u0000ria' }],
    ['nome com quebra de linha', { ...base, nome: 'Ma\nria' }],
    ['nome não é texto', { ...base, nome: 5 }],
    ['id curto', { ...base, id: 'abc' }],
    ['id com símbolo', { ...base, id: 'lic<script>12' }],
    ['plano desconhecido', { ...base, plano: 'vitalicia' }],
    ['aparelhos zero', { ...base, aparelhos: 0 }],
    ['aparelhos 11', { ...base, aparelhos: 11 }],
    ['aparelhos fracionado', { ...base, aparelhos: 1.5 }],
    ['aparelhos como texto', { ...base, aparelhos: '3' }],
    ['data impossível', { ...base, emitida: '2026-13-40' }],
    ['validade antes da emissão', { ...base, valida_ate: '2026-11-30' }],
    ['anual sem validade', { v: 1, kid: 'k1', id: base.id, nome: base.nome, plano: 'anual', emitida: base.emitida, aparelhos: 3 }],
    ['interna com validade', { ...base, plano: 'interna' }],
  ];
  for (const [label, payload] of bad) assert.equal(reason(await verifyLicense(await sign(payload), trusted)), 'conteudo', label);
  const interna = { v: 1, kid: 'k1', id: base.id, nome: 'Dono', plano: 'interna', emitida: '2026-11-05', aparelhos: 3 };
  assert.equal((await verifyLicense(await sign(interna), trusted)).ok, true, 'a licença interna não tem validade');
});

test('o nome vira texto puro: marcação HTML no nome não é interpretada nem alterada aqui', async () => {
  const r = await verifyLicense(await sign({ ...base, nome: '<b>Zé</b> & cia' }), trusted);
  assert.equal(r.ok && r.payload.nome, '<b>Zé</b> & cia'); // a tela usa textContent; o módulo não mexe no texto
});

// ---- estado da licença ----

const ok = async (over: Record<string, unknown> = {}) => verifyLicense(await sign({ ...base, ...over }), trusted);

test('sem chave: os 7 dias de teste escrevem; no dia 8 vira somente leitura', () => {
  for (let d = 0; d < TRIAL_DAYS; d++) {
    const today = new Date(Date.parse('2026-12-01T00:00:00Z') + d * 86_400_000).toISOString().slice(0, 10);
    const s = evaluateLicense({ license: null, installedOn: '2026-12-01', today });
    assert.deepEqual([s.state, s.canWrite, s.daysLeft], ['teste', true, TRIAL_DAYS - d], `dia ${d}`);
  }
  const s = evaluateLicense({ license: null, installedOn: '2026-12-01', today: '2026-12-08' });
  assert.deepEqual([s.state, s.canWrite], ['sem_chave', false]);
  assert.match(s.message, /ver seus dados.*cópia/);
});

test('licença no prazo: ativa; faltando 30 dias ou menos: vencendo; último dia ainda escreve; dia seguinte é somente leitura', async () => {
  const lic = await ok({ emitida: '2026-12-01', valida_ate: '2027-01-31' });
  const at = (today: string) => evaluateLicense({ license: lic, installedOn: '2026-12-01', today });
  assert.deepEqual([at('2026-12-15').state, at('2026-12-15').canWrite], ['ativa', true]);
  assert.deepEqual([at('2027-01-01').state, at('2027-01-01').daysLeft], ['vencendo', 30]);
  assert.deepEqual([at('2027-01-31').state, at('2027-01-31').canWrite, at('2027-01-31').daysLeft], ['vencendo', true, 0]);
  assert.match(at('2027-01-31').message, /vence hoje/);
  const v = at('2027-02-01');
  assert.deepEqual([v.state, v.canWrite, v.daysLeft], ['vencida', false, -1]);
  assert.match(v.message, /ver seus dados.*cópia/);
});

test('licença vencida não ganha os 7 dias de teste de volta', async () => {
  const s = evaluateLicense({ license: await ok({ valida_ate: '2026-12-10' }), installedOn: '2026-12-09', today: '2026-12-11' });
  assert.deepEqual([s.state, s.canWrite], ['vencida', false]);
});

test('licença interna nunca vence e não depende do relógio', async () => {
  const lic = await verifyLicense(await sign({ v: 1, kid: 'k1', id: 'lic_dono_0001', nome: 'Dono', plano: 'interna', emitida: '2026-11-05', aparelhos: 3 }), trusted);
  const s = evaluateLicense({ license: lic, installedOn: '2026-11-05', today: '2099-01-01' });
  assert.deepEqual([s.state, s.canWrite, s.daysLeft, s.plan], ['ativa', true, null, 'interna']);
});

test('chave guardada que deixou de valer vira "invalida", e só escreve se o teste ainda estiver correndo', async () => {
  const lic = await verifyLicense('AGP1.xxxx.yyyy', trusted);
  const depois = evaluateLicense({ license: lic, installedOn: '2026-12-01', today: '2027-03-01' });
  assert.deepEqual([depois.state, depois.canWrite], ['invalida', false]);
  assert.equal(evaluateLicense({ license: lic, installedOn: '2026-12-01', today: '2026-12-02' }).state, 'teste');
});

test('relógio voltado para trás não devolve dias: vale a maior data já vista', async () => {
  const lic = await ok({ valida_ate: '2027-01-31' });
  const s = evaluateLicense({ license: lic, installedOn: '2026-12-01', today: '2026-12-05', latestSeenOn: '2027-02-10' });
  assert.deepEqual([s.state, s.canWrite, s.seenOn], ['vencida', false, '2027-02-10']);
  const normal = evaluateLicense({ license: lic, installedOn: '2026-12-01', today: '2026-12-05', latestSeenOn: '2026-12-04' });
  assert.equal(normal.seenOn, '2026-12-05', 'data vista antiga não puxa para trás');
  const teste = evaluateLicense({ license: null, installedOn: '2026-12-01', today: '2026-12-02', latestSeenOn: '2026-12-20' });
  assert.equal(teste.state, 'sem_chave', 'o teste também não volta');
});

test('instalação "no futuro" (relógio errado) não trava o teste', () => {
  const s = evaluateLicense({ license: null, installedOn: '2026-12-10', today: '2026-12-01' });
  assert.deepEqual([s.state, s.daysLeft], ['teste', TRIAL_DAYS]);
});

test('datas inválidas vão para mensagem em português, não para exceção solta', () => {
  assert.throws(() => evaluateLicense({ license: null, installedOn: '2026-02-30', today: '2026-12-01' }), /data válida/);
  assert.throws(() => evaluateLicense({ license: null, installedOn: '2026-12-01', today: 'hoje' }), /data válida/);
});

// ---- garantias de projeto ----

test('HARD: a conferência da licença não usa rede e nenhum material privado está no repositório', () => {
  const src = readFileSync('src/domain/license.ts', 'utf8');
  assert.doesNotMatch(src, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/, 'conferir licença nunca chama a rede');
  assert.deepEqual(Object.keys(TRUSTED_PUBLIC_KEYS).filter((k) => 'd' in (TRUSTED_PUBLIC_KEYS[k] as object)), [], 'chave pública sem o campo privado "d"');
  const keysSrc = readFileSync('src/domain/license-keys.ts', 'utf8');
  assert.doesNotMatch(keysSrc, /PRIVATE KEY|"d"\s*:|\bd:\s*['"]/, 'nenhum material privado no arquivo de chaves');
  const ignore = readFileSync('.gitignore', 'utf8');
  for (const rule of ['*.pem', 'licencas/', 'chave-privada*']) assert.ok(ignore.split(/\r?\n/).includes(rule), `.gitignore deve conter ${rule}`);
});
