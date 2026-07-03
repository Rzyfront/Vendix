// pdfkit's CJS module exports the PDFDocument class directly, not under a
// `default` property. The default-style import `import X from 'pdfkit'`
// transpiles to `new (require('pdfkit').default)(...)` which throws
// `pdfkit_1.default is not a constructor`. Use namespace import + the
// `.default` / module-object fallback to cover both CJS and ESM-bridge
// environments (ts-node-watch, swc, tsc, esbuild).
import * as PDFKitNs from 'pdfkit';
import type { ArticleExitSummary } from '../utils/route-stop-calc';
const PDFDocument: typeof import('pdfkit') =
  ((PDFKitNs as unknown as { default?: typeof import('pdfkit') }).default ??
    PDFKitNs) as typeof import('pdfkit');

interface RouteForPdf {
  id: number;
  route_number: string;
  route_code?: string | null;
  status: string;
  planned_date: Date;
  dispatch_started_at?: Date | null;
  closed_at?: Date | null;
  total_to_collect: any;
  total_collected: any;
  total_prepaid: any;
  total_changes: any;
  total_withholdings: any;
  total_credit: any;
  declared_cash?: any;
  cash_variance?: any;
  currency?: string | null;
  notes?: string | null;
  vehicle?: { plate: string; type?: string; brand?: string | null; model_name?: string | null } | null;
  driver_user?: { first_name?: string | null; last_name?: string | null; document_number?: string | null } | null;
  external_driver_name?: string | null;
  external_driver_id_number?: string | null;
  origin_location?: { name: string; code?: string | null } | null;
  stops: Array<{
    id: number;
    stop_sequence: number;
    status: string;
    result?: string | null;
    is_prepaid: boolean;
    is_extra_route: boolean;
    collected_amount: any;
    anticipo_amount: any;
    change_amount: any;
    withholding_amount: any;
    credit_amount: any;
    payment_method?: string | null;
    settled_at?: Date | null;
    dispatch_note?: {
      dispatch_number: string;
      customer_name?: string | null;
      grand_total: any;
      // Delivery-address snapshot (JSON). Falls back to the order's shipping
      // snapshot. Both carry the `addresses` column names (address_line1,
      // state_province, country_code, ...).
      customer_address?: any;
      order?: {
        shipping_address_snapshot?: any;
        addresses_orders_shipping_address_idToaddresses?: any;
      } | null;
    } | null;
  }>;
}

const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
});

