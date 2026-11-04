# FASE-06 — Segurança e homologação

Data: 2026-11-03. Status: **EXECUTADA PARA O QUE SE PODE TESTAR SOZINHO; piloto fechado e testes em aparelho real: NOT_RUN.** Sem commit.

## Resultado dos testes automáticos
`npm test` (Node 24.20): **66 testes, 66 passam.** Por arquivo: activities 7, backup 8, bundle 2, domain 12, migrations 5, production 13, reports 6, security 6, structure 1, units 6. Checagem de tipos: **NOT_RUN** (sem compilador TypeScript instalado). `npm audit`: 0 vulnerabilidades conhecidas (o único pacote é o sql.js 1.15.2, licença MIT).

## Revisão de segurança (CONFIRMED = coberto por teste que passou)
| Controle | Estado |
|---|---|
| Injeção de SQL | CONFIRMED: todos os valores vão por parâmetro; texto como `x'); drop table farm; --` é gravado como texto (`security.test.ts`). Nomes de tabela e coluna de backup nunca vêm do arquivo (comparados com o banco) |
| Backup forjado | CONFIRMED: `__proto__`, tabela extra com SQL, tipos perigosos e registro órfão são recusados e não poluem `Object.prototype`. **Limite:** o hash SHA-256 detecta dano acidental, não forja: quem recalcula o hash gera arquivo válido. Restaurar substitui tudo, por isso a tela exige confirmação |
| XSS | CONFIRMED por teste que varre `src` e `web` sem `innerHTML`, `eval`, `document.write`; todo texto entra por `textContent` |
| Política de conteúdo (CSP) | CONFIRMED por teste e por uso no navegador: `default-src 'self'`, sem scripts de terceiros, sem `unsafe-inline` e `unsafe-eval`; só `wasm-unsafe-eval`, necessário para o SQLite em WebAssembly. Em `<meta>`: sem o cabeçalho HTTP, `frame-ancestors` não vale (POSSIBLE risco de embutir a página em outra; depende da hospedagem) |
| Injeção de fórmula em planilha | CONFIRMED: células que começam com `= + - @` ganham apóstrofo no CSV |
| Anexos | CONFIRMED: tipo pelo conteúdo, limite de 5 MB, nome sem caminho. Sem varredura de vírus |
| Dados no cache | O service worker só guarda arquivos do app (CONFIRMED por leitura do código e do cache no navegador); dados ficam no IndexedDB |
| Segredos | Nenhum segredo, chave ou conta no código; sem backend, sem login, sem rede de dados |
| Perda de dados | Uma aba por vez (travada); gravação por transação; backup e restauração testados. **Risco aberto:** o navegador pode apagar o IndexedDB (persistência recusada no painel) |
| Dependências | Só sql.js fixo em 1.15.2; sem scripts de instalação. Origem do pacote: registro npm oficial; integridade conferida pelo `package-lock.json` |

