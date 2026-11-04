# Auditoria de segurança e qualidade

Data: 2026-11-04. Escopo: todo o código (src, web, scripts, tests), o site publicado em https://agropulso.mmsystem.tech, o repositório no GitHub e a ligação do domínio. Método: leitura do código parte por parte, ataques simulados, testes automáticos e conferência no navegador. Resultado dos testes ao final: 115 passam, 0 falham.

Legenda: CONFIRMADO = reproduzido ou provado por teste; POTENCIAL = risco que depende de uma condição; RECOMENDAÇÃO = melhoria sem falha.

## O que foi atacado e o que aconteceu

| Ataque tentado | Resultado |
|---|---|
| Texto malicioso (`<img onerror>`, `<svg onload>`, `<script>`, fórmula `=cmd`) digitado em propriedade, cultura, categoria, tipo de atividade, unidade e pessoa, e as seis telas abertas | Nada executou. O texto aparece como texto. Nenhum `<img>` ou `<script>` foi criado |
| Injeção de SQL | Não há SQL montado com texto do usuário (busca por consultas com `${}`: só nomes fixos de tabela). Tudo vai por parâmetros |
| Backup forjado com o hash recalculado (quem sabe o formato consegue) | O hash só detecta dano, não autentica. Por isso o backup com senha existe agora; o importador também recusa o que for estranho (ver F-04) |
| Backup protegido adulterado (um byte, IV, sal, número de iterações, algoritmo) | Todos recusados, sem vazar nada |
| Backup com número de iterações absurdo para travar o aparelho | Recusado (limite de 200 mil a 5 milhões) |
| Arquivo de backup gigante | Recusado antes de abrir (teto de 120 milhões de caracteres) |
| Abrir o app dentro de outro site (clickjacking) | Mitigado por script (F-09); a defesa por cabeçalho não existe nesta hospedagem |
| Ler o tráfego de rede do app em todas as telas | Só o próprio site, a previsão (api.open-meteo.com) e os quadros do mapa (tile.openstreetmap.org). Nenhum envio de dado do caderno. Com "Desligar tempo e mapa", zero pedidos externos |
| Caminho `../` e endereço com `%` quebrado no servidor de teste | 404 e 400; o servidor continua de pé (antes caía) |
| Segredos no histórico do Git | Nenhum encontrado (chaves, tokens, senhas, chaves privadas) |
| Dependências | 1 pacote (sql.js 1.15.2, versão fixa, integridade no lockfile); `npm audit`: 0 vulnerabilidades |

## Achados

