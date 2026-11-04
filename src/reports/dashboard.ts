import type { Database } from '../storage/database.ts';
import { cycleResult } from '../domain/results.ts';
import type { CycleResult } from '../domain/results.ts';

export interface DashboardCycle {
  cycleId: string;
  farmId: string;
  farmName: string;
  cropName: string;
  status: string;
  result: CycleResult;
}

export interface Dashboard {
  activeCycles: DashboardCycle[];
  pendingActivities: { id: string; cycleId: string; occurredOn: string; typeName: string }[];
  salesToReceiveCents: number;
  monthly: { month: string; expensesCents: number; salesCents: number }[]; // evolução por mês (AAAA-MM)
}

// RF-AG-011: safras ativas, pendências, custo registrado, vendas, colheita declarada e evolução por período.
// Só leitura: nada aqui grava no banco.
export async function dashboard(db: Database): Promise<Dashboard> {
  const cycles = await db.all(
    "select c.id, c.status, f.id as farm_id, f.name as farm, t.name as crop from crop_cycle c join farm f on f.id = c.farm_id join crop_type t on t.id = c.crop_type_id where c.status in ('PLANEJADA','EM_ANDAMENTO') order by f.name, c.created_at, c.id",
  );
  const activeCycles: DashboardCycle[] = [];
  for (const c of cycles) {
    activeCycles.push({ cycleId: String(c.id), farmId: String(c.farm_id), farmName: String(c.farm), cropName: String(c.crop), status: String(c.status), result: await cycleResult(db, String(c.id)) });
  }
  const pending = await db.all(
    "select a.id, a.cycle_id, a.occurred_on, t.name from field_activity a join activity_type t on t.id = a.type_id where a.state = 'PLANEJADA' order by a.occurred_on, a.id",
  );
  const toReceive = await db.all(
    'select coalesce((select sum(amount_cents) from sale), 0) - coalesce((select sum(amount_cents) from sale_receipt), 0) as v',
  );
  const exp = await db.all("select substr(occurred_on, 1, 7) as m, sum(amount_cents) as v from financial_entry where voided_at is null and kind = 'DESPESA' and family_labor = 0 group by m");
  const sal = await db.all('select substr(sold_on, 1, 7) as m, sum(amount_cents) as v from sale group by m');
  const months = new Map<string, { expensesCents: number; salesCents: number }>();
  for (const r of exp) months.set(String(r.m), { expensesCents: Number(r.v), salesCents: 0 });
  for (const r of sal) months.set(String(r.m), { expensesCents: months.get(String(r.m))?.expensesCents ?? 0, salesCents: Number(r.v) });
  return {
    activeCycles,
    pendingActivities: pending.map((p) => ({ id: String(p.id), cycleId: String(p.cycle_id), occurredOn: String(p.occurred_on), typeName: String(p.name) })),
    salesToReceiveCents: Math.max(Number(toReceive[0]?.v ?? 0), 0),
    monthly: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v })),
  };
}
