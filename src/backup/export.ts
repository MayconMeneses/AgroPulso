import type { Database } from '../storage/database.ts';
import { currentVersion } from '../migrations/runner.ts';
import { FORMAT, FORMAT_VERSION, encodeRow, sha256Hex } from './codec.ts';
import type { JsonRow } from './codec.ts';
import { quote, userTables } from './schema.ts';

// Gera um arquivo de texto com todos os dados. O sha256 detecta corrupção ou edição
// acidental; não é assinatura: quem recalcular o hash consegue forjar um arquivo válido.
export async function exportBackup(db: Database): Promise<string> {
  const tables: Record<string, JsonRow[]> = {};
  for (const name of await userTables(db)) {
    const rows = await db.all(`select * from ${quote(name)} order by rowid`);
    tables[name] = rows.map(encodeRow);
  }
  const payload = JSON.stringify({ tables });
  return JSON.stringify({
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    schemaVersion: await currentVersion(db),
    sha256: await sha256Hex(payload),
    payload,
  });
}
