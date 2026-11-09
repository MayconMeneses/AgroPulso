import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { exportBackup } from '../src/backup/export.ts';
import { LICENSE_ENFORCED } from '../src/domain/license-config.ts';
import { TRUSTED_PUBLIC_KEYS } from '../src/domain/license-keys.ts';
import { activateLicense, loadLicense } from '../src/domain/license-state.ts';
import { DomainError } from '../src/domain/errors.ts';
import { base64urlEncode, TRIAL_DAYS } from '../src/domain/license.ts';
import type { TrustedKeys } from '../src/domain/license.ts';
import type { KeyValueStore } from '../src/storage/key-value.ts';
import { freshDb } from './helpers.ts';

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  writes = 0;
  async get(key: string) { return this.data.get(key) ?? null; }
  async set(key: string, value: string) { this.writes++; this.data.set(key, value); }
}

const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const trusted: TrustedKeys = { k1: await crypto.subtle.exportKey('jwk', pair.publicKey) };
async function keyFor(over: Record<string, unknown> = {}): Promise<string> {
  const payload = { v: 1, kid: 'k1', id: 'lic_12345678', nome: 'Maria', plano: 'anual', emitida: '2026-12-01', valida_ate: '2027-12-01', aparelhos: 3, ...over };
  const p = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(`AGP1.${p}`)));
  return `AGP1.${p}.${base64urlEncode(sig)}`;
}

test('cobrança desligada: libera tudo e não grava NADA (o teste de 7 dias não começa a contar)', async () => {
  const store = new MemoryStore();
  const v = await loadLicense(store, trusted, '2026-12-01', false);
  assert.deepEqual([v.enforced, v.status.canWrite], [false, true]);
  assert.equal(store.writes, 0, 'nenhum carimbo de instalação nem de data');
  const much = await loadLicense(store, trusted, '2027-06-01', false);
  assert.equal(much.status.canWrite, true);
  assert.equal(store.writes, 0);
});

test('cobrança desligada, com licença já ativada: mostra os dados, e vencida continua escrevendo', async () => {
  const store = new MemoryStore();
  assert.equal((await activateLicense(store, await keyFor({ valida_ate: '2026-12-31' }), trusted)).ok, true);
  const v = await loadLicense(store, trusted, '2027-02-01', false);
  assert.deepEqual([v.status.state, v.status.canWrite, v.status.name], ['vencida', true, 'Maria']);
});

test('cobrança ligada: o teste começa na primeira abertura, conta os dias e depois vira somente leitura', async () => {
  const store = new MemoryStore();
  const day0 = await loadLicense(store, trusted, '2026-12-01', true);
  assert.deepEqual([day0.status.state, day0.status.daysLeft, day0.status.canWrite], ['teste', TRIAL_DAYS, true]);
  assert.equal(store.data.get('installed_on'), '2026-12-01');
  const day6 = await loadLicense(store, trusted, '2026-12-07', true);
  assert.deepEqual([day6.status.state, day6.status.daysLeft], ['teste', 1]);
  const day7 = await loadLicense(store, trusted, '2026-12-08', true);
  assert.deepEqual([day7.status.state, day7.status.canWrite], ['sem_chave', false]);
});

test('cobrança ligada: voltar o relógio não devolve dias (a maior data vista fica guardada)', async () => {
  const store = new MemoryStore();
  await loadLicense(store, trusted, '2026-12-01', true);
  await loadLicense(store, trusted, '2026-12-20', true); // teste já acabou
  const back = await loadLicense(store, trusted, '2026-12-02', true); // relógio voltado
  assert.deepEqual([back.status.state, back.status.canWrite, back.status.seenOn], ['sem_chave', false, '2026-12-20']);
});

test('ativar a licença destrava; chave ruim não é guardada e não destrava', async () => {
  const store = new MemoryStore();
  await loadLicense(store, trusted, '2026-12-01', true);
  await loadLicense(store, trusted, '2026-12-20', true);
  const before = [...store.data.entries()].join('|');
  assert.equal((await activateLicense(store, 'AGP1.lixo.lixo', trusted)).ok, false);
  assert.equal((await activateLicense(store, await keyFor({ nome: '' }), trusted)).ok, false);
  assert.equal([...store.data.entries()].join('|'), before, 'nada foi guardado');
  assert.equal((await loadLicense(store, trusted, '2026-12-20', true)).status.canWrite, false);
  assert.equal((await activateLicense(store, `  ${await keyFor({ emitida: '2026-12-20', valida_ate: '2027-12-20' })}\n`, trusted)).ok, true);
  const ok = await loadLicense(store, trusted, '2026-12-20', true);
  assert.deepEqual([ok.status.state, ok.status.canWrite, ok.status.name], ['ativa', true, 'Maria']);
});

