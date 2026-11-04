# PRD — AgroPulso (hipóteses a validar)

Fonte: Prompt Mestre v1.0 (30/10/2026), citado como §n. Status: **proposta a validar**. Implementado até aqui (2026-11-03, código em `src/` e `web/`, 64 testes automáticos passando, app verificado só no Chromium do painel): fases 1 a 5 do roadmap em versão local e sem login (relatórios em `docs/reports/FASE-02` a `FASE-07`). **Não implementado:** multiusuário e papéis (RF-AG-001, RF-AG-014, ver ACCESS_MATRIX), alerta de colheita acima da estimativa (RN-AG-014), valor imputado de mão de obra familiar (RN-AG-020), consultor, estoque, mapas, clima. **Não verificado:** Android, iOS e Windows reais, checagem de tipos, piloto com produtores.
Nenhum número, recomendação agronômica, regra ambiental ou dado externo foi acrescentado além do que o Prompt Mestre traz.

## 1. Problema e público (§1)
O produtor precisa responder: o que plantei, onde, quando, quanto custou, quanto colhi, por quanto vendi e qual resultado posso comprovar.
Público inicial: pequeno produtor de lavouras. Pecuária, cooperativas, assistência técnica, IoT e exportação fiscal são expansões condicionais.
Fora do papel do sistema: substituir técnico agrônomo, receituário, análise de solo, laudo meteorológico, CAR/SICAR ou decisão profissional de manejo.
Os dados do Censo Agro 2017 (§1, [AG01]) contextualizam o público; não provam demanda pagante e não entram em projeção de clientes ou receita.

## 1.1 Foco regional (pedido do dono, 2026-11-03)
O projeto não tem foco regional: serve a produtores de todo o Brasil. O núcleo é genérico e configurável para qualquer área da agricultura (DP-018).
Tudo abaixo é **hipótese a validar em entrevistas**, não fato levantado:
- conectividade mais irregular no campo: reforça rascunhos locais e a fila offline da V2;
- unidades locais de medida de área e de venda diferentes das do Sul/Sudeste (ex.: tarefa): exigir unidade cadastrável com fator informado, sem fator padrão;
- água e irrigação como assunto frequente: manter "irrigação anotada" (§9) como tipo de atividade; custo de água como categoria configurável, sem regra codificada;
- culturas de subsistência e comerciais variadas: o catálogo é do tenant, sem lista fixa (o §4 cita milho, feijão e mandioca só como exemplo);
- vários estados e fusos: fuso por propriedade (RN-AG-022).
Não há dados regionais, estatísticas nem recomendações agronômicas neste documento. Fontes oficiais regionais ainda não foram pesquisadas (benchmark NOT_RUN).

## 2. Posicionamento (hipótese, §1)
"Caderno de Campo Inteligente" com visão por safra e talhão, financeiro entendível e operação prática no celular, explicando cada cálculo, sem IA generativa.
É diferencial testável, não alegação de exclusividade.

## 3. Personas (§4)
| Persona | Pode | Observação |
|---|---|---|
| Produtor/proprietário | Despesas, safras, resultados, exportação | |
| Funcionário autorizado | Atividades, fotos, quantidades, colheitas | Sem acesso irrestrito ao financeiro |
| Consultor convidado | Acesso temporário e delimitado | **V2**, com revogação |
| Master da plataforma | Planos e operação técnica | Sem navegação silenciosa pelos dados rurais |

## 4. Jornadas (§4)
- J1: propriedade → talhão opcional → safra → compra e aplicação como eventos separados → atividade e mão de obra → colheita parcial → venda parcial → resultado por safra → relatório.
- J2: produtor sem mapa cadastra safra direto na propriedade; atribui área depois sem perder registros.
- J3: talhões sobrepostos no tempo com ciclos diferentes; verificar regras de simultaneidade em vez de bloquear.

## 5. Escopo (§2)
- **MVP:** empresas/usuários/permissões; propriedades; talhões opcionais com delimitação simples; safras; cultura/ciclo; atividades de campo; despesas e entradas de caixa básicas; colheita; venda; vínculo com safra e área; painel; relatório PDF/CSV; PWA instalável com operação online e rascunhos locais controlados (se validados); anexos seguros; trilha de alterações; backups, auditoria e isolamento multiempresa.
- **V2 (só após validação):** estoque de insumos, compra planejada, rateio detalhado, clima/ZARC, calendário avançado, offline com sincronização, importação KML/KMZ/GeoJSON, relatórios comparativos, consultor, serviços geoespaciais licenciados.
- **V3 (só com necessidade comprovada):** pecuária, cooperativas, rastreabilidade avançada, IoT, satélite, alertas preditivos, recomendação assistida, API de terceiros, integrações contábeis/fiscais, financiamento, certificação.
- **Fora do MVP:** apps nativos, portal público de compradores (§12). Mapa, IoT, predição e clima não entram no aceite do MVP (§28).

