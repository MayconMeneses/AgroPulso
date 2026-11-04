# Direção visual — proposta

Origem: pedido do dono em 2026-11-03 ("bem futurista, preto e verde, seguindo o ponto do agro"), alinhado ao §12 do Prompt Mestre (interface futurista, forte legibilidade, ícones próprios, estados de erro/sem conexão, WCAG 2.2 AA, ações grandes para campo sob sol, baixo consumo de dados).
Status: **aplicada ao app em 2026-11-03** (`web/styles.css`, `web/index.html`, `web/ui.js`); validada só no Chrome emulando aparelhos, não em aparelho real nem sob sol, nem com produtores. O §12 citava fundo marinho/verde-agro/ciano; o dono pediu preto e verde, então o ciano fica só como apoio.

## Paleta proposta (tokens)
Razões de contraste calculadas com a fórmula WCAG 2.x (script, 2026-11-03). Mínimo AA: 4,5:1 para texto, 3:1 para elementos de interface.

| Token | Hex | Uso | Contraste sobre fundo | Sobre superfície |
|---|---|---|---|---|
| bg | #050A07 | fundo preto-esverdeado | — | — |
| surface | #0B1410 | cartões | — | — |
| text | #E6F2EA | texto principal | 17,34 | 16,27 |
| text-muted | #8FA89A | texto secundário | 7,82 | 7,34 |
| primary | #2BE37F | verde-agro: ação principal, destaque | 11,77 | 11,05 |
| accent | #19D3C5 | ciano de apoio: links, dados | 10,60 | 9,95 |
| warning | #F5B83D | alerta de qualidade de dado | 11,21 | 10,52 |
| danger | #FF6B6B | erro | 7,19 | 6,75 |
| on-primary | #04110A | texto sobre botão verde | 11,38 (sobre #2BE37F) | — |

## Tema claro (opção escolhida pelo usuário)
Pedido do dono em 2026-11-03: o usuário poderá alternar para o tom claro. Proposta: seletor Escuro / Claro / Automático (segue o sistema), com a escolha lembrada no aparelho. Mesmos tokens, outros valores; as cores de texto escuras permitem leitura sob sol.

| Token | Hex | Uso | Contraste sobre bg | Sobre surface |
|---|---|---|---|---|
| bg | #F4F8F5 | fundo | — | — |
| surface | #FFFFFF | cartões | — | — |
| text | #0A1A12 | texto principal | 16,75 | 17,96 |
| text-muted | #4A5F54 | texto secundário | 6,41 | 6,87 |
| primary | #0B7A3E | ação principal (verde mais escuro) | 5,07 | 5,43 |
| accent | #0A7A72 | apoio | 4,85 | 5,20 |
| warning | #8A5A00 | alerta | 5,53 | 5,93 |
| danger | #B3261E | erro | 6,10 | 6,54 |
| on-primary | #FFFFFF | texto sobre botão verde | 5,43 (sobre #0B7A3E) | — |

Contrastes calculados pelo mesmo script WCAG (2026-11-03); todos acima de 4,5:1. O verde neon do tema escuro não serve no claro (contraste insuficiente), por isso o verde é mais escuro. Fica pendente: validar em aparelho real sob sol e definir se a preferência é guardada por usuário (conta) ou só no aparelho.

Bordas (#1B2B22) não foram medidas e só servem de separador; ainda falta verificar o contraste de foco e de bordas de campos.

## Princípios (do §12 e §13)
- Futurista sem peso: brilho verde só em destaques (ação principal, dado ativo); sem animação pesada, sem imagens grandes.
- Alvos de toque grandes e texto legível ao sol; tema claro disponível por opção do usuário (ver seção acima; eficácia sob sol não validada).
- Cada cartão e gráfico mostra a natureza do dado (manual, estimado, oficial) e a unidade.
- Estados vazios, erro e sem conexão desenhados desde o início.
- Ícones próprios, sem depender de biblioteca de marca.

## Pendente
- Validar a paleta com produtores em aparelho Android real (DP-011).
- Tipografia: sem fonte baixada de terceiros (o CSP só permite arquivos do próprio app e isso poupa dados). Texto em fonte do sistema; títulos, rótulos e números em fonte monoespaçada do sistema, o que dá o ar de instrumento. A aparência varia um pouco entre Android, iOS e Windows; não foi conferida nos três.
- Estrutura (2º pedido do dono, 2026-11-03: mudar a forma, não a cor): barra flutuante no celular e trilho lateral no computador, painéis em mosaico com cantos assimétricos, gavetas para formulários, gráfico de linha, pulso de brilho ligado ao nome da marca. Detalhes em `docs/reports/FASE-05.md`.
- Aplicado: tema escuro como padrão (a identidade é preto e verde), claro por escolha, automático segue o sistema; ícones próprios em traço; mostradores de números no painel; grade e brilho verde discretos, sem animação pesada (movimento desligado para quem pede menos movimento).
- Contrastes medidos nos dois temas (texto 6,1 a 17,3; botão principal 5,4 a 11,4; borda de campo 3,8 e 4,0 contra o cartão; foco 6,0 e 10,6). O "natureza do dado" (manual, estimado, oficial) em cada cartão ainda não foi desenhado.
