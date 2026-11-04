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