## 6. Requisitos funcionais (RF-AG)
| ID | Requisito | Fonte |
|---|---|---|
| RF-AG-001 | Isolar dados por empresa (tenant) em banco, API e arquivos | §2, §18 |
| RF-AG-002 | Cadastrar propriedade sem exigir mapa | §10, §28 |
| RF-AG-003 | Criar mais de uma safra por propriedade/área com histórico independente | §28 |
| RF-AG-004 | Registrar atividade de campo em poucos toques (safra → tipo → dado mínimo → salvar) | §9 |
| RF-AG-005 | Registrar despesa com valor exato, data, categoria, fonte, beneficiário e vínculo opcional a safra/área | §7 |
| RF-AG-006 | Registrar colheita parcial, com unidade física obrigatória | §6, §17 |
| RF-AG-007 | Registrar venda parcial em datas diferentes; recebimento é conceito distinto | §5, §17 |
| RF-AG-008 | Despesa compartilhada entra como custo não alocado ou com critério explícito | §7 |
| RF-AG-009 | Anexos privados (fotos/documentos) vinculados a registros | §2, §19 |
| RF-AG-010 | Histórico de edição em registros realizados | §9 |
| RF-AG-011 | Painel com safras ativas, pendências, custo registrado, vendas, colheita declarada, evolução por período | §12 |
| RF-AG-012 | Relatórios PDF (texto selecionável) e CSV com filtros, unidades e proveniência | §20 |
| RF-AG-013 | Cultura como dado configurável, não regra codificada | §4, §8 |
| RF-AG-014 | Permissões finas: funcionário registra tarefa sem ver receita | §18 |
| RF-AG-015 | PWA instalável, informa falta de rede | §14, §28 |
| RF-AG-016 | Usuário alterna entre tema escuro, claro e automático | pedido do dono, 2026-11-03; ver DIRECAO_VISUAL.md |

## 7. Regras de negócio (RN-AG)
| ID | Regra | Fonte |
|---|---|---|
| RN-AG-001 | Distinguir sempre: planejado × realizado; custo × pagamento; estimada × colhida; venda × recebimento; área declarada × medida; previsão × observação; fonte oficial × manual | §5 |
| RN-AG-002 | Estados da safra RASCUNHO→PLANEJADA→EM_ANDAMENTO→CONCLUIDA; CANCELADA só com motivo autorizado | §6 |
| RN-AG-003 | Safra cancelada ou concluída preserva histórico; ajuste só com evento e justificativa | §6, §24 |
| RN-AG-004 | Colheita parcial e venda em datas diferentes nunca são bloqueadas | §6 |
| RN-AG-005 | Concluir safra com perda total admite motivo de perda; não inventar rendimento zero sem apuração (revisar se CONCLUIDA exige colheita) | §6 |
| RN-AG-006 | Mesma ação reenviada não duplica colheita, custo ou venda (idempotência) | §6, §17 |
| RN-AG-007 | Edição concorrente: controle de versão e conflito legível | §6, §17 |
| RN-AG-008 | Receita de vendas = soma das vendas registradas, não necessariamente recebimento | §7 |
| RN-AG-009 | Resultado parcial acompanha custos não alocados; não chamar de lucro/margem líquida sem todos os custos | §7, §13 |
| RN-AG-010 | Produtividade = colhido / área de referência, só se ambos válidos; sem área confiável, omitir e informar o motivo | §7, §20 |
| RN-AG-011 | Não somar kg com sacas sem fator por produto/cultura; conversão com fator e origem explícitos; "saca" e "caixa" sem conversão global | §7, §8 |
| RN-AG-012 | Estoque colhido não é caixa recebido | §7 |
| RN-AG-013 | Nunca corrigir silenciosamente número, separador decimal ou unidade digitados | §13 |
| RN-AG-014 | Colheita maior que a estimada: apenas alerta, nunca bloqueio | §23 |
| RN-AG-015 | Área medida não substitui área declarada; exibir as duas e a divergência | §10, §24 |
| RN-AG-016 | Latitude/longitude trocadas nunca são aceitas silenciosamente | §24 |
| RN-AG-017 | Aplicação de produto registrada é informação declarada, com aviso de que não substitui receituário e registros obrigatórios; o sistema não prescreve | §9 |
| RN-AG-018 | Falha de fonte externa não impede registrar custo, safra ou colheita | §11 |
| RN-AG-019 | Culturas, tipos de atividade, categorias de custo e unidades locais são dados configuráveis por tenant; ciclos de culturas perenes admitem várias colheitas | DP-001, DP-018 |
| RN-AG-020 | Mão de obra familiar fica em linha separada, fora do custo registrado; valor imputado é opção por tenant, desligada por padrão | DP-007 |
| RN-AG-021 | Concluir safra exige colheita registrada ou motivo explícito; nunca rendimento zero automático | DP-008 |
| RN-AG-022 | Moeda BRL, pt-BR, vírgula decimal; fuso guardado por propriedade, persistência em UTC | DP-017 |