const fmtDate = (d: Date | null | undefined) => {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Format a delivery-address JSON snapshot into a one-line string for the PDF.
 * Tolerant of both `addresses` column names (address_line1, state_province) and
 * legacy DTO names (address_line_1, state); returns '' when nothing usable.
 */
const formatPdfAddress = (addr: any): string => {
  if (!addr || typeof addr !== 'object') return '';
  const line1 = addr.address_line1 ?? addr.address_line_1 ?? addr.line1 ?? addr.address ?? '';
  const line2 = addr.address_line2 ?? addr.address_line_2 ?? '';
  const city = addr.city ?? '';
  const state = addr.state_province ?? addr.state ?? '';
  return [line1, line2, city, state]
    .map((p) => (p ?? '').toString().trim())
    .filter(Boolean)
    .join(', ');
};

const MARGIN = 24; // thin margin to maximize printable width
const PAGE_WIDTH = 612; // Letter
const PAGE_HEIGHT = 792;

export class PdfExportService {
  async generate(
    route: RouteForPdf,
    articles?: ArticleExitSummary,
  ): Promise<Buffer> {
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

        this.drawHeader(doc, route);
        this.drawTitle(doc, route);
        this.drawRouteInfo(doc, route);
        this.drawDriverInfo(doc, route);
        this.drawStopsTable(doc, route);
        this.drawTotals(doc, route);
        this.drawSignatures(doc);
        // Last page: consolidated goods-out detail. Drawn BEFORE the footer so
        // drawFooter's bufferedPageRange numbers this page too.
        if (articles) {
          this.drawArticleDetailPage(doc, route, articles);
        }
        this.drawFooter(doc);

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Renders the final "DETALLE DE SALIDA DE ARTÍCULOS" page: the consolidated
   * list of every product that leaves the warehouse in the route (sum of
   * `dispatched_quantity` per product across all non-released stops). Columns:
   * Código · Descripción · Unidad · Total Und. NO packaging columns.
   */
  private drawArticleDetailPage(
    doc: PDFKit.PDFDocument,
    route: RouteForPdf,
    articles: ArticleExitSummary,
  ) {
    doc.addPage();
    const printable = PAGE_WIDTH - MARGIN * 2;

    // Title (centered, bold).
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .text('DETALLE DE SALIDA DE ARTÍCULOS', MARGIN, MARGIN, {
        align: 'center',
        width: printable,
      });
    doc.moveDown(0.4);

    // Origin-warehouse subheader (only when known).
    if (route.origin_location) {
      const codePart = route.origin_location.code
        ? `${route.origin_location.code} - `
        : '';
      doc
        .font('Helvetica')
        .fontSize(10)
        .text(`Bodega: ${codePart}${route.origin_location.name}`, MARGIN, doc.y, {
          align: 'center',
          width: printable,
        });
      doc.moveDown(0.3);
    }
    this.hr(doc);
    doc.moveDown(0.3);

    // Column layout (sums to the printable width = 564). Código is widened
    // (SKUs like ROKU-GAMI-NINT-0024-V38 are long) so it stays on one line.
    const col_widths = [140, 250, 64, 110];
    const aligns: Array<'left' | 'right' | 'center'> = [
      'left',
      'left',
      'center',
      'right',
    ];
    const headers = ['Código', 'Descripción', 'Unidad', 'Total Und'];
    const startX = MARGIN;

    // Draw (and re-draw on page breaks) the column header; returns the y of the
    // first data row.
    const drawColHeader = (yTop: number): number => {
      doc.font('Helvetica-Bold').fontSize(9);
      let hx = startX;
      headers.forEach((h, i) => {
        doc.text(h, hx, yTop, { width: col_widths[i], align: aligns[i] });
        hx += col_widths[i];
      });
      const yAfter = yTop + 16;
      this.hr(doc, yAfter - 4, MARGIN, PAGE_WIDTH - MARGIN * 2);
      return yAfter + 4;
    };

    let y = drawColHeader(doc.y);

    if (articles.rows.length === 0) {
      doc.font('Helvetica').fontSize(10).fillColor('#555');
      doc.text('Sin artículos despachados en esta ruta.', MARGIN, y + 4, {
        width: printable,
        align: 'left',
      });
      doc.fillColor('black');
      y += 24;
    } else {
      // Dynamic row height: measure the tallest cell so a long código or
      // descripción makes the ROW grow instead of overlapping the next one.
      // The código keeps its full text (never truncated) — legibility matters
      // on a picking sheet — at a slightly smaller font so most fit one line.
      const CELL_PAD_Y = 5;
      const CODE_FONT = 8;
      const BODY_FONT = 9;
      for (const row of articles.rows) {
        doc.font('Helvetica').fontSize(CODE_FONT);
        const codeH = doc.heightOfString(row.code, { width: col_widths[0] - 4 });
        doc.font('Helvetica').fontSize(BODY_FONT);
        const nameH = doc.heightOfString(row.name, { width: col_widths[1] - 4 });
        const rowH = Math.max(codeH, nameH, 11) + CELL_PAD_Y * 2;

        // Page break accounts for the FULL measured row height.
        if (y + rowH > PAGE_HEIGHT - 60) {
          doc.addPage();
          y = drawColHeader(MARGIN);
        }

        const cellY = y + CELL_PAD_Y;
        let x = startX;
        // Col 0: código (smaller font, wraps within the widened column).
        doc.font('Helvetica').fontSize(CODE_FONT).fillColor('black');
        doc.text(row.code, x, cellY, { width: col_widths[0] - 4, align: aligns[0] });
        x += col_widths[0];
        // Col 1: descripción (wraps within its column).
        doc.font('Helvetica').fontSize(BODY_FONT);
        doc.text(row.name, x, cellY, { width: col_widths[1] - 4, align: aligns[1] });
        x += col_widths[1];
        // Col 2: unidad
        doc.text(row.unit, x, cellY, { width: col_widths[2], align: aligns[2] });
        x += col_widths[2];
        // Col 3: total und
        doc.text(row.total_units.toLocaleString('es-CO'), x, cellY, {
          width: col_widths[3],
          align: aligns[3],
        });

        y += rowH;
        this.hr(doc, y - 2, MARGIN, PAGE_WIDTH - MARGIN * 2);
      }
    }

    // Sheet footer: totals in bold. Push to a new page if too close to the
    // bottom margin band (writing there would auto-append a blank page).
    if (y > PAGE_HEIGHT - 80) {
      doc.addPage();
      y = MARGIN;
    }
    const footerY = y + 8;
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(
        `TOTAL ARTÍCULOS: ${articles.article_count}    TOTAL UNIDADES: ${articles.total_units.toLocaleString('es-CO')}`,
        MARGIN,
        footerY,
        { width: printable, align: 'right' },
      );
    doc.font('Helvetica');
  }

  private drawHeader(doc: PDFKit.PDFDocument, route: RouteForPdf) {
    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .text('PLANILLA DE DESPACHO', MARGIN, MARGIN, { align: 'center' });
    doc.fontSize(10).font('Helvetica').text(`(Ruta de Recaudo)`, { align: 'center' });
    doc.moveDown(0.5);
    this.hr(doc);
  }

  private drawTitle(doc: PDFKit.PDFDocument, route: RouteForPdf) {
    doc.moveDown(0.4);
    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .text(`Planilla N° ${route.route_number}`, MARGIN, doc.y);
    if (route.route_code) {
      doc.fontSize(10).font('Helvetica').text(`Ruta: ${route.route_code}`);
    }
    doc.fontSize(10).text(`Estado: ${route.status.toUpperCase()}`);
    doc.text(`Fecha planeada: ${fmtDate(route.planned_date)}`);
    if (route.dispatch_started_at) {
      doc.text(`Despachada: ${fmtDate(route.dispatch_started_at)}`);
    }
    if (route.closed_at) {
      doc.text(`Cerrada: ${fmtDate(route.closed_at)}`);
    }
    doc.moveDown(0.3);
    this.hr(doc);
  }

  private drawRouteInfo(doc: PDFKit.PDFDocument, route: RouteForPdf) {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(11).text('Información de la Ruta');
    doc.font('Helvetica').fontSize(10);
    if (route.vehicle) {
      doc.text(
        `Vehículo: ${route.vehicle.plate} (${route.vehicle.type || 'N/A'}) ${route.vehicle.brand || ''} ${route.vehicle.model_name || ''}`.trim(),
      );
    } else {
      doc.text('Vehículo: —');
    }
    if (route.origin_location) {
      doc.text(`Origen: ${route.origin_location.name} (${route.origin_location.code || '—'})`);
    }
  }

  private drawDriverInfo(doc: PDFKit.PDFDocument, route: RouteForPdf) {
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').fontSize(11).text('Conductor / Personal');
    doc.font('Helvetica').fontSize(10);
    if (route.driver_user) {
      doc.text(
        `Conductor: ${route.driver_user.first_name || ''} ${route.driver_user.last_name || ''}`.trim() +
          (route.driver_user.document_number ? ` (CC ${route.driver_user.document_number})` : ''),
      );
    } else if (route.external_driver_name) {
      doc.text(
        `Conductor externo: ${route.external_driver_name}` +
          (route.external_driver_id_number ? ` (CC ${route.external_driver_id_number})` : ''),
      );
    } else {
      doc.text('Conductor: —');
    }
    const assistants = (route as any).assistants as Array<any> | undefined;
    if (assistants && assistants.length > 0) {
      const lines = assistants.map((a) => {
        if (a.user_id) {
          return `• Auxiliar #${a.user_id}${a.role ? ` (${a.role})` : ''}`;
        }
        return `• Auxiliar externo: ${a.external_name || '—'}${a.external_id_number ? ` (CC ${a.external_id_number})` : ''}${a.role ? ` - ${a.role}` : ''}`;
      });
      lines.forEach((l) => doc.text(l));
    }
    doc.moveDown(0.3);
    this.hr(doc);
  }

  private drawStopsTable(doc: PDFKit.PDFDocument, route: RouteForPdf) {
    const isClosed = this.isClosedRoute(route);

    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(11).text('Paradas');
    doc.fontSize(8).font('Helvetica').fillColor('#666');
    doc.text(
      isClosed
        ? 'Snapshot del cierre: casillas reflejan el estado real de cada parada.'
        : 'Llene en campo: marque las casillas y escriba el monto recaudado.',
    );
    doc.fillColor('black');
    doc.moveDown(0.2);

    // Column layout (sums to the printable width = PAGE_WIDTH - 2*MARGIN = 564).
    // [#, Remisión, Cliente/Dirección, A cobrar, Entrega, Recaudo, Recaudado $]
    const col_widths = [22, 74, 150, 74, 52, 52, 140];
    const aligns: Array<'left' | 'right' | 'center'> = [
      'center',
      'left',
      'left',
      'right',
      'center',
      'center',
      'left',
    ];
    const headers = [
      '#',
      'Remisión',
      'Cliente / Dirección',
      'A cobrar',
      'Entrega',
      'Recaudo',
      'Recaudado',
    ];

    const startX = MARGIN;
    const ROW_H = 28; // taller row: customer name + delivery address on 2 lines
    let y = doc.y;

    // Header row
    doc.font('Helvetica-Bold').fontSize(9);
    let x = startX;
    headers.forEach((h, i) => {
      doc.text(h, x, y, { width: col_widths[i], align: aligns[i] });
      x += col_widths[i];
    });
    y += 16;
    this.hr(doc, y - 4, MARGIN, PAGE_WIDTH - MARGIN * 2);
    y += 4;

    // Rows
    doc.font('Helvetica').fontSize(9);
    for (const stop of route.stops) {
      if (y > PAGE_HEIGHT - 200) {
        doc.addPage();
        y = MARGIN;
      }
      this.drawStopRow(doc, stop, isClosed, startX, y, col_widths, aligns);
      y += ROW_H;
      this.hr(doc, y - 6, MARGIN, PAGE_WIDTH - MARGIN * 2);
    }

    doc.y = y + 4;
    this.hr(doc);
  }

  /**
   * Draws a single stop row. The same layout serves both purposes:
   * - Operative (route not closed): empty checkboxes + a blank write-in line
   *   for the collected amount.
   * - Snapshot (route closed): checkboxes reflect the real settlement state and
   *   the collected amount is printed.
   */
  private drawStopRow(
    doc: PDFKit.PDFDocument,
    stop: RouteForPdf['stops'][number],
    isClosed: boolean,
    startX: number,
    y: number,
    col_widths: number[],
    aligns: Array<'left' | 'right' | 'center'>,
  ) {
    const dn = stop.dispatch_note;
    const is_released = stop.result === 'released' || stop.status === 'released';
    const is_rejected = stop.result === 'rejected' || stop.status === 'rejected';
    const customer = is_released
      ? '(Liberada)'
      : is_rejected
        ? '(Rechazada)'
        : dn?.customer_name || '—';

    // A cobrar: COD/no-prepaid grand_total. Prepaid stops have nothing to collect.
    const toCollect = stop.is_prepaid
      ? 'PREPAGADO'
      : dn
        ? COP.format(Number(dn.grand_total))
        : '—';

    // Real state for closed routes.
    const delivered = stop.result === 'delivered' || stop.result === 'partial';
    const collectedReal = !stop.is_prepaid && (delivered || Number(stop.collected_amount || 0) > 0);

    let x = startX;
    // Col 0: sequence
    doc.font('Helvetica').fontSize(9);
    doc.text(String(stop.stop_sequence), x, y + 4, { width: col_widths[0], align: aligns[0] });
    x += col_widths[0];

    // Col 1: remisión number
    doc.text(dn?.dispatch_number || '—', x, y + 4, { width: col_widths[1], align: aligns[1] });
    x += col_widths[1];

    // Col 2: customer name (line 1) + delivery address (line 2, gray, ellipsis).
    // No address for released/rejected stops (nothing to deliver there).
    const addressStr =
      is_released || is_rejected
        ? ''
        : formatPdfAddress(
            dn?.customer_address ??
              dn?.order?.shipping_address_snapshot ??
              dn?.order?.addresses_orders_shipping_address_idToaddresses,
          );
    doc.font('Helvetica').fontSize(9).fillColor('black');
    doc.text(customer, x, y + 2, {
      width: col_widths[2],
      align: aligns[2],
      lineBreak: false,
      ellipsis: true,
    });
    if (addressStr) {
      doc.font('Helvetica').fontSize(7).fillColor('#555');
      doc.text(addressStr, x, y + 14, {
        width: col_widths[2],
        align: aligns[2],
        lineBreak: false,
        ellipsis: true,
      });
      doc.font('Helvetica').fontSize(9).fillColor('black');
    }
    x += col_widths[2];

    // Col 3: A cobrar
    doc.text(toCollect, x, y + 4, { width: col_widths[3], align: aligns[3] });
    x += col_widths[3];

    // Col 4: Entrega checkbox (centered in its column)
    this.drawCheckbox(doc, x + col_widths[4] / 2 - 6, y + 2, isClosed && delivered);
    x += col_widths[4];

    // Col 5: Recaudo checkbox — N/A for prepaid stops.
    if (stop.is_prepaid) {
      doc.font('Helvetica-Bold').fontSize(8).text('N/A', x, y + 5, {
        width: col_widths[5],
        align: 'center',
      });
      doc.font('Helvetica').fontSize(9);
    } else {
      this.drawCheckbox(doc, x + col_widths[5] / 2 - 6, y + 2, isClosed && collectedReal);
    }
    x += col_widths[5];

    // Col 6: Recaudado $ — blank write-in line (operative) or real amount (closed).
    this.drawMoneyField(
      doc,
      x,
      y,
      col_widths[6],
      stop.is_prepaid ? '—' : isClosed ? COP.format(Number(stop.collected_amount || 0)) : null,
    );
  }

  /**
   * Draws a scanner-friendly checkbox: a bold square outline, plus a thick
   * check-mark stroke when `checked`. Drawn with vector primitives so it is
   * crisp at any zoom for the downstream AI scanner.
   */
  private drawCheckbox(doc: PDFKit.PDFDocument, x: number, y: number, checked: boolean) {
    const size = 12;
    doc.save();
    doc.lineWidth(1.2).strokeColor('#222');
    doc.rect(x, y, size, size).stroke();
    if (checked) {
      doc.lineWidth(2).strokeColor('#000');
      doc
        .moveTo(x + 2.5, y + size / 2)
        .lineTo(x + size / 2 - 1, y + size - 2.5)
        .lineTo(x + size - 1.5, y + 2)
        .stroke();
    }
    doc.restore();
    doc.strokeColor('black').lineWidth(1);
  }

  /**
   * Draws the "Recaudado $____" field. When `value` is null it renders the
   * "$" prefix plus a write-in underline for manual entry in the field; when a
   * value is given (closed snapshot) it prints the real collected amount over
   * the same baseline.
   */
  private drawMoneyField(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
    value: string | null,
  ) {
    const pad = 4;
    const lineY = y + 14;
    // Underline baseline always present so the field reads the same in both modes.
    doc.save();
    doc.lineWidth(0.8).strokeColor('#444');
    doc.moveTo(x + pad, lineY).lineTo(x + width - pad, lineY).stroke();
    doc.restore();
    doc.strokeColor('black').lineWidth(1);

    if (value === null) {
      doc.font('Helvetica').fontSize(9).fillColor('#444').text('$', x + pad, y + 4);
      doc.fillColor('black');
    } else {
      doc.font('Helvetica-Bold').fontSize(9).text(value, x + pad, y + 4, {
        width: width - pad * 2,
        align: 'left',
      });
      doc.font('Helvetica');
    }
  }

  /** A route shows real state only once it is closed; otherwise it is a blank field form. */
  private isClosedRoute(route: RouteForPdf): boolean {
    return route.status === 'closed';
  }

  private drawTotals(doc: PDFKit.PDFDocument, route: RouteForPdf) {
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(11).text('Resumen de Recaudo', MARGIN, doc.y, { align: 'right' });
    doc.font('Helvetica').fontSize(10);
    const label_x = PAGE_WIDTH - MARGIN - 220;
    const value_x = PAGE_WIDTH - MARGIN - 60;
    const line_h = 14;
    let y = doc.y;

    const lines: Array<[string, string]> = [
      ['Total a recaudar:', COP.format(Number(route.total_to_collect || 0))],
      ['Total prepagado:', COP.format(Number(route.total_prepaid || 0))],
      ['Total recaudado:', COP.format(Number(route.total_collected || 0))],
      ['Total cambios/devoluciones:', COP.format(Number(route.total_changes || 0))],
      ['Total retenciones:', COP.format(Number(route.total_withholdings || 0))],
      ['Total a crédito:', COP.format(Number(route.total_credit || 0))],
    ];
    if (route.declared_cash != null) {
      lines.push(['Efectivo declarado:', COP.format(Number(route.declared_cash))]);
    }
    if (route.cash_variance != null) {
      const variance = Number(route.cash_variance);
      lines.push([
        'Diferencia de caja:',
        COP.format(variance) + (variance === 0 ? ' (CUADRA)' : variance > 0 ? ' (SOBRA)' : ' (FALTA)'),
      ]);
    }

    for (const [label, value] of lines) {
      doc.text(label, label_x, y, { width: 150, align: 'right' });
      doc.text(value, value_x, y, { width: 80, align: 'right' });
      y += line_h;
    }
    doc.y = y + 10;
    this.hr(doc);
  }

  private drawSignatures(doc: PDFKit.PDFDocument) {
    doc.moveDown(1.2);
    const y = doc.y;
    const col1_x = MARGIN;
    const col2_x = PAGE_WIDTH / 2 + 10;
    const col_width = PAGE_WIDTH / 2 - MARGIN - 20;

    // Signature lines
    doc.moveTo(col1_x, y + 40).lineTo(col1_x + col_width, y + 40).stroke();
    doc.moveTo(col2_x, y + 40).lineTo(col2_x + col_width, y + 40).stroke();

    doc.font('Helvetica').fontSize(9);
    doc.text('Conductor / Responsable de la ruta', col1_x, y + 42, {
      width: col_width,
      align: 'center',
    });
    doc.text('Quien recibe / Cierra la planilla', col2_x, y + 42, {
      width: col_width,
      align: 'center',
    });
  }

  private drawFooter(doc: PDFKit.PDFDocument) {
    const range = doc.bufferedPageRange();
    const generated = `Generado el ${new Date().toLocaleString('es-CO')}`;
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Writing inside the bottom-margin band makes PDFKit auto-append a blank
      // page and pushes the footer onto it. Temporarily zero the bottom margin
      // (and disable line wrapping) so the footer stays on its own page.
      const prev_bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(8).fillColor('#666');
      doc.text(
        `${generated} — Página ${i + 1} de ${range.count}`,
        MARGIN,
        PAGE_HEIGHT - 20,
        { width: PAGE_WIDTH - MARGIN * 2, align: 'center', lineBreak: false },
      );
      doc.fillColor('black');
      doc.page.margins.bottom = prev_bottom;
    }
  }

  private hr(doc: PDFKit.PDFDocument, y?: number, x1?: number, x2?: number) {
    const yPos = y ?? doc.y;
    const a = x1 ?? MARGIN;
    const b = x2 ?? PAGE_WIDTH - MARGIN;
    doc.moveTo(a, yPos).lineTo(b, yPos).strokeColor('#999').stroke();
    doc.strokeColor('black');
  }
}
