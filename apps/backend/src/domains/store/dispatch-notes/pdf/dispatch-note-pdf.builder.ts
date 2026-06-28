// pdfkit's CJS module exports the PDFDocument class directly, not under a
// `default` property. The default-style import `import X from 'pdfkit'`
// transpiles to `new (require('pdfkit').default)(...)` which throws
// `pdfkit_1.default is not a constructor`. Use namespace import + the
// `.default` / module-object fallback to cover both CJS and ESM-bridge
// environments (ts-node-watch, swc, tsc, esbuild). Mirrors the pattern in
// dispatch-routes/route-flow/pdf-export.service.ts.
import * as PDFKitNs from 'pdfkit';
const PDFDocument: typeof import('pdfkit') =
  ((PDFKitNs as unknown as { default?: typeof import('pdfkit') }).default ??
    PDFKitNs) as typeof import('pdfkit');

export interface DispatchNotePdfItem {
  /** Product display name. */
  product_name: string;
  /** Optional variant SKU appended to the description. */
  variant_sku?: string | null;
  /** Optional lot/serial appended to the description. */
  lot_serial?: string | null;
  ordered_quantity: number;
  dispatched_quantity: number;
  unit_price: number;
  total_price: number;
}

export interface DispatchNoteTransporter {
  route_number: string;
  vehicle_plate?: string | null;
  driver_name?: string | null;
}

export interface DispatchNotePdfData {
  // Documento
  dispatch_number: string;
  status: string;
  issue_date: string;

  // Emisor
  company_name: string;
  company_nit: string;
  company_address?: string;
  company_phone?: string;
  company_email?: string;
  company_logo_buffer?: Buffer;

  // Dirección de salida (origen físico del despacho)
  origin_location_name?: string;
  origin_address?: string;

  // Cliente
  customer_name: string;
  customer_tax_id?: string;

  // Dirección de entrega (destino)
  delivery_address?: string;

  // Items
  items: DispatchNotePdfItem[];

  // Totales
  subtotal_amount: number;
  discount_amount: number;
  tax_amount: number;
  grand_total: number;
  currency?: string;

  // Transportador (solo si hay ruta activa asignada)
  transporter?: DispatchNoteTransporter;

  // Observaciones
  notes?: string;
}

const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
});

const MARGIN = 24; // thin margin to maximize printable width
const PAGE_WIDTH = 612; // Letter
const PAGE_HEIGHT = 792;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2; // 564

const STATUS_LABELS: Record<string, string> = {
  draft: 'BORRADOR',
  confirmed: 'CONFIRMADA',
  delivered: 'ENTREGADA',
  invoiced: 'FACTURADA',
  voided: 'ANULADA',
};

