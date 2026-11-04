import type { ReportData } from './csv.ts';

// PDF mínimo com texto selecionável (fonte Helvetica padrão, codificação WinAnsi), sem dependências.
// Caracteres fora do Latin-1 viram "?" — limite conhecido.
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;
const LINE = 13;
const MAX_CHARS = 98;

function winAnsi(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) as number;
    const c = code < 256 ? ch : '?';
    out += c === '(' || c === ')' || c === '\\' ? `\\${c}` : c;
  }
  return out;
}

function wrap(text: string): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let cur = '';
    for (const word of paragraph.split(' ')) {
      if ((cur + ' ' + word).trim().length > MAX_CHARS) {
        if (cur) lines.push(cur);
        cur = word;
      } else cur = (cur + ' ' + word).trim();
    }
    lines.push(cur);
  }
  return lines;
}

export function reportLines(d: ReportData): string[] {
  const out: string[] = [d.title, '', ...wrap(d.filters), `Gerado em (UTC): ${d.generatedAt}`, '', 'RESUMO'];
  for (const [k, v] of d.summary) out.push(...wrap(`${k}: ${v}`));
  if (d.warnings.length) out.push('', 'AVISOS', ...d.warnings.flatMap((w) => wrap(`- ${w}`)));
  if (d.excluded.length) out.push('', 'FORA DO CÁLCULO', ...d.excluded.flatMap((x) => wrap(`- ${x}`)));
  out.push('', 'REGISTROS');
  for (const r of d.rows) {
    out.push(...wrap([r.date, r.section, r.description, [r.quantity, r.unit].filter(Boolean).join(' '), r.value, r.paid].filter(Boolean).join(' | ')));
  }
  return out;
}

export function toPdf(d: ReportData): Uint8Array {
  const all = reportLines(d);
  const perPage = Math.floor((PAGE_H - 2 * MARGIN) / LINE);
  const pages: string[][] = [];
  for (let i = 0; i < all.length; i += perPage) pages.push(all.slice(i, i + perPage));
  if (pages.length === 0) pages.push(['']);

  const objects: string[] = [];
  const add = (body: string): number => objects.push(body);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('PAGES'); // preenchido depois
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const pageIds: number[] = [];
  for (const lines of pages) {
    const text = lines.map((l, i) => `BT /F1 10 Tf ${MARGIN} ${PAGE_H - MARGIN - i * LINE} Td (${winAnsi(l)}) Tj ET`).join('\n');
    const contentId = add(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`));
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Latin-1: um byte por caractere, para os deslocamentos do xref baterem.
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}
