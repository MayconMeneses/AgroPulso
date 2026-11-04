# EXTRAS-01 — Estoque, aviso de atualização, tempo e mapa

Data: 2026-11-03. Status: **implementado e verificado no Chromium do painel do app; Android, iOS e Windows reais: NOT_RUN.** Sem commit.
Pedido do dono: pendências "multiusuário, sincronização, mapas, clima e estoque" e "avisar quando houver versão nova". Decisão do dono: clima e mapa só com internet.

## Feito
| Item | Onde | Verificação |
|---|---|---|
| Estoque de insumos (item, entrada, saída, ajuste, histórico, aviso de estoque baixo) | `src/domain/stock.ts`, migração v6, `web/views-estoque.js` | 9 testes (saldo, mínimo, saldo negativo recusado, ajuste exige motivo, repetição, safra encerrada, auditoria, backup); fluxo pela interface |
| Aviso de versão nova | `web/sw.js`, `web/app.js`, `#update` | Testado no navegador: build novo, evento de reconexão, aviso, toque em "Atualizar agora", página recarregou, cache velho apagado, dados mantidos |
| Local da propriedade (opcional) | `src/domain/location.ts`, migração v7 | 2 testes + interface |
| Previsão do tempo, só com internet | `src/domain/online.ts`, `web/views-local.js` | Previsão real recebida e exibida; resposta torta ou hostil recusada (teste); sem internet: aviso |
| Mapa, só com internet | `src/domain/online.ts` (9 quadros do OpenStreetMap, sem biblioteca) | Nove quadros carregados com o ponto no lugar; sem internet: aviso |

Total: 80 testes passando (eram 66). A barra de baixo continuou com 6 botões (Relatório e Cópia dos dados dividem a aba) e sem rolagem lateral nem botão menor que 44 px em 320 px.

## Como o aviso de atualização funciona
O navegador confere se há `sw.js` novo ao abrir o app, ao voltar para ele, ao reconectar e a cada hora. A versão nova baixa em segundo plano (ignorando o cache da hospedagem) e **espera**; o app mostra "Há uma versão nova" com "Atualizar agora" e "Depois". Só ao aceitar o código troca e a página recarrega. Os dados já estão gravados a cada registro, então recarregar não perde nada.
Limite: uma instalação feita **antes** desta versão não tem esse aviso; ela troca de código sozinha, sem avisar, uma única vez.

## Privacidade e política de segurança (CSP)
- Tempo e mapa nunca rodam sozinhos: só no toque do botão, com o aviso na tela. Para o tempo vai à Open-Meteo o local arredondado (4 casas) e o fuso; para o mapa o OpenStreetMap recebe os endereços dos quadros (que revelam a área) e o endereço do site.
- A CSP passou a permitir **somente** `https://api.open-meteo.com` (conexão) e `https://tile.openstreetmap.org` (imagem). Há teste que trava isso.
- A política de privacidade do app (LGPD) precisa citar esses dois serviços antes de qualquer publicação. NOT_RUN.

## Licenças (decisão do dono em 2026-11-03: o AgroPulso é só para uso próprio)
- Open-Meteo: o uso gratuito é para fins **não comerciais**; para uso próprio isso basta. **Se um dia o app for vendido ou oferecido a clientes, reavaliar** (plano pago com chave). Não confirmado nos termos do serviço.
- OpenStreetMap: os quadros públicos aceitam uso leve e pedem identificação e crédito (o crédito está na tela). Uso próprio é leve. Com muitos usuários, seria preciso um provedor de mapas contratado.

## Localização automática (pedido do dono, mesmo dia)
Com internet e sem local salvo, o app pede a localização do aparelho (uma vez por sessão e por propriedade; o navegador mostra a própria pergunta de permissão). Se a pessoa permitir, o local é salvo no aparelho e o tempo e o mapa aparecem sozinhos no Painel e em Cadastros; a previsão fica 30 minutos em memória para não buscar a cada tela. Se negar, o app segue normal e oferece digitar o local. "Remover o local" para tudo. Isto troca a regra anterior ("só no toque do botão"): agora o envio do local aproximado acontece sempre que a tela abre com internet, e o aviso na tela diz isso.

## Pendências
- Não há desenho de talhão no mapa: só o ponto da propriedade. Contorno de talhão precisa de decisão de fornecedor e de modelo de dados.
- Previsão e mapa não ficam guardados: sem internet, não aparecem.

## Ainda não feito
- **Multiusuário:** o app só guarda o nome de quem anota. Papéis (dono e empregado) no mesmo aparelho são possíveis, mas não existem; em aparelhos diferentes exigem servidor.
- **Sincronização entre aparelhos:** exige servidor e contas; contraria a decisão atual (app local, sem servidor) e muda a política de privacidade.
- Estoque: não gera despesa sozinho (o custo continua sendo lançado em "Registrar"), não converte unidades e não apaga movimentos (corrige-se com ajuste).
- Não verificado: Safari do iPhone (WebKit), celular real, desempenho em aparelho de entrada.

