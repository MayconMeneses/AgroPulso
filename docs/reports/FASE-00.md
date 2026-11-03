# FASE-00 — Descoberta e viabilidade

Data: 2026-11-03. Status da fase: **ENCERRADA POR DECISÃO DO DONO, NÃO POR GATES APROVADOS.** O dono mandou começar a criação em 2026-11-03. Gates sem PASS e pendências estão listados abaixo.

## Commit
N/A — repositório não inicializado. Não há hash. O dono disse que criaria o repositório (DP-014); `git init` não foi autorizado. O OneDrive no caminho é só nomeação (desativado), não é restrição.

## Motivação
O Prompt Mestre (§27, §30) manda começar pela Fase 0 e gerar os documentos de §29 antes de qualquer código.

## Arquivos (apenas `docs/`, sem código) — linhas medidas com `wc -l` em 2026-11-03
| Arquivo | Linhas |
|---|---|
| docs/product/PRD.md | 135 |
| docs/product/DECISOES_PENDENTES.md | 33 |
| docs/product/DESCOBERTA.md | 69 |
| docs/product/DIRECAO_VISUAL.md | 50 |
| docs/architecture/DECISIONS.md | 37 |
| docs/architecture/DATA_MODEL.md | 57 |
| docs/security/THREAT_MODEL.md | 47 |
| docs/security/ACCESS_MATRIX.md | 26 |
| docs/legal/TERMO_DE_USO_MINUTA.md | 72 |
| docs/reports/FASE-00.md | este arquivo |

## Verificações executadas (saída real de `find`/`wc`/`grep`/`file`)
- Todos os arquivos listados existem; o maior (PRD) tem 135 linhas, abaixo da orientação de ~300 (regra 22).
- IDs distintos: RF-AG 16, RN-AG 22, RNF-AG 8, CT-AG 17, SEC-AG 20, DP 21. Sem definição duplicada. Em THREAT_MODEL os IDs SEC-AG aparecem também na tabela de revisão do app local, o que o `uniq -d` acusa; não é duplicação de definição.
- Encoding: todos UTF-8 (`file`), sem exceções.
- Nenhum diretório vazio.
- "Nada implementado": nenhum código existe.

## Gates
| Gate | Resultado | Observação |
|---|---|---|
| PRD, DECISIONS, DATA_MODEL, THREAT_MODEL, ACCESS_MATRIX, DECISOES_PENDENTES existem | PASS | `find` |
| IDs numerados e únicos | PASS | `grep`/`uniq -d` |
| Nenhum número, preço, fator de unidade ou regra agronômica inventado | PASS (por revisão) | revisão do autor; sem verificação automatizada |
| Benchmark com ≥3 alternativas (§3) | PASS | Aegro (página), Embrapa (guia), Emater-DF (PDF de 61 p., baixado com OK do dono); mais 2 TCCs secundários; nenhum software foi testado em uso |
| Entrevistas com 10–15 pessoas (§3) | SUBSTITUÍDO (decisão do dono) | 0 entrevistas; trocadas por pesquisa secundária. Não é PASS: roteiro respondido em parte, resto UNKNOWN |
| Matriz dor × frequência × custo (§3) | PARCIAL | 3 linhas só com o que as fontes sustentam |
| Critérios do piloto | PASS (parcial) | CT-AG-001..017 transcritos do §28, todos NOT_RUN |
| Custos conhecidos / decisão de prosseguir | BLOCKED, ultrapassado pelo dono | DP-009, DP-010, DP-015, DP-019, DP-020 parciais; DP-011, DP-013, DP-021 abertas. Sem hospedagem: custo de nuvem zero |
| Termo de uso | PARCIAL | minuta feita; LGPD arts. 41/46–48/52 e Resolução ANPD 2/2022 não confirmados; sem revisão de advogado; campos comerciais em DP-021 |

## Histórico das rodadas (2026-11-03)
- **Segunda:** dono delegou as pendências "como se fosse para o Brasil", adaptável a toda a agricultura; DIRECAO_VISUAL criado; RN-AG-019..022 e RF-AG-016 no PRD; foco no Nordeste (DP-020); o dono criaria o repositório.
- **Terceira:** caderno da Emater-DF, TCC da Unesp e TCC da UFPB (n=16) lidos; Sicredi e artigo de Guanambi devolveram 403 (não lidos); sem pessoas reais para entrevistas, substituídas por pesquisa; projeto não será hospedado.
- **Quarta:** app local, hospedagem só com clientes; ADR-001, 003, 005, 007 e 011 reescritas; minuta do termo de uso (Maycon Meneses, pessoa física, sem CNPJ); DATA_MODEL, THREAT_MODEL e ACCESS_MATRIX ajustados ao perfil único.
- Contagem das decisões pendentes: 21 itens, 13 resolvidas, 5 parciais, 3 abertas.

## Problemas e correções
- Primeira extração do PDF perdeu acentos (codificação do `pdftotext`); reextraída com `-enc UTF-8`. Leitura de PDF pelo `Read` falhou (poppler ausente); contornado com `pdftotext`.
- Contagens e citações erradas deste relatório e de documentos foram corrigidas ao longo das rodadas (DP, RN-AG-007, linha quebrada por `sed`).
- Este relatório ficou desatualizado em contagens e arquivos até esta revisão; refeito a partir de comandos.

## Riscos
- DATA_MODEL: transições além das citadas no §6 (planejar, iniciar, reabrir) são proposta minha, marcadas "a validar".
- ACCESS_MATRIX: papéis multiusuário são referência futura; na V1 há um perfil.
- ADR-004 (PostgreSQL) está desatualizada: exige servidor. Precisa de banco embarcado.
- Benchmark e entrevistas dependem de fontes secundárias; nada validado com produtores reais.

## Evidências
Saídas dos comandos acima, desta sessão. Spec lido de `AgroPulso_Prompt_Mestre_Arquitetura_e_Engenharia.pdf`.

## Decisão de prosseguir
O dono autorizou a criação em 2026-11-03. **Em aberto para a Fase 1:** DP-011 (aparelho-alvo: define o armazenamento), ADR-004 (banco embarcado) e `git init` (o dono disse que cria o repositório). A Fase 1 deve ser reduzida ao que sobra da fundação com app local: estrutura de módulos, banco embarcado com migrações, exportar/importar como backup/restore e testes. Sem login, tenant nem RLS, e sem módulos das fases 2 a 4.
