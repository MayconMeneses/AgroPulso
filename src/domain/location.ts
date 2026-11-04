import type { Database } from '../storage/database.ts';
import { recordEvent } from './audit.ts';
import { DomainError } from './errors.ts';

export interface FarmLocation {
  latMicro: number;
  lonMicro: number;
}

// Coordenadas em micrograus (inteiro), como o resto do app guarda quantidades. Só vírgula como separador (RN-AG-013).
// O local é opcional e fica só no aparelho; ele só sai daqui se a pessoa pedir a previsão ou o mapa.
export function parseCoordinate(text: string, axis: 'lat' | 'lon'): number {
  const t = text.trim();
  const m = /^(-?)(\d{1,3})(?:,(\d{1,6}))?$/.exec(t);
  const label = axis === 'lat' ? 'Latitude' : 'Longitude';
  if (!m) throw new DomainError('invalido', `${label}: use números com vírgula, como -8,047562`);
  const micro = Number(m[2]) * 1_000_000 + Number((m[3] ?? '').padEnd(6, '0'));
  const limit = (axis === 'lat' ? 90 : 180) * 1_000_000;
  if (micro > limit) throw new DomainError('invalido', `${label} fora do limite (até ${axis === 'lat' ? 90 : 180} graus)`);
  return m[1] === '-' ? -micro : micro;
}

export function formatCoordinate(micro: number): string {
  const sign = micro < 0 ? '-' : '';
  const abs = Math.abs(micro);
  return `${sign}${Math.floor(abs / 1_000_000)},${String(abs % 1_000_000).padStart(6, '0')}`;
}

export async function setFarmLocation(db: Database, farmId: string, loc: FarmLocation | null): Promise<void> {
  if (loc && (!Number.isSafeInteger(loc.latMicro) || !Number.isSafeInteger(loc.lonMicro) || Math.abs(loc.latMicro) > 90_000_000 || Math.abs(loc.lonMicro) > 180_000_000)) {
    throw new DomainError('invalido', 'Coordenadas fora do limite');
  }
  await db.transaction(async () => {
    const before = await getFarmLocation(db, farmId);
    if ((await db.all('select 1 as ok from farm where id = ?', [farmId])).length === 0) throw new DomainError('invalido', 'Propriedade inválida');
    await db.run('update farm set lat_micro = ?, lon_micro = ?, version = version + 1 where id = ?', [loc?.latMicro ?? null, loc?.lonMicro ?? null, farmId]);
    await recordEvent(db, { type: 'farm.location_set', resource: 'farm', resourceId: farmId, before, after: loc });
  });
}

// Chave geral para os recursos que usam a internet (previsão e mapa). Desligada, o app não faz nenhum pedido a serviço de
// fora e não pede a localização do aparelho. Ligada é o padrão, como o dono escolheu; a escolha fica só neste aparelho.
const ONLINE_KEY = 'recursos_online';

export async function onlineFeaturesEnabled(db: Database): Promise<boolean> {
  const r = (await db.all('select value from app_meta where key = ?', [ONLINE_KEY]))[0];
  return r?.value !== 'desligado';
}

export async function setOnlineFeatures(db: Database, on: boolean): Promise<void> {
  await db.transaction(async () => {
    await db.run('insert into app_meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value', [ONLINE_KEY, on ? 'ligado' : 'desligado']);
    await recordEvent(db, { type: 'online_features.set', resource: 'app_meta', resourceId: ONLINE_KEY, after: { on } });
  });
}

export async function getFarmLocation(db: Database, farmId: string): Promise<FarmLocation | null> {
  const r = (await db.all('select lat_micro, lon_micro from farm where id = ?', [farmId]))[0];
  if (!r || r.lat_micro === null || r.lon_micro === null) return null;
  return { latMicro: Number(r.lat_micro), lonMicro: Number(r.lon_micro) };
}
