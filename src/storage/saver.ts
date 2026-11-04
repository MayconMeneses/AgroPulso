// Fila de gravações do banco no navegador. As gravações saem em ordem, uma de cada vez. Se uma falhar (disco cheio,
// armazenamento bloqueado), a falha vai para quem pediu aquela gravação, e as seguintes TENTAM de novo em vez de
// herdar o erro para sempre: antes, uma única falha deixava o resto da sessão sem salvar nada.
export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageError';
  }
}

export function createSaver(write: () => Promise<void>): () => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  return () => {
    const run = tail.catch(() => undefined).then(async () => {
      try {
        await write();
      } catch (cause) {
        throw new StorageError('Não foi possível gravar no aparelho (talvez sem espaço). O que você acabou de fazer pode não estar salvo: baixe uma cópia dos dados e libere espaço.', { cause });
      }
    });
    tail = run;
    return run;
  };
}
