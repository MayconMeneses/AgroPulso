import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyLicense } from '../src/domain/license.ts';

// Usa SEMPRE pastas temporárias e chaves descartáveis: nenhuma chave real é criada por estes testes.
const run = (args: string[]) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/licenca.mjs', ...args], { encoding: 'utf8' });
const tmp = () => mkdtempSync(join(tmpdir(), 'agp-lic-'));

test('gerar-chaves cria o par fora do projeto, sem imprimir a chave privada, e recusa sobrescrever', () => {
  const dir = tmp();
  try {
    const r = run(['gerar-chaves', '--pasta', dir]);
    assert.equal(r.status, 0, r.stderr);
    const pem = readFileSync(join(dir, 'chave-privada.pem'), 'utf8');
    assert.match(pem, /BEGIN PRIVATE KEY/);
    const body = pem.replace(/-----[^-]+-----|\s+/g, '');
    assert.ok(!r.stdout.includes(body.slice(0, 40)), 'a chave privada não pode aparecer na saída');
    const pub = JSON.parse(readFileSync(join(dir, 'chave-publica.json'), 'utf8'));
    assert.deepEqual(Object.keys(pub).sort(), ['crv', 'kty', 'x', 'y'], 'a pública não leva nenhum campo privado');
    const again = run(['gerar-chaves', '--pasta', dir]);
    assert.notEqual(again.status, 0);
    assert.match(again.stderr, /já existe/);
    assert.equal(readFileSync(join(dir, 'chave-privada.pem'), 'utf8'), pem, 'a chave privada ficou intacta');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a pasta das chaves não pode ficar dentro do projeto', () => {
  const r = run(['gerar-chaves', '--pasta', 'licencas']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /dentro do projeto/);
  assert.equal(existsSync('licencas/chave-privada.pem'), false);
  assert.notEqual(run(['gerar-chaves', '--pasta', '.']).status, 0);
});

test('emitir: a licença passa na conferência do app, tem o plano e a validade certos e fica registrada fora do projeto', async () => {
  const dir = tmp();
  try {
    assert.equal(run(['gerar-chaves', '--pasta', dir]).status, 0);
    const pub = JSON.parse(readFileSync(join(dir, 'chave-publica.json'), 'utf8'));
    const cases: Array<[string[], string, string | undefined]> = [
      [['--plano', 'anual'], 'anual', '2027-12-05'],
      [['--plano', 'mensal'], 'mensal', '2027-01-11'],
      [['--plano', 'anual', '--ate', '2027-03-01'], 'anual', '2027-03-01'],
      [['--plano', 'interna'], 'interna', undefined],
    ];
    for (const [extra, plano, ate] of cases) {
      const r = run(['emitir', '--pasta', dir, '--nome', 'Maria da Roça', '--hoje', '2026-12-05', '--whatsapp', '(81) 99999-0000', ...extra]);
      assert.equal(r.status, 0, r.stderr);
      const key = /AGP1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.exec(r.stdout)?.[0] ?? '';
      const v = await verifyLicense(key, { k1: pub });
      assert.equal(v.ok, true, `${plano}: ${r.stdout}`);
      if (v.ok) {
        assert.deepEqual([v.payload.nome, v.payload.plano, v.payload.valida_ate, v.payload.aparelhos, v.payload.emitida], ['Maria da Roça', plano, ate, 3, '2026-12-05']);
      }
      assert.match(r.stdout, /https:\/\/agropulso\.mmsystem\.tech\/#licenca=AGP1\./);
      assert.match(r.stdout, /https:\/\/wa\.me\/81999990000\?text=/);
    }
    const lines = readFileSync(join(dir, 'licencas-emitidas.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 4);
    assert.equal(lines[0].whatsapp, '81999990000');
    assert.equal(new Set(lines.map((l) => l.id)).size, 4, 'cada licença tem número próprio');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('emitir recusa dados ruins e não registra nada', () => {
  const dir = tmp();
  try {
    assert.equal(run(['gerar-chaves', '--pasta', dir]).status, 0);
    const bad: string[][] = [
      ['--nome', '', '--plano', 'anual'],
      ['--nome', 'Maria', '--plano', 'vitalicia'],
      ['--nome', 'Maria'],
      ['--nome', 'a'.repeat(41), '--plano', 'anual'],
      ['--nome', 'Maria', '--plano', 'anual', '--aparelhos', '0'],
      ['--nome', 'Maria', '--plano', 'anual', '--aparelhos', '11'],
      ['--nome', 'Maria', '--plano', 'anual', '--ate', '2020-01-01', '--hoje', '2026-12-05'],
      ['--nome', 'Maria', '--plano', 'anual', '--ate', '2027-13-45'],
      ['--nome', 'Maria', '--plano', 'interna', '--ate', '2027-01-01'],
    ];
    for (const args of bad) assert.notEqual(run(['emitir', '--pasta', dir, ...args]).status, 0, args.join(' '));
    assert.equal(existsSync(join(dir, 'licencas-emitidas.jsonl')), false, 'nenhuma licença ruim foi registrada');
    assert.notEqual(run(['emitir', '--pasta', tmp(), '--nome', 'Maria', '--plano', 'anual']).status, 0, 'sem chave privada não emite');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('aplicar-chave-publica grava só a pública no arquivo de chaves e não sobrescreve sem --forcar', () => {
  const dir = tmp();
  try {
    assert.equal(run(['gerar-chaves', '--pasta', dir]).status, 0);
    const target = join(dir, 'license-keys.ts');
    copyFileSync('src/domain/license-keys.ts', target);
    const before = readFileSync('src/domain/license-keys.ts', 'utf8');
    const r = run(['aplicar-chave-publica', '--pasta', dir, '--arquivo-chaves', target]);
    assert.equal(r.status, 0, r.stderr);
    const text = readFileSync(target, 'utf8');
    assert.match(text, /TRUSTED_PUBLIC_KEYS: TrustedKeys = \{ k1: \{"kty":"EC","crv":"P-256"/);
    assert.doesNotMatch(text, /"d"\s*:/);
    assert.notEqual(run(['aplicar-chave-publica', '--pasta', dir, '--arquivo-chaves', target]).status, 0, 'não troca uma chave existente sem --forcar');
    assert.equal(readFileSync('src/domain/license-keys.ts', 'utf8'), before, 'o arquivo real do projeto não foi tocado');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('HARD: nenhum arquivo de chave privada ou lista de licenças dentro do projeto', () => {
  const tracked = spawnSync('git', ['ls-files'], { encoding: 'utf8' }).stdout.split('\n');
  assert.deepEqual(tracked.filter((f) => /\.pem$|^licencas\/|chave-privada|licencas-emitidas/.test(f)), []);
  const ignored = spawnSync('git', ['check-ignore', 'chave-privada.pem', 'licencas/x', 'a.pem'], { encoding: 'utf8' }).stdout.trim().split('\n').sort();
  assert.deepEqual(ignored, ['a.pem', 'chave-privada.pem', 'licencas/x']);
});