export class DispatchNotePdfBuilder {
  /**
   * Generates a Colombian-compliant dispatch note (remisión) PDF. A remisión is
   * a goods-movement document, NOT a fiscal invoice — hence the explicit legal
   * legend and the despachado/recibido signature block.
   */
  static async generate(data: DispatchNotePdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'LETTER',
          margin: MARGIN,
          bufferPages: true,
        });
        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        this.drawHeader(doc, data);
        this.drawTitle(doc, data);
        this.hr(doc);

        this.drawEmisor(doc, data);
        this.hr(doc);

        this.drawAddresses(doc, data);
        this.hr(doc);

        this.drawCustomer(doc, data);
        this.hr(doc);

        this.drawItemsTable(doc, data.items);
        this.hr(doc);

        this.drawTotals(doc, data);

        if (data.transporter) {
          this.hr(doc);
          this.drawTransporter(doc, data.transporter);
        }

        if (data.notes) {
          this.hr(doc);
          this.drawNotes(doc, data.notes);
        }

        this.hr(doc);
        this.drawLegalLegend(doc);

        this.drawSignatures(doc);

        this.drawFooter(doc);

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  // ─── Sections ───────────────────────────────────────────────────

  private static drawHeader(
    doc: PDFKit.PDFDocument,
    data: DispatchNotePdfData,
  ): void {
    const header_y = MARGIN;

    if (data.company_logo_buffer) {
      try {
        doc.image(data.company_logo_buffer, MARGIN, header_y, {
          width: 60,
          height: 60,
          fit: [60, 60],
        });
      } catch {
        // If logo fails to render, skip it silently.
      }
    }

    const text_x = data.company_logo_buffer ? MARGIN + 70 : MARGIN;

    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .fillColor('#000000')
      .text(data.company_name, text_x, header_y);

    doc
      .font('Helvetica')
      .fontSize(9)
      .text(`NIT: ${data.company_nit}`, text_x, doc.y + 2);

    if (data.company_address) {
      doc.text(data.company_address, text_x, doc.y + 1);
    }

    const contact_parts: string[] = [];
    if (data.company_phone) contact_parts.push(`Tel: ${data.company_phone}`);
    if (data.company_email) contact_parts.push(data.company_email);
    if (contact_parts.length > 0) {
      doc.text(contact_parts.join('  |  '), text_x, doc.y + 1);
    }

    // Ensure we clear the logo height before continuing.
    if (data.company_logo_buffer) {
      const min_y = header_y + 65;
      if (doc.y < min_y) doc.y = min_y;
    }
  }

  private static drawTitle(
    doc: PDFKit.PDFDocument,
    data: DispatchNotePdfData,
  ): void {
    doc.moveDown(0.5);
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .text('REMISIÓN', MARGIN, doc.y, { align: 'center', width: CONTENT_WIDTH });

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(`No. ${data.dispatch_number}`, MARGIN, doc.y + 2, {
        align: 'center',
        width: CONTENT_WIDTH,
      });

    const status_label = STATUS_LABELS[data.status] || data.status.toUpperCase();
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(
        `Estado: ${status_label}  |  Fecha de emisión: ${data.issue_date}`,
        MARGIN,
        doc.y + 3,
        { align: 'center', width: CONTENT_WIDTH },
      );
    doc.moveDown(0.4);
  }

  private static drawEmisor(
    doc: PDFKit.PDFDocument,
    data: DispatchNotePdfData,
  ): void {
    this.sectionTitle(doc, 'EMISOR');
    doc.font('Helvetica').fontSize(9);
    doc.text(`Razón social: ${data.company_name}`, MARGIN, doc.y);
    doc.text(`NIT: ${data.company_nit}`, MARGIN, doc.y + 1);
    if (data.company_address) {
      doc.text(`Dirección: ${data.company_address}`, MARGIN, doc.y + 1);
    }
    const contact_parts: string[] = [];
    if (data.company_phone) contact_parts.push(`Tel: ${data.company_phone}`);
    if (data.company_email) contact_parts.push(`Email: ${data.company_email}`);
    if (contact_parts.length > 0) {
      doc.text(contact_parts.join('  |  '), MARGIN, doc.y + 1);
    }
    doc.moveDown(0.3);
  }

  private static drawAddresses(
    doc: PDFKit.PDFDocument,
    data: DispatchNotePdfData,
  ): void {
    // Two side-by-side columns: salida (origen) | entrega (destino).
    const half = CONTENT_WIDTH / 2;
    const left_x = MARGIN;
    const right_x = MARGIN + half;
    const start_y = doc.y;

    // Left column: dirección de salida
    doc.font('Helvetica-Bold').fontSize(10).text('DIRECCIÓN DE SALIDA', left_x, start_y, {
      width: half - 8,
    });
    doc.font('Helvetica').fontSize(9);
    if (data.origin_location_name) {
      doc.text(data.origin_location_name, left_x, doc.y + 1, { width: half - 8 });
    }
    doc.text(data.origin_address || '—', left_x, doc.y + 1, { width: half - 8 });
    const left_end_y = doc.y;

    // Right column: dirección de entrega
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('DIRECCIÓN DE ENTREGA', right_x, start_y, { width: half - 8 });
    doc.font('Helvetica').fontSize(9);
    doc.text(data.delivery_address || '—', right_x, doc.y + 1, {
      width: half - 8,
    });
    const right_end_y = doc.y;

    // Continue below the taller column.
    doc.y = Math.max(left_end_y, right_end_y);
    doc.moveDown(0.3);
  }

  private static drawCustomer(
    doc: PDFKit.PDFDocument,
    data: DispatchNotePdfData,
  ): void {
    this.sectionTitle(doc, 'CLIENTE');
    const half = CONTENT_WIDTH / 2;
    const y = doc.y;
    doc.font('Helvetica').fontSize(9);
    doc.text(`Nombre: ${data.customer_name}`, MARGIN, y, { width: half - 8 });
    if (data.customer_tax_id) {
      doc.text(`NIT/CC: ${data.customer_tax_id}`, MARGIN + half, y, {
        width: half - 8,
      });
    }
    doc.moveDown(0.3);
  }

  private static drawItemsTable(
    doc: PDFKit.PDFDocument,
    items: DispatchNotePdfItem[],
  ): void {
    this.sectionTitle(doc, 'DETALLE DE MERCANCÍA');

    // Column layout sums to the printable width (CONTENT_WIDTH = 564):
    // [#, Descripción, Cant. pedida, Cant. despachada, P. Unit., Total]
    const col_widths = [24, 250, 60, 70, 70, 90];
    const headers = [
      '#',
      'Descripción',
      'Pedida',
      'Despachada',
      'P. Unit.',
      'Total',
    ];
    const aligns: Array<'left' | 'right' | 'center'> = [
      'center',
      'left',
      'center',
      'center',
      'right',
      'right',
    ];

    const start_x = MARGIN;
    let y = doc.y;

    // Header background + labels.
    doc
      .save()
      .rect(start_x, y - 2, CONTENT_WIDTH, 16)
      .fill('#f5f5f5')
      .restore();
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000');
    let x = start_x;
    headers.forEach((h, i) => {
      doc.text(h, x, y, { width: col_widths[i], align: aligns[i] });
      x += col_widths[i];
    });
    y += 18;

    doc.font('Helvetica').fontSize(8);
    let index = 1;
    for (const item of items) {
      if (y > PAGE_HEIGHT - 220) {
        doc.addPage();
        y = MARGIN;
      }

      // Build the description: product + variant sku + lot.
      const description_parts: string[] = [item.product_name];
      if (item.variant_sku) description_parts.push(`(${item.variant_sku})`);
      let description = description_parts.join(' ');
      if (item.lot_serial) description += `\nLote: ${item.lot_serial}`;

      x = start_x;
      const values: string[] = [
        String(index),
        description,
        this.formatQuantity(item.ordered_quantity),
        this.formatQuantity(item.dispatched_quantity),
        COP.format(item.unit_price),
        COP.format(item.total_price),
      ];
      // Track the tallest cell so multi-line descriptions do not overlap.
      const row_start_y = y;
      let row_height = 12;
      values.forEach((v, i) => {
        doc.text(v, x, row_start_y, { width: col_widths[i], align: aligns[i] });
        if (i === 1) {
          const h = doc.heightOfString(v, { width: col_widths[i] });
          row_height = Math.max(row_height, h);
        }
        x += col_widths[i];
      });

      y = row_start_y + row_height + 4;
      this.hr(doc, y - 4, MARGIN, CONTENT_WIDTH);
      index++;
    }

    doc.y = y;
    doc.moveDown(0.2);
  }

  private static drawTotals(
    doc: PDFKit.PDFDocument,
    data: DispatchNotePdfData,
  ): void {
    doc.moveDown(0.3);
    const totals_x = MARGIN + CONTENT_WIDTH / 2;
    const totals_width = CONTENT_WIDTH / 2;
    doc.font('Helvetica').fontSize(9).fillColor('#000000');

    let y = doc.y;
    const line = (label: string, value: string) => {
      doc.text(label, totals_x, y);
      doc.text(value, totals_x, y, { width: totals_width, align: 'right' });
      y = doc.y + 2;
    };

    line('Subtotal:', COP.format(data.subtotal_amount));
    if (data.discount_amount > 0) {
      line('Descuento:', `-${COP.format(data.discount_amount)}`);
    }
    if (data.tax_amount > 0) {
      line('IVA:', COP.format(data.tax_amount));
    }

    // Total box.
    doc.moveDown(0.4);
    const total_y = doc.y;
    const box_height = 26;
    doc
      .save()
      .rect(totals_x - 5, total_y - 4, totals_width + 5, box_height)
      .fill('#f0f0f0')
      .restore();
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#000000')
      .text('TOTAL:', totals_x, total_y + 4);
    doc.text(COP.format(data.grand_total), totals_x, total_y + 4, {
      width: totals_width,
      align: 'right',
    });
    doc.y = total_y + box_height + 2;
  }

  private static drawTransporter(
    doc: PDFKit.PDFDocument,
    transporter: DispatchNoteTransporter,
  ): void {
    this.sectionTitle(doc, 'TRANSPORTADOR');
    doc.font('Helvetica').fontSize(9);
    doc.text(`Planilla / Ruta: ${transporter.route_number}`, MARGIN, doc.y);
    doc.text(`Vehículo (placa): ${transporter.vehicle_plate || '—'}`, MARGIN, doc.y + 1);
    doc.text(`Conductor: ${transporter.driver_name || '—'}`, MARGIN, doc.y + 1);
    doc.moveDown(0.3);
  }

  private static drawNotes(doc: PDFKit.PDFDocument, notes: string): void {
    this.sectionTitle(doc, 'OBSERVACIONES');
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#444444')
      .text(notes, MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.fillColor('#000000');
    doc.moveDown(0.3);
  }

  private static drawLegalLegend(doc: PDFKit.PDFDocument): void {
    doc
      .font('Helvetica-Oblique')
      .fontSize(8)
      .fillColor('#555555')
      .text(
        'Este documento no constituye factura de venta ni documento equivalente. Remisión de mercancía.',
        MARGIN,
        doc.y,
        { align: 'center', width: CONTENT_WIDTH },
      );
    doc.fillColor('#000000');
    doc.moveDown(0.3);
  }

  private static drawSignatures(doc: PDFKit.PDFDocument): void {
    // Keep the signature block on the current page if there is room; otherwise
    // push it down so it never collides with the table/totals.
    if (doc.y > PAGE_HEIGHT - 120) {
      doc.addPage();
    }
    doc.moveDown(1.5);
    const y = doc.y;
    const col1_x = MARGIN;
    const col2_x = PAGE_WIDTH / 2 + 10;
    const col_width = PAGE_WIDTH / 2 - MARGIN - 20;

    // Signature lines.
    doc.moveTo(col1_x, y + 40).lineTo(col1_x + col_width, y + 40).stroke();
    doc.moveTo(col2_x, y + 40).lineTo(col2_x + col_width, y + 40).stroke();

    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('Despachado por', col1_x, y + 44, {
      width: col_width,
      align: 'center',
    });
    doc.text('Recibido por', col2_x, y + 44, {
      width: col_width,
      align: 'center',
    });

    doc.font('Helvetica').fontSize(8).fillColor('#555555');
    const detail_lines = 'Nombre: ____________________\nC.C.: ____________________\nFecha: ____________________';
    doc.text(detail_lines, col1_x, y + 58, { width: col_width, align: 'left' });
    doc.text(detail_lines, col2_x, y + 58, { width: col_width, align: 'left' });
    doc.fillColor('#000000');
  }

  private static drawFooter(doc: PDFKit.PDFDocument): void {
    const range = doc.bufferedPageRange();
    const generated = `Generado el ${new Date().toLocaleString('es-CO')}`;
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Writing inside the bottom-margin band makes PDFKit auto-append a blank
      // page and pushes the footer onto it. Temporarily zero the bottom margin
      // (and disable line wrapping) so the footer stays on its own page.
      const prev_bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(8).fillColor('#666666');
      doc.text(
        `${generated} — Página ${i + 1} de ${range.count}`,
        MARGIN,
        PAGE_HEIGHT - 20,
        { width: CONTENT_WIDTH, align: 'center', lineBreak: false },
      );
      doc.fillColor('#000000');
      doc.page.margins.bottom = prev_bottom;
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private static sectionTitle(doc: PDFKit.PDFDocument, title: string): void {
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#000000')
      .text(title, MARGIN, doc.y);
    doc.moveDown(0.2);
  }

  private static hr(
    doc: PDFKit.PDFDocument,
    y?: number,
    x1?: number,
    width?: number,
  ): void {
    const y_pos = y ?? doc.y;
    const a = x1 ?? MARGIN;
    const b = width !== undefined ? a + width : PAGE_WIDTH - MARGIN;
    doc.moveTo(a, y_pos).lineTo(b, y_pos).strokeColor('#cccccc').lineWidth(0.5).stroke();
    doc.strokeColor('#000000').lineWidth(1);
    if (y === undefined) doc.moveDown(0.3);
  }

  private static formatQuantity(qty: number): string {
    if (Number.isInteger(qty)) return qty.toString();
    return qty.toFixed(2);
  }
}
