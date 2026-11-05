# ADR-014: Venda do AgroPulso por licença, com dados no aparelho (modelo A)

Estado: **DECIDIDA pelo dono (seção 12), implementação pendente**; nada foi programado. Data: 2026-11-05. Pedido do dono: vender no modelo A e definir como atualizar.
Relacionada: ADR-001 (app local), ADR-011 (PWA em hospedagem estática), DP-015 e DP-021, `docs/legal/TERMO_DE_USO_MINUTA.md`.

## 1. Em uma frase

O cliente paga, recebe uma **chave de licença assinada**, cola no app, e o app confere a assinatura **sem internet**. Os dados continuam só no aparelho. Não há conta, login nem servidor guardando dados do cliente.

## 2. Restrição que decide tudo: o código é público

Verificado em 2026-11-05 pela API do GitHub: o repositório `MayconMeneses/AgroPulso` é **público** e **sem arquivo de licença** (por padrão, todos os direitos reservados ao autor).

Consequência: qualquer pessoa pode ler o código, copiar o repositório e apagar a verificação de licença. Com o repositório público, a chave é uma **trava de cortesia**: segura quem compraria de qualquer jeito e quem não sabe programar, mas não segura quem sabe. O GitHub Pages gratuito exige repositório público, então trocar isso tem custo (item da fase de custos).

Opções, em ordem de proteção:

| Opção | Proteção | O que muda |
|---|---|---|
| **P1. Trava de cortesia (repo público)** | Baixa | Nada. Custo zero. Risco de cópia aceito. A proteção real vem de suporte, manual, atualizações e comodidade. |
| **P2. Repo privado + hospedagem que sirva a partir dele** | Média | O código-fonte deixa de ser lido. O JavaScript entregue ao navegador continua legível, só não organizado. Custa plano pago do GitHub ou outra hospedagem. |
| **P3. Conta e servidor (modelo B)** | Alta | Fora do escopo deste ADR. |

Recomendação: **começar em P1**, porque o público é pequeno, o preço é baixo e o ganho de P2 é pequeno diante do custo. Revisar se aparecerem cópias reais. Decisão do dono (seção 12).

Mesmo em P1, **o histórico antigo do repositório não é segredo**: nunca colocar chave privada, e-mails de clientes ou listas de licenças no repositório.

## 3. Formato da licença

Chave = texto único, copiável, no formato `AGP1.<payload>.<assinatura>` (base64url).

Payload (JSON mínimo, para a LGPD):

| Campo | Para quê |
|---|---|
| `v` | versão do formato (1) |
| `kid` | identificador da chave pública que assina (permite trocar de chave) |
| `id` | número da licença (aleatório, sem relação com o cliente) |
| `nome` | nome para mostrar em "Licenciado para" (o cliente pode pedir só o primeiro nome ou apelido) |
| `plano` | `anual`, `mensal` ou `interna` (permanente, só a do dono; não é vendida) |
| `emitida` | data de emissão |
| `valida_ate` | data de fim (ausente só na licença interna do dono) |
| `aparelhos` | limite combinado em contrato (informativo, ver seção 8) |

Sem CPF, sem telefone, sem endereço. O e-mail do cliente fica **só** no sistema de pagamento, não dentro da chave.

**Assinatura:** ECDSA P-256 com SHA-256, pela WebCrypto. Motivo: funciona em Safari, Chrome e Firefox sem ressalva. Ed25519 é mais novo no Safari e não dá para confirmar a versão do iPhone do dono daqui, então só vale a troca depois de checar. A chave pública (ou uma lista delas, por `kid`) vai dentro do app; a **privada nunca entra no repositório nem no app**.

A verificação roda em `src/domain/` (função pura, testável em Node com o mesmo WebCrypto), sem rede. Não muda a CSP (`connect-src` fica como está).

## 4. Emissão da chave

