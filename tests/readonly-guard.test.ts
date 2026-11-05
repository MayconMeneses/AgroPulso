import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { exportBackup } from '../src/backup/export.ts';
import { importBackup } from '../src/backup/import.ts';
import { userTables } from '../src/backup/schema.ts';
import * as activities from '../src/domain/activities.ts';
import * as attachments from '../src/domain/attachments.ts';
import * as audit from '../src/domain/audit.ts';
import * as cropTypes from '../src/domain/crop-types.ts';
import * as cycles from '../src/domain/cycles.ts';
import * as defaults from '../src/domain/defaults.ts';
import * as farms from '../src/domain/farms.ts';
import * as financial from '../src/domain/financial.ts';
import * as guards from '../src/domain/guards.ts';
import * as guide from '../src/domain/guide.ts';
import * as labor from '../src/domain/labor.ts';
import * as location from '../src/domain/location.ts';
import * as plots from '../src/domain/plots.ts';
import * as production from '../src/domain/production.ts';
import { classifySql, guardDatabase, isWriteAllowedWhenLocked, unguarded } from '../src/domain/readonly-guard.ts';
import * as results from '../src/domain/results.ts';
import * as stock from '../src/domain/stock.ts';
import * as units from '../src/domain/units.ts';
import { freshDb } from './helpers.ts';

const MODULES = { activities, attachments, audit, cropTypes, cycles, defaults, farms, financial, guards, guide, labor, location, plots, production, results, stock, units } as const;

// ---- 1. o classificador de comandos SQL ----

test('classificador: leituras e controle de transação não são gravação', () => {
  for (const q of ['select * from farm', '  SELECT 1;', 'with c as (select 1) select * from c', 'begin', 'commit', 'rollback', 'savepoint a', 'release a', "pragma table_info(farm)", 'pragma foreign_key_check', 'explain query plan select 1', '', ' ; ']) {
    assert.deepEqual(classifySql(q).writes, [], q);
  }
});

test('classificador: toda gravação aponta a tabela certa, em qualquer jeito de escrever', () => {
  const cases: Array<[string, string[]]> = [
    ['insert into farm (id) values (1)', ['farm']],
    ['INSERT   OR REPLACE INTO "farm" (id) values (1)', ['farm']],
    ['insert or ignore into main.farm values (1)', ['farm']],
    ['replace into farm values (1)', ['farm']],
    ['UPDATE\nfarm set name = ?', ['farm']],
    ['update or replace farm set a = 1', ['farm']],
    ['delete from farm', ['farm']],
    ['delete from "app_meta"', ['app_meta']],
    ['with c as (select 1) insert into farm select * from c', ['farm']],
    ['insert into app_meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value', ['app_meta']],
    ['insert into farm (a) values (1) on conflict(id) do update set a = 1', ['farm']],
    ['select 1; delete from farm', ['farm']],
    ['insert into app_meta values (1); delete from farm', ['app_meta', 'farm']],
    ['insert into [farm] values (1)', ['farm']],
    ["insert into farm values ('insert into app_meta')", ['farm']],
    ["update farm set a = 'app_meta' where 'app_meta' = 'app_meta'", ['farm']],
    ['/* app_meta */ insert into farm values (1)', ['farm']],
    ['insert into farm values (1) -- app_meta', ['farm']],
    ['insert into farm select * from app_meta', ['farm']],
  ];
  for (const [sql, tables] of cases) assert.deepEqual(classifySql(sql).writes, tables, sql);
});

test('classificador: comandos que mudam estrutura ou são desconhecidos contam como gravação (na dúvida, bloqueia)', () => {
  for (const q of ['create table x (a)', 'drop table farm', 'alter table farm add column x', 'vacuum', 'reindex', "attach database 'x' as y", 'detach y', 'pragma writable_schema = on', 'pragma foreign_keys = off', 'truncate farm', 'frobnicate', 'with c as (select 1) drop table farm']) {
    assert.ok(classifySql(q).writes.includes('?'), q);
    assert.equal(isWriteAllowedWhenLocked(classifySql(q)), false, q);
  }
});

test('classificador: só app_meta passa com a licença travada', () => {
  assert.equal(isWriteAllowedWhenLocked(classifySql("insert into app_meta (key, value) values ('a', 'b')")), true);
  assert.equal(isWriteAllowedWhenLocked(classifySql('delete from app_meta')), true);
  assert.equal(isWriteAllowedWhenLocked(classifySql('insert into audit_event (type) values (1)')), false);
  assert.equal(isWriteAllowedWhenLocked(classifySql('insert into app_meta values (1); insert into farm values (1)')), false);
});