## Rodada 2 (2026-11-03): alertas, anular, etiquetas, contorno
| Item | Onde | Verificação |
|---|---|---|
| Tipos de atividade vêm preenchidos no primeiro uso (10 nomes comuns; só "Aplicação de defensivo" leva o aviso de aplicação). Continuam do usuário; categorias de custo e unidades **seguem vazias** de propósito (variam por região) | `addCommonActivityTypes` em `src/domain/activities.ts` | teste; conferido na tela |
| Estimativa de colheita (RN-AG-014) e aviso quando a colheita passa dela | `setHarvestEstimate`, `estimateWarnings` | 2 testes; conferido no Painel |
| Aviso ao vender mais do que colheu, venda sem colheita e venda em unidade sem colheita (sem converter unidades). Só avisa, não bloqueia; aparece ao salvar e no resultado | `saleWarnings` em `src/domain/results.ts` | testes |
| Anular despesa/entrada com motivo: sai das contas, do painel e do CSV; fica gravada riscada com o motivo | `voidEntry`, tela "Lançamentos" na safra | testes; conferido na tela |
| Remover anexo com motivo: o arquivo é apagado, o registro (nome, tipo, tamanho, motivo) fica. Em safra encerrada o anexo é preservado | `removeAttachment` | testes |
| Etiquetas Digitado / Calculado / Estimado / Fonte externa nos números do Painel, estoque, estimativa e previsão. "Oficial" virou "Fonte externa": a previsão é de um serviço privado, não de órgão oficial | `tag()` em `web/ui.js` | conferido na tela |
| Contorno do talhão: toque nos cantos no mapa, até 60 pontos, área estimada em hectares (não altera área declarada nem medida) e polígono sobre o mapa | `src/domain/geo.ts`, `setPlotOutline`, `web/views-talhao.js` | testes (toque↔coordenada, área de ~1 ha); desenhado e salvo no navegador |

Total: 87 testes. Não existe "desfazer anulação" nem "desfazer remoção de anexo" pela tela.

**Aviso de versão nova para quem instalou antes:** não há o que fazer no código. A instalação antiga troca de versão uma vez, sem aviso, na próxima abertura; as seguintes já avisam. Como o app ainda não foi publicado, a única instalação antiga é a do computador de desenvolvimento.

## Rodada 3 (2026-11-03): funcionários, diária e mensal
- **Cadastro de pessoas** (Cadastros): funcionário contratado ou da família, pagamento por **diária** ou **mensal** e o valor (obrigatório para contratado; opcional para família).
- **Dia de trabalho** (Registrar): diária = dias trabalhados (aceita 0,5, até 31); mensal = que % do salário do mês vai para a safra (1 a 100; o mês de uma pessoa não passa de 100 % somando as safras). O app calcula o custo e lança a despesa de mão de obra na hora, na mesma gravação.
- **Contratado** entra no custo registrado e no resultado. **Família** entra na linha separada "mão de obra familiar", fora do custo e do resultado (RN-AG-020), com a etiqueta "Estimado". Família sem valor cadastrado: o trabalho é anotado sem valor, com aviso; nenhum número é inventado.
- Anular o trabalho anula a despesa dele, com o motivo; a despesa gerada por trabalho não se anula sozinha. A safra encerrada pede justificativa, como nas demais.
- Resumo por pessoa e lista na tela "Lançamentos" da safra.
- Defeito achado pelos testes e corrigido: datas impossíveis (mês 13, dia 40) causavam erro interno em vez de mensagem em português (`guards.ts` e `cycles.ts`).
- 96 testes (eram 87). Conferido no navegador: contratado por diária (2,5 dias x R$ 150 = R$ 375 no custo) e família mensal (50 % de R$ 1.800 = R$ 900 na linha separada).
- Não feito: relatório PDF/CSV por pessoa (o CSV já traz a despesa com o nome na coluna de quem recebeu); salário proporcional por dias do mês; 13º, férias e encargos (o app registra o que você declara, não faz folha de pagamento).

## Rodada 4 (2026-11-04): categorias e unidades prontas, relatório de mão de obra
- **Categorias de custo** (10) e **unidades** (kg, tonelada, saca, litro, hectare, tarefa, unidade, caixa) são oferecidas uma única vez no primeiro uso. São só nomes: **nenhum fator de conversão vem pronto** (saca e tarefa mudam por cultura e região; o fator continua sendo cadastrado por quem usa, com a origem). Nome que já existe não é repetido; a marca no banco impede de voltar. A categoria "Mão de obra" é a que o trabalho usa na despesa. Em `src/domain/defaults.ts`.
- **Relatório de mão de obra por pessoa** em PDF e planilha (Relatório > "Qual relatório"): resumo por pessoa (dias ou % de salário e valor), total contratado e total da família (estimado, fora do custo), linhas do período, aviso de família sem valor e menção aos anulados (que não entram nas somas). Em `src/reports/labor.ts`; usa o mesmo formato do relatório da safra, com nomes neutralizados contra fórmula na planilha.
- 100 testes. Conferido no navegador: listas preenchidas, sem fator de conversão, PDF de mão de obra gerado. O texto do PDF foi conferido pelo teste das linhas, não aberto em um leitor de PDF nesta rodada.

## Rodada 5 (2026-11-04): correções na tela
Em Safras > Lançamentos, três seções novas: **Colheitas**, **Vendas** e **Atividades**, cada linha com "Corrigir".
- Colheita: nova quantidade e motivo obrigatório. A unidade não muda (para trocar, registra-se de novo).
- Venda: quantidade e/ou valor (campo vazio = não muda) e motivo obrigatório; recusa se nada mudou.
- Atividade: data e observação; atividade planejada ganha "já foi feita" para virar realizada (antes não havia como concluir uma tarefa planejada). Quem alterou fica gravado.
- Depois de corrigir, o app repete o aviso de coerência (venda acima da colheita, colheita acima da estimativa) se for o caso.
- O valor de antes e o de depois ficam no histórico de cada correção. Conferido no navegador: sem motivo recusa; correção de colheita (20 para 18) e de venda (R$ 4.000 para R$ 4.100) aplicadas e o aviso de estimativa apareceu. A tela de atividade não foi exercitada à mão (o código de domínio tem teste).