- **Fase 1 (sem servidor):** comando local `scripts/emitir-licenca.mjs`, rodado pelo dono no próprio computador. Lê a chave privada de um arquivo **fora do repositório** (caminho passado por parâmetro; `.gitignore` bloqueia `*.pem` e `licencas/`), assina e imprime a chave. O dono manda por e-mail ou WhatsApp. Serve para as primeiras vendas.
  **Fluxo definido pelo dono (2026-11-05):** na compra, o cliente informa o **WhatsApp**; o dono confere que o pagamento caiu e **envia a chave pelo WhatsApp**. Ajustes que isso exige:
  1. **Enviar por link:** além da chave, o comando imprime um link `https://agropulso.mmsystem.tech/#licenca=<chave>`. A chave tem cerca de 200 caracteres, então tocar no link é mais fácil do que copiar e colar. O app lê o fragmento, ativa e apaga o fragmento do endereço (seção 5).
  2. **Mensagem pronta** (modelo para colar no WhatsApp): saudação, o link, o que fazer se o link não abrir (copiar a chave e colar em Ativar), validade, e o aviso de que a chave é só dele.
  3. **Só emitir com o pagamento confirmado** (Pix cai na hora; cartão pode ser contestado depois, então não é a mesma coisa).
  4. **WhatsApp é dado pessoal (LGPD):** pedir só na compra, guardar fora do repositório (planilha do dono, com a data da emissão), usar só para enviar a chave e dar suporte, e dizer isso na política de privacidade do site de vendas. O número **não entra dentro da chave**.
  5. **Limite do método manual:** funciona bem para dezenas de vendas; o dono precisa estar disponível para responder. Quando pesar, passa para a fase 2.
- **Fase 2 (automático):** webhook do serviço de pagamento, função sem servidor que assina e envia o e-mail. A chave privada fica no cofre de segredos do serviço. GitHub Pages não executa servidor, então isto é item de custo.
- **Lista de licenças emitidas:** guardar fora do repositório (planilha do dono). A proteção de segredos do GitHub já está ligada, e o repositório é público.

## 5. O que o app faz com a chave

Telas novas (cada uma com texto simples, como o resto do app):
1. **Ativar**: campo para colar a chave, ou o link do e-mail com a chave em `#fragmento` (o fragmento não vai para servidores). O app guarda a chave e **apaga o fragmento do endereço**.
2. **Sobre a licença** (em Cadastros): nome, plano, validade, botão para renovar.
3. **Aviso de vencimento** na faixa do Painel, 30 dias antes.

Estados da licença:

| Estado | Quando | O app permite |
|---|---|---|
| **Teste** | primeiros 7 dias após a instalação | tudo |
| **Ativa** | chave válida e dentro da data | tudo |
| **Vencendo** | faltam até 30 dias | tudo, com aviso |
| **Vencida ou sem chave** | passou da data, ou o teste acabou | **somente leitura** (ver seção 6) |
| **Inválida** | assinatura não confere | como "sem chave", com mensagem clara |

Teste e relógio: o teste é contado no próprio aparelho, então dá para burlar. É aceito. Para reduzir a volta do relógio, o app guarda em `app_meta` **a maior data já vista** e usa a maior entre ela e a data do aparelho. É uma checagem fraca e será descrita assim no texto ao cliente.

## 6. Regra de ouro: nunca prender os dados do cliente

Licença vencida ou ausente coloca o app em **somente leitura**, e nunca bloqueia total:
- **Continua liberado:** ver painel, safras e lançamentos, gerar relatório (PDF e planilha), **baixar cópia de segurança**, restaurar cópia, ativar licença.
- **Bloqueado:** criar e alterar registros.

Motivos: integridade dos dados do cliente (prioridade 3 das regras de engenharia); o Código de Defesa do Consumidor não combina com reter dados que o cliente produziu; e **proteção contra um defeito nosso**: se uma versão futura errar a verificação, ninguém perde acesso aos próprios dados.

