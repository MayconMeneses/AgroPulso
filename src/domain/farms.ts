import type { Database } from '../storage/database.ts';
import { recordEvent } from './audit.ts';
import { DomainError } from './errors.ts';

export interface Farm {
  id: string;
  name: string;
  timezone: string;
  version: number;
}

// RN-AG-022: o fuso é guardado por propriedade e não tem valor padrão (o Nordeste tem mais de um).
export function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: timezone });
  } catch {
    throw new DomainError('invalido', 'Fuso horário inválido. Use um nome como "America/Recife"');
  }
}

// RF-AG-002: propriedade sem mapa e sem área.
export async function createFarm(db: Database, input: { name: string; timezone: string }): Promise<Farm> {
  const name = input.name.trim();
  if (name === '') throw new DomainError('invalido', 'Informe o nome da propriedade');
  assertTimezone(input.timezone);
  const farm: Farm = { id: crypto.randomUUID(), name, timezone: input.timezone, version: 1 };
  await db.transaction(async () => {
    await db.run('insert into farm (id, name, timezone, version, created_at) values (?, ?, ?, 1, ?)', [
      farm.id,
      farm.name,
      farm.timezone,
      new Date().toISOString(),
    ]);
    await recordEvent(db, { type: 'farm.created', resource: 'farm', resourceId: farm.id, after: { name, timezone: farm.timezone } });
  });
  return farm;
}

export async function getFarm(db: Database, id: string): Promise<Farm | null> {
  const rows = await db.all('select id, name, timezone, version from farm where id = ?', [id]);
  const r = rows[0];
  return r ? { id: String(r.id), name: String(r.name), timezone: String(r.timezone), version: Number(r.version) } : null;
}

export async function listFarms(db: Database): Promise<Farm[]> {
  const rows = await db.all('select id, name, timezone, version from farm order by name, id');
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), timezone: String(r.timezone), version: Number(r.version) }));
}