// ---- 2. a trava no banco ----

const locked = { value: false };
const message = 'Sua licença venceu.';

async function setup() {
  const raw = await freshDb();
  const db = guardDatabase(raw, { canWrite: () => !locked.value, message: () => message });
  locked.value = false;
  const farm = await farms.createFarm(db, { name: 'Sítio', timezone: 'America/Recife' });
  const crop = await cropTypes.createCropType(db, { name: 'Milho' });
  const kg = await units.createUnit(db, { name: 'kg', kind: 'massa' });
  const saco = await units.createUnit(db, { name: 'saco', kind: 'massa' });
  const cycleA = await cycles.openCycle(db, { farmId: farm.id, cropTypeId: crop.id }); // rascunho
  const cycleB = await cycles.openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  const b1 = await cycles.planCycle(db, cycleB.id, cycleB.version, { plannedStart: '2026-12-01', plannedEnd: '2027-03-01' }); // planejada
  const cycleC = await cycles.openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  const c1 = await cycles.planCycle(db, cycleC.id, cycleC.version, { plannedStart: '2026-12-01', plannedEnd: '2027-03-01' });
  const c2 = await cycles.startCycle(db, cycleC.id, c1.version, { actualStart: '2026-12-01' }); // em andamento
  const cycleD = await cycles.openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
  const d1 = await cycles.planCycle(db, cycleD.id, cycleD.version, { plannedStart: '2026-12-01', plannedEnd: '2027-03-01' });
  const d2 = await cycles.startCycle(db, cycleD.id, d1.version, { actualStart: '2026-12-01' });
  const type = await activities.createActivityType(db, { name: 'Capina' });
  const activity = await activities.recordActivity(db, { cycleId: cycleC.id, typeId: type.id, occurredOn: '2026-12-02', author: 'Ana' });
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]);
  const attachment = await attachments.addAttachment(db, { activityId: activity.id, name: 'foto.png', bytes: png });
  const category = await financial.createCostCategory(db, { name: 'Adubo' });
  const entry = await financial.recordEntry(db, { farmId: farm.id, cycleId: cycleC.id, kind: 'DESPESA', categoryId: category.id, amountCents: 5000, occurredOn: '2026-12-02', author: 'Ana' });
  const harvest = await production.recordHarvest(db, { cycleId: cycleC.id, harvestedOn: '2026-12-03', quantityMicro: 10_000_000, unitId: kg.id, author: 'Ana' });
  const sale = await production.recordSale(db, { cycleId: cycleC.id, soldOn: '2026-12-04', quantityMicro: 1_000_000, unitId: kg.id, amountCents: 1000, author: 'Ana' });
  const worker = await labor.createWorker(db, { farmId: farm.id, name: 'João', kind: 'CONTRATADO', payType: 'DIARIA', rateCents: 8000 } as Parameters<typeof labor.createWorker>[1]);
  const work = await labor.recordWork(db, { workerId: worker.id, cycleId: cycleC.id, occurredOn: '2026-12-05', daysMicro: 1_000_000, author: 'Ana' });
  const plot = await plots.createPlot(db, { farmId: farm.id, name: 'Talhão 1' });
  const item = await stock.createStockItem(db, { farmId: farm.id, name: 'Adubo NPK', unitId: kg.id });
  return { raw, db, farm, crop, kg, saco, cycleA, cycleB: { ...cycleB, version: b1.version }, cycleC: { ...cycleC, version: c2.version }, cycleD: { ...cycleD, version: d2.version }, type, activity, attachment, category, entry, harvest, sale, worker, work, plot, item };
}
type Fx = Awaited<ReturnType<typeof setup>>;
type Db = Fx['db'];

