import type { Database } from '../storage/database.ts';
import { recordEvent } from './audit.ts';
import { DomainError } from './errors.ts';
import { assertCycleWritable } from './guards.ts';

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
// O banco inteiro vive na memória do aparelho e é regravado a cada mudança: fotos demais deixam o app lento e podem estourar a
// memória de celulares simples. Medido: 52 MB de fotos regravam em ~50 ms no computador; o limite protege os aparelhos fracos.
export const MAX_ATTACHMENTS_TOTAL_BYTES = 120 * 1024 * 1024;

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
    const activity = (await db.all('select cycle_id from field_activity where id = ?', [input.activityId]))[0];
    if (!activity) throw new DomainError('invalido', 'Atividade inválida');
    await assertCycleWritable(db, String(activity.cycle_id));
    const used = Number((await db.all('select coalesce(sum(size), 0) as t from attachment'))[0]?.t ?? 0);
    if (used + input.bytes.byteLength > MAX_ATTACHMENTS_TOTAL_BYTES) throw new DomainError('invalido', 'O espaço de fotos deste aparelho chegou ao limite (120 MB). Remova anexos antigos antes de enviar outro');
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

// O arquivo (a foto ou o PDF) é apagado de verdade para liberar espaço e por privacidade; o que fica é o registro de que
// existiu: nome, tipo, tamanho, quando foi removido e por quê. O conteúdo não volta.
export async function removeAttachment(db: Database, id: string, reason: string): Promise<void> {
  if (reason.trim() === '') throw new DomainError('invalido', 'Informe o motivo de remover o anexo');
  await db.transaction(async () => {
    const r = (await db.all('select a.name, a.mime, a.size, a.activity_id, f.cycle_id from attachment a join field_activity f on f.id = a.activity_id where a.id = ?', [id]))[0];
    if (!r) throw new DomainError('nao_encontrado', 'Anexo não encontrado');
    const closed = (await db.all("select 1 as ok from crop_cycle where id = ? and status in ('CONCLUIDA','CANCELADA')", [r.cycle_id])).length > 0;
    if (closed) throw new DomainError('transicao_invalida', 'Safra encerrada: o anexo fica preservado no histórico');
    await db.run('delete from attachment where id = ?', [id]);
    await recordEvent(db, { type: 'attachment.removed', resource: 'attachment', resourceId: id, reason: reason.trim(), before: { name: r.name, mime: r.mime, size: Number(r.size), activityId: r.activity_id } });
  });
}
