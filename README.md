<p align="center"><img src="docs/brand/AgroPulso-logo-com-texto.png" alt="AgroPulso" width="480"></p>

# AgroPulso

Caderno de campo digital para produtores rurais do Brasil. Funciona sem internet, com os dados no aparelho de quem usa. **Em desenvolvimento: ainda não foi usado por nenhum produtor real.**

## O que existe hoje
Registra propriedades, talhões (opcionais), culturas, safras com estados, atividades de campo (com foto), despesas, entradas de caixa, colheitas, vendas e recebimentos. Mostra o resultado parcial de cada safra, gera relatório em PDF e CSV e faz cópia de segurança dos dados em um arquivo. Estado detalhado e o que **não** foi verificado: [docs/reports](docs/reports).

## Como rodar (Node 24 ou mais novo)
```bash
npm install        # só traz o sql.js (SQLite em WebAssembly) para o navegador
npm test           # testes automáticos
node scripts/build.mjs   # gera dist/ (site estático)
node scripts/serve.mjs   # abre em http://127.0.0.1:5173
```
A pasta `dist/` é um site estático (sem servidor próprio). Os dados ficam no navegador de quem usa (IndexedDB).

## Estrutura
- `src/domain`: regras do caderno (propriedade, safra, atividades, custos, colheita, venda, resultado)
- `src/storage`, `src/migrations`, `src/backup`: banco SQLite, migrações só para frente, exportar e restaurar
- `src/reports`: painel, CSV e PDF
- `web`: telas do app (PWA); `scripts`: build e servidor local; `tests`: testes
- `docs`: produto, arquitetura, segurança, minuta de termo de uso e relatórios por fase

## Limites conhecidos
Não substitui técnico agrônomo, receituário nem registros obrigatórios. Os dados só existem neste aparelho: sem cópia de segurança, perda do aparelho ou limpeza do navegador significa perda dos dados.

## Segurança
Os dados ficam só no aparelho. O que o app faz e não faz pela segurança, e como avisar uma falha, está em [SECURITY.md](SECURITY.md).
