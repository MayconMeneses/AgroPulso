import type { Database } from '../storage/database.ts';
import { recordEvent } from './audit.ts';
import { DomainError } from './errors.ts';
import { assertNameLength } from './guards.ts';

export interface CropType {
  id: string;
  name: string;
}

// RN-AG-019 / RF-AG-013: cultura é dado do usuário. Nenhuma cultura vem pré-cadastrada.
export async function createCropType(db: Database, input: { name: string }): Promise<CropType> {
  const name = input.name.trim();
  assertNameLength(name);
  if (name === '') throw new DomainError('invalido', 'Informe o nome da cultura');
  const crop: CropType = { id: crypto.randomUUID(), name };
  await db.transaction(async () => {
    const same = await db.all('select 1 as ok from crop_type where lower(name) = lower(?)', [name]);
    if (same.length > 0) throw new DomainError('duplicado', 'Já existe uma cultura com esse nome');
    await db.run('insert into crop_type (id, name, created_at) values (?, ?, ?)', [crop.id, crop.name, new Date().toISOString()]);
    await recordEvent(db, { type: 'crop_type.created', resource: 'crop_type', resourceId: crop.id, after: { name } });
  });
  return crop;
}

export async function listCropTypes(db: Database): Promise<CropType[]> {
  const rows = await db.all('select id, name from crop_type order by name, id');
  return rows.map((r) => ({ id: String(r.id), name: String(r.name) }));
}
