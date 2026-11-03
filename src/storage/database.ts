// Interface de armazenamento (ADR-004). Assíncrona de propósito: os adaptadores de
// celular costumam ser assíncronos. O domínio só conhece esta interface.
export type SqlValue = string | number | bigint | Uint8Array | null;
export type Row = Record<string, SqlValue>;

export interface Database {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<void>;
  all(sql: string, params?: SqlValue[]): Promise<Row[]>;
  // Uma transação por vez; aninhar lança erro. Qualquer erro dentro de fn desfaz tudo.
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
