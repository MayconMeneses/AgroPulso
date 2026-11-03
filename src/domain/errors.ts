export type DomainErrorCode =
  | 'invalido'
  | 'nao_encontrado'
  | 'conflito_de_versao'
  | 'transicao_invalida'
  | 'duplicado';

export class DomainError extends Error {
  code: DomainErrorCode;
  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
