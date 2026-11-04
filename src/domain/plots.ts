import type { Database } from '../storage/database.ts';
import { recordEvent } from './audit.ts';
import { DomainError } from './errors.ts';
import { assertNameLength } from './guards.ts';
import { assertOutline } from './geo.ts';
import type { FarmLocation } from './location.ts';
import { getUnit } from './units.ts';

export interface Plot {
  id: string;
  farmId: string;
  name: string;
  areaDeclaredMicro: number | null;
  areaMeasuredMicro: number | null;
  areaUnitId: string | null;
  outline: FarmLocation[] | null; // contorno desenhado no mapa (opcional; não muda a área declarada nem a medida)
}

// Um contorno ilegível (arquivo de backup antigo ou mexido) vale como "sem contorno": não pode derrubar a tela inteira.
function readOutline(raw: unknown): FarmLocation[] | null {
  if (raw === null || raw === undefined) return null;
  try {
    const pts = JSON.parse(String(raw)) as FarmLocation[];
    assertOutline(pts);
    return pts;
  } catch {
    return null;
  }
}

function toPlot(r: Record<string, unknown>): Plot {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: String(r.id),
    farmId: String(r.farm_id),
    name: String(r.name),
    areaDeclaredMicro: n(r.area_declared_micro),
    areaMeasuredMicro: n(r.area_measured_micro),
    areaUnitId: r.area_unit_id === null ? null : String(r.area_unit_id),
    outline: readOutline(r.outline_json),
  };
}

// RN-AG-015: área declarada e área medida são guardadas separadas; uma não substitui a outra.
// A área é opcional (J2): talhão sem área vale, e o resultado deixa de calcular produtividade (RN-AG-010).
export async function createPlot(
  db: Database,
  input: { farmId: string; name: string; areaDeclaredMicro?: number; areaMeasuredMicro?: number; areaUnitId?: string },
): Promise<Plot> {
  const name = input.name.trim();
  assertNameLength(name);
  if (name === '') throw new DomainError('invalido', 'Informe o nome do talhão');
  const hasArea = input.areaDeclaredMicro !== undefined || input.areaMeasuredMicro !== undefined;
  if (hasArea && !input.areaUnitId) throw new DomainError('invalido', 'Informe a unidade da área');
  for (const v of [input.areaDeclaredMicro, input.areaMeasuredMicro]) {
    if (v !== undefined && (!Number.isSafeInteger(v) || v <= 0)) throw new DomainError('invalido', 'Área deve ser maior que zero');
  }
  const id = crypto.randomUUID();
  await db.transaction(async () => {
    if ((await db.all('select 1 as ok from farm where id = ?', [input.farmId])).length === 0) {
      throw new DomainError('invalido', 'Propriedade inválida');
    }
    if (input.areaUnitId) {
      const u = await getUnit(db, input.areaUnitId);
      if (!u || u.kind !== 'area') throw new DomainError('invalido', 'A unidade da área deve ser do tipo área');
    }
    await db.run(
      'insert into plot (id, farm_id, name, area_declared_micro, area_measured_micro, area_unit_id, created_at) values (?, ?, ?, ?, ?, ?, ?)',
      [id, input.farmId, name, input.areaDeclaredMicro ?? null, input.areaMeasuredMicro ?? null, input.areaUnitId ?? null, new Date().toISOString()],
    );
    await recordEvent(db, { type: 'plot.created', resource: 'plot', resourceId: id, after: { name, farmId: input.farmId } });
  });
  return (await getPlot(db, id)) as Plot;
}

export async function getPlot(db: Database, id: string): Promise<Plot | null> {
  const r = (await db.all('select * from plot where id = ?', [id]))[0];
  return r ? toPlot(r) : null;
}

export async function listPlots(db: Database, farmId: string): Promise<Plot[]> {
  return (await db.all('select * from plot where farm_id = ? order by name, id', [farmId])).map(toPlot);
}

// J2: a safra nasce na propriedade e recebe o talhão depois, sem perder nenhum registro.
// Invariante 1: o talhão precisa ser da mesma propriedade da safra.
export async function assignPlot(db: Database, cycleId: string, version: number, plotId: string): Promise<void> {
  await db.transaction(async () => {
    const c = (await db.all('select farm_id, version, plot_id from crop_cycle where id = ?', [cycleId]))[0];
    if (!c) throw new DomainError('nao_encontrado', 'Safra não encontrada');
    if (Number(c.version) !== version) throw new DomainError('conflito_de_versao', 'Esta safra foi alterada por outra ação. Recarregue e tente de novo');
    const p = await getPlot(db, plotId);
    if (!p || p.farmId !== String(c.farm_id)) throw new DomainError('invalido', 'O talhão precisa ser da mesma propriedade da safra');
    await db.run('update crop_cycle set plot_id = ?, version = version + 1 where id = ? and version = ?', [plotId, cycleId, version]);
    await recordEvent(db, {
      type: 'crop_cycle.plot_assigned',
      resource: 'crop_cycle',
      resourceId: cycleId,
      before: { plotId: c.plot_id ?? null },
      after: { plotId },
    });
  });
}

// O desenho do talhão no mapa é opcional e guardado à parte. A área do desenho é só uma estimativa mostrada na tela:
// ela não substitui a área declarada nem a medida (RN-AG-015).
export async function setPlotOutline(db: Database, plotId: string, points: FarmLocation[] | null): Promise<void> {
  if (points) assertOutline(points);
  await db.transaction(async () => {
    const p = await getPlot(db, plotId);
    if (!p) throw new DomainError('nao_encontrado', 'Talhão não encontrado');
    const clean = points?.map((q) => ({ latMicro: q.latMicro, lonMicro: q.lonMicro })) ?? null;
    await db.run('update plot set outline_json = ? where id = ?', [clean ? JSON.stringify(clean) : null, plotId]);
    await recordEvent(db, { type: 'plot.outline_set', resource: 'plot', resourceId: plotId, before: { points: p.outline?.length ?? 0 }, after: { points: clean?.length ?? 0 } });
  });
}
