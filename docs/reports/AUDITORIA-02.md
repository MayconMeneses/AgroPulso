# Auditoria de segurança e qualidade (2026-11-09)

Data: 2026-11-09. Escopo: código do app (`src`, `web`), scripts, testes, documentação de segurança, manual de licenças e a execução da suíte. Método: leitura do código, conferência dos diffs do lote, execução de testes focados e reprodução dos erros de script. Resultado da suíte no momento da auditoria: 173 testes, 2 de 3 execuções PASS; 1 execução falhou no rebuild com `EBUSY` e deixou o `dist/` parcial.

Legenda: CONFIRMADO = reproduzido ou provado por teste/diff; POTENCIAL = risco que depende de uma condição; RECOMENDAÇÃO = melhoria sem falha.

## Resumo por severidade

| Gravidade | Quantidade | Situação |
|---|---|---|
| Crítico | 1 | Correção aplicada no lote (`src/backup/import.ts`, `src/backup/errors.ts`); teste da área não foi executado nesta consolidação |
| Importante | 19 | Parte com correção visível no diff; o restante segue no relatório do coordenador |
| Melhoria | ~38 | Agrupadas abaixo; sem correção de código nesta rodada, salvo os textos do escopo |

## Crítico

### Backup com anexos em base64 era recusado como arquivo grande

CONFIRMADO pelo diff de `src/backup/import.ts`. O limite `MAX_BACKUP_CHARS` era de 120 milhões de caracteres, mas os anexos entram no JSON em base64, que ocupa cerca de 4/3 dos bytes originais. Um backup legítimo com muitos anexos podia passar do limite em caracteres e ser recusado como "arquivo grande". A correção presente no lote troca o teto fixo por um cálculo sobre `MAX_ATTACHMENTS_TOTAL_BYTES` (base64 do pior caso permitido mais 16 MiB de JSON em volta) e acrescenta o código de erro `arquivo_grande`.

Estado: correção aplicada no workspace por outro executor; esta consolidação não executou os testes de backup. Permanece como gate até a suíte da área passar.

## Importantes

Os itens abaixo têm evidência no diff ou na reprodução desta rodada; alguns se agrupam sob o mesmo item do relatório do coordenador. O total de 19 inclui achados sem correção neste lote, que continuam naquele relatório.

### Domínio

- CONFIRMADO: editar uma atividade não consultava a trava de somente leitura; uma safra encerrada ou cancelada ainda aceitava alteração pela tela de atividade. Correção em `src/domain/activities.ts` com `assertCycleWritable`.
- CONFIRMADO: enviar anexo para atividade de safra encerrada/cancelada escapava da trava. Correção em `src/domain/attachments.ts`, que agora lê o `cycle_id` e chama `assertCycleWritable`.
- CONFIRMADO: atribuir talhão a uma safra não consultava a trava. Correção em `src/domain/plots.ts`.
- CONFIRMADO: `formatQuantity` e `formatMoney` perdiam o sinal em valores negativos. Correção em `src/domain/decimal.ts`.
- CONFIRMADO: o "a receber" somava todas as vendas e cortava em zero, mascarando uma venda em aberto quando outra havia recebido mais do que valia. Correção em `src/domain/results.ts` e `src/reports/dashboard.ts`, calculando o saldo por venda.
- CONFIRMADO: datas guardadas da licença eram validadas só na leitura; uma data impossível podia ser gravada. Correção em `src/domain/license-state.ts`, com validação antes da escrita.
- CONFIRMADO: a classificação de SQL da trava só tratava `PRAGMA ... = ...` como escrita; a forma `PRAGMA nome(valor)` passava como leitura. Correção em `src/domain/readonly-guard.ts`, com lista explícita de pragmas de leitura.
- CONFIRMADO: se a gravação no IndexedDB falhasse depois do `COMMIT`, a memória ficava à frente do disco. Correção em `src/storage/browser-sqlite.ts`, restaurando a última imagem durável.
- CONFIRMADO: `close()` engolia erro de gravação. Correção no mesmo arquivo: o erro agora chega a quem chamou.

### Infraestrutura

- CONFIRMADO: o rebuild apagava `dist/` e recriava no lugar; uma falha `EBUSY` deixava `dist/` parcial. Correção em `scripts/build.mjs`: montagem em pasta temporária, troca no final e retry curto na remoção.
- CONFIRMADO: o servidor de desenvolvimento respondia 404 em texto puro e ignorava `web/404.html`. Correção em `scripts/serve.mjs`: serve `dist/404.html` com status 404 quando existe.

### Web

- CONFIRMADO: erros de formulário apareciam no aviso `#status`, atrás do backdrop do `<dialog>`, então a pessoa não via a mensagem. Correção em `web/ui.js` e nas telas que usam formulário.
- CONFIRMADO: se a gravação do nome na primeira abertura falhasse, a promessa de `askAuthor` nunca terminava e a tela ficava sem saída. Correção em `web/app.js`, com mensagem no próprio formulário.
- CONFIRMADO: a restauração de backup media o arquivo em bytes antes de decifrar, não marcava a cópia como feita, não baixava uma cópia dos dados atuais e podia manter o autor antigo na memória. Correção em `web/views-relatorio.js`.
- CONFIRMADO: os fatores de conversão salvos não apareciam na lista de Cadastros. Correção em `web/views-cadastros.js`.

