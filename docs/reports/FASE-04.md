# FASE-04 — Custos e produção

Data: 2026-11-03. Status: **CONCLUÍDA NO CÓDIGO.** Sem commit.

## Escopo do spec (§27): despesas/receitas, colheitas, vendas, unidades e fórmulas auditáveis
| Item | Estado | Onde |
|---|---|---|
| Despesas e entradas de caixa | feito | `src/domain/financial.ts`; valor em centavos inteiros; categoria do usuário; custo e pagamento em datas separadas (RN-AG-001) |
| Custo não alocado | feito | lançamento sem safra fica fora do resultado e é avisado (RF-AG-008) |
| Mão de obra familiar | feito | linha separada, fora do custo registrado (RN-AG-020); valor imputado não implementado |
| Colheita parcial | feito | `src/domain/production.ts`; unidade obrigatória e existente (RF-AG-006); várias datas, nunca bloqueada (RN-AG-004) |
| Venda parcial e recebimento | feito | venda e recebimento em tabelas separadas (RN-AG-001, RN-AG-008, RN-AG-012) |
| Correções | feito | exigem justificativa, versão e deixam antes e depois (RN-AG-003) |
| Concluir safra | feito | exige colheita registrada ou motivo (RN-AG-021) |
| Resultado auditável | feito | `src/domain/results.ts` |

## Regras do resultado (`cycleResult`)
- Custo registrado = soma das despesas da safra, sem mão de obra familiar. Pago e a pagar separados.
- Receita = soma das vendas registradas; recebido = soma dos recebimentos; a receber = diferença (nunca negativa).
- Colhido e vendido por unidade; **unidades diferentes nunca são somadas**.
- Resultado parcial = vendas menos custo registrado, **só se houver ao menos um custo e uma venda**; senão fica indisponível (despesa ou venda desconhecida não vira zero, CT-AG-008). Sempre rotulado "parcial", nunca "lucro".
- Produtividade = colhido (por unidade) ÷ área declarada do talhão, só com talhão e área válidos; sem isso informa o motivo (RN-AG-010). Área medida e declarada aparecem; divergência é avisada (RN-AG-015).
- O que ficou fora (mão de obra familiar, custos sem safra) é listado no resultado.

## Não implementado
- Alerta de colheita acima da estimativa (RN-AG-014): não existe campo de estimativa.
- Valor imputado de mão de obra familiar (RN-AG-020, opção do tenant).
- Rateio de custo entre safras (só o critério em texto; sem divisão automática).
- Estoque colhido × vendido não é conferido: vender mais do que colheu não é bloqueado nem avisado.
- Multi-moeda: só BRL.

## Testes
`tests/production.test.ts` (13). Contagem total em FASE-06.