## 8. Requisitos não funcionais (RNF-AG)
| ID | Requisito | Fonte |
|---|---|---|
| RNF-AG-001 | Valores monetários em centavos ou decimal preciso; datas em UTC na persistência com exibição no fuso local | §8 |
| RNF-AG-002 | Interface pt-BR; WCAG 2.2 AA; ações grandes e contraste alto; baixo consumo de dados | §12, §13 |
| RNF-AG-003 | Linguagem simples ("custo registrado", "resultado parcial"); fórmulas explicadas e números rastreáveis à origem | §13 |
| RNF-AG-004 | Medir (não prometer): tempo de abrir safra, lançar atividade, concluir venda, gerar relatório, tamanho da PWA | §23 |
| RNF-AG-005 | Sem God Files/Components; revisar arquivos acima de ~300 linhas, sem corte mecânico | §16 |
| RNF-AG-006 | Backup e restauração por tenant testados; RPO/RTO definidos antes de dados reais | §22 |
| RNF-AG-007 | Cache não indiscriminado de dados pessoais/financeiros privados | §14 |
| RNF-AG-008 | Documentação descreve apenas o que existe | §28 |

## 9. Segurança
Ver [THREAT_MODEL.md](../security/THREAT_MODEL.md) (SEC-AG) e [ACCESS_MATRIX.md](../security/ACCESS_MATRIX.md).

## 10. Critérios de aceite do piloto (CT-AG, §28)
Cada item só vira PASS com evidência reproduzível. Estado atual: **NOT_RUN**, exceto o que os testes automáticos de `tests/domain.test.ts` e `tests/backup.test.ts` cobrem em parte (CT-AG-002 e CT-AG-003 no nível do código, sem interface; CT-AG-013 só como exportar/importar de teste). Nenhum vira PASS sem a evidência completa do critério.
| ID | Critério |
|---|---|
| CT-AG-001 | Duas empresas isoladas no banco, na API e nos arquivos |
| CT-AG-002 | Produtor registra propriedade sem desenhar mapa |
| CT-AG-003 | Cria duas safras e consulta histórico independente |
| CT-AG-004 | Lança custo e atividade com autor e data |
| CT-AG-005 | Registra colheita parcial e venda parcial sem duplicidade |
| CT-AG-006 | Valor financeiro e unidade têm precisão |
| CT-AG-007 | Cálculo exibe fonte e casos excluídos |
| CT-AG-008 | Safra sem dados não apresenta resultado inventado |
| CT-AG-009 | Anexos privados não são compartilhados entre tenants |
| CT-AG-010 | Colaborador não consulta dados financeiros sem permissão |
| CT-AG-011 | PWA funciona nos navegadores-alvo e informa falta de rede |
| CT-AG-012 | PDF/CSV preservam filtros, unidades e proveniência |
| CT-AG-013 | Backup restaurado e verificado |
| CT-AG-014 | Todos os testes críticos executados aprovados |
| CT-AG-015 | Sem vulnerabilidade crítica/alta explorável sem tratamento |
| CT-AG-016 | Sem novos God Files |
| CT-AG-017 | Documentação descreve o que foi realmente implementado |

## 11. Casos de teste obrigatórios (§24)
Alterar custo entre empresas é negado; safra cancelada retém histórico; colheita com mesma idempotency_key registra uma vez; lucro não trata despesa desconhecida como zero; produtividade sem área é indisponível; venda sem recebimento não aparece como caixa recebido; login revogado não sincroniza; mapa não aceita lat/lon trocadas silenciosamente; área medida não substitui declarada; PDF reproduz os filtros.

## 12. Não objetivos
IA obrigatória, previsão climática inventada, compliance automático, ERP agrícola completo (§Entrega final, §Princípio).

## 13. Ambiguidades e premissas
Ver [DECISOES_PENDENTES.md](DECISOES_PENDENTES.md). Em especial: culturas, unidades comerciais, mão de obra familiar, necessidade real de georreferenciamento e rascunhos locais no MVP.
