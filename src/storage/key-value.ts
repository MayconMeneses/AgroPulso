// Guarda pequena de chave e valor, FORA do banco SQLite. Serve para o que não pode viajar na cópia de segurança nem ser
// trocado por uma restauração: a licença, a data da instalação e a maior data já vista (ADR-014 §7).
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}