// Toda função exportada do domínio precisa estar numa destas listas. Função nova sem classificar faz o teste falhar:
// é assim que nenhuma gravação nova escapa da trava sem alguém decidir.
const NOT_DB = new Set(['assertDateText', 'assertNameLength', 'assertTimezone', 'guideComplete', 'dailyCostCents', 'monthlyCostCents', 'parseCoordinate', 'formatCoordinate', 'estimateWarnings', 'saleWarnings', 'sniffMime']);
const READS = new Set([
  'listActivityTypes', 'getActivity', 'listActivities', 'listAttachments', 'readAttachment', 'eventsFor', 'listCropTypes', 'getCycle', 'listCycles', 'listFarms',
  'listCostCategories', 'getEntry', 'listEntries', 'listCycleEntries', 'assertCycleWritable', 'findByKey', 'guideSteps', 'backupStatus', 'dailyAlerts', 'listWorkers', 'listWork',
  'laborSummary', 'onlineFeaturesEnabled', 'getFarmLocation', 'getPlot', 'listPlots', 'getHarvest', 'listHarvests', 'getSale', 'listSales', 'harvestWarning', 'saleWarning',
  'harvestEstimate', 'cycleResult', 'getStockItem', 'listStockItems', 'listMovements', 'getUnit', 'listUnits', 'convert',
]);
// Gravam em app_meta (data da última cópia): continuam permitidas mesmo travado.
const ALLOWED_LOCKED = new Set(['markBackupDone']);

const WRITES: Record<string, (f: Fx) => Promise<unknown>> = {
  createActivityType: (f) => activities.createActivityType(f.db, { name: 'Plantio' }),
  addCommonActivityTypes: (f) => activities.addCommonActivityTypes(f.db),
  recordActivity: (f) => activities.recordActivity(f.db, { cycleId: f.cycleC.id, typeId: f.type.id, occurredOn: '2026-12-06', author: 'Ana' }),
  updateActivity: (f) => activities.updateActivity(f.db, f.activity.id, f.activity.version, { notes: 'novo' }, 'Ana'),
  addAttachment: (f) => attachments.addAttachment(f.db, { activityId: f.activity.id, name: 'b.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]) }),
  removeAttachment: (f) => attachments.removeAttachment(f.db, f.attachment.id, 'enviado por engano'),
  recordEvent: (f) => audit.recordEvent(f.db, { type: 'teste', resource: 'farm', resourceId: f.farm.id }),
  createCropType: (f) => cropTypes.createCropType(f.db, { name: 'Feijão' }),
  openCycle: (f) => cycles.openCycle(f.db, { farmId: f.farm.id, cropTypeId: f.crop.id }),
  planCycle: (f) => cycles.planCycle(f.db, f.cycleA.id, f.cycleA.version, { plannedStart: '2026-12-01', plannedEnd: '2027-03-01' }),
  startCycle: (f) => cycles.startCycle(f.db, f.cycleB.id, f.cycleB.version, { actualStart: '2026-12-02' }),
  closeCycle: (f) => cycles.closeCycle(f.db, f.cycleD.id, f.cycleD.version, { reason: 'fim' }),
  cancelCycle: (f) => cycles.cancelCycle(f.db, f.cycleA.id, f.cycleA.version, { reason: 'desisti' }),
  addCommonCategoriesAndUnits: (f) => defaults.addCommonCategoriesAndUnits(f.db),
  createFarm: (f) => farms.createFarm(f.db, { name: 'Outro sítio', timezone: 'America/Recife' }),
  createCostCategory: (f) => financial.createCostCategory(f.db, { name: 'Combustível' }),
  recordEntry: (f) => financial.recordEntry(f.db, { farmId: f.farm.id, kind: 'DESPESA', amountCents: 100, occurredOn: '2026-12-06', author: 'Ana' }),
  recordEntryTx: (f) => financial.recordEntryTx(f.db, { farmId: f.farm.id, kind: 'DESPESA', amountCents: 100, occurredOn: '2026-12-06', author: 'Ana' }),
  voidEntry: (f) => financial.voidEntry(f.db, f.entry.id, f.entry.version, 'lançado errado'),
  voidEntryTx: (f) => financial.voidEntryTx(f.db, f.entry.id, f.entry.version, 'lançado errado'),
  correctEntry: (f) => financial.correctEntry(f.db, f.entry.id, f.entry.version, { amountCents: 4000, justification: 'valor certo' }),
  createWorker: (f) => labor.createWorker(f.db, { farmId: f.farm.id, name: 'Maria', kind: 'CONTRATADO', payType: 'DIARIA', rateCents: 9000 } as Parameters<typeof labor.createWorker>[1]),
  recordWork: (f) => labor.recordWork(f.db, { workerId: f.worker.id, cycleId: f.cycleC.id, occurredOn: '2026-12-07', daysMicro: 1_000_000, author: 'Ana' }),
  voidWork: (f) => labor.voidWork(f.db, f.work.id, 'dia errado'),
  setFarmLocation: (f) => location.setFarmLocation(f.db, f.farm.id, { latMicro: -8_000_000, lonMicro: -35_000_000 }),
  setOnlineFeatures: (f) => location.setOnlineFeatures(f.db, true),
  createPlot: (f) => plots.createPlot(f.db, { farmId: f.farm.id, name: 'Talhão 2' }),
  assignPlot: (f) => plots.assignPlot(f.db, f.cycleA.id, f.cycleA.version, f.plot.id),
  setPlotOutline: (f) => plots.setPlotOutline(f.db, f.plot.id, [{ latMicro: -8_000_000, lonMicro: -35_000_000 }, { latMicro: -8_001_000, lonMicro: -35_000_000 }, { latMicro: -8_001_000, lonMicro: -35_001_000 }]),
  recordHarvest: (f) => production.recordHarvest(f.db, { cycleId: f.cycleC.id, harvestedOn: '2026-12-08', quantityMicro: 1_000_000, unitId: f.kg.id, author: 'Ana' }),
  correctHarvest: (f) => production.correctHarvest(f.db, f.harvest.id, f.harvest.version, { quantityMicro: 11_000_000, justification: 'pesagem certa' }),
  recordSale: (f) => production.recordSale(f.db, { cycleId: f.cycleC.id, soldOn: '2026-12-09', quantityMicro: 1_000_000, unitId: f.kg.id, amountCents: 900, author: 'Ana' }),
  correctSale: (f) => production.correctSale(f.db, f.sale.id, f.sale.version, { amountCents: 900, justification: 'valor certo' }),
  recordReceipt: (f) => production.recordReceipt(f.db, { saleId: f.sale.id, receivedOn: '2026-12-10', amountCents: 500 }),
  setHarvestEstimate: (f) => production.setHarvestEstimate(f.db, f.cycleC.id, f.cycleC.version, { quantityMicro: 50_000_000, unitId: f.kg.id }),
  createStockItem: (f) => stock.createStockItem(f.db, { farmId: f.farm.id, name: 'Semente', unitId: f.kg.id }),
  recordMovement: (f) => stock.recordMovement(f.db, { itemId: f.item.id, kind: 'ENTRADA', quantityMicro: 1_000_000, occurredOn: '2026-12-06', author: 'Ana' }),
  createUnit: (f) => units.createUnit(f.db, { name: 'tonelada', kind: 'massa' }),
  setConversion: (f) => units.setConversion(f.db, { fromUnitId: f.saco.id, toUnitId: f.kg.id, factorMicro: 60_000_000, source: 'embalagem' }),
};

async function snapshot(db: Db): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of await userTables(unguarded(db))) if (t !== 'app_meta') out[t] = Number((await unguarded(db).all(`select count(*) as n from "${t}"`))[0]?.n);
  return out;
}

