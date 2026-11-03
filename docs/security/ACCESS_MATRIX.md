# Matriz de acesso — proposta (§18)

**V1 local (ADR-001/005, DP-015, 2026-11-03): um perfil por aparelho; o usuário é o Proprietário e tem todas as permissões. Não há login de rede, tenant, colaborador, consultor nem Master.** A tabela abaixo fica como referência para uma futura versão com servidor e não vale na V1. Na V1 a proteção é o bloqueio do aparelho e, se decidido, uma trava local opcional do app (a definir). O teste CT-AG-010 (colaborador sem acesso financeiro) só se aplica quando houver colaboradores.

Papéis e permissões vêm do §18. A atribuição de cada permissão a cada papel é **proposta a validar com o dono** (DP-016); o spec só fixa que funcionário registra tarefa sem necessariamente ver receita, e que o Master age por autorização explícita.

Legenda: S = sim; N = não; O = opcional por membro; E = só com autorização explícita, escopo restrito e auditoria.

| Permissão | Proprietário | Colaborador operacional | Usuário financeiro (opcional) | Consultor (V2) | Master |
|---|---|---|---|---|---|
| farm.read | S | S (propriedades atribuídas) | O | S (escopo convidado) | E |
| farm.write | S | N | N | N | N |
| cycle.manage | S | N | N | N | N |
| activity.create | S | S | N | N | N |
| financial.read | S | N | S | O | N |
| financial.write | S | N | S | N | N |
| harvest.create | S | S | N | N | N |
| report.export | S | O | O | O | N |
| tenant.members.manage | S | N | N | N | N |

Regras:
- O servidor deriva o tenant da sessão/vínculo válido; nunca de campo livre no JSON.
- Toda leitura e escrita exige `tenant_id` confiável e política de recurso. ID público não prevê autorização.
- Master: sem navegação silenciosa; acesso a dados rurais só por autorização expressa, com escopo e auditoria (`access.denied` e acessos registrados).
- Consultor: acesso temporário, delimitado a propriedades, revogável; só V2.
- Teste obrigatório: colaborador não consulta dados financeiros sem permissão (CT-AG-010).