## Critérios do piloto (CT-AG, §28)
| ID | Estado | Evidência |
|---|---|---|
| 001 isolamento entre empresas | N/A na V1 | perfil único (ADR-001/005) |
| 002 propriedade sem mapa | PASS | `domain.test.ts`; interface no Chromium |
| 003 duas safras com histórico independente | PASS | `domain.test.ts` |
| 004 custo e atividade com autor e data | PASS | `production.test.ts`, `activities.test.ts` |
| 005 colheita e venda parcial sem duplicidade | PASS | chave de idempotência testada nas três |
| 006 valor e unidade com precisão | PASS | inteiros em centavos e milionésimos; `units.test.ts` |
| 007 cálculo mostra fonte e exclusões | PASS | avisos e "fora desta conta" no painel e no relatório |
| 008 safra sem dados sem resultado inventado | PASS | `production.test.ts` |
| 009 anexos entre empresas | N/A na V1 | |
| 010 colaborador sem ver finanças | N/A na V1 | perfil único |
| 011 PWA nos navegadores-alvo | PARCIAL | só motor Chromium (painel e Chrome emulando 8 aparelhos); Safari do iPhone, Chrome Android real e Edge Windows reais: NOT_RUN |
| 012 PDF/CSV com filtros, unidades e proveniência | PASS | `reports.test.ts`; PDF lido por `pdftotext` |
| 013 backup restaurado e verificado | PASS | testes e Chromium; RPO/RTO (DP-009) sem definição |
| 014 testes críticos aprovados | PARCIAL | 64 automáticos passam; os de aparelho real não rodaram |
| 015 sem vulnerabilidade crítica ou alta explorável | PARCIAL | nenhuma conhecida; sem teste de invasão nem auditoria externa |
| 016 sem God Files | PASS | `structure.test.ts`: nenhum arquivo acima de 300 linhas |
| 017 documentação fiel ao implementado | PARCIAL | PRD, DATA_MODEL, DECISIONS e relatórios atualizados nesta rodada; sem revisão por outra pessoa |

## As 20 regras de site do dono (aplicadas à página do app; só uma página)
| # | Regra | Estado | Evidência ou motivo |
|---|---|---|---|
| 1 | Política de privacidade | NOT_RUN | não publicada; depende da DP-013 e de revisão jurídica |
| 2 | Termos | BLOCKED | minuta em `docs/legal`; campos comerciais ficam para o fim (DP-021) |
| 3 | CTA limpa | PARCIAL | cada formulário tem um botão principal; não foi medido com usuário |
| 4 | FAQ | NOT_RUN | não há objeções de compra levantadas; não foi inventada |
| 5 | robots.txt | NOT_RUN | depende do endereço da hospedagem |
| 6 | sitemap.xml | NOT_RUN | idem |
| 7 | 404 personalizado | NOT_RUN | depende da hospedagem estática escolhida |
| 8 | Texto alternativo | PASS | sem imagens de conteúdo; ícone com rótulo |
| 9 | Analytics | N/A por decisão | o app não mede nem envia nada; sem rastreamento |
| 10 | Meta título | PASS | um título curto e único (28 caracteres; o alvo de ~60 vale para várias páginas) |
| 11 | Meta descrição | PASS | uma descrição (101 caracteres) |
| 12 | Open Graph e Twitter Card | NOT_RUN | sem imagem 1200×630 |
| 13 | Favicon | PARCIAL | só SVG; faltam PNG e ícone de iPhone |
| 14 | Canonical | BLOCKED | precisa do endereço final |
| 15 | Consentimento de cookies | N/A | sem cookies; só `localStorage` para o tema (conveniência) e IndexedDB para os dados |
| 16 | Mobile 320–1920 px | PASS na emulação do Chrome | 320, 360, 375, 390, 412, 667 (deitado), 768, 1366 e 1920 px sem rolagem horizontal e com alvos de toque de 44 px ou mais; Safari e Android reais: NOT_RUN |
| 17 | Acessibilidade | PARCIAL | contraste medido, rótulos e Lighthouse 100; teclado e foco não testados à mão |
| 18 | Formulários testados | PASS no Chromium | caminho feliz e erros pela interface; recebimento visível no painel |
| 19 | Links quebrados | PASS | a página não tem links internos nem externos além dos arquivos próprios |
| 20 | Desempenho | PARCIAL | LCP 601 ms e CLS 0 em localhost sem limitação. Emulando 3G lento e CPU 4× mais lenta, a primeira visita a frio levou 26 s (863 KB em 6 arquivos, depois de juntar os módulos; eram 35 s com 36 arquivos); depois vem do cache. Aparelho real: NOT_RUN |

## O que NÃO foi feito
Teste em aparelho real (Android, iOS, Windows); teste de invasão; piloto fechado com produtor; revisão por advogado; restauração com volume real de dados; medição de tamanho do banco com muitas fotos.
