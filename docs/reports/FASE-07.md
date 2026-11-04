# FASE-07 e FASE-08 — Piloto comercial e evolução opcional

Data: 2026-11-03. Status: **NÃO EXECUTADAS. BLOCKED por natureza, não por falta de trabalho do agente.**

## F7 — Piloto comercial (§27)
O spec pede acompanhar uso real, medir retenção e custo, validar faturamento e decidir a V2. Nada disso pode ser feito sem produtores reais usando o app e sem decisões do dono.
- **BLOCKED:** nenhum produtor usou o app; não há dado de uso, retenção nem custo real.
- **BLOCKED:** faturamento depende de preço, forma de pagamento, suporte e contato (DP-021; o dono pediu para perguntar só no fim) e de decisão sobre CNPJ/forma jurídica.
- **BLOCKED:** distribuição: falta escolher a hospedagem estática gratuita e confirmar a instalação em iOS, Android e Windows (DP-011).
- Pendências jurídicas: LGPD arts. 41/46–48/52 e Resolução ANPD 2/2022 não confirmados; sem revisão de advogado (DP-013).

## F8 — Evolução opcional (§27)
"Mapas avançados, offline completo, dados externos e estoque apenas mediante decisão comprovada." Não há decisão nem evidência de necessidade; **não implementado, de propósito**, conforme o spec. Offline completo já existe em parte (o app inteiro roda local), mas sincronização entre aparelhos não existe nem foi pedida.

## O que o dono precisa decidir ou fazer para destravar a F7
1. Escolher o serviço de hospedagem estática gratuita e publicar `dist/`.
2. Testar o app num Android, num iPhone e num computador Windows reais.
3. Convidar produtores para um piloto fechado (a pesquisa de campo substituída por fontes secundárias na Fase 0 continua sem validação com pessoas).
4. Responder as perguntas comerciais (DP-021) e, se houver cobrança, a forma jurídica.