test('toda função exportada do domínio está classificada (leitura, gravação ou auxiliar sem banco)', () => {
  const unclassified: string[] = [];
  for (const [mod, ns] of Object.entries(MODULES)) {
    for (const [name, value] of Object.entries(ns)) {
      if (typeof value !== 'function') continue;
      if (NOT_DB.has(name) || READS.has(name) || ALLOWED_LOCKED.has(name) || name in WRITES) continue;
      unclassified.push(`${mod}.${name}`);
    }
  }
  assert.deepEqual(unclassified, [], 'classifique estas funções em tests/readonly-guard.test.ts (leitura ou gravação)');
});

test('travado: TODA função de gravação do domínio é recusada com a mensagem da licença e não muda nenhum dado', async () => {
  const f = await setup();
  const before = await snapshot(f.db);
  locked.value = true;
  try {
    for (const [name, attempt] of Object.entries(WRITES)) {
      await assert.rejects(attempt(f), (e: unknown) => {
        const err = e as { code?: string; message?: string };
        assert.equal(err.code, 'somente_leitura', `${name}: código do erro (recebeu "${err.message}")`);
        assert.equal(err.message, message, name);
        return true;
      }, name);
    }
  } finally {
    locked.value = false;
  }
  assert.deepEqual(await snapshot(f.db), before, 'nenhuma linha criada, alterada ou apagada');
});

