# Decisões de arquitetura (ADR) — propostas

A stack do §15 é **sugerida**. Cada entrada abaixo é proposta com premissa explícita (§30), reversível até a Fase 1. Nenhuma foi implementada.
Regra geral (§30): para decisão técnica reversível, usar a alternativa menos complexa e registrar a premissa.

| ID | Proposta | Premissa | Alternativa mais simples considerada | Fonte | Estado |
|---|---|---|---|---|---|
| ADR-001 | Aplicativo local de perfil único: um aparelho, um usuário, sem servidor na V1. Domínio isolado de armazenamento e interface, para poder migrar a servidor se surgirem clientes | DP-015: dono não hospeda; hospedagem só com clientes | Já é a mais simples | §15, DP-015 | PROPOSTA (reescrita 2026-11-03; substitui "monólito multi-tenant") |
| ADR-002 | React + TypeScript + Vite no front | Padrão sugerido; confirmar com o dono | — | §15 | PROPOSTA |
| ADR-003 | Sem API REST na V1: a interface chama uma camada de aplicação interna com entradas e saídas validadas por schema (Zod). REST `/api/v1` + OpenAPI só se houver servidor | Sem servidor não há cliente remoto a contratar | Fastify local (descartado: processo extra sem benefício) | §15, §18 | PROPOSTA (reescrita) |
| ADR-004 | SQLite embarcado atrás de uma interface de armazenamento (`Database`); migrações SQL numeradas, só para frente. Fase 1 usa `node:sqlite` do Node 24 nos testes, sem dependências. O adaptador de cada plataforma (Android, iOS, Windows) é escolhido quando a entrega for decidida (DP-011). Sem ORM | Servidor não existe (DP-015); SQLite roda nas três plataformas; a interface evita acoplar o domínio ao empacotamento | PostgreSQL + Drizzle (volta só com servidor) | §15, §17, DP-011 | PROPOSTA (reescrita) |
| ADR-005 | Isolamento entre produtores = um arquivo/banco local por perfil; sem RLS e sem `tenant_id` na V1. Toda tabela leva `farm_id` ou ancestral, o que permite criar `tenant_id` na migração. Dados protegidos pelo bloqueio do aparelho; criptografia do arquivo exportado a decidir | Um usuário por aparelho; §19 passa a valer na migração a servidor | RLS (volta se houver servidor) | §19 | PROPOSTA (reescrita) |
| ADR-006 | PostGIS só se houver operação geográfica real | Mapa é opcional (§10); adiar até DP-006 | Guardar GeoJSON sem PostGIS | §10, §15 | ADIADA |
| ADR-007 | Anexos guardados localmente no aparelho; backup e portabilidade por exportação de um arquivo único (dados + anexos). Sem S3 | Sem nuvem e sem custo (DP-015); backup é responsabilidade do usuário e o termo deve avisar | S3 só se hospedar | §15, §19 | PROPOSTA (reescrita) |
| ADR-008 | Sem IA, data lake, Kubernetes, Kafka, microsserviços | Requisito explícito do Prompt Mestre | — | §15 | DECIDIDA pelo spec |
| ADR-009 | Estado atual + histórico transacional; sem event sourcing | Auditoria sem complexidade | — | §21 | PROPOSTA |
| ADR-010 | Workers só com necessidade medida | Relatórios síncronos até benchmark indicar o contrário | — | §15 | PROPOSTA |
| ADR-011 | Aplicativo que funciona 100% sem rede e sem servidor próprio, com dados em armazenamento local. Empacotamento (PWA instalável, app Android ou desktop) fica em aberto até DP-011 (aparelhos-alvo) | O "offline na V2" do §14 sobe para V1 porque o app é local; dado financeiro nunca sai do aparelho sem ação explícita de exportar | — | §14, DP-011 | PROPOSTA (reescrita; empacotamento aberto) |
| ADR-012 | Mapas: MapLibre GL JS, sem depender de tiles públicos do OSM; modo sem mapa-base | Licença do provedor a verificar | Sem mapa no MVP | §10 | ADIADA |
| ADR-013 | Testes: Vitest e Playwright | Padrão sugerido | — | §15, §24 | PROPOSTA |

## Limites de domínio (§15)
identity/tenancy, farms, plots, crop-cycles, field-activities, cost-ledger, harvest, sales, documents, reports, audit, platform-admin.
Regras quantitativas ficam no domínio e são reutilizadas pelos relatórios; interfaces não acessam o banco; API não devolve entidade interna sem schema de resposta.

## Estrutura referencial (§16)
`apps/`, `packages/`, `infra/`, `tests/`, `docs/`. Criada só quando houver conteúdo; nada de diretórios vazios. A árvore do §16 é referencial.

## Pendências que afetam arquitetura
DP-014 (repositório/OneDrive), DP-015 (hospedagem e custos), DP-009 (RPO/RTO), DP-012 (rascunhos locais).

## Revisão pela decisão do dono (2026-11-03): sem hospedagem
Dono: app local, dados no aparelho, hospedagem só se surgirem clientes (DP-015). ADR-001, 003, 005, 007 e 011 foram **reescritas** acima como propostas. Mantêm-se as de domínio e dados (ADR-009, safra, unidades, dinheiro exato).
Ainda a revisar por consequência, **não alteradas**:
- **ADR-004**: reescrita como SQLite embarcado atrás de uma interface (2026-11-03). Ainda não validado em Android, iOS e Windows reais; a persistência do armazenamento web no iOS e no Android não foi conferida na documentação oficial.
- **DATA_MODEL.md**: invariantes 1, 8 e 9 falam de `tenant_id`; na V1 valem por `farm_id`. THREAT_MODEL.md e ACCESS_MATRIX.md citam tenant e papéis multiusuário e precisam ser reduzidos ao perfil único.
Se surgirem clientes: nova decisão do dono, com custo autorizado; o domínio não deve mudar na migração.
