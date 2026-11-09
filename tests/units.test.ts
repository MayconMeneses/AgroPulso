import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportBackup } from '../src/backup/export.ts';
import { importBackup } from '../src/backup/import.ts';
import { createCropType } from '../src/domain/crop-types.ts';
import { cancelCycle, closeCycle, getCycle, openCycle, planCycle, startCycle } from '../src/domain/cycles.ts';
import { formatMoney, formatQuantity, parseMoney, parseQuantity } from '../src/domain/decimal.ts';
import { DomainError } from '../src/domain/errors.ts';
import { createFarm } from '../src/domain/farms.ts';
import { assignPlot, createPlot } from '../src/domain/plots.ts';
import { convert, createUnit, listUnits, setConversion } from '../src/domain/units.ts';
import { freshDb } from './helpers.ts';

async function rejectsWith(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof DomainError && e.code === code);
}

test('números: só vírgula decimal, sem corrigir em silêncio', () => {
  assert.equal(parseMoney('1234,56', 'x'), 123456);
  assert.equal(parseMoney('10', 'x'), 1000);
  assert.equal(parseQuantity('12,5', 'x'), 12_500_000);
  for (const ruim of ['1.234,56', '12.5', '10,567', '-3', '', 'abc', '1,2,3']) {
    assert.throws(() => parseMoney(ruim, 'Valor'), DomainError, ruim);
  }
  assert.throws(() => parseQuantity('0,1234567', 'q'), DomainError);
  assert.equal(formatMoney(123456), 'R$ 1.234,56');
  assert.equal(formatMoney(5), 'R$ 0,05');
  assert.equal(formatMoney(-5), 'R$ -0,05');
  assert.equal(formatMoney(-50), 'R$ -0,50');
  assert.equal(formatMoney(-99), 'R$ -0,99');
  assert.equal(formatMoney(-500_000), 'R$ -5.000,00');
  assert.equal(formatMoney(-1_500_000), 'R$ -15.000,00');
  assert.equal(formatQuantity(12_500_000), '12,5');
  assert.equal(formatQuantity(1_000_000_000), '1.000');
  assert.equal(formatQuantity(-5), '-0,000005');
  assert.equal(formatQuantity(-50), '-0,00005');
  assert.equal(formatQuantity(-99), '-0,000099');
  assert.equal(formatQuantity(-500_000), '-0,5');
  assert.equal(formatQuantity(-1_500_000), '-1,5');
});

test('nenhuma unidade vem pronta; "saca" e "caixa" não têm conversão global', async () => {
  const db = await freshDb();
  assert.deepEqual(await listUnits(db), []);
  const kg = await createUnit(db, { name: 'kg', kind: 'massa' });
  const saca = await createUnit(db, { name: 'saca', kind: 'massa' });
  await rejectsWith(createUnit(db, { name: 'KG', kind: 'massa' }), 'duplicado');
  assert.equal(await convert(db, 2_000_000, saca.id, kg.id), null);
});

test('conversão exige fator com origem, por cultura, e não mistura tipos', async () => {
  const db = await freshDb();
  const kg = await createUnit(db, { name: 'kg', kind: 'massa' });
  const saca = await createUnit(db, { name: 'saca', kind: 'massa' });
  const ha = await createUnit(db, { name: 'ha', kind: 'area' });
  const milho = await createCropType(db, { name: 'Milho' });
  const feijao = await createCropType(db, { name: 'Feijão' });
  await rejectsWith(setConversion(db, { fromUnitId: saca.id, toUnitId: kg.id, factorMicro: 60_000_000, source: ' ' }), 'invalido');
  await rejectsWith(setConversion(db, { fromUnitId: saca.id, toUnitId: ha.id, factorMicro: 1_000_000, source: 'x' }), 'invalido');
  await rejectsWith(setConversion(db, { fromUnitId: saca.id, toUnitId: kg.id, factorMicro: 0, source: 'x' }), 'invalido');
  await setConversion(db, { fromUnitId: saca.id, toUnitId: kg.id, factorMicro: 60_000_000, source: 'fator de teste', cropTypeId: milho.id });

  const ok = await convert(db, 2_500_000, saca.id, kg.id, milho.id);
  assert.deepEqual(ok, { micro: 150_000_000, exact: true });
  assert.equal(await convert(db, 2_500_000, saca.id, kg.id, feijao.id), null);
  // sentido inverso usa o mesmo fator; o que não divide exato é marcado como arredondado
  const volta = await convert(db, 100_000_000, kg.id, saca.id, milho.id);
  assert.equal(volta?.exact, false);
  assert.equal(volta?.micro, 1_666_667);
  assert.deepEqual(await convert(db, 7, kg.id, kg.id), { micro: 7, exact: true });
});

