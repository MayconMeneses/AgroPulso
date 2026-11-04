# FASE-05 — UX/PWA e BI

Data: 2026-11-03. Status: **CONCLUÍDA PARA O QUE FOI TESTADO NO CHROMIUM DO PAINEL DO APP; Android, iOS e Windows reais: NOT_RUN.** Sem commit.

## O que existe
| Item | Onde |
|---|---|
| Painel (safras ativas, pendências, a receber, evolução por mês; só leitura) | `src/reports/dashboard.ts`, `web/views-resumo.js` |
| Relatório CSV | `src/reports/csv.ts` (BOM para acentos no Excel; fórmulas neutralizadas) |
| Relatório PDF com texto selecionável | `src/reports/pdf.ts`, sem dependências; Latin-1, o que está fora vira "?" |
| Telas: cadastros, safras, registrar, painel, relatório, cópia dos dados | `web/*.js`, `web/index.html`, `web/styles.css` |
| Banco no navegador | `src/storage/browser-sqlite.ts` (sql.js 1.15.2 fixo, bytes no IndexedDB) |
| PWA instalável e offline | `web/manifest.webmanifest`, `web/sw.js` (cache só dos arquivos do app, nunca dos dados) |
| Tema claro, escuro e automático | RF-AG-016; escolha guardada em `localStorage` só por conveniência |
| Build sem compilador | `scripts/build.mjs` remove os tipos com `module.stripTypeScriptTypes` do Node |
| Uma aba por vez | bloqueio `navigator.locks`: a segunda aba recebe aviso (evita uma aba apagar o trabalho da outra) |

## Verificação feita (Chromium do painel + chrome-devtools; 2026-11-03)
- Fluxo completo pela interface: cadastros, safra (abrir, planejar, iniciar, ligar talhão), atividade, duas despesas, colheita, venda e recebimento. O painel mostrou os números esperados.
- Dados sobrevivem a recarregar a página (IndexedDB). **PASS.**
- Offline de verdade: servidor parado, página recarregada, app abriu com os dados (service worker). **PASS.** Defeito encontrado e corrigido antes: o pré-cache não incluía as telas.
- PDF gerado foi lido por um leitor real (`pdftotext`), acentos corretos. CSV e PDF baixaram pelo app. **PASS.**
- Backup baixado e restaurado no navegador; arquivo adulterado recusado; sem marcar a confirmação, recusa. **PASS.**
- 375 px e 320 px: sem rolagem horizontal nas seis seções; nenhum alvo de toque abaixo de 44 px; todos os campos com rótulo. **PASS.**
- **Emulação de aparelhos no Chrome** (chrome-devtools, perfil limpo, primeiro acesso e as seis seções em cada um): Galaxy 360×740, iPhone SE 375×667, iPhone 14 390×844, Pixel 412×915, celular deitado 667×375, iPad 768×1024, notebook 1366×768 e monitor 1920×1080. Em todos: sem rolagem horizontal, sem elemento cortado, nenhum alvo abaixo de 44 px. **PASS.** Isto é emulação de tela e toque no Chrome (Blink): **não prova** o comportamento do Safari do iPhone (WebKit) nem do Android real.
- Tema escuro com captura de tela real (390 px): texto, botão ativo e cartão legíveis. **PASS.**
- Primeira carga a frio, sem cache, em "3G lento" com CPU 4× mais lenta (emulado): **35 s** com 36 arquivos antes de juntar os módulos; **26 s** com 6 requisições (863 KB) depois que `scripts/bundle.mjs` passou a gerar um único `app.js` (121 KB). O que sobra é quase todo o SQLite em WebAssembly (733 KB); se a hospedagem comprimir `.wasm`, deve cair (UNKNOWN, depende do serviço escolhido). Depois da primeira vez o app abre do cache, sem rede.
- Depois do bundle, refeito no Chrome: fluxo completo pela interface (propriedade, cultura, unidade, categoria, safra aberta, planejada, iniciada, despesa, painel), sem erro no console. **PASS.** Os testes do bundler estão em `tests/bundle.test.ts`.
- Contraste medido: claro (corpo 13,9; texto secundário 7,2; botão ativo 6,4; aviso 6,2) e escuro (15,6; 7,9; 9,5; 9,5), todos acima de 4,5. **PASS.** Captura de tela do tema escuro: NOT_RUN (a janela do painel não renderizou).
- Lighthouse (mobile): acessibilidade 100, boas práticas 100, SEO 100, 51 verificações sem falha.
- Desempenho (traço sem limitação de rede ou CPU, em localhost): LCP 601 ms, CLS 0,00. Medida de laboratório, não de aparelho real.
- Segunda aba bloqueada com aviso; a primeira continua funcionando. **PASS** (após refazer o teste: a primeira tentativa usava o código antigo em cache e não valia).