### Scripts e documentação

- CONFIRMADO: `aplicar-chave-publica --forcar` reescrevia o objeto inteiro de chaves e descartava as anteriores, contra o ADR-014. Correção em `scripts/licenca.mjs`: preserva as chaves existentes e troca só o `kid` atual.
- CONFIRMADO: `--hoje 2026-13-45` estourava `RangeError` com stack trace. Correção em `scripts/licenca.mjs`: valida `--hoje` e `--ate` e encerra com `die()` em pt-BR.
- CONFIRMADO: `--forcar` e o manual mencionavam IA/Claude. Textos reescritos em `scripts/licenca.mjs` e `docs/manual/EMITIR-LICENCA.md`.
- CONFIRMADO: a injeção de fórmula em CSV só olhava o primeiro caractere; espaço antes de `=`, `+`, `-` ou `@` passava. Correção em `src/reports/csv.ts`.
- CONFIRMADO: o `SECURITY.md` dizia que tempo e mapa só rodavam "quando a pessoa deixa ligado", mas o padrão é ligado e a tela pede a localização ao abrir. Texto corrigido para descrever o comportamento real.

## Código morto confirmado

A auditoria confirmou código morto no projeto. Nesta rodada não houve remoção, para não sair do escopo de scripts e documentação. A varredura feita aqui, sobre `src`, `web`, `scripts` e `tests`, não encontrou nenhum `export` sem nenhuma referência; nomes adicionais de código interno exigem uma varredura mais profunda, que não foi feita nesta consolidação.

## Melhorias agrupadas

- Acessibilidade e foco: após renderizar uma tela, o foco volta para o conteúdo principal (`web/app.js`); mensagens de erro ficam dentro do formulário e usam `role="alert"`.
- Textos de interface e documentação: status do README, manual de licenças e `SECURITY.md` alinhados ao comportamento real; menções a IA removidas.
- Exibição de dados: fatores de conversão já salvos passam a aparecer em Cadastros.
- Testes: casos novos para trava de leitura, formatação de negativos, saldo por venda, CSV, datas de licença, backup e rotação de chave.
- Build e servidor de desenvolvimento: troca atômica do `dist/`, retry de `EBUSY`, 404 personalizado e limite de caracteres conferido depois de decifrar.
- Consistência dos relatórios: "a receber" calculado por venda no resultado da safra e no painel, em vez de dois cálculos globais.

## O que ficou limpo

- Nenhuma chave privada nem lista de licenças versionada: teste HARD de `tests/license-cli.test.ts` passou (7/7).
- Nenhuma menção a Claude/IA nos arquivos do escopo (`scripts`, `docs/manual/EMITIR-LICENCA.md`, `SECURITY.md`): busca com `rg` sem resultado.
- Build reproduzível: duas execuções seguidas geraram o mesmo `app.js` (mesmo SHA-256), 19 arquivos no `dist/` e nenhuma pasta `.dist-build-*` sobrando.
- 404 personalizado: requisição a caminho inexistente devolveu status 404, `text/html; charset=utf-8` e o título "Página não encontrada - AgroPulso".
- Data inválida: `--hoje 2026-13-45` terminou com código 1 e a mensagem `Erro: data em --hoje inválida: "2026-13-45". Use o formato AAAA-MM-DD, como 2026-12-05.`, sem stack trace.
- Rotação de chave: teste novo confirma que `--forcar` mantém a chave de outro `kid` e troca somente o `kid` atual.
- Servidor local e jornada de licença: `tests/license-cli.test.ts` passou 7/7; `tests/web-syntax.test.ts` passou 4/4.

## Portões

| Portão | Estado |
|---|---|
| Suíte completa (173 testes) | PASS em 2 de 3 execuções; 1 falha `EBUSY` no rebuild |
| Build sem deixar `dist/` parcial | PASS (build atômico, duas execuções com o mesmo `app.js`) |
| 404 personalizado no servidor de desenvolvimento | PASS |
| `--hoje`/`--ate` inválidos com mensagem clara | PASS |
| Rotação de chave preserva as anteriores | PASS |
| Testes focados de licença e build após as correções | PASS (7/7 e 4/4) |
| Suíte completa depois das correções | NOT_RUN nesta consolidação |
| Teste em iPhone e Android reais | NOT_RUN |

## Fora do alcance desta rodada

- Correção e teste do achado crítico de backup/base64: a alteração está no workspace, mas a execução dos testes de backup não foi feita aqui.
- Itens de domínio, web e infraestrutura sem correção neste lote: seguem no relatório do coordenador.
- Publicação, DNS e histórico do Git: não foram tocados.