test('talhão sem área vale; áreas declarada e medida ficam separadas', async () => {
  const db = await freshDb();
  const farm = await createFarm(db, { name: 'Sítio', timezone: 'America/Recife' });
  const ha = await createUnit(db, { name: 'ha', kind: 'area' });
  const kg = await createUnit(db, { name: 'kg', kind: 'massa' });
  const semArea = await createPlot(db, { farmId: farm.id, name: 'Baixio' });
  assert.equal(semArea.areaDeclaredMicro, null);
  const comArea = await createPlot(db, { farmId: farm.id, name: 'Serra', areaDeclaredMicro: 2_000_000, areaMeasuredMicro: 1_800_000, areaUnitId: ha.id });
  assert.equal(comArea.areaDeclaredMicro, 2_000_000);
  assert.equal(comArea.areaMeasuredMicro, 1_800_000);
  await rejectsWith(createPlot(db, { farmId: farm.id, name: 'X', areaDeclaredMicro: 1_000_000 }), 'invalido');
  await rejectsWith(createPlot(db, { farmId: farm.id, name: 'X', areaDeclaredMicro: 1_000_000, areaUnitId: kg.id }), 'invalido');
  await rejectsWith(createPlot(db, { farmId: farm.id, name: 'X', areaDeclaredMicro: 0, areaUnitId: ha.id }), 'invalido');
  await rejectsWith(createPlot(db, { farmId: 'nada', name: 'X' }), 'invalido');
});

test('safra recebe o talhão depois, só da mesma propriedade, sem perder registros', async () => {
  const db = await freshDb();
  const a = await createFarm(db, { name: 'A', timezone: 'America/Recife' });
  const b = await createFarm(db, { name: 'B', timezone: 'America/Recife' });
  const crop = await createCropType(db, { name: 'Milho' });
  const c = await openCycle(db, { farmId: a.id, cropTypeId: crop.id });
  const pa = await createPlot(db, { farmId: a.id, name: 'P-A' });
  const pb = await createPlot(db, { farmId: b.id, name: 'P-B' });
  await rejectsWith(assignPlot(db, c.id, c.version, pb.id), 'invalido');
  await assignPlot(db, c.id, c.version, pa.id);
  const depois = await getCycle(db, c.id);
  assert.equal(depois?.plotId, pa.id);
  assert.equal(depois?.version, c.version + 1);
  await rejectsWith(assignPlot(db, c.id, c.version, pa.id), 'conflito_de_versao');
});

test('safra encerrada não recebe talhão, concluída ou cancelada', async () => {
  for (const encerrada of ['CONCLUIDA', 'CANCELADA'] as const) {
    const db = await freshDb();
    const farm = await createFarm(db, { name: 'Sítio', timezone: 'America/Recife' });
    const crop = await createCropType(db, { name: 'Milho' });
    let c = await openCycle(db, { farmId: farm.id, cropTypeId: crop.id });
    const p = await createPlot(db, { farmId: farm.id, name: 'Talhão' });
    if (encerrada === 'CONCLUIDA') {
      c = await planCycle(db, c.id, c.version, { plannedStart: '2026-12-01', plannedEnd: '2027-03-01' });
      c = await startCycle(db, c.id, c.version, { actualStart: '2026-12-05' });
      c = await closeCycle(db, c.id, c.version, { reason: 'fim' });
    } else {
      c = await cancelCycle(db, c.id, c.version, { reason: 'seca' });
    }
    await rejectsWith(assignPlot(db, c.id, c.version, p.id), 'transicao_invalida');
    assert.equal((await getCycle(db, c.id))?.plotId, null, encerrada);
  }
});

test('backup preserva unidades, fatores e talhões', async () => {
  const db = await freshDb();
  const farm = await createFarm(db, { name: 'S', timezone: 'America/Recife' });
  const ha = await createUnit(db, { name: 'ha', kind: 'area' });
  const tarefa = await createUnit(db, { name: 'tarefa', kind: 'area' });
  await setConversion(db, { fromUnitId: tarefa.id, toUnitId: ha.id, factorMicro: 300_000, source: 'valor de teste' });
  await createPlot(db, { farmId: farm.id, name: 'P', areaDeclaredMicro: 3_000_000, areaUnitId: tarefa.id });
  const arquivo = await exportBackup(db);
  const destino = await freshDb();
  await importBackup(destino, arquivo);
  assert.equal(await exportBackup(destino), arquivo);
  assert.deepEqual(await convert(destino, 3_000_000, tarefa.id, ha.id), { micro: 900_000, exact: true });
});