O somente leitura precisa de um **ponto único** no domínio (por exemplo, uma verificação antes de qualquer escrita), com teste que prova que nenhuma função de escrita escapa. Não pode ser só botões escondidos na tela.

A instalação do dono recebe uma **licença interna permanente**, emitida pelo mesmo comando, e o plano é conferido antes de qualquer lançamento (nada de exceção no código).

## 7. A licença viaja no backup?

Recomendação: **não**. A chave fica num armazenamento separado (`app_meta` com chave própria, fora da exportação). Motivo: compartilhar um backup com alguém não deve compartilhar a licença. Efeito colateral: ao trocar de celular, o cliente restaura os dados **e cola a chave de novo** (ela está no e-mail). O manual deve dizer isso. Decisão do dono (seção 12).

## 8. Pontos fracos, ditos com honestidade

- A chave **pode ser repassada**. Um app offline não conta aparelhos. Mitigação: mostrar "Licenciado para: <nome>" nas telas de relatório e de cópia; o termo de uso fixa o número de aparelhos (DP-021). O campo `aparelhos` é informativo.
- **Revogação:** sem servidor, não dá para derrubar uma chave específica. Se um dia for necessário, o app buscaria uma lista de revogação num endereço fixo. Isso exige liberar um domínio em `connect-src` da CSP e deixar a checagem "falhar aberta" (sem internet, continua valendo). Fica **fora da fase 1**.
- Quem remove a trava do código (seção 2) não é impedido.

## 9. Como atualizar (a segunda metade do pedido)

**Como funciona hoje:** todo envio para a `main` publica para todos, pelo mesmo endereço (`agropulso.mmsystem.tech`). Quem já instalou recebe o aviso "Atualizar agora". Isso é bom para correções, mas **não existe versão por cliente**: não dá para dizer "atualizações por 1 ano" e segurar a versão de quem não renovou. Em hospedagem única, quem tem o app sempre recebe a versão atual. A licença controla **o que o app deixa fazer**, não a versão.

Regras propostas:

1. **Atualização do app é para todos, sempre**, inclusive licença vencida, porque inclui correção de segurança. A licença vencida só afeta escrita.
2. **Versão e novidades:** número no app (`1.0.0`, em `Cadastros > Sobre`) e uma linha de novidades no aviso "Atualizar agora" ("O que mudou: …"). O texto vem de um arquivo `novidades.json` embarcado no build.
3. **Lançamento por etiqueta, não por empurrão na main:** o fluxo de publicação (`pages.yml`) passa a rodar ao criar uma etiqueta `vX.Y.Z` (e continua rodando testes, auditoria de dependências e build). `main` deixa de publicar sozinha.
4. **Canal de teste antes da produção:** publicar primeiro num endereço de teste (por exemplo `teste.agropulso...`). **Isso exige um registro novo no DNS**, e você mandou não mexer no DNS sem autorização. Alternativa sem DNS: testar o `dist/` localmente e no navegador do dono antes de criar a etiqueta. Decisão do dono.
5. **Migrações do banco continuam só para frente** e passam a ter teste obrigatório contra **bancos antigos de verdade** (arquivos de cada versão guardados como amostra, restaurados e migrados). Uma migração ruim num produto pago é o pior defeito possível, porque corrompe dado do cliente.
6. **Voltar atrás:** reverter a etiqueta publica a versão anterior. O app antigo não abre um banco com versão de esquema mais nova (já recusado hoje), então **não se desfaz uma migração**: por isso a regra 5 é rígida e o app recomenda cópia de segurança antes de uma atualização que migra.
7. **Renovação da licença:** o aviso de 30 dias leva ao link de renovação; a chave nova chega por e-mail; o cliente cola ou toca no link. Não precisa atualizar o app.
8. **Quando o formato da licença mudar** (nova chave pública, campo novo): o app aceita várias chaves públicas por `kid` por pelo menos duas versões, para a rotação nunca deixar um cliente sem acesso.