test('travado: ver, gerar relatório, baixar a cópia e marcar "cópia feita" continuam funcionando', async () => {
  const f = await setup();
  locked.value = true;
  try {
    assert.equal((await farms.listFarms(f.db)).length, 1);
    assert.equal((await cycles.listCycles(f.db, f.farm.id)).length, 4);
    assert.ok((await results.cycleResult(f.db, f.cycleC.id)) !== undefined);
    assert.ok((await guide.guideSteps(f.db)).length === 4);
    assert.deepEqual(await guide.dailyAlerts(f.db, '2026-12-10'), []);
    const backup = await exportBackup(f.db);
    assert.ok(backup.length > 100);
    await guide.markBackupDone(f.db, new Date('2026-12-10T12:00:00Z')); // app_meta continua liberada
    assert.equal((await guide.backupStatus(f.db, new Date('2026-12-11T12:00:00Z'))).daysSince, 1);
  } finally {
    locked.value = false;
  }
});

test('destravar libera na hora, sem reabrir o banco', async () => {
  const f = await setup();
  locked.value = true;
  await assert.rejects(farms.createFarm(f.db, { name: 'X', timezone: 'America/Recife' }), /venceu/);
  locked.value = false;
  assert.equal((await farms.createFarm(f.db, { name: 'X', timezone: 'America/Recife' })).name, 'X');
});

test('travado: restaurar uma cópia de segurança continua possível, pelo banco sem trava', async () => {
  const origem = await setup();
  const copia = await exportBackup(origem.db);
  const destino = await setup();
  locked.value = true;
  try {
    await assert.rejects(importBackup(destino.db, copia), (e: unknown) => (e as { code?: string }).code === 'somente_leitura' || /venceu/.test(String((e as Error).message)));
    await importBackup(unguarded(destino.db), copia);
    assert.equal((await farms.listFarms(destino.db)).length, 1);
  } finally {
    locked.value = false;
  }
});

// ---- 3. garantias de projeto ----

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sourceFiles(p);
    else if (p.endsWith('.ts') || p.endsWith('.js')) yield p.replaceAll('\\', '/');
  }
}

test('HARD: todo comando SQL escrito no código é entendido pelo classificador (nenhum escapa por forma estranha)', async () => {
  const known = new Set(await userTables(unguarded((await setup()).db)));
  const appMetaWriters = new Set<string>();
  let analysed = 0;
  for (const file of sourceFiles('src')) {
    if (file.includes('/migrations/') || file.endsWith('node-sqlite.ts') || file.endsWith('browser-sqlite.ts') || file.endsWith('/backup/import.ts')) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\.(?:run|exec|all)\(\s*(`[^`]*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g)) {
      const literal = (m[1] as string).slice(1, -1);
      if (/^\$\{[A-Z_]+\}/.test(literal)) continue; // começa por uma constante de SELECT definida no próprio arquivo: é leitura
      const sql = literal.replace(/\$\{[^}]*\}/g, 'x');
      const c = classifySql(sql);
      analysed++;
      assert.ok(!c.writes.includes('?'), `${file}: comando de gravação não reconhecido: ${sql.slice(0, 80)}`);
      for (const t of c.writes) {
        if (t === 'app_meta') appMetaWriters.add(file);
        else assert.ok(known.has(t) || t === 'x', `${file}: grava em tabela desconhecida "${t}"`);
      }
    }
  }
  assert.ok(analysed > 100, `analisou só ${analysed} comandos`);
  assert.deepEqual([...appMetaWriters].sort(), ['src/domain/activities.ts', 'src/domain/defaults.ts', 'src/domain/guide.ts', 'src/domain/location.ts'], 'quem grava em app_meta mudou: confira se é seguro com a licença travada');
});

test('HARD: as telas só gravam direto no banco em app_meta (o nome da pessoa); o resto passa pelo domínio e pela trava', () => {
  for (const file of readdirSync('web').filter((n) => n.endsWith('.js'))) {
    const text = readFileSync(join('web', file), 'utf8');
    for (const m of text.matchAll(/\bdb\.(?:run|exec)\(\s*(`[^`]*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g)) {
      const c = classifySql((m[1] as string).slice(1, -1));
      assert.ok(c.writes.length > 0 && isWriteAllowedWhenLocked(c), `${file}: grava direto fora de app_meta: ${m[1]}`);
    }
    assert.doesNotMatch(text, /\bdb\.(?:run|exec)\(\s*[^'"`\s]/, `${file}: db.run ou db.exec com SQL que não é texto fixo`);
  }
});

test('HARD: nenhuma migração cria gatilho (um gatilho poderia gravar fora da lista permitida)', () => {
  for (const file of sourceFiles('src/migrations')) assert.doesNotMatch(readFileSync(file, 'utf8'), /create\s+trigger/i, file);
});
