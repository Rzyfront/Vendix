import { PDFDocument } from '@common/pdf/pdfkit';
import { BasePdfBody, BlockAlign, BlocksBody, SignatureSlot } from './template-body';
import type { SignatureStamp } from './issued-document-renderer';
import {
  TokenScope,
  formatDate,
  lookup,
  renderText,
} from './template-tokens';

/** A page of the base PDF already rasterized: JPEG bytes + size in PDF points. */
export interface BasePageImage {
  image: Buffer;
  width_pt: number;
  height_pt: number;
}

export interface PdfRenderOptions {
  scope: TokenScope;
  /** Adds the "VISTA PREVIA" watermark. */
  preview?: boolean;
  /** Store logo bytes; null/undefined = no logo. */
  logo?: Buffer | null;
  signatures?: SignatureStamp[];
  title?: string;
  appendPages?: (doc: PDFKit.PDFDocument) => void | Promise<void>;
}

type Doc = PDFKit.PDFDocument;

const PAGE_SIZES: Record<string, [number, number]> = {
  A4: [595.28, 841.89],
  LETTER: [612, 792],
};
const GRAY = '#6b7280';
const LINE = '#9ca3af';

function open(options: PDFKit.PDFDocumentOptions): { doc: Doc; done: Promise<Buffer> } {
  const doc = new PDFDocument({ ...options, bufferPages: true });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  return { doc, done };
}

/** Writes at an absolute position without ever triggering a page break. */
function writeAt(doc: Doc, str: string, x: number, y: number, width: number, align: BlockAlign = 'left') {
  doc.text(str, x, y, { width, align, lineBreak: false });
}

/** Draws something outside the page margins (watermark, footer) without adding pages. */
function withoutMargins(doc: Doc, fn: () => void) {
  const m = { ...doc.page.margins };
  doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
  try {
    fn();
  } finally {
    doc.page.margins = m;
  }
}

function watermark(doc: Doc) {
  const { width, height } = doc.page;
  withoutMargins(doc, () => {
    doc.save();
    doc.rotate(-40, { origin: [width / 2, height / 2] });
    doc.fillColor('#000000').fillOpacity(0.08).font('Helvetica-Bold').fontSize(86);
    writeAt(doc, 'VISTA PREVIA', 0, height / 2 - 43, width, 'center');
    doc.restore();
  });
}

function timeInZone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/** Maps each declared slot to the stamp that signs it (by key; unkeyed stamps fill free slots in order). */
function stampsBySlot(slots: SignatureSlot[], stamps: SignatureStamp[] = []): Map<string, SignatureStamp> {
  const out = new Map<string, SignatureStamp>();
  const known = new Set(slots.map((s) => s.key));
  for (const s of stamps) if (s.slot_key && known.has(s.slot_key) && !out.has(s.slot_key)) out.set(s.slot_key, s);
  const free = slots.filter((s) => !out.has(s.key));
  for (const s of stamps.filter((x) => !x.slot_key || !known.has(x.slot_key))) {
    const slot = free.shift();
    if (slot) out.set(slot.key, s);
  }
  return out;
}

