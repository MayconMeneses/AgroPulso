import type { Database } from '../storage/database.ts';
import { recordEvent } from './audit.ts';
import { DomainError } from './errors.ts';
import { assertCycleWritable, assertDateText, findByKey } from './guards.ts';

export interface ActivityType {
  id: string;
  name: string;
  isApplication: boolean;
}

export interface Activity {
  id: string;
  cycleId: string;
  typeId: string;
  occurredOn: string;
  state: 'PLANEJADA' | 'REALIZADA';
  notes: string | null;
  author: string;
  version: number;
  notice: string | null;
}

// RN-AG-017: o sistema só guarda o que foi declarado; não prescreve nem substitui receituário.
export const APPLICATION_NOTICE =
  'Aplicação declarada por você. Este registro não substitui receituário nem os registros obrigatórios.';

// RN-AG-019: tipos de atividade (plantio, capina, irrigação anotada...) são do usuário; nenhum vem pronto.
export async function createActivityType(db: Database, input: { name: string; isApplication?: boolean }): Promise<ActivityType> {
  const name = input.name.trim();
  if (name === '') throw new DomainError('invalido', 'Informe o nome do tipo de atividade');
  const t: ActivityType = { id: crypto.randomUUID(), name, isApplication: input.isApplication === true };
  await db.transaction(async () => {
    const same = await db.all('select 1 as ok from activity_type where lower(name) = lower(?)', [name]);
    if (same.length > 0) throw new DomainError('duplicado', 'Já existe um tipo de atividade com esse nome');
    await db.run('insert into activity_type (id, name, is_application) values (?, ?, ?)', [t.id, name, t.isApplication ? 1 : 0]);
    await recordEvent(db, { type: 'activity_type.created', resource: 'activity_type', resourceId: t.id, after: { name } });
  });
  return t;
}

// Tipos comuns de lavoura, oferecidos uma única vez no primeiro uso para a lista não começar vazia. São só nomes: continuam
// sendo do usuário (RN-AG-019), que pode acrescentar os seus. Só "Aplicação de defensivo" leva o aviso de aplicação (RN-AG-017).
// Quem já tem um tipo com o mesmo nome não recebe repetido, e a marca no banco impede de oferecer de novo.
const COMMON_TYPES: [string, boolean][] = [
  ['Preparo do solo', false], ['Plantio', false], ['Adubação', false], ['Irrigação', false], ['Capina', false],
  ['Aplicação de defensivo', true], ['Poda', false], ['Colheita', false], ['Transporte', false], ['Observação de campo', false],
];
export async function addCommonActivityTypes(db: Database): Promise<number> {
  return db.transaction(async () => {
    if ((await db.all("select 1 as ok from app_meta where key = 'tipos_atividade_iniciais'")).length > 0) return 0;
    let added = 0;
    for (const [name, isApplication] of COMMON_TYPES) {
      if ((await db.all('select 1 as ok from activity_type where lower(name) = lower(?)', [name])).length > 0) continue;
      const id = crypto.randomUUID();
      await db.run('insert into activity_type (id, name, is_application) values (?, ?, ?)', [id, name, isApplication ? 1 : 0]);
      await recordEvent(db, { type: 'activity_type.created', resource: 'activity_type', resourceId: id, reason: 'tipo comum oferecido no primeiro uso', after: { name } });
      added++;
    }
    await db.run("insert into app_meta (key, value) values ('tipos_atividade_iniciais', ?)", [new Date().toISOString()]);
    return added;
  });
}

export async function listActivityTypes(db: Database): Promise<ActivityType[]> {
  const rows = await db.all('select id, name, is_application from activity_type order by name, id');
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), isApplication: Number(r.is_application) === 1 }));
}

const SELECT =
  'select a.id, a.cycle_id, a.type_id, a.occurred_on, a.state, a.notes, a.author, a.version, t.is_application from field_activity a join activity_type t on t.id = a.type_id';

