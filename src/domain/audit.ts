import type { Database } from '../storage/database.ts';

export interface AuditEvent {
  type: string;
  resource: string;
  resourceId: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
}

// Só acrescenta. Deve ser chamado dentro da transação da operação que gerou o evento,
// para o evento e a mudança nascerem juntos ou nenhum dos dois existir.
export async function recordEvent(db: Database, e: AuditEvent): Promise<void> {
  await db.run(
    'insert into audit_event (type, resource, resource_id, occurred_at, reason, before_json, after_json) values (?, ?, ?, ?, ?, ?, ?)',
    [
      e.type,
      e.resource,
      e.resourceId,
      new Date().toISOString(),
      e.reason ?? null,
      e.before === undefined ? null : JSON.stringify(e.before),
      e.after === undefined ? null : JSON.stringify(e.after),
    ],
  );
}

export async function eventsFor(db: Database, resource: string, resourceId: string) {
  return db.all('select seq, type, reason, before_json, after_json from audit_event where resource = ? and resource_id = ? order by seq', [
    resource,
    resourceId,
  ]);
}
