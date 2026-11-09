import type { Database } from '../storage/database.ts';
import { formatQuantity, MICRO } from './decimal.ts';
import { DomainError } from './errors.ts';

export interface UnitTotal {
  unitId: string;
  unitName: string;
  quantityMicro: number;
}

export interface Productivity {
  harvestUnitName: string;
  areaUnitName: string;
  valueMicro: number;
  exact: boolean;
}

export interface CycleResult {
  cycleId: string;
  semDados: boolean;
  custoRegistradoCents: number;
  maoDeObraFamiliarCents: number; // linha separada, fora do custo registrado (RN-AG-020)
  custoPagoCents: number;
  custoAPagarCents: number;
  entradasDeCaixaCents: number;
  receitaVendasCents: number; // soma das vendas registradas (RN-AG-008)
  recebidoCents: number;
  aReceberCents: number;
  colhido: UnitTotal[]; // nunca soma unidades diferentes (RN-AG-011)
  vendido: UnitTotal[];
  produtividade: Productivity[] | null;
  semProdutividadeMotivo: string | null;
  areaDeclaradaMicro: number | null;
  areaMedidaMicro: number | null;
  resultadoParcialCents: number | null; // receita de vendas menos custo registrado; "parcial" sempre
  custosNaoAlocadosDaPropriedadeCents: number; // fora desta safra, não entram na conta
  estimativaColheita: UnitTotal | null; // estimativa declarada pelo usuário (não é dado medido)
  avisos: string[];
  excluidos: string[];
}

async function sumCents(db: Database, sql: string, params: unknown[]): Promise<number> {
  const r = (await db.all(sql, params as never[]))[0];
  return Number(r?.total ?? 0);
}

async function totals(db: Database, table: 'harvest_entry' | 'sale', cycleId: string): Promise<UnitTotal[]> {
  const rows = await db.all(
    `select t.unit_id, u.name, sum(t.quantity_micro) as total from ${table} t join unit u on u.id = t.unit_id where t.cycle_id = ? group by t.unit_id, u.name order by u.name`,
    [cycleId],
  );
  return rows.map((r) => ({ unitId: String(r.unit_id), unitName: String(r.name), quantityMicro: Number(r.total) }));
}

// RN-AG-014 e vendas: avisos de coerência entre estimativa, colheita e venda. Só avisam; nunca bloqueiam nem corrigem.
// Unidades diferentes não são comparadas nem convertidas (RN-AG-011).
const qtext = (t: UnitTotal) => `${formatQuantity(t.quantityMicro)} ${t.unitName}`;

export function estimateWarnings(colhido: UnitTotal[], estimativa: UnitTotal | null): string[] {
  const h = estimativa ? colhido.find((x) => x.unitId === estimativa.unitId) : undefined;
  return estimativa && h && h.quantityMicro > estimativa.quantityMicro
    ? [`A colheita registrada (${qtext(h)}) passou da sua estimativa (${qtext(estimativa)}). Confira se o valor está certo.`]
    : [];
}

export function saleWarnings(colhido: UnitTotal[], vendido: UnitTotal[]): string[] {
  const out: string[] = [];
  for (const v of vendido) {
    const h = colhido.find((x) => x.unitId === v.unitId);
    if (h && v.quantityMicro > h.quantityMicro) out.push(`Você vendeu mais (${qtext(v)}) do que colheu (${qtext(h)}). Confira a colheita e a venda.`);
    else if (!h && colhido.length === 0) out.push(`Há venda de ${v.unitName} e nenhuma colheita registrada nesta safra.`);
    else if (!h) out.push(`Há venda em ${v.unitName} sem colheita nessa unidade. O app não converte unidades sozinho, então não dá para comparar.`);
  }
  return out;
}

export async function harvestEstimate(db: Database, cycleId: string): Promise<UnitTotal | null> {
  const r = (await db.all('select c.harvest_estimate_micro as q, c.harvest_estimate_unit_id as u, n.name from crop_cycle c left join unit n on n.id = c.harvest_estimate_unit_id where c.id = ?', [cycleId]))[0];
  return r && r.q !== null && r.u !== null ? { unitId: String(r.u), unitName: String(r.name), quantityMicro: Number(r.q) } : null;
}

