# FASE-02 — Núcleo rural

Data: 2026-11-03. Status: **CONCLUÍDA NO CÓDIGO; formulários rápidos verificados só no Chromium do painel do app**. Sem commit desta parte (pedido do dono: não commitar).

## Escopo do spec (§27) e o que foi feito
F2: propriedades, áreas opcionais, safras, estados e formulários rápidos.

| Item | Estado | Onde |
|---|---|---|
| Propriedades | feito | `src/domain/farms.ts`; sem mapa e sem área; fuso obrigatório e sem valor padrão (RN-AG-022) |
| Áreas opcionais (talhões) | feito | `src/domain/plots.ts`; área declarada e medida separadas (RN-AG-015); talhão ligado depois à safra (J2) |
| Unidades e fatores | feito | `src/domain/units.ts`; nenhuma unidade nem fator vem pronto; fator com origem escrita e por cultura (RN-AG-011); sem fator, conversão devolve "indisponível" |
| Números | feito | `src/domain/decimal.ts`; só vírgula decimal; ponto, milhar e casas a mais são recusados (RN-AG-013) |
| Safras e estados | feito | `src/domain/cycles.ts`; criar, planejar, iniciar, concluir, cancelar; versão e evento por passo |
| Cultura configurável | feito | `src/domain/crop-types.ts` |
| Formulários rápidos | feito, verificação parcial | telas em `web/`; ver FASE-05 |

## Decisões de projeto (minhas, a validar)
- Chaves estrangeiras ligadas e sem `ON DELETE`; restauração de backup checa `pragma foreign_key_check` antes do `COMMIT`.
- Datas como texto AAAA-MM-DD, sem hora; o fuso fica na propriedade.
- Quantidades e áreas em milionésimos (6 casas), dinheiro em centavos, tudo inteiro. Conversão que não divide exato é marcada como arredondada.
- Não implementados: voltar de estado, reabrir e ajustar safra (propostas sem validação do dono).
- Nome de cultura, unidade, tipo e categoria: comparação sem diferenciar maiúsculas vale só para letras sem acento (`lower()` do SQLite).

## Falhas encontradas e corrigidas na causa
- Funções de transição lançavam erro de forma síncrona; viraram `async`.
- Backup com registro órfão falharia só no `COMMIT` com erro cru; agora vira `BackupError('estrutura')`. Teste falha se a checagem é desligada.

## Testes
Ver a contagem total em FASE-06. Arquivos desta fase: `tests/domain.test.ts`, `tests/units.test.ts`, mais o teste de órfão em `tests/backup.test.ts`.
