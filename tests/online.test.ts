import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportBackup } from '../src/backup/export.ts';
import { importBackup } from '../src/backup/import.ts';
import { eventsFor } from '../src/domain/audit.ts';
import { DomainError } from '../src/domain/errors.ts';
import { createFarm } from '../src/domain/farms.ts';
import { formatCoordinate, getFarmLocation, parseCoordinate, setFarmLocation } from '../src/domain/location.ts';
import { mapTiles, parseForecast, weatherUrl } from '../src/domain/online.ts';
import { freshDb } from './helpers.ts';

async function rejectsWith(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof DomainError && e.code === code);
}

test('coordenada: só vírgula, até 6 casas, dentro dos limites', () => {
  assert.equal(parseCoordinate('-8,047562', 'lat'), -8_047_562);
  assert.equal(parseCoordinate('-34,9', 'lon'), -34_900_000);
  assert.equal(parseCoordinate('90', 'lat'), 90_000_000);
  assert.equal(parseCoordinate('0', 'lon'), 0);
  for (const bad of ['-8.047562', '', 'abc', '91', '-90,000001', '1,1234567', '--1']) assert.throws(() => parseCoordinate(bad, 'lat'), DomainError, bad);
  assert.throws(() => parseCoordinate('181', 'lon'), DomainError);
  assert.equal(formatCoordinate(-8_047_562), '-8,047562');
  assert.equal(formatCoordinate(5_000_000), '5,000000');
});

test('o local da propriedade é opcional, validado, auditado e vai no backup', async () => {
  const db = await freshDb();
  const farm = await createFarm(db, { name: 'Sítio', timezone: 'America/Recife' });
  assert.equal(await getFarmLocation(db, farm.id), null);
  await setFarmLocation(db, farm.id, { latMicro: -8_047_562, lonMicro: -34_877_000 });
  assert.deepEqual(await getFarmLocation(db, farm.id), { latMicro: -8_047_562, lonMicro: -34_877_000 });
  await rejectsWith(setFarmLocation(db, farm.id, { latMicro: 91_000_000, lonMicro: 0 }), 'invalido');
  await rejectsWith(setFarmLocation(db, 'nao-existe', { latMicro: 0, lonMicro: 0 }), 'invalido');
  assert.deepEqual(await getFarmLocation(db, farm.id), { latMicro: -8_047_562, lonMicro: -34_877_000 });
  const ev = (await eventsFor(db, 'farm', farm.id)).filter((e) => e.type === 'farm.location_set');
  assert.equal(ev.length, 1);
  const other = await freshDb();
  await importBackup(other, await exportBackup(db));
  assert.deepEqual(await getFarmLocation(other, farm.id), { latMicro: -8_047_562, lonMicro: -34_877_000 });
  await setFarmLocation(db, farm.id, null);
  assert.equal(await getFarmLocation(db, farm.id), null);
});

test('a URL da previsão leva só o local arredondado e o fuso da propriedade', () => {
  const u = new URL(weatherUrl({ latMicro: -8_047_562, lonMicro: -34_877_123 }, 'America/Recife'));
  assert.equal(u.origin, 'https://api.open-meteo.com');
  assert.equal(u.searchParams.get('latitude'), '-8.0476');
  assert.equal(u.searchParams.get('longitude'), '-34.8771');
  assert.equal(u.searchParams.get('timezone'), 'America/Recife');
});

test('previsão: lê a resposta certa e recusa resposta torta ou hostil', () => {
  const ok = { daily: { time: ['2026-12-01', '2026-12-02'], temperature_2m_max: [31.2, 30], temperature_2m_min: [23, 22.5], precipitation_sum: [0, 4.2], precipitation_probability_max: [10, null] } };
  const days = parseForecast(ok);
  assert.equal(days.length, 2);
  assert.deepEqual(days[1], { date: '2026-12-02', maxC: 30, minC: 22.5, rainMm: 4.2, rainChance: null });
  const bads: unknown[] = [null, {}, { daily: {} }, { daily: { ...ok.daily, time: [] } }, { daily: { ...ok.daily, time: ['<img onerror=x>', '2026-12-02'] } },
    { daily: { ...ok.daily, temperature_2m_max: [31, 'quente'] } }, { daily: { ...ok.daily, precipitation_sum: [0] } }, { daily: { ...ok.daily, temperature_2m_min: [null, 1] } }];
  for (const b of bads) assert.throws(() => parseForecast(b), DomainError);
});

test('mapa: 9 quadros em volta do ponto, marcador dentro do quadro central', () => {
  const zero = mapTiles({ latMicro: 0, lonMicro: 0 }, 15);
  assert.equal(zero.tiles.length, 9);
  assert.ok(zero.tiles.some((t) => t.url === 'https://tile.openstreetmap.org/15/16384/16384.png' && t.col === 1 && t.row === 1));
  const recife = mapTiles({ latMicro: -8_047_562, lonMicro: -34_877_000 }, 15);
  assert.ok(recife.markerX >= 100 / 3 && recife.markerX <= 200 / 3 && recife.markerY >= 100 / 3 && recife.markerY <= 200 / 3);
  const pole = mapTiles({ latMicro: 85_000_000, lonMicro: 179_999_999 }, 3);
  assert.ok(pole.tiles.every((t) => /^https:\/\/tile\.openstreetmap\.org\/3\/\d+\/\d+\.png$/.test(t.url)));
  assert.ok(pole.tiles.some((t) => t.url.includes('/3/0/')), 'dá a volta no meridiano 180');
});
