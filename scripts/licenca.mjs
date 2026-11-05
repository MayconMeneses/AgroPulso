// Ferramenta do DONO para chaves e licenças do AgroPulso (ADR-014). Roda só no seu computador, nunca no app.
//
//   node scripts/licenca.mjs gerar-chaves            cria o par de chaves (a PRIVADA fica fora do projeto)
//   node scripts/licenca.mjs aplicar-chave-publica   coloca a chave PÚBLICA em src/domain/license-keys.ts
//   node scripts/licenca.mjs emitir --nome "Maria" --plano anual [--whatsapp 5581999999999] [--aparelhos 3] [--ate AAAA-MM-DD]
//
// Opção comum: --pasta CAMINHO (padrão: AgroPulso-licencas, na sua pasta de usuário). A pasta NUNCA pode ficar dentro do projeto.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { base64urlEncode, verifyLicense } from '../src/domain/license.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KID = 'k1';
const BASE_URL = 'https://agropulso.mmsystem.tech/';
const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

const out = (s = '') => process.stdout.write(`${s}\n`);
function die(msg) {
  process.stderr.write(`Erro: ${msg}\n`);
  process.exit(1);
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { pasta: { type: 'string' }, nome: { type: 'string' }, plano: { type: 'string' }, whatsapp: { type: 'string' }, aparelhos: { type: 'string' }, ate: { type: 'string' }, forcar: { type: 'boolean' }, hoje: { type: 'string' }, 'arquivo-chaves': { type: 'string' } },
});
const command = positionals[0];

// A pasta das chaves e da lista de licenças emitidas guarda segredo e dados de clientes: fora do projeto, sempre.
const folder = resolve(values.pasta ?? join(homedir(), 'AgroPulso-licencas'));
const rel = relative(ROOT, folder);
if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) die(`a pasta ${folder} está dentro do projeto. Use uma pasta fora dele (padrão: ${join(homedir(), 'AgroPulso-licencas')}).`);
const privatePath = join(folder, 'chave-privada.pem');
const publicPath = join(folder, 'chave-publica.json');
const registryPath = join(folder, 'licencas-emitidas.jsonl');

const toPem = (bytes) => `-----BEGIN PRIVATE KEY-----\n${Buffer.from(bytes).toString('base64').replace(/(.{64})/g, '$1\n').trim()}\n-----END PRIVATE KEY-----\n`;
const fromPem = (pem) => Buffer.from(pem.replace(/-----[^-]+-----|\s+/g, ''), 'base64');
const todayLocal = () => values.hoje ?? new Date().toLocaleDateString('en-CA');
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function gerarChaves() {
  if (existsSync(privatePath) && !values.forcar) die(`já existe uma chave privada em ${privatePath}. Gerar outra invalidaria o que você já emitiu. Se tem certeza, use --forcar.`);
  const pair = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const publicJwk = { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y };
  mkdirSync(folder, { recursive: true });
  writeFileSync(privatePath, toPem(await crypto.subtle.exportKey('pkcs8', pair.privateKey)), { mode: 0o600 });
  writeFileSync(publicPath, `${JSON.stringify(publicJwk)}\n`);
  out('Chaves criadas.');
  out(`  Privada (SEGREDO, não compartilhe): ${privatePath}`);
  out(`  Pública (pode ir para o app):       ${publicPath}`);
  out('');
  out('Faça AGORA uma cópia da chave privada em lugar seguro (gerenciador de senhas ou pen drive guardado).');
  out('Sem ela você não consegue emitir novas licenças. Com ela na mão de outra pessoa, ela emite licenças falsas.');
  out('Próximo passo: node scripts/licenca.mjs aplicar-chave-publica');
}