/** Signature box: empty → "Pendiente de firma" + role; signed → stroke, name, document, date. */
function drawSignatureBox(
  doc: Doc,
  slot: SignatureSlot,
  stamp: SignatureStamp | undefined,
  box: { x: number; y: number; width: number; height: number },
  timeZone: string,
) {
  const { x, y, width, height } = box;
  doc.save();
  doc.lineWidth(0.8).strokeColor(LINE);
  if (!stamp) doc.dash(3, { space: 3 });
  doc.rect(x, y, width, height).stroke();
  doc.undash();
  doc.restore();
  const caption = 8;
  if (stamp) {
    const imgH = Math.max(10, height - caption * 3 - 4);
    try {
      doc.image(stamp.image, x + 4, y + 2, { fit: [width - 8, imgH], align: 'center', valign: 'center' });
    } catch {
      // A corrupt stroke must not hide the signer's identity lines below.
    }
    const when = `${formatDate(slot.key, stamp.signed_at, timeZone, null)} ${timeInZone(stamp.signed_at, timeZone)}`;
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(caption);
    writeAt(doc, stamp.name, x + 4, y + height - caption * 3 - 2, width - 8);
    doc.font('Helvetica').fillColor(GRAY);
    writeAt(doc, `${stamp.document_number ? `Doc. ${stamp.document_number} · ` : ''}${when}`, x + 4, y + height - caption * 2 - 1, width - 8);
    writeAt(doc, slot.role_label, x + 4, y + height - caption - 1, width - 8);
  } else {
    doc.fillColor(GRAY).font('Helvetica-Oblique').fontSize(10);
    writeAt(doc, 'Pendiente de firma', x, y + height / 2 - 12, width, 'center');
    doc.font('Helvetica-Bold').fontSize(9);
    writeAt(doc, slot.role_label, x, y + height / 2 + 2, width, 'center');
  }
  doc.fillColor('#000000');
}

// ---------------------------------------------------------------------------
// Block templates
// ---------------------------------------------------------------------------

export async function renderBlocksPdf(body: BlocksBody, o: PdfRenderOptions): Promise<Buffer> {
  const margin = body.page.margin ?? 50;
  const { doc, done } = open({
    size: PAGE_SIZES[body.page.size],
    margin,
    info: { Title: o.title ?? 'Documento' },
  });
  const text = (t: string, scope: TokenScope = o.scope) => renderText(t, scope);
  const stamps = stampsBySlot(body.signature_slots ?? [], o.signatures);
  const contentWidth = () => doc.page.width - margin * 2;
  const bottom = () => doc.page.height - margin;
  const ensure = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };

  const drawHeader = () => {
    if (!body.header) return;
    if (body.header.show_logo && o.logo) {
      try {
        doc.image(o.logo, margin, doc.y, { fit: [110, 48] });
        doc.y += 52;
      } catch {
        // An unreadable logo is cosmetic: the document is still valid.
      }
    }
    if (body.header.text) {
      doc.font('Helvetica').fontSize(9).fillColor(GRAY);
      doc.text(text(body.header.text), margin, doc.y, { width: contentWidth() });
      doc.fillColor('#000000').moveDown(0.6);
    }
  };
  drawHeader();
  const onPage = () => {
    doc.x = margin;
    drawHeader();
  };
  doc.on('pageAdded', onPage);

  for (const b of body.blocks) {
    switch (b.type) {
      case 'heading': {
        const size = b.level === 1 ? 20 : b.level === 2 ? 16 : 13;
        doc.font('Helvetica-Bold').fontSize(size);
        ensure(size * 2.5);
        doc.text(text(b.text), margin, doc.y, { width: contentWidth(), align: b.align ?? 'left' });
        doc.moveDown(0.5);
        break;
      }
      case 'paragraph':
        doc.font('Helvetica').fontSize(11);
        doc.text(text(b.text), margin, doc.y, { width: contentWidth(), align: b.align ?? 'left' });
        doc.moveDown(0.6);
        break;
      case 'fields': {
        const labelW = Math.min(170, contentWidth() * 0.35);
        for (const r of b.rows) {
          const label = text(r.label);
          const value = text(r.value);
          doc.font('Helvetica-Bold').fontSize(10);
          const h = Math.max(
            doc.heightOfString(label, { width: labelW }),
            doc.font('Helvetica').heightOfString(value, { width: contentWidth() - labelW - 8 }),
          );
          ensure(h + 4);
          const y = doc.y;
          doc.font('Helvetica-Bold').fontSize(10);
          doc.text(label, margin, y, { width: labelW });
          doc.font('Helvetica').text(value, margin + labelW + 8, y, { width: contentWidth() - labelW - 8 });
          doc.y = y + h + 4;
        }
        doc.moveDown(0.4);
        break;
      }
      case 'table': {
        const raw = lookup(o.scope, b.source);
        const rows = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
        const colW = contentWidth() / b.columns.length;
        const drawRow = (cells: string[], header: boolean) => {
          doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
          const h = Math.max(...cells.map((c) => doc.heightOfString(c, { width: colW - 8 }))) + 8;
          ensure(h);
          const y = doc.y;
          if (header) doc.rect(margin, y, contentWidth(), h).fill('#f3f4f6').fillColor('#000000');
          doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
          cells.forEach((c, i) => doc.text(c, margin + i * colW + 4, y + 4, { width: colW - 8 }));
          doc.moveTo(margin, y + h).lineTo(margin + contentWidth(), y + h).lineWidth(0.4).strokeColor(LINE).stroke();
          doc.y = y + h;
        };
        drawRow(b.columns.map((c) => text(c.header)), true);
        for (const row of rows) {
          const scope: TokenScope = { ...o.scope, row: typeof row === 'object' && row ? row : { value: row } };
          drawRow(b.columns.map((c) => text(c.value, scope)), false);
        }
        doc.fillColor('#000000').moveDown(0.8);
        break;
      }
      case 'image':
        if (o.logo) {
          const w = b.width ?? 120;
          ensure(w / 2 + 8);
          try {
            doc.image(o.logo, margin, doc.y, { fit: [w, w / 2] });
            doc.y += w / 2 + 8;
          } catch {
            // Cosmetic.
          }
        }
        break;
      case 'spacer':
        doc.y += b.height;
        break;
      case 'page_break':
        doc.addPage();
        break;
      case 'signature': {
        const slot = (body.signature_slots ?? []).find((s) => s.key === b.slot_key);
        if (!slot) break;
        ensure(110);
        const y = doc.y + 6;
        drawSignatureBox(doc, slot, stamps.get(slot.key), { x: margin, y, width: 250, height: 84 }, o.scope.timezone);
        doc.y = y + 84 + 14;
        break;
      }
    }
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    if (o.preview) watermark(doc);
    if (body.footer && (body.footer.text || body.footer.page_numbers)) {
      withoutMargins(doc, () => {
        doc.font('Helvetica').fontSize(8).fillColor(GRAY);
        const y = doc.page.height - margin + 14;
        if (body.footer?.text) writeAt(doc, text(body.footer.text), margin, y, contentWidth() - 60);
        if (body.footer?.page_numbers) {
          writeAt(doc, `Página ${i - range.start + 1} de ${range.count}`, margin, y, contentWidth(), 'right');
        }
        doc.fillColor('#000000');
      });
    }
  }
  doc.off('pageAdded', onPage);
  await o.appendPages?.(doc);
  doc.end();
  return done;
}

