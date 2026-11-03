# Modelo de ameaças — AgroPulso (Fase 0)

Fonte: §18, §19, §21, §24. Não há código; todos os itens são **POTENTIAL RISK** de projeto, nenhum é vulnerabilidade confirmada.
Referências normativas citadas no spec: OWASP ASVS/API Top 10 [AG15], NIST SSDF [AG16], ANPD [AG17]. Não se alega conformidade com nenhuma delas.

| ID | Ameaça | Classe | Controle proposto | Teste (fase) |
|---|---|---|---|---|
| SEC-AG-001 | Usuário de uma empresa lê ou altera dados de outra (IDOR, ex.: alterar custo) | POTENTIAL RISK | Tenant obtido da sessão, nunca do JSON; RLS com papel de banco sem bypass; ID público não prevê autorização | Teste cruzado entre duas empresas (F1) |
| SEC-AG-002 | Consultor (V2) acessa outra fazenda | POTENTIAL RISK | Convite com escopo por propriedade, prazo e revogação; auditoria | F8 / V2 |
| SEC-AG-003 | Vazamento de receita agrícola a colaborador sem permissão | POTENTIAL RISK | Permissões financial.read/write separadas; respostas por schema | E2E colaborador (F4) |
| SEC-AG-004 | Alteração maliciosa de despesa ou safra | POTENTIAL RISK | Autoria, bloqueio otimista, histórico antes/depois, eventos de auditoria | F1/F4 |
| SEC-AG-005 | Extração massiva de dados | POTENTIAL RISK | Rate limiting, paginação, limites de exportação, restrição de links compartilhados | F6 |
| SEC-AG-006 | Mapa revela limites ou uso da propriedade; localização de colaboradores exposta | POTENTIAL RISK | Sem publicar mapas nem localização por padrão; política de retenção (DP-013) | F2 |
| SEC-AG-007 | Adulteração de coordenadas | POTENTIAL RISK | Validação de lat/lon e CRS; histórico de alterações; área medida separada da declarada | F2 |
| SEC-AG-008 | Uso indevido de token offline | POTENTIAL RISK | V2: IndexedDB por usuário/tenant, detecção de conta trocada, revogação; login revogado não sincroniza | F8 |
| SEC-AG-009 | Anexo malicioso (malware, tipo falsificado) | POTENTIAL RISK | Allowlist, limite de tamanho, assinatura validada, storage privado, varredura a definir | F3 |
| SEC-AG-010 | Dado público interpretado como regularidade ambiental | POTENTIAL RISK | Avisos de que mapa/ZARC/CAR não certificam nada; mostrar fonte e vigência | F2/F8 |
| SEC-AG-011 | Injeção SQL e XSS | POTENTIAL RISK | Consultas parametrizadas, saída escapada, CSP | SAST/DAST (F6) |
| SEC-AG-012 | Formula injection em CSV exportado | POTENTIAL RISK | Neutralizar células iniciadas por `=`, `+`, `-`, `@` | F5 |
| SEC-AG-013 | Roubo ou fixação de sessão; CSRF | POTENTIAL RISK | Sessões revogáveis; cookies HttpOnly/Secure/SameSite; token CSRF quando necessário | F1 |
| SEC-AG-014 | Senhas fracas ou vazadas; conta Master comprometida | POTENTIAL RISK | Argon2id; MFA para Master e contas privilegiadas | F1 |
| SEC-AG-015 | Segredos em código ou logs; dados privados em logs | POTENTIAL RISK | Segredos em mecanismo apropriado; logs sem dados desnecessários; varredura de segredos no CI | F1/F6 |
| SEC-AG-016 | Suporte Master navega silenciosamente nos dados | POTENTIAL RISK | Acesso por autorização explícita, escopo restrito, auditoria | F6 |
| SEC-AG-017 | Perda ou ransomware em backups | POTENTIAL RISK | Backups criptografados, cópia protegida, exclusão sem credencial da aplicação; restauração por tenant testada | F1/F6 |
| SEC-AG-018 | Duplicação por reenvio (replay) de colheita/custo/venda | POTENTIAL RISK | idempotency_key | F4 |
| SEC-AG-019 | Cadeia de suprimentos (dependências, actions) | POTENTIAL RISK | SCA no CI, lockfile, fixar actions críticas | F1/F6 |
| SEC-AG-020 | Fonte externa falha ou é spoofada (V2) | POTENTIAL RISK | Adaptador só após comprovar endpoint e termos; falha não bloqueia registros | F8 |

## Revisão para o app local (2026-11-03, ADR-001/005/007/011)
Sem servidor, sem login de rede, sem multiusuário. Classificação continua POTENTIAL RISK; nada foi testado.
| IDs | Na V1 local | Observação |
|---|---|---|
| SEC-AG-001, 002, 003, 016 | Não se aplicam | Dependem de tenants, colaboradores, consultor ou Master. Voltam com servidor |
| SEC-AG-004, 018 | Mantidas | Histórico antes/depois, versão e `idempotency_key` valem também no banco local, inclusive na importação |
| SEC-AG-005 | Alterada | Risco passa a ser vazamento por arquivo exportado: aviso ao exportar; criptografia do arquivo a decidir |
| SEC-AG-006, 007, 010 | Mantidas | Mapa continua adiado (ADR-006/012); valem quando houver coordenadas |
| SEC-AG-008, 013, 014 | Não se aplicam / a decidir | Sem sessão nem senha de rede; trava local do app é decisão em aberto |
| SEC-AG-009 | Mantida | Anexo importado do aparelho: tipo e tamanho validados; sem varredura de malware (sem serviço) |
| SEC-AG-011, 012 | Mantidas | XSS na interface e formula injection em CSV continuam possíveis |
| SEC-AG-015, 019 | Mantidas | Sem segredos de servidor; dependências e lockfile continuam |
| SEC-AG-017 | Alterada | Perda do aparelho sem backup é o risco central; backup é do usuário (termo, item 4) |
| SEC-AG-020 | Adiada | Fontes externas são V2 |
Novos riscos locais, a tratar na Fase 1: importar arquivo adulterado ou de versão incompatível (validar schema e versão antes de gravar); exportar dados financeiros sem aviso; perda de dados por limpeza do armazenamento do navegador, se o empacotamento for web (depende de DP-011).

## Limites desta versão
Sem arquitetura implementada, sem DAST/SAST, sem pentest. Esta é lista de ameaças a tratar, não avaliação de segurança.
Incidente (§26): detectar, classificar, conter, preservar evidências, corrigir, restaurar, comunicar conforme regras pertinentes, acrescentar teste de regressão. Plano detalhado fica para F6.