function aplicarChavePublica() {
  if (!existsSync(publicPath)) die(`não achei ${publicPath}. Rode antes: node scripts/licenca.mjs gerar-chaves`);
  const jwk = JSON.parse(readFileSync(publicPath, 'utf8'));
  if ('d' in jwk) die('o arquivo da chave pública contém campo privado ("d"). Abortei.');
  const file = values['arquivo-chaves'] ? resolve(values['arquivo-chaves']) : join(ROOT, 'src', 'domain', 'license-keys.ts'); // --arquivo-chaves é só para testes
  const text = readFileSync(file, 'utf8');
  const re = /export const TRUSTED_PUBLIC_KEYS: TrustedKeys = [\s\S]*?;\s*$/;
  if (!re.test(text)) die('não reconheci o formato de src/domain/license-keys.ts.');
  const current = /TRUSTED_PUBLIC_KEYS: TrustedKeys = \{\s*\}/.test(text);
  if (!current && !values.forcar) die('license-keys.ts já tem uma chave. Para trocar, use --forcar (e mantenha a antiga por duas versões, ver o ADR-014).');
  writeFileSync(file, text.replace(re, `export const TRUSTED_PUBLIC_KEYS: TrustedKeys = { ${KID}: ${JSON.stringify(jwk)} };\n`));
  out(`Chave pública gravada em src/domain/license-keys.ts (kid "${KID}").`);
  out('Agora é preciso publicar o app com esta chave: peça ao Claude para rodar os testes e enviar ao GitHub.');
}

async function emitir() {
  const nome = (values.nome ?? '').trim();
  const plano = values.plano ?? '';
  if (!nome) die('informe o nome com --nome "Maria".');
  if (!['anual', 'mensal', 'interna'].includes(plano)) die('--plano deve ser anual, mensal ou interna.');
  if (!existsSync(privatePath)) die(`não achei a chave privada em ${privatePath}. Rode antes: node scripts/licenca.mjs gerar-chaves`);
  if (!existsSync(publicPath)) die(`não achei ${publicPath}.`);
  const aparelhos = values.aparelhos === undefined ? 3 : Number(values.aparelhos);
  const emitida = todayLocal();
  const payload = { v: 1, kid: KID, id: `lic_${base64urlEncode(crypto.getRandomValues(new Uint8Array(9)))}`, nome, plano, emitida, aparelhos };
  if (plano !== 'interna') payload.valida_ate = values.ate ?? addDays(emitida, plano === 'anual' ? 365 : 37); // mensal: 30 dias + 7 de tolerância
  else if (values.ate) die('a licença interna não tem data de validade.');

  const key = await crypto.subtle.importKey('pkcs8', fromPem(readFileSync(privatePath, 'utf8')), ALG, false, ['sign']);
  const body = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign(SIGN, key, new TextEncoder().encode(`AGP1.${body}`)));
  const license = `AGP1.${body}.${base64urlEncode(signature)}`;

  // Confere a própria chave com a chave pública, do mesmo jeito que o app fará. Se falhar, nada é entregue nem registrado.
  const check = await verifyLicense(license, { [KID]: JSON.parse(readFileSync(publicPath, 'utf8')) });
  if (!check.ok) die(`a licença gerada não passou na conferência (${check.message}). Nada foi registrado. Confira o nome (até 40 letras, sem quebra de linha) e o número de aparelhos (1 a 10).`);

  const link = `${BASE_URL}#licenca=${license}`;
  const ate = payload.valida_ate ? `Sua licença vale até ${payload.valida_ate.split('-').reverse().join('/')}` : 'Licença sem data de validade';
  const message = `Olá, ${nome}! Obrigado por escolher o AgroPulso. 🌱\n\nPara ativar, toque neste link no celular:\n${link}\n\nSe o link não abrir, entre no app, vá em Cadastros > Licença e cole esta chave:\n${license}\n\n${ate}, para até ${aparelhos} aparelhos. Qualquer dúvida é só me chamar por aqui.`;

  mkdirSync(folder, { recursive: true });
  const digits = (values.whatsapp ?? '').replace(/\D/g, '');
  appendFileSync(registryPath, `${JSON.stringify({ id: payload.id, nome, plano, emitida, valida_ate: payload.valida_ate ?? null, aparelhos, whatsapp: digits || null })}\n`);

  out(`Licença ${payload.id} emitida para ${nome} (${plano}).`);
  out('');
  out('--- Mensagem pronta para enviar ---');
  out(message);
  out('-----------------------------------');
  if (digits) {
    out('');
    out('Abrir o WhatsApp do cliente já com a mensagem:');
    out(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`);
  }
  out('');
  out(`Registrado em ${registryPath} (fora do projeto).`);
}

switch (command) {
  case 'gerar-chaves': await gerarChaves(); break;
  case 'aplicar-chave-publica': aplicarChavePublica(); break;
  case 'emitir': await emitir(); break;
  default: die('comando desconhecido. Use: gerar-chaves, aplicar-chave-publica ou emitir (veja o início de scripts/licenca.mjs).');
}