test('licença vencida: somente leitura, e renovar com a chave nova volta a escrever', async () => {
  const store = new MemoryStore();
  await activateLicense(store, await keyFor({ plano: 'mensal', emitida: '2026-12-01', valida_ate: '2027-01-08' }), trusted);
  assert.equal((await loadLicense(store, trusted, '2027-01-08', true)).status.canWrite, true, 'último dia ainda vale');
  const late = await loadLicense(store, trusted, '2027-01-09', true);
  assert.deepEqual([late.status.state, late.status.canWrite], ['vencida', false]);
  await activateLicense(store, await keyFor({ plano: 'mensal', emitida: '2027-01-08', valida_ate: '2027-02-08' }), trusted);
  assert.equal((await loadLicense(store, trusted, '2027-01-09', true)).status.canWrite, true);
});

test('troca de chave pública: licença guardada que deixou de ser reconhecida vira "invalida"', async () => {
  const store = new MemoryStore();
  await activateLicense(store, await keyFor(), trusted);
  await loadLicense(store, trusted, '2026-12-01', true); // instalação carimbada: o teste de 7 dias já passou quando a chave trocar
  const v = await loadLicense(store, {}, '2027-06-01', true);
  assert.equal(v.status.state, 'invalida');
  assert.equal(v.status.canWrite, false);
});

test('datas guardadas adulteradas não quebram: valem como se não existissem', async () => {
  const store = new MemoryStore();
  store.data.set('installed_on', 'ontem');
  store.data.set('seen_on', '2026-99-99');
  const v = await loadLicense(store, trusted, '2026-12-01', true);
  assert.deepEqual([v.status.state, v.status.canWrite], ['teste', true]);
});

test('data guardada impossível no calendário vale como ausente; data inválida de hoje é recusada antes de gravar', async () => {
  const store = new MemoryStore();
  store.data.set('installed_on', '2026-02-30');
  const v = await loadLicense(store, trusted, '2026-12-01', true);
  assert.deepEqual([v.status.state, v.status.canWrite], ['teste', true]);
  assert.equal(store.data.get('installed_on'), '2026-12-01');

  const invalido = new MemoryStore();
  await assert.rejects(loadLicense(invalido, trusted, '2026-02-30', true), (e: unknown) => e instanceof DomainError && e.code === 'invalido');
  assert.equal(invalido.writes, 0, 'nada gravado com data inválida');
});

test('a licença e as datas NÃO entram na cópia de segurança e não ficam no banco', async () => {
  const db = await freshDb();
  const store = new MemoryStore();
  const key = await keyFor();
  await activateLicense(store, key, trusted);
  await loadLicense(store, trusted, '2026-12-01', true);
  const backup = await exportBackup(db);
  assert.equal(backup.includes(key), false);
  assert.equal(backup.includes('installed_on'), false);
  const code = readFileSync('src/domain/license-state.ts', 'utf8');
  assert.doesNotMatch(code, /\bDatabase\b|app_meta/, 'license-state não conhece o banco');
});

// ---- garantias de projeto ----

test('HARD: a cobrança só pode estar ligada se existir ao menos uma chave pública real no app', () => {
  if (LICENSE_ENFORCED) assert.ok(Object.keys(TRUSTED_PUBLIC_KEYS).length > 0, 'cobrança ligada com license-keys.ts vazio: ninguém conseguiria ativar licença e todos ficariam em somente leitura');
});

test('HARD: só duas telas usam o banco sem trava (restaurar cópia e o botão de tempo e mapa)', () => {
  const sites: string[] = [];
  for (const f of readdirSync('web').filter((n) => n.endsWith('.js'))) {
    const text = readFileSync(join('web', f), 'utf8');
    for (const line of text.split(/\r?\n/)) if (/\bunguarded\(/.test(line) && !/^\s*import\b/.test(line)) sites.push(f);
  }
  assert.deepEqual(sites.sort(), ['views-local.js', 'views-relatorio.js']);
});

test('HARD: o app abre o banco, migra, só então coloca a trava, e os dados iniciais toleram somente leitura', () => {
  const app = readFileSync('web/app.js', 'utf8');
  const iMigrate = app.indexOf('await migrate(raw, migrations)');
  const iGuard = app.indexOf('db = guardDatabase(raw');
  const iSeed = app.indexOf('addCommonActivityTypes(db).catch(onlyReadOnly)');
  assert.ok(iMigrate > 0 && iGuard > iMigrate && iSeed > iGuard, 'ordem: migrar, travar, semear');
  assert.match(app, /e\?\.code !== 'somente_leitura'\) throw e/, 'só o erro de somente leitura é tolerado; os outros continuam subindo');
});
