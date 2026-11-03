# FASE-02 — Núcleo rural (início)

Data: 2026-11-03. Status: **EM ANDAMENTO, reduzida.** Autorizada pelo dono ("Sim, começar Fase 2"). Sem commit ainda: as mudanças estão só na pasta local.

## Escopo do spec (§27) e o que foi feito
F2 do spec: propriedades, áreas opcionais, safras, estados e formulários rápidos.

| Item do spec | Estado | Observação |
|---|---|---|
| Propriedades | feito (código) | `src/domain/farms.ts`; sem mapa e sem área; fuso obrigatório e sem valor padrão (RN-AG-022) |
| Safras e estados | feito (código) | `src/domain/cycles.ts`; criar, planejar, iniciar, concluir, cancelar; versão e evento por passo |
| Cultura configurável | feito (código) | `src/domain/crop-types.ts`; nenhuma cultura pré-cadastrada (RN-AG-019) |
| Áreas opcionais (talhões) | NOT_RUN | exigem unidades de área cadastráveis com fator (RN-AG-011/013); fica para depois |
| Formulários rápidos (interface) | NOT_RUN | depende da entrega por PWA (DP-011) e da direção visual |

## Arquivos novos ou alterados
`src/domain/{errors,audit,farms,crop-types,cycles}.ts`, migração v2 em `src/migrations/migrations.ts`, `pragma foreign_keys = on` em `src/storage/node-sqlite.ts`, `tests/domain.test.ts`; `tests/helpers.ts` e `tests/migrations.test.ts` ajustados para não fixar o número da versão. Nenhum arquivo passa de 163 linhas (`wc -l`).

## Decisões de projeto (minhas, a validar)
- Chaves estrangeiras ligadas e sem `ON DELETE`, para a restauração do backup poder apagar e regravar na mesma transação.
- Datas da safra como texto AAAA-MM-DD, sem hora e sem fuso; o fuso fica na propriedade.
- Concluir safra aceita só o motivo escrito, pois colheita só existe na Fase 4. RN-AG-021 fica incompleta até lá.
- Não foram implementados "voltar de estado", "reabrir" e "ajustar" (propostas sem validação do dono em DATA_MODEL).
- Comparação de nome de cultura sem diferenciar maiúsculas vale só para letras sem acento (`lower()` do SQLite); "Ágata" e "ágata" seriam duas culturas.

## Testes (`npm test`, Node 24.20)
**25 testes, 25 passam**: 12 da Fase 1 (4 de migração ajustados para derivar a versão em vez de fixá-la), 12 novos em `tests/domain.test.ts` e 1 novo em `tests/backup.test.ts` (backup com registro órfão: rejeitado com `estrutura`, banco intacto e ainda usável; o teste falha se a verificação for desligada). Cobrem: propriedade com fuso inválido ou nome vazio recusados; sem culturas de fábrica e nome repetido recusado; várias safras com histórico independente; safra exige propriedade e cultura; percurso completo com um evento por passo; concluir e cancelar exigem motivo; transições fora de ordem recusadas sem alterar nada; datas inválidas ou incoerentes recusadas; conflito de versão; o banco recusa safra de propriedade inexistente; backup/restauração com os dados novos, importados duas vezes sem duplicar.

## Risco novo corrigido: restauração com chaves estrangeiras
Ligar as chaves estrangeiras abriu um caminho: um backup com `farm_id` inexistente só falharia no `COMMIT`, com erro cru. Agora `importBackup` roda `pragma foreign_key_check` antes do `COMMIT` e rejeita com `BackupError('estrutura')`, desfazendo a transação.

## Falha encontrada e corrigida na causa
Três testes falharam porque `planCycle`, `startCycle`, `closeCycle` e `cancelCycle` lançavam o erro de validação de forma síncrona, em vez de rejeitar a promessa. Corrigido tornando as funções `async`. Nenhum teste foi enfraquecido.

## NOT_RUN
Checagem de tipos (sem compilador TypeScript); interface; Android, iOS e Windows reais; idempotência de criação (RN-AG-006, `idempotency_key`); exclusão com auditoria; teste de concorrência real (só o conflito de versão sequencial).

## Riscos
- O evento de auditoria usa o relógio do aparelho; sem garantia de ordem entre aparelhos (não há sincronização na V1).
- Backup só restaura na mesma versão do esquema: depois da v2, backups da v1 são recusados (comportamento já testado na Fase 1; migrar backups antigos segue pendente).