## 10. Alinhamento com o que já existe

- **Termo de uso (`TERMO_DE_USO_MINUTA.md`):** os campos `[PREENCHER]` de DP-021 (aparelhos por licença, validade técnica, preço, suporte) entram agora. O texto "não envia dados ao desenvolvedor" continua verdadeiro **enquanto** a emissão não guardar dados no app; o e-mail do cliente fica no serviço de pagamento, e a política de privacidade do site de vendas precisa dizer isso.
- **Política de privacidade e termos:** publicados e linkados no site de vendas e no app (regras 1 e 2 do checklist de sites).
- **Tempo e mapa:** o Open-Meteo gratuito e os mapas públicos do OpenStreetMap não são para uso comercial. Antes de vender, trocar de fornecedor ou assinar plano. **Isso muda a CSP** (`connect-src` e `img-src`) e o texto do app sobre privacidade.
- **Site de vendas:** página própria, seguindo as 20 regras do checklist. O site comercial do MM System só muda se o dono pedir.
- **Instalação do dono:** licença interna permanente (seção 6).

## 11. Plano de implementação em etapas (cada uma com teste)

1. **Verificador de licença** em `src/domain/license.ts` + testes: chave válida, adulterada, vencida, `kid` desconhecido, formato errado.
   **Etapa 1 feita em 2026-11-05** (`src/domain/license.ts`, `license-keys.ts`, `tests/license.test.ts`, 18 testes; suíte inteira 139 passando; build ok). Ainda **não está ligada ao app** e `license-keys.ts` está vazio: falta gerar o par de chaves reais (etapa 4).
2. **Estado e somente leitura:** guarda de escrita única + teste que percorre todas as funções de escrita exportadas.
   **Etapa 2 feita em 2026-11-05** (`src/domain/readonly-guard.ts`, `tests/readonly-guard.test.ts`, 12 testes; suíte 151 passando; build ok). A trava fica no banco (`Database`), não nas telas, e só deixa passar gravação em `app_meta`. **Ainda não está ligada ao app** (ligar agora travaria tudo após 7 dias, pois ainda não há tela de ativação nem chave real). Pontos a resolver ao ligar (etapa 3): (1) o app deve abrir o banco com `guardDatabase` e usar `unguarded(db)` só para restaurar cópia; (2) as duas rotinas de dados iniciais que rodam na abertura (`addCommonActivityTypes`, `addCommonCategoriesAndUnits`) precisam tolerar o erro `somente_leitura`; (3) `setOnlineFeatures` grava um evento de auditoria e por isso fica bloqueada quando travado; decidir se o botão "Desligar tempo e mapa" deve continuar liberado; (4) guardar a licença e a maior data vista fora das tabelas que entram na cópia de segurança (decisão 4).
3. **Telas:** Ativar, Sobre a licença, faixa de vencimento; teste visual no celular e no computador.
4. **Comando de emissão** `scripts/emitir-licenca.mjs` + par de chaves de teste fictício (nunca o real) + teste de ida e volta.
5. **Versão e novidades** no aviso de atualização; **fluxo por etiqueta**.
6. **Teste de migração contra bancos antigos.**
7. **Manual e termos atualizados** (inclui "como ativar", "troquei de celular").
8. Só então: fornecedores de tempo e mapa, site de vendas, pagamento (itens de custo).

Critério de pronto de cada etapa: testes passando e conferido no navegador. Nada disso foi feito ainda.

## 12. Decisões do dono (2026-11-05)