function toActivity(r: Record<string, unknown>): Activity {
  return {
    id: String(r.id),
    cycleId: String(r.cycle_id),
    typeId: String(r.type_id),
    occurredOn: String(r.occurred_on),
    state: String(r.state) as Activity['state'],
    notes: r.notes === null ? null : String(r.notes),
    author: String(r.author),
    version: Number(r.version),
    notice: Number(r.is_application) === 1 ? APPLICATION_NOTICE : null,
  };
}

export async function getActivity(db: Database, id: string): Promise<Activity | null> {
  const r = (await db.all(`${SELECT} where a.id = ?`, [id]))[0];
  return r ? toActivity(r) : null;
}

export async function listActivities(db: Database, cycleId: string): Promise<Activity[]> {
  return (await db.all(`${SELECT} where a.cycle_id = ? order by a.occurred_on, a.id`, [cycleId])).map(toActivity);
}

// RF-AG-004 / RN-AG-001: registrar o realizado, ou planejar uma tarefa para fazer depois. Autor e data sempre gravados.
export async function recordActivity(
  db: Database,
  input: {
    cycleId: string;
    typeId: string;
    occurredOn: string;
    author: string;
    state?: 'PLANEJADA' | 'REALIZADA';
    notes?: string;
    idempotencyKey?: string;
    justification?: string;
  },
): Promise<Activity> {
  assertDateText(input.occurredOn, 'Data da atividade');
  const author = input.author.trim();
  if (author === '') throw new DomainError('invalido', 'Informe quem registrou');
  const id = crypto.randomUUID();
  return db.transaction(async () => {
    const dup = await findByKey(db, 'field_activity', input.idempotencyKey);
    if (dup) return (await getActivity(db, dup)) as Activity;
    await assertCycleWritable(db, input.cycleId, input.justification);
    if ((await db.all('select 1 as ok from activity_type where id = ?', [input.typeId])).length === 0) {
      throw new DomainError('invalido', 'Tipo de atividade inválido');
    }
    await db.run(
      'insert into field_activity (id, cycle_id, type_id, occurred_on, state, notes, author, version, idempotency_key, created_at) values (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
      [id, input.cycleId, input.typeId, input.occurredOn, input.state ?? 'REALIZADA', input.notes?.trim() || null, author, input.idempotencyKey ?? null, new Date().toISOString()],
    );
    await recordEvent(db, {
      type: 'activity.recorded',
      resource: 'field_activity',
      resourceId: id,
      reason: input.justification ?? null,
      after: { cycleId: input.cycleId, occurredOn: input.occurredOn, state: input.state ?? 'REALIZADA', author },
    });
    return (await getActivity(db, id)) as Activity;
  });
}

// Histórico de edição (RF-AG-010): cada mudança deixa evento com antes e depois.
export async function updateActivity(
  db: Database,
  id: string,
  version: number,
  change: { occurredOn?: string; notes?: string; state?: 'REALIZADA' },
  author: string,
): Promise<Activity> {
  if (change.occurredOn !== undefined) assertDateText(change.occurredOn, 'Data da atividade');
  if (author.trim() === '') throw new DomainError('invalido', 'Informe quem alterou');
  return db.transaction(async () => {
    const cur = await getActivity(db, id);
    if (!cur) throw new DomainError('nao_encontrado', 'Atividade não encontrada');
    if (cur.version !== version) throw new DomainError('conflito_de_versao', 'Esta atividade foi alterada por outra ação. Recarregue e tente de novo');
    if (change.state === 'REALIZADA' && cur.state === 'REALIZADA') throw new DomainError('transicao_invalida', 'A atividade já está realizada');
    const next = {
      occurredOn: change.occurredOn ?? cur.occurredOn,
      notes: change.notes === undefined ? cur.notes : change.notes.trim() || null,
      state: change.state ?? cur.state,
    };
    await db.run('update field_activity set occurred_on = ?, notes = ?, state = ?, version = version + 1 where id = ? and version = ?', [
      next.occurredOn,
      next.notes,
      next.state,
      id,
      version,
    ]);
    await recordEvent(db, {
      type: 'activity.updated',
      resource: 'field_activity',
      resourceId: id,
      before: { occurredOn: cur.occurredOn, notes: cur.notes, state: cur.state },
      after: { ...next, by: author.trim() },
    });
    return (await getActivity(db, id)) as Activity;
  });
}