| Id | Tipo | Gravidade | O que era | Situação |
|---|---|---|---|---|
| F-01 | CONFIRMADO | alta | Backup feito antes de uma atualização não restaurava mais (o app exigia a mesma versão do esquema, e o app se atualiza sozinho) | Corrigido: aceita versões anteriores e recusa as mais novas. Testes AUD-01 e AUD-02 |
| F-02 | CONFIRMADO | alta | Uma gravação que falhava (disco cheio) deixava todas as seguintes falharem até recarregar; a tela mostrava o dado, que sumia ao reabrir | Corrigido: a fila tenta de novo e a falha vira mensagem clara. Teste AUD-05, com mutação (sem a correção o teste cai) |
| F-03 | CONFIRMADO | média | Um contorno de talhão inválido (backup mexido) quebrava Painel e Cadastros | Corrigido: lido com validação, vale como "sem contorno". AUD-04 |
| F-04 | CONFIRMADO | média | A importação aceitava anexo com tipo falso (ex.: SVG) e tamanho que não conferia, base64 quebrado (erro genérico) e coluna `__proto__` | Corrigido. AUD-03 |
| F-05 | CONFIRMADO | média | Data impossível (mês 13, dia 40) causava erro interno em vez de mensagem | Corrigido em `guards.ts` e `cycles.ts` |
| F-06 | CONFIRMADO | média | O trabalho de CI que roda o código do projeto tinha permissão de escrita no Pages; ações presas só por tag | Corrigido: permissões vazias por padrão, escrita só no job de publicar, ações presas por SHA, `npm ci --ignore-scripts`, `npm audit`, e a exigência de SHA ligada nas configurações do repositório. Teste HARD |
| F-07 | CONFIRMADO | baixa | Servidor de teste caía com `%` quebrado e aceitava pasta vizinha (`dist2`) | Corrigido |
| F-08 | CONFIRMADO | média | A política de conteúdo deixava `data:` e `blob:` em imagens e não usava Trusted Types | Fechada. O Trusted Types bloqueou o registro do service worker no primeiro teste e foi resolvido com uma política que só aceita `sw.js` |
| F-09 | CONFIRMADO | média | Sem proteção contra ser aberto em moldura: a hospedagem não envia `X-Frame-Options` e `frame-ancestors` não funciona em `<meta>` | Mitigado: `guard.js` esconde a página e só a libera se estiver no topo. Teste unitário da lógica passa. O teste em moldura real no navegador foi inconclusivo (a moldura nem carregou), então a prova é a do teste unitário |
| F-10 | POTENCIAL | média | O site não envia HSTS (o GitHub Pages não envia no domínio próprio). A primeira visita por `http://` pode ser interceptada em Wi-Fi hostil antes do redirecionamento | Aberto. Mitiga: o app instalado sempre abre por https. Resolver de verdade pede uma hospedagem que permita cabeçalhos (ou um proxy na frente) |
| F-11 | CONFIRMADO | baixa | A previsão do tempo enviava o local com 4 casas (cerca de 11 m) | Agora 2 casas (cerca de 1 km). Chave "Desligar tempo e mapa" |
| F-12 | POTENCIAL | média | O banco no aparelho não é cifrado | Decisão: não cifrar o banco. A chave ficaria na mesma origem e qualquer falha de XSS a usaria sem extrair; o iPhone já cifra o disco; e a cifra aumentaria o risco de perder tudo. Recomendação: bloqueio de tela. O backup, que viaja por WhatsApp e e-mail, ganhou senha opcional |
| F-13 | CONFIRMADO | baixa | Total de fotos sem limite (o banco inteiro mora na memória e é regravado a cada mudança) | Teto de 120 MB. Medido: 52 MB regravam em 52 ms no computador |
| F-14 | CONFIRMADO | baixa | Código morto: `getFarm`, regra `.pulse-line` e animação `travel` sem uso | Removidos |
| F-15 | CONFIRMADO | média (função) | Era possível enviar foto e nunca mais abri-la; correções de colheita, venda e atividade existem no código e não têm tela | Anexo agora tem "Baixar". As correções de colheita e venda seguem sem tela (RECOMENDAÇÃO) |
| F-16 | CONFIRMADO | baixa | `correctEntry` aceitava mexer em despesa que veio de um dia de trabalho | Recusa, como a anulação |
| F-17 | CONFIRMADO | média | O histórico público do Git mostra o e-mail pessoal do dono em todos os commits e 16 linhas de coautoria automática | Corrigido em 2026-11-04: histórico reescrito com autor único (e-mail privado do GitHub) e sem linhas de coautoria, mesmo conteúdo de arquivos, cópia do histórico antigo guardada fora do repositório. O GitHub ainda guarda cópias dos pedidos de atualização antigos por um tempo |
| F-18 | CONFIRMADO | baixa | `.claude/launch.json` estava versionado | Saiu do repositório e entrou no `.gitignore` |
| F-19 | CONFIRMADO | baixa | Descrição do repositório desatualizada ("sem código", "foco no Nordeste") | Atualizada, com site e tópicos |
| F-20 | POTENCIAL | média | Domínio apontado para o GitHub Pages sem verificação: se o Pages for desligado, outra conta poderia reivindicar o endereço (sequestro de subdomínio) | Parcial. O registro TXT de verificação precisa ser criado no Hostinger e não foi, porque a criação foi bloqueada e depende de nova autorização do dono |
| F-21 | CONFIRMADO | informativo | A orientação anterior sobre o iPhone apagar dados em 7 dias vale para o Safari, não para app na tela inicial (tem contador próprio, segundo a Apple) | Corrigida aqui. A cópia de segurança continua valendo |

## Proteções ligadas no GitHub (conferidas na tela)

Alertas do Dependabot, atualizações de segurança do Dependabot, gráfico de dependências, relato privado de vulnerabilidades, proteção contra envio de segredos (já estava ligada), exigência de SHA nas ações, permissão padrão do fluxo de trabalho somente leitura (já estava), análise CodeQL semanal e a cada envio. O CodeQL e a publicação passaram na primeira execução com o fluxo novo.

## Fora do alcance desta rodada (precisa do dono)

