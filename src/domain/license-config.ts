// Chave geral da licença (ADR-014 §9). Enquanto for false, o app NÃO cobra nada: não conta teste, não trava, não mostra
// aviso de vencimento. A tela de ativação já existe, para o dono ativar a licença interna antes da virada.
// Só vire para true depois de: (1) gerar o par de chaves reais e colocar a chave pública em license-keys.ts;
// (2) emitir e ativar a licença interna do dono em TODOS os aparelhos dele; (3) testar a virada num aparelho de teste.
// Um teste falha se esta chave for true com license-keys.ts vazio.
export const LICENSE_ENFORCED = false;