## Visual e estrutura futuristas (2026-11-03)
O dono achou o app "comum, quadrado e antigo" e pediu mudança de **forma**, não de cor. Primeira rodada: paleta preto e verde da [DIRECAO_VISUAL.md](../product/DIRECAO_VISUAL.md). Segunda rodada, a estrutural:
- **Casca:** sem barra de abas no topo. No celular, uma barra flutuante em pílula embaixo (só a seção atual mostra o nome); no computador, trilho lateral com ícone e nome. Topo enxuto com marca, nome da seção, rede e botão de tema.
- **Painéis:** cantos assimétricos (redondo de um lado, quase reto do outro) com colchetes verdes de painel de instrumento.
- **Painel (cockpit):** resultado da safra em destaque, anel de "recebido", blocos de números, **gráfico de linha** de despesas e vendas por mês, colheita, pendências e avisos. Troca de safra por botões.
- **Registrar:** grade de seis ações grandes; cada uma abre uma **gaveta** (sobe de baixo no celular, entra pela direita no computador) só com os campos daquela ação.
- **Safras:** cada safra é uma trilha (rascunho, planejada, em andamento, concluída) com uma única ação principal. **Cadastros:** blocos que mostram o que existe e abrem gaveta para adicionar.
- **Movimento (pedido do dono, aprovado):** um brilho que pulsa no resultado da safra e atrás do nome AgroPulso, **no mesmo ritmo** (3,2 s), a linha do logo que corre, e as linhas do gráfico que se desenham uma vez. Só opacidade, escala e traçado de linha (barato). Com "reduzir movimento" ligado no sistema, tudo isso para e a linha já aparece desenhada (um defeito de regra de CSS que escondia a linha nesse modo foi achado no teste e corrigido).
- **Verificado no Chrome (emulado):** fluxo completo pelas gavetas e ações; capturas de tela no celular e no computador, tema escuro e claro; animações ativas e desligadas pelo modo de menos movimento; sem rolagem lateral e sem alvo abaixo de 44 px em 320, 360, 412, 768, 1366 e 1920 px; Lighthouse 100 nas quatro categorias nos dois temas; 66 testes passam. Defeitos achados pelo teste e corrigidos: altura do seletor de tema, salto de layout, linha escondida em "reduzir movimento", gráfico com pontos grandes demais.
- **Não verificado:** aparência em aparelho real, fonte monoespaçada do sistema no iOS, desempenho das animações em aparelho de entrada, leitura sob sol, navegação por teclado à mão.

## Limites e riscos
- `navigator.storage.persist()` retornou **falso** no painel: o navegador não garante guarda permanente. A tela "Cópia dos dados" avisa isso e pede cópia frequente. No iOS, o apagamento de dados do Safari depois de 7 dias sem uso não foi conferido na documentação oficial.
- O app só roda em navegador moderno com WebAssembly, IndexedDB e Web Locks. Sem Web Locks o bloqueio de aba única não existe.
- Versão nova do app com uma aba antiga aberta: a aba antiga continua com o código velho até recarregar. Não há aviso de atualização.
- Uma falha ao gravar no IndexedDB (disco cheio) não é tratada de forma específica: a gravação falharia depois do dado já estar na memória.
- Um erro de console "Failed to load resource: net::ERR_FAILED" apareceu uma vez e não foi reproduzido; provável efeito do servidor parado durante o teste offline (POSSIBLE).
- Navegação por teclado e anel de foco: só verificados por regra de CSS e Lighthouse, não à mão.
- Rascunhos locais controlados (§14): sem sincronização, tudo já é local.