- Autenticação em dois fatores no GitHub e no Hostinger: só o dono pode ligar.
- Registro TXT de verificação do domínio (F-20).
- Feito depois: histórico reescrito (F-17) e `main` protegida contra envio forçado e exclusão (regra ativa, conferida pela API do GitHub: `non_fast_forward` e `deletion`).
- Registro CAA: não aplicado. No apex ele valeria também para o site comercial, que não deve ser tocado sem pedido, e no subdomínio `agropulso` não pode coexistir com o CNAME.
- As ramificações do Dependabot foram removidas na limpeza do histórico; ele reabre as atualizações na próxima semana, e os saltos de versão principal (setup-node 7, codeql-action 4) precisam ser avaliados antes de aceitar.

## Portões

| Portão | Estado |
|---|---|
| Testes automáticos (115) | PASS |
| `npm audit` | PASS (0) |
| XSS pelas telas | PASS |
| Backup antigo restaura | PASS |
| Backup protegido: cifra, senha errada, adulteração | PASS |
| Importação recusa arquivo malicioso | PASS |
| Saída de dados pela rede | PASS (3 destinos, todos explicados; desligáveis) |
| Clickjacking em moldura real | NOT_RUN (só a lógica foi testada) |
| HSTS | FAIL (a hospedagem não permite) |
| Verificação de domínio | BLOCKED (aguarda autorização do dono) |
| `main` protegida contra envio forçado e exclusão | PASS |
| Histórico sem e-mail pessoal e sem coautoria automática | PASS |
| Teste em iPhone e Android reais após esta rodada | NOT_RUN |

## Lista das 20 regras de site (o app é uso próprio)

1 Política de privacidade: não feita (uso próprio; precisa existir antes de abrir a outras pessoas). 2 Termos: idem. 3 Chamada principal: OK nas telas. 4 Perguntas frequentes: não se aplica. 5 `robots.txt`: OK, bloqueia tudo de propósito. 6 `sitemap.xml`: não se aplica (site não indexado). 7 404 própria: OK, com status 404 verificado. 8 Texto alternativo: OK nos ícones e na logo. 9 Análise de visitas: não se aplica, e não há rastreio. 10 e 11 Título e descrição: OK, únicos (é uma página só). 12 Cartão social: não se aplica. 13 Ícones: OK, vários tamanhos. 14 URL canônica: não se aplica (uma página). 15 Consentimento de cookies: não há cookies. 16 Celular de 320 px a 1920 px: OK (rodadas anteriores). 17 Acessibilidade: Lighthouse 100 nas rodadas anteriores. 18 Formulários testados: OK. 19 Links quebrados: nenhum encontrado. 20 Desempenho: carga de 190 KB de código mais 685 KB do banco; medido em rodadas anteriores.
A marca `noindex` faz o item de buscadores do Lighthouse cair de propósito: o app é pessoal e não deve aparecer no Google.

## Fontes consultadas

- OWASP, Password Storage Cheat Sheet (lida na íntegra): PBKDF2-HMAC-SHA256 com 600.000 iterações; Argon2id é a primeira escolha, mas o navegador não o traz.
- OWASP, Web Security Testing Guide, teste de armazenamento do navegador: dado sensível em IndexedDB e chaves extraíveis.
- web.dev, Trusted Types: suporte no Chrome, Edge, Firefox 148 e Safari 26; política como ponte.
- WHATWG e MDN sobre CSP em `<meta>`: `frame-ancestors`, `report-uri` e `sandbox` são ignorados.
- GitHub Docs, verificação de domínio personalizado do Pages: proteção contra sequestro de subdomínio.
- GitHub Docs e StepSecurity, endurecimento do GitHub Actions: SHA completo e permissões mínimas.
- GitHub Docs, Secret scanning, Dependabot e relato privado de vulnerabilidades.
- Let's Encrypt e discussões do GitHub: registro CAA e o certificado do Pages.
- WebKit e Apple (John Wilander): limite de 7 dias do armazenamento e a exceção do app na tela inicial.
- ANPD, guia de segurança da informação para agentes de tratamento de pequeno porte (2021): medidas de segurança do art. 46 da LGPD.
- Pesquisa por avisos de segurança do sql.js: nenhum aviso específico encontrado; só avisos do SQLite em geral, a conferir a cada atualização.
- Documentação do Web Crypto (AES-GCM): IV único por cifragem e chave não extraível.