// Cálculo auditável (RNF-AG-003, CT-AG-007): cada número vem de uma soma dos registros e os casos
// deixados de fora são listados. Sem dados, nenhum resultado é inventado (CT-AG-008).
export async function cycleResult(db: Database, cycleId: string): Promise<CycleResult> {
  const c = (await db.all('select id, farm_id, plot_id from crop_cycle where id = ?', [cycleId]))[0];
  if (!c) throw new DomainError('nao_encontrado', 'Safra não encontrada');
  const farmId = String(c.farm_id);

  const exp = (extra: string) =>
    sumCents(db, `select sum(amount_cents) as total from financial_entry where voided_at is null and cycle_id = ? and kind = 'DESPESA' ${extra}`, [cycleId]);
  const custoRegistradoCents = await exp('and family_labor = 0');
  const maoDeObraFamiliarCents = await exp('and family_labor = 1');
  const custoPagoCents = await exp('and family_labor = 0 and paid_on is not null');
  const entradasDeCaixaCents = await sumCents(db, "select sum(amount_cents) as total from financial_entry where voided_at is null and cycle_id = ? and kind = 'ENTRADA'", [cycleId]);
  const receitaVendasCents = await sumCents(db, 'select sum(amount_cents) as total from sale where cycle_id = ?', [cycleId]);
  const recebidoCents = await sumCents(
    db,
    'select sum(r.amount_cents) as total from sale_receipt r join sale s on s.id = r.sale_id where s.cycle_id = ?',
    [cycleId],
  );
  // A receber por venda: cada venda entra com o próprio saldo em aberto. Somar tudo e cortar em zero mascara
  // uma venda em aberto quando outra recebeu mais do que valia.
  const aReceberCents = await sumCents(
    db,
    'select sum(max(0, s.amount_cents - coalesce((select sum(r.amount_cents) from sale_receipt r where r.sale_id = s.id), 0))) as total from sale s where s.cycle_id = ?',
    [cycleId],
  );
  const naoAlocados = await sumCents(
    db,
    "select sum(amount_cents) as total from financial_entry where voided_at is null and farm_id = ? and cycle_id is null and kind = 'DESPESA' and family_labor = 0",
    [farmId],
  );

  const colhido = await totals(db, 'harvest_entry', cycleId);
  const vendido = await totals(db, 'sale', cycleId);
  const nCusto = Number((await db.all("select count(*) as n from financial_entry where voided_at is null and cycle_id = ? and kind = 'DESPESA'", [cycleId]))[0]?.n);
  const nVendas = Number((await db.all('select count(*) as n from sale where cycle_id = ?', [cycleId]))[0]?.n);
  const nAtividades = Number((await db.all('select count(*) as n from field_activity where cycle_id = ?', [cycleId]))[0]?.n);
  const semDados = nCusto + nVendas + nAtividades + colhido.length + entradasDeCaixaCents === 0;

  // RN-AG-010 / RN-AG-015: produtividade só com colheita e área declarada válidas; as duas áreas aparecem.
  let produtividade: Productivity[] | null = null;
  let semProdutividadeMotivo: string | null = null;
  let areaDeclaradaMicro: number | null = null;
  let areaMedidaMicro: number | null = null;
  if (c.plot_id === null) {
    semProdutividadeMotivo = 'A safra ainda não tem talhão com área informada';
  } else {
    const p = (await db.all('select p.area_declared_micro, p.area_measured_micro, u.name as unit_name from plot p left join unit u on u.id = p.area_unit_id where p.id = ?', [c.plot_id]))[0];
    areaDeclaradaMicro = p?.area_declared_micro == null ? null : Number(p.area_declared_micro);
    areaMedidaMicro = p?.area_measured_micro == null ? null : Number(p.area_measured_micro);
    if (areaDeclaradaMicro === null) semProdutividadeMotivo = 'O talhão não tem área declarada';
    else if (colhido.length === 0) semProdutividadeMotivo = 'Sem colheita registrada';
    else {
      produtividade = colhido.map((h) => {
        const num = BigInt(h.quantityMicro) * BigInt(MICRO);
        const den = BigInt(areaDeclaradaMicro as number);
        const q = num / den;
        const rem = num % den;
        return {
          harvestUnitName: h.unitName,
          areaUnitName: String(p?.unit_name),
          valueMicro: Number(q + (rem * 2n >= den ? 1n : 0n)),
          exact: rem === 0n,
        };
      });
    }
  }

  const avisos: string[] = [];
  const excluidos: string[] = [];
  let resultadoParcialCents: number | null = null;
  if (nCusto === 0 || nVendas === 0) {
    avisos.push('Sem resultado: falta registrar custos e vendas desta safra. Custo ou venda desconhecidos não são tratados como zero.');
  } else {
    resultadoParcialCents = receitaVendasCents - custoRegistradoCents;
    avisos.push('Resultado parcial: vendas registradas menos o custo registrado. Não é lucro nem margem líquida.');
  }
  if (naoAlocados > 0) {
    avisos.push('Há custos da propriedade sem safra. Eles não entram neste resultado.');
    excluidos.push('Custos da propriedade sem safra (não alocados)');
  }
  if (maoDeObraFamiliarCents > 0) excluidos.push('Mão de obra familiar (linha separada)');
  if (receitaVendasCents > recebidoCents) avisos.push('Há vendas ainda não recebidas. Venda registrada não é dinheiro recebido.');
  if (areaDeclaradaMicro !== null && areaMedidaMicro !== null && areaDeclaradaMicro !== areaMedidaMicro) {
    avisos.push('A área medida é diferente da declarada. As duas são mostradas; a produtividade usa a declarada.');
  }
  if (produtividade?.some((p) => !p.exact)) avisos.push('Produtividade arredondada na 6ª casa decimal.');
  const estimativaColheita = await harvestEstimate(db, cycleId);
  avisos.push(...estimateWarnings(colhido, estimativaColheita), ...saleWarnings(colhido, vendido));

  return {
    cycleId,
    semDados,
    custoRegistradoCents,
    maoDeObraFamiliarCents,
    custoPagoCents,
    custoAPagarCents: custoRegistradoCents - custoPagoCents,
    entradasDeCaixaCents,
    receitaVendasCents,
    recebidoCents,
    aReceberCents,
    colhido,
    vendido,
    produtividade,
    semProdutividadeMotivo,
    areaDeclaradaMicro,
    areaMedidaMicro,
    resultadoParcialCents,
    custosNaoAlocadosDaPropriedadeCents: naoAlocados,
    estimativaColheita,
    avisos,
    excluidos,
  };
}
