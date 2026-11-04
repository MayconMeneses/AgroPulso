# FASE-03 — Atividades

Data: 2026-11-03. Status: **CONCLUÍDA NO CÓDIGO.** Sem commit.

## Escopo do spec (§27): caderno de campo, fotos, histórico e tarefas
| Item | Estado | Onde |
|---|---|---|
| Caderno de campo | feito | `src/domain/activities.ts`; autor e data sempre gravados; tipos de atividade cadastrados pelo usuário, nenhum pronto (RN-AG-019) |
| Tarefas | feito | atividade `PLANEJADA` vira `REALIZADA` por `updateActivity` (planejado × realizado, RN-AG-001) |
| Fotos e documentos | feito | `src/domain/attachments.ts`; JPG, PNG, WebP e PDF até 5 MB; tipo decidido pelo conteúdo, não pelo nome; nome saneado |
| Histórico de edição | feito | cada mudança grava evento com antes e depois (RF-AG-010) |
| Aviso de aplicação | feito | tipo marcado como aplicação devolve o aviso de que o registro não substitui receituário (RN-AG-017); o sistema não prescreve |
| Repetição não duplica | feito | `idempotency_key` única (RN-AG-006) |
| Safra encerrada | feito | registro novo só com justificativa, gravada no evento (RN-AG-003) |

## Limites
- Anexos ficam dentro do banco local; fotos grandes aumentam o arquivo de backup (base64 dentro do JSON). Tamanho do backup com muitas fotos não foi medido.
- Dimensão e compressão de imagem não são tratadas: o app não redimensiona fotos.
- O arquivo não é varrido por antivírus; só se confere a assinatura e nunca é aberto como HTML (nada vira `innerHTML`).
- Não há exclusão de atividade nem de anexo (invariante 6, exclusão com auditoria, não implementada).
- Mover anexo para outra atividade não existe, o que cumpre a invariante 9 por ausência.

## Testes
`tests/activities.test.ts` (7). Contagem total em FASE-06.
