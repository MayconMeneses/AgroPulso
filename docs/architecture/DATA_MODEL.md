# Modelo de dados inicial — candidato

Fonte: §5, §6, §8, §17. Entidades são candidatas; criar somente as exigidas por casos de uso aprovados (§17). Nada implementado.
A cultura é referência configurável (`crop_types`), sem tabela por cultura (§8).

## Entidades candidatas e relacionamentos
farms, plots, crop_types, crop_cycles; field_activities; financial_entries; harvest_entries; sales; attachments; audit_events. (V1 local, ADR-001/005: sem tenants, users, memberships e sessions; voltam só se houver servidor.)
- farm → plots; farm/plot → crop_cycles.
- crop_cycle → field_activities, harvest_entries, financial_entries.
- harvest_entries → sales por associação controlada, quando necessária.
- Venda e recebimento são conceitos distintos; o MVP pode registrar apenas data e valor da venda, sem fingir conciliação bancária.

## Invariantes (§17)
1. `farm_id` de crop_cycle é igual ao de plot (V1 local; com servidor, `tenant_id` igual em farm, plot e crop_cycle).
2. Quantidades não negativas onde fizer sentido; ajuste por estorno é distinto.
3. Moeda exata (centavos ou decimal preciso).
4. `idempotency_key` em operações de registro.
5. Bloqueio otimista (versão) em edição concorrente.
6. Exclusão com auditoria.
7. Unidade física obrigatória em colheita.
8. Cultivo só em propriedades existentes no perfil local.
9. Anexo não muda de propriedade sem operação controlada (§8).
10. Colheita não deriva de dados de venda duplicados (§8).
11. Constraints, FKs e índices por propriedade/safra/data protegem as relações (§8, §23).
12. Exportação e importação preservam todos os registros, anexos e unidades; importar o mesmo arquivo duas vezes não duplica (idempotência).

## Dicionário de campos (§8) — formato obrigatório
Para cada campo: nome, tipo, unidade, obrigatoriedade, fonte, permissão, validação, retenção, tratamento de null.
Será preenchido por entidade na Fase 1/2, após DP-001, DP-003 e DP-013. Campos de exemplo já fixados pelo spec:

| Campo | Tipo | Unidade | Obrig. | Fonte | Permissão | Validação | Retenção | Null |
|---|---|---|---|---|---|---|---|---|
| financial_entries.amount | inteiro (centavos) ou decimal | moeda | sim | manual | financial.read/write | valor exato; sem arredondamento silencioso | DP-013 | proibido |
| harvest_entries.quantity | decimal | unidade física | sim | manual | harvest.create | não negativo | DP-013 | proibido |
| harvest_entries.unit | referência | — | sim | cadastro de unidades | harvest.create | unidade controlada | DP-013 | proibido |
| conversões | valor original, unidade original, fator, origem, data, aprovador | — | quando houver | manual | a definir | fator explícito | DP-013 | permitido se sem conversão |
| plots.area_declared / area_measured | decimal | ha | não | manual / cálculo geodésico | farm.read/write | duas áreas separadas | DP-013 | permitido |
| datas | timestamp UTC + fuso | — | sim | sistema | — | exibição no fuso local | DP-013 | proibido |

Demais campos: **pendentes**.

## Matriz de transição da safra (§6) — proposta
Papéis usam as permissões de [ACCESS_MATRIX.md](../security/ACCESS_MATRIX.md). Todo evento gera `audit_events`.

| Estado atual | Ação | Próximo | Papel | Pré-condições | Dados exigidos | Evento | Desfazer | Erro |
|---|---|---|---|---|---|---|---|---|
| — | criar | RASCUNHO | cycle.manage | propriedade do tenant; cultura existente | propriedade, cultura | crop_cycle.opened | excluir (auditado) | "Propriedade ou cultura inválida" |
| RASCUNHO | planejar | PLANEJADA | cycle.manage | datas estimadas coerentes | início/fim estimados | crop_cycle.planned | voltar a RASCUNHO | "Datas incoerentes" |
| PLANEJADA | iniciar | EM_ANDAMENTO | cycle.manage | — | data de início real | crop_cycle.started | voltar a PLANEJADA se sem registros | "Safra já iniciada" |
| EM_ANDAMENTO | concluir | CONCLUIDA | cycle.manage | colheita registrada ou motivo explícito (DP-008, RN-AG-021) | motivo de perda se sem colheita | crop_cycle.closed | reabrir com justificativa | "Informe colheita ou motivo" |
| RASCUNHO / PLANEJADA / EM_ANDAMENTO | cancelar | CANCELADA | proprietário (motivo autorizado) | motivo informado | motivo | crop_cycle.closed (cancel) | reabrir com justificativa | "Motivo obrigatório" |
| CONCLUIDA | ajustar | CONCLUIDA | cycle.manage | operação permitir | justificativa | harvest/sale.corrected | estorno auditado | "Justificativa obrigatória" |

Regras comuns: histórico nunca é eliminado; colheitas parciais e vendas em datas diferentes não são bloqueadas; reenvio da mesma ação não duplica (idempotência); conflito de versão retorna mensagem legível. Detalhes de transições internas (ex.: reabrir) ficam marcados como **proposta a validar** com o dono.

## Eventos (§21)
farm.created, crop_cycle.opened/closed, activity.recorded, expense.recorded, harvest.recorded/corrected, sale.recorded/corrected, attachment.uploaded, access.denied. Campos: autoria, tenant, recurso, timestamp, antes/depois limitados, motivo, correlation ID.
