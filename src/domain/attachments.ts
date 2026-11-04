import type { Database } from '../storage/database.ts';
import { recordEvent } from './audit.ts';
import { DomainError } from './errors.ts';

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const SIGNATURES: { mime: string; test: (b: Uint8Array) => boolean }[] = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/webp', test: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
  { mime: 'application/pdf', test: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
];

export interface AttachmentInfo {
  id: string;
  activityId: string;
  name: string;
  mime: string;
  size: number;
}

// O tipo vem do conteúdo (assinatura do arquivo), nunca do nome nem do tipo declarado pelo aparelho.
export function sniffMime(bytes: Uint8Array): string | null {
  return SIGNATURES.find((s) => s.test(bytes))?.mime ?? null;
}

function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\u0000-\u001f<>:"|?*]/g, '').trim().slice(0, 120);
  return clean === '' || clean === '.' || clean === '..' ? 'arquivo' : clean;
}

// RF-AG-009: foto ou documento ligado a uma atividade. Fica no banco local, privado do aparelho.
export async function addAttachment(db: Database, input: { activityId: string; name: string; bytes: Uint8Array }): Promise<AttachmentInfo> {
  if (input.bytes.byteLength === 0) throw new DomainError('invalido', 'Arquivo vazio');
  if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new DomainError('invalido', 'Arquivo maior que 5 MB');
  const mime = sniffMime(input.bytes);
  if (!mime) throw new DomainError('invalido', 'Tipo de arquivo não aceito. Use JPG, PNG, WebP ou PDF');
  const info: AttachmentInfo = { id: crypto.randomUUID(), activityId: input.activityId, name: safeName(input.name), mime, size: input.bytes.byteLength };
  await db.transaction(async () => {
    if ((await db.all('select 1 as ok from field_activity where id = ?', [input.activityId])).length === 0) {
      throw new DomainError('invalido', 'Atividade inválida');
    }
    await db.run('insert into attachment (id, activity_id, name, mime, size, data, created_at) values (?, ?, ?, ?, ?, ?, ?)', [
      info.id,
      info.activityId,
      info.name,
      info.mime,
      info.size,
      input.bytes,
      new Date().toISOString(),
    ]);
    await recordEvent(db, { type: 'attachment.uploaded', resource: 'attachment', resourceId: info.id, after: { activityId: info.activityId, mime, size: info.size } });
  });
  return info;
}

export async function listAttachments(db: Database, activityId: string): Promise<AttachmentInfo[]> {
  const rows = await db.all('select id, activity_id, name, mime, size from attachment where activity_id = ? order by created_at, id', [activityId]);
  return rows.map((r) => ({ id: String(r.id), activityId: String(r.activity_id), name: String(r.name), mime: String(r.mime), size: Number(r.size) }));
}

export async function readAttachment(db: Database, id: string): Promise<Uint8Array | null> {
  const r = (await db.all('select data from attachment where id = ?', [id]))[0];
  return r ? (r.data as Uint8Array) : null;
}