// ---------------------------------------------------------------------------
// Base PDF templates
// ---------------------------------------------------------------------------

/** Coordinates are PDF points measured from the TOP-LEFT corner of the page. */
export async function renderBasePdf(body: BasePdfBody, pages: BasePageImage[], o: PdfRenderOptions): Promise<Buffer> {
  const { doc, done } = open({ autoFirstPage: false, margin: 0, info: { Title: o.title ?? 'Documento' } });
  const stamps = stampsBySlot(body.signature_slots, o.signatures);
  pages.forEach((p, index) => {
    const number = index + 1;
    doc.addPage({ size: [p.width_pt, p.height_pt], margin: 0 });
    doc.image(p.image, 0, 0, { width: p.width_pt, height: p.height_pt });
    for (const f of body.fields.filter((x) => x.page === number)) {
      doc.font('Helvetica').fontSize(f.font_size ?? 11).fillColor('#000000');
      doc.text(renderText(f.value, o.scope), f.x, f.y, {
        width: f.width,
        height: f.height,
        align: f.align ?? 'left',
        ellipsis: true,
        lineBreak: true,
      });
    }
    for (const s of body.signature_slots.filter((x) => x.page === number)) {
      drawSignatureBox(doc, s, stamps.get(s.key), s, o.scope.timezone);
    }
  });
  if (o.preview) {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      watermark(doc);
    }
  }
  await o.appendPages?.(doc);
  doc.end();
  return done;
}
