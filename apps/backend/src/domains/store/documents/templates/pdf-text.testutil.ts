import { inflateSync } from 'zlib';

/**
 * Text drawn by pdfkit with standard fonts, for specs: decodes the hex/literal
 * strings of every (deflated or plain) content stream, in drawing order.
 */
export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content = m[1];
    try {
      content = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      // not deflated
    }
    if (!/\bTj\b|\bTJ\b/.test(content)) continue;
    for (const hex of content.matchAll(/<([0-9a-fA-F]+)>/g)) {
      out.push(Buffer.from(hex[1], 'hex').toString('latin1'));
    }
    for (const lit of content.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) out.push(lit[1]);
    out.push('\n');
  }
  return out.join('');
}