| # | Tema | Decisão |
|---|---|---|
| 1 | Repositório | **Público** (trava de cortesia, seção 2). Reavaliar se aparecerem cópias reais. |
| 2 | Planos e preços | **Anual R$ 200,00** e **mensal R$ 35,00** (informado pelo dono em 2026-11-05). Em 12 meses o mensal sai R$ 420,00, então o anual dá cerca de 52% de desconto. **Plano vitalício: fora da venda** (decisão do dono em 2026-11-05: "não é viável"). A licença permanente do próprio dono continua, como licença interna (seção 6). Ao vencer, somente leitura. |
| 3 | Aparelhos por licença | **3** (entra no termo de uso, DP-021, e no campo `aparelhos` da chave). |
| 4 | Licença no backup | **Não** (seção 7). |
| 5 | Teste grátis | **7 dias** (seção 5). |
| 6 | Canal de teste | **Autorizado** criar um registro novo no DNS para um subdomínio de teste. A autorização vale só para isso: antes de criar, mostro ao dono o registro exato (tipo, nome e valor), e quem entra na Hostinger é o próprio dono. Não vale para outros registros. |
| 7 | Nome no app | **O cliente escolhe** o nome que aparece em "Licenciado para". Pedir só um nome ou apelido, sem documentos. |

Consequências das decisões: com 3 aparelhos e licença fora do backup, o cliente cola a mesma chave em cada aparelho (o manual explica); o preço e a política de renovação do plano anual ficam para a fase de custos; o estado do ADR passa a **DECIDIDA pelo dono, implementação pendente**.

## 13. O que provavelmente custa dinheiro (sem preços)

Repositório privado ou outra hospedagem; função sem servidor e serviço de e-mail para a fase 2; serviço de pagamento (taxa por venda); fornecedor de tempo e mapa para uso comercial; MEI ou CNPJ e nota fiscal; domínio e subdomínio do site de vendas; registro do nome no INPI; (opcional) contador e advogado para revisar termos.

## 14. Plano mensal muda o desenho: a chave precisa se renovar sozinha

Com o plano mensal (R$ 35,00), mandar uma chave nova pelo WhatsApp todo mês não é viável. Desenho proposto:

- A chave de um plano **recorrente** vale pelo período pago **mais 7 dias de tolerância**.
- Quando o app está **com internet**, ele pede uma chave nova ao servidor de vendas (`POST /licenca/renovar`, enviando só o número da licença). O servidor responde com uma chave nova **se a assinatura estiver em dia**; se não estiver, recusa.
- Sem internet por mais que a tolerância, o app cai em **somente leitura** (seção 6). O cliente nunca perde os dados.
- Efeito colateral útil: o servidor passa a poder **recusar a renovação** de uma licença (revogação, seção 8) sem listas.
- Custo no app: liberar **um** endereço novo em `connect-src` da CSP (o do servidor de vendas), e dizer na política de privacidade que essa chamada existe e o que ela envia (número da licença e o endereço de rede de quem chama).
- A chave anual **não precisa** disso: continua valendo offline pela data da própria chave. A renovação online também pode ser usada por ela, como comodidade.

## 15. Backend de vendas (Mercado Pago + Telegram), baseado no site comercial

Referência lida em 2026-11-05 (somente leitura): projeto `SaaS Restaurante/Master` (site comercial do MM System). Nada foi copiado nem alterado lá. Padrões a reaproveitar, **reescritos** para o AgroPulso:

| Padrão do site comercial | Uso no AgroPulso |
|---|---|
| Checkout Pro do Mercado Pago por chamada direta de API (`/checkout/preferences`), sem SDK, com `external_reference` = número do pedido local, `notification_url` informada em cada cobrança e `back_urls` | Pagamento do plano anual (pagamento único, Pix e cartão) |
| Assinatura recorrente do Mercado Pago (`preapproval`) | Plano mensal. **Atenção:** assinatura recorrente aceita só cartão; Pix não renova sozinho. A confirmar na documentação do Mercado Pago antes de implementar |
| Webhook com **assinatura obrigatória** (HMAC SHA-256 do `x-signature`, comparação em tempo constante); sem o segredo configurado, recusa com 503 | Igual. Sem exceção |
| **Nunca confiar no corpo do aviso:** reconsultar o pagamento na API do Mercado Pago antes de aprovar | Igual |
| **Idempotência** por tabela de eventos, com chave que inclui o status; em falha, desfaz a marca e responde 500 para o Mercado Pago reenviar | Igual |
| Aviso ao dono pelo **Telegram** (Bot API `sendMessage`), enviado sem esperar (nunca trava o pagamento), com texto escapado, limite de alertas repetidos e link `wa.me` já pronto | Aviso de cadastro, pagamento aprovado, falha de webhook e renovação |
| Regra de auditoria do próprio site: **credenciais não vão para o Telegram** | Ver decisão abaixo |

Fluxo proposto:
1. Site de vendas: o cliente escolhe o plano e preenche **nome (o que aparecerá no app), WhatsApp e e-mail**.
2. O servidor grava o pedido como "pendente" e cria a cobrança no Mercado Pago.
3. O cliente paga. O Mercado Pago avisa o webhook; o servidor confere a assinatura, reconsulta o pagamento e, se aprovado, **emite a licença** (assinada com a chave privada que só existe no servidor).
4. O **bot do Telegram** avisa o dono: "Pagamento aprovado — plano, nome, WhatsApp, link `wa.me` com a mensagem pronta".
5. O dono toca no link, o WhatsApp abre com o texto pronto e **ele mesmo envia** (como já decidido). Envio automático pelo WhatsApp exige a API oficial (custo) e fica para depois.
6. O app, se o plano for recorrente, renova sozinho (seção 14).

Decisões novas que dependem do dono:
- **Chave no Telegram: DECIDIDO pelo dono (2026-11-05): só o link, sem a chave.** Como a chave não pode passar pelo Telegram, o desenho usa um **código de ativação de uso único**: o servidor gera um código curto (12 caracteres de um alfabeto sem letras confundíveis, por exemplo `AGP-7K3Q-9XMD`), válido por 7 dias e que só funciona uma vez. A mensagem do Telegram traz o link do WhatsApp do cliente com esse código (ou um link `.../#codigo=...`); o código sozinho não dá acesso a nada depois de usado. Quando o cliente digita o código (ou toca no link), o app o **troca por uma chave** junto ao servidor, **uma única vez, com internet**. Efeitos: o cliente digita 12 caracteres em vez de colar 200; a chave real nunca aparece em chat; é o "código de autorização" que o dono já tinha imaginado. Cuidados: limitar tentativas por endereço de rede (ex.: 10 por hora), comparar em tempo constante e não revelar se um código existe. A ativação precisa de internet uma vez; depois o app funciona sem rede (anual) ou renova sozinho (mensal, seção 14). Nas primeiras vendas, antes de existir servidor, vale o comando local `emitir-licenca` (seção 4).
- **Onde roda o servidor de vendas:** o dono já tem uma VPS com o site comercial. Proposta: **um serviço separado e pequeno** (contêiner e banco próprios, não dentro do Painel Master, para não misturar produtos nem dados). Nada é publicado na VPS sem pedido e autorização explícitos do dono.
- **Segredos** (token do Mercado Pago, segredo do webhook, chave privada de licença, token do bot, id do chat): só em variáveis de ambiente no servidor, nunca no repositório, nunca coladas na conversa. O dono cria o bot no @BotFather e a aplicação no painel de desenvolvedores do Mercado Pago; começamos em **modo de teste** (credenciais de teste do Mercado Pago).
- **LGPD:** o servidor passa a guardar nome, WhatsApp, e-mail, pagamento e licença. O termo de uso (premissa DP-015: "sem servidor do desenvolvedor") e a política de privacidade precisam de **nova versão antes da primeira venda**. O app em si continua sem enviar dados de uso; a exceção é a renovação (seção 14).
