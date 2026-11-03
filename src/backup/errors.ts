export type BackupErrorCode =
  | 'arquivo_invalido'
  | 'formato_desconhecido'
  | 'versao_incompativel'
  | 'checksum'
  | 'estrutura'
  | 'valor_nao_suportado';

// A mensagem pode ser mostrada ao usuário; o código serve para testes e logs.
export class BackupError extends Error {
  code: BackupErrorCode;

  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}
