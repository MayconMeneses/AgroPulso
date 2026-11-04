import type { Database } from '../storage/database.ts';

// Ajuda para quem abre o app pela primeira vez, lembrete de cópia de segurança e avisos do dia a dia.
// Tudo aqui só LÊ o banco (menos marcar a data da última cópia). Os textos são escritos para quem não é de tecnologia.

export interface GuideStep {
  id: 'propriedade' | 'cultura' | 'safra' | 'registro';
  done: boolean;
  title: string;
  help: string;
}

async function count(db: Database, sql: string): Promise<number> {
  return Number((await db.all(sql))[0]?.n ?? 0);
}

// Os quatro primeiros passos, na ordem em que fazem sentido. "Registro" vale qualquer anotação de verdade (despesa, atividade,
// colheita, venda ou dia de trabalho); o que foi anulado não conta.
export async function guideSteps(db: Database): Promise<GuideStep[]> {
  const farms = await count(db, 'select count(*) as n from farm');
  const crops = await count(db, 'select count(*) as n from crop_type');
  const cycles = await count(db, 'select count(*) as n from crop_cycle');
  const records =
    (await count(db, 'select count(*) as n from financial_entry where voided_at is null')) +
    (await count(db, 'select count(*) as n from field_activity')) +
    (await count(db, 'select count(*) as n from harvest_entry')) +
    (await count(db, 'select count(*) as n from sale')) +
    (await count(db, 'select count(*) as n from work_entry where voided_at is null'));
  return [
    { id: 'propriedade', done: farms > 0, title: 'Cadastre sua propriedade', help: 'O nome do sítio, da fazenda ou da roça, e a cidade (para a hora certa).' },
    { id: 'cultura', done: crops > 0, title: 'Diga o que você planta', help: 'Por exemplo: milho, feijão, mandioca. Pode cadastrar mais depois.' },
    { id: 'safra', done: cycles > 0, title: 'Abra a primeira safra', help: 'A safra é o período de uma plantação, do preparo até a venda. Tudo que você anotar fica ligado a ela.' },
    { id: 'registro', done: records > 0, title: 'Anote a primeira despesa ou atividade', help: 'Pode ser uma compra de adubo, um dia de capina, uma venda. É na aba "Registrar".' },
  ];
}

export function guideComplete(steps: GuideStep[]): boolean {
  return steps.every((s) => s.done);
}

const LAST_BACKUP_KEY = 'ultima_copia';
const BACKUP_EVERY_DAYS = 30;

export async function markBackupDone(db: Database, now: Date = new Date()): Promise<void> {
  await db.run('insert into app_meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value', [LAST_BACKUP_KEY, now.toISOString()]);
}

export interface BackupStatus {
  lastAt: string | null;
  daysSince: number | null;
  due: boolean; // hora de lembrar
  hasData: boolean;
}

// Só lembra quem já anotou alguma coisa: quem acabou de instalar não tem o que perder.
export async function backupStatus(db: Database, now: Date = new Date()): Promise<BackupStatus> {
  const steps = await guideSteps(db);
  const hasData = steps.find((s) => s.id === 'registro')?.done === true;
  const r = (await db.all('select value from app_meta where key = ?', [LAST_BACKUP_KEY]))[0];
  const lastAt = r ? String(r.value) : null;
  const t = lastAt ? Date.parse(lastAt) : NaN;
  const daysSince = Number.isNaN(t) ? null : Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
  return { lastAt: Number.isNaN(t) ? null : lastAt, daysSince, hasData, due: hasData && (daysSince === null || daysSince >= BACKUP_EVERY_DAYS) };
}

export type AlertGo = 'safras' | 'registrar' | 'estoque' | 'relatorio';
export interface Alert {
  kind: 'tarefa' | 'receber' | 'estoque';
  text: string;
  go: AlertGo;
}

const addDays = (iso: string, days: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// Avisos que pedem uma ação: tarefa que passou da data, venda sem receber há mais de 30 dias e item de estoque no fim.
// "today" vem de quem chama (AAAA-MM-DD no relógio do aparelho), para o resultado não depender do relógio nos testes.
export async function dailyAlerts(db: Database, today: string): Promise<Alert[]> {
  const out: Alert[] = [];
  for (const t of await db.all(
    `select a.occurred_on as d, y.name as tipo from field_activity a join activity_type y on y.id = a.type_id join crop_cycle c on c.id = a.cycle_id
     where a.state = 'PLANEJADA' and a.occurred_on < ? and c.status not in ('CONCLUIDA','CANCELADA') order by a.occurred_on limit 5`,
    [today],
  )) {
    out.push({ kind: 'tarefa', text: `Tarefa atrasada: ${String(t.tipo)}, marcada para ${String(t.d)}. Já foi feita? Marque como feita ou mude a data.`, go: 'safras' });
  }
  const cutoff = addDays(today, -30);
  const late = await db.all(
    `select count(*) as n from sale s where s.sold_on <= ? and s.amount_cents > coalesce((select sum(r.amount_cents) from sale_receipt r where r.sale_id = s.id), 0)`,
    [cutoff],
  );
  const nLate = Number(late[0]?.n ?? 0);
  if (nLate > 0) out.push({ kind: 'receber', text: nLate === 1 ? 'Uma venda feita há mais de 30 dias ainda não foi recebida por inteiro. Já caiu o dinheiro? Anote o recebimento.' : `${nLate} vendas feitas há mais de 30 dias ainda não foram recebidas por inteiro. Já caiu o dinheiro? Anote os recebimentos.`, go: 'registrar' });
  for (const i of await db.all(
    `select i.name, i.min_micro, coalesce((select sum(m.delta_micro) from stock_movement m where m.item_id = i.id), 0) as saldo
     from stock_item i where i.min_micro is not null order by i.name`,
  )) {
    if (Number(i.saldo) <= Number(i.min_micro)) out.push({ kind: 'estoque', text: Number(i.saldo) === 0 ? `Acabou: ${String(i.name)}. Hora de comprar mais.` : `Está acabando: ${String(i.name)}. Veja o estoque.`, go: 'estoque' });
  }
  return out.slice(0, 6);
}
