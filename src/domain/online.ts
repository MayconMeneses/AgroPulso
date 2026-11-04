import { DomainError } from './errors.ts';
import { gridFor, toPct } from './geo.ts';
import type { FarmLocation } from './location.ts';

// Recursos que só existem com internet: previsão do tempo (Open-Meteo) e mapa (OpenStreetMap).
// Nada aqui roda sozinho: a tela só chama quando a pessoa toca no botão. O que vem de fora é conferido antes de usar.
export const WEATHER_HOST = 'https://api.open-meteo.com';
export const TILE_HOST = 'https://tile.openstreetmap.org';

export interface ForecastDay {
  date: string;
  maxC: number;
  minC: number;
  rainMm: number;
  rainChance: number | null;
}

const deg = (micro: number): string => (micro / 1_000_000).toFixed(2); // 2 casas (~1 km): basta para a previsão e entrega menos do local exato

export function weatherUrl(loc: FarmLocation, timezone: string): string {
  const q = new URLSearchParams({
    latitude: deg(loc.latMicro),
    longitude: deg(loc.lonMicro),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max',
    timezone,
    forecast_days: '5',
  });
  return `${WEATHER_HOST}/v1/forecast?${q.toString()}`;
}

function nums(v: unknown, n: number, nullable = false): (number | null)[] {
  if (!Array.isArray(v) || v.length !== n) throw new DomainError('invalido', 'Resposta da previsão fora do formato esperado');
  return v.map((x) => {
    if (x === null && nullable) return null;
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new DomainError('invalido', 'Resposta da previsão fora do formato esperado');
    return x;
  });
}

export function parseForecast(json: unknown): ForecastDay[] {
  const d = (json as { daily?: Record<string, unknown> } | null)?.daily;
  if (!d || !Array.isArray(d.time) || d.time.length === 0 || d.time.length > 16) throw new DomainError('invalido', 'Resposta da previsão fora do formato esperado');
  const n = d.time.length;
  const dates = d.time.map((t) => {
    if (typeof t !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new DomainError('invalido', 'Resposta da previsão fora do formato esperado');
    return t;
  });
  const max = nums(d.temperature_2m_max, n);
  const min = nums(d.temperature_2m_min, n);
  const rain = nums(d.precipitation_sum, n);
  const chance = nums(d.precipitation_probability_max, n, true);
  return dates.map((date, i) => ({ date, maxC: max[i] as number, minC: min[i] as number, rainMm: rain[i] as number, rainChance: chance[i] }));
}

// Mapa sem biblioteca: 3 x 3 quadros do OpenStreetMap em volta do ponto, mais a posição do marcador (em % da grade).
export function mapTiles(loc: FarmLocation, zoom = 15): { tiles: { url: string; col: number; row: number }[]; markerX: number; markerY: number } {
  const g = gridFor(loc, zoom);
  const n = 2 ** zoom;
  const tiles: { url: string; col: number; row: number }[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const tx = (((g.cx + col - 1) % n) + n) % n;
      const ty = g.cy + row - 1;
      if (ty < 0 || ty >= n) continue;
      tiles.push({ url: `${TILE_HOST}/${zoom}/${tx}/${ty}.png`, col, row });
    }
  }
  const m = toPct(g, loc);
  return { tiles, markerX: m.x, markerY: m.y };
}
