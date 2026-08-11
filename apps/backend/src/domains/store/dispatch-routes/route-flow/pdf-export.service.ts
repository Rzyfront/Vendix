// pdfkit's CJS module exports the PDFDocument class directly, not under a
// `default` property. The default-style import `import X from 'pdfkit'`
// transpiles to `new (require('pdfkit').default)(...)` which throws
// `pdfkit_1.default is not a constructor`. Use namespace import + the
// `.default` / module-object fallback to cover both CJS and ESM-bridge
// environments (ts-node-watch, swc, tsc, esbuild).
import * as PDFKitNs from 'pdfkit';
import type { ArticleExitSummary } from '../utils/route-stop-calc';
import {
  PRINT_DEFAULTS,
  PRINT_FORMATS,
  type PrintDocumentConfig,
  type PrintFormat,
} from '../../settings/interfaces/store-settings.interface';
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

/** Millimetres to PostScript points, the unit PDFKit works in. */
const MM = 2.834645669;

/**
 * Resolved page box for one render pass. Nothing in this builder may read a
 * page dimension from anywhere else: the whole point of QUI-666 is that the
 * paper is configurable per store, so `PAGE_WIDTH`/`MARGIN` module constants
 * (what this file used to have) are exactly the bug.
 */
export interface PlanillaLayout {
  format: PrintFormat;
  width: number;
  height: number;
  margin: number;
  /**
   * Drawable width. EVERY column width and x anchor derives from this — the
   * old layout hardcoded widths that summed to 564 pt (letter minus a 24 pt
   * margin), which overflowed or left dead space on any other paper.
   */
  content: number;
  /** Roll paper: the height is measured from the content, not from the page. */
  roll: boolean;
  /** Multiplies every font size and vertical metric so narrow paper still fits. */
  font_scale: number;
}

/**
 * Page geometry per format, mirroring `invoice-pdf.builder.ts:GEOMETRY`.
 *
 * `margin` here is the format's own default; for sheet formats it is overridden
 * by `receipts.printing.dispatch_route.margin_mm`. Roll formats keep theirs:
 * a receipt roll has no page margin to speak of, and `PrintDocumentConfig`
 * documents `margin_mm` as ignored there.
 *
 * A roll is a poor fit for a 7-column route sheet and the `font_scale` values
 * say so honestly — but it must not BREAK, so the columns compress with the
 * paper and every narrow cell ellipsises instead of wrapping into the next row.
 */
const GEOMETRY: Record<
  PrintFormat,
  { width: number; height: number; margin: number; roll: boolean; font_scale: number }
> = {
  letter: {
    width: 612,
    height: 792,
    margin: 24,
    roll: false,
    font_scale: 1,
  },
  a4: {
    // 210 × 297 mm — the default for this document. Narrower and taller than
    // letter, so the same margin leaves ~14 pt less printable width.
    width: 210 * MM,
    height: 297 * MM,
    margin: 8 * MM,
    roll: false,
    font_scale: 1,
  },
  half_letter: {
    // Half a letter sheet. The fixed blocks (header, route info, driver,
    // totals, signatures) already eat most of the page at letter density, so
    // the type is scaled down to leave room for actual stops.
    width: 612,
    height: 396,
    margin: 14,
    roll: false,
    font_scale: 0.78,
  },
  thermal_80: {
    width: 80 * MM,
    // Replaced by the measured content height; see `generate`.
    height: 0,
    margin: 8,
    roll: true,
    font_scale: 0.62,
  },
  thermal_58: {
    width: 58 * MM,
    height: 0,
    margin: 6,
    roll: true,
    font_scale: 0.5,
  },
};

/** Probe height for the roll measuring pass: tall enough never to break a page. */
const ROLL_PROBE_HEIGHT = 20000;

/** Bottom band a roll reserves for the page footer, in points. */
const ROLL_FOOTER_RESERVE = 28;

/** Distance from the bottom page edge to the footer baseline, in points. */
const FOOTER_OFFSET = 20;

/** A configured margin may never squeeze the table below this printable width. */
const MIN_CONTENT_WIDTH = 200;

/** Fonts never scale below this: an illegible sheet is a broken sheet. */
const MIN_FONT_PT = 5;

export class PdfExportService {
  /**
   * @param print_config `receipts.printing.dispatch_route` for the owning store.
   *        Absent/partial ⇒ `PRINT_DEFAULTS.dispatch_route` (A4, 8 mm margin).
   *        `copies` is a printer-side concern and is not read here: this method
   *        returns one buffer, the caller decides how many times to print it.
   */
  async generate(
    route: RouteForPdf,
    articles?: ArticleExitSummary,
    print_config?: PrintDocumentConfig | null,
  ): Promise<Buffer> {
    const layout = this.resolveLayout(print_config);

    if (!layout.roll) {
      const { buffer } = await this.render(route, articles, layout);
      return buffer;
    }

    // Roll paper has no fixed height. Render once on a very tall page just to
    // measure where the content ends, then render again on a page cut to that
    // height. Manual page breaks are disabled on rolls precisely so both passes
    // lay the content out identically.
    const probe = await this.render(route, articles, {
      ...layout,
      height: ROLL_PROBE_HEIGHT,
    });
    // `margin * 2` (not `margin`): PDFKit breaks the page as soon as the next
    // line would cross `height - bottomMargin`, so cutting exactly at the
    // measured end still spills onto a second page — and a receipt printer cuts
    // the paper between pages. The extra band is the footer's.
    const { buffer } = await this.render(route, articles, {
      ...layout,
      height: Math.max(
        probe.end_y + layout.margin * 2 + ROLL_FOOTER_RESERVE,
        200,
      ),
    });
    return buffer;
  }

  /**
   * Turns the store's per-document print config into a concrete page box.
   * Unknown/absent format falls back to `PRINT_DEFAULTS.dispatch_route`, so a
   * store that never opens the print settings screen keeps getting the A4
   * thin-margin sheet this document needs.
   */
  private resolveLayout(config?: PrintDocumentConfig | null): PlanillaLayout {
    const fallback = PRINT_DEFAULTS.dispatch_route;
    const requested = config?.format;
    const format: PrintFormat =
      requested && (PRINT_FORMATS as readonly string[]).includes(requested)
        ? requested
        : fallback.format;
    const geometry = GEOMETRY[format];
    const margin = geometry.roll
      ? geometry.margin
      : this.resolveMargin(geometry, config?.margin_mm ?? fallback.margin_mm);

    return {
      format,
      width: geometry.width,
      height: geometry.height,
      margin,
      content: geometry.width - margin * 2,
      roll: geometry.roll,
      font_scale: geometry.font_scale,
    };
  }

  /**
   * Millimetre margin from settings, clamped so a fat margin can never starve
   * the table: below `MIN_CONTENT_WIDTH` the columns stop being a table.
   */
  private resolveMargin(
    geometry: { width: number; margin: number },
    margin_mm?: number,
  ): number {
    if (
      typeof margin_mm !== 'number' ||
      !Number.isFinite(margin_mm) ||
      margin_mm < 0
    ) {
      return geometry.margin;
    }
    const max = Math.max((geometry.width - MIN_CONTENT_WIDTH) / 2, 0);
    return Math.min(margin_mm * MM, max);
  }

  /** Scaled font size, floored so extreme formats stay readable. */
  private fz(L: PlanillaLayout, size: number): number {
    return Math.max(size * L.font_scale, MIN_FONT_PT);
  }

  /** Scaled vertical/geometric metric. */
  private sz(L: PlanillaLayout, value: number): number {
    return value * L.font_scale;
  }

  /**
   * Distributes a set of REFERENCE column widths over the real printable width.
   *
   * The reference numbers are proportions, not points: the old code wrote them
   * as absolute widths summing to the letter printable width, which is exactly
   * what stopped being a constant once the format became configurable. Float
   * drift is absorbed by the last column so the row always sums to `content`.
   */
  private scaleColumns(reference: number[], content: number): number[] {
    const total = reference.reduce((a, b) => a + b, 0);
    const scaled = reference.map((w) => (w * content) / total);
    const drift = content - scaled.reduce((a, b) => a + b, 0);
    scaled[scaled.length - 1] += drift;
    return scaled;
  }

  /**
   * Absolute-positioned blocks (totals, signatures) are drawn with explicit
   * coordinates and PDFKit will not reflow them, so they need whole-block room.
   * No-op on rolls, whose page grows to fit the content.
   */
  private ensureSpace(doc: PDFKit.PDFDocument, L: PlanillaLayout, needed: number) {
    if (L.roll) return;
    if (doc.y + needed > L.height - L.margin) {
      doc.addPage();
    }
  }

  private render(
    route: RouteForPdf,
    articles: ArticleExitSummary | undefined,
    L: PlanillaLayout,
  ): Promise<{ buffer: Buffer; end_y: number }> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: [L.width, L.height],
          margin: L.margin,
          bufferPages: true,
        });

        // Highest cursor reached across ALL pages. `doc.y` resets on every page
        // break, so the roll measurement hooks `addPage` (PDFKit's own
        // auto-break funnels through `continueOnNewPage` → `addPage` too) and
        // snapshots the cursor before it is lost.
        let end_y = L.margin;
        const original_add_page = doc.addPage.bind(doc);
        doc.addPage = (options?: PDFKit.PDFDocumentOptions) => {
          end_y = Math.max(end_y, doc.y);
          return original_add_page(options);
        };

        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), end_y }));
        doc.on('error', reject);

        this.drawHeader(doc, L);
        this.drawTitle(doc, L, route);
        this.drawRouteInfo(doc, L, route);
        this.drawDriverInfo(doc, L, route);
        this.drawStopsTable(doc, L, route);
        this.ensureSpace(doc, L, this.sz(L, 150));
        this.drawTotals(doc, L, route);
        this.ensureSpace(doc, L, this.sz(L, 70));
        this.drawSignatures(doc, L);
        // Last page: consolidated goods-out detail. Drawn BEFORE the footer so
        // drawFooter's bufferedPageRange numbers this page too.
        if (articles) {
          this.drawArticleDetailPage(doc, L, route, articles);
        }
        // Captured before the footer: `drawFooter` switches pages and would
        // report the cursor of whichever page it visited last.
        end_y = Math.max(end_y, doc.y);
        this.drawFooter(doc, L);

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
    L: PlanillaLayout,
    route: RouteForPdf,
    articles: ArticleExitSummary,
  ) {
    doc.addPage();

    // Title (centered, bold).
    doc
      .font('Helvetica-Bold')
      .fontSize(this.fz(L, 16))
      .text('DETALLE DE SALIDA DE ARTÍCULOS', L.margin, L.margin, {
        align: 'center',
        width: L.content,
      });
    doc.moveDown(0.4);

    // Origin-warehouse subheader (only when known).
    if (route.origin_location) {
      const codePart = route.origin_location.code
        ? `${route.origin_location.code} - `
        : '';
      doc
        .font('Helvetica')
        .fontSize(this.fz(L, 10))
        .text(`Bodega: ${codePart}${route.origin_location.name}`, L.margin, doc.y, {
          align: 'center',
          width: L.content,
        });
      doc.moveDown(0.3);
    }
    this.hr(doc, L);
    doc.moveDown(0.3);

    // Column proportions. Código is widened (SKUs like
    // ROKU-GAMI-NINT-0024-V38 are long) so it stays on one line on a sheet.
    const col_widths = this.scaleColumns([140, 250, 64, 110], L.content);
    const aligns: Array<'left' | 'right' | 'center'> = [
      'left',
      'left',
      'center',
      'right',
    ];
    const headers = ['Código', 'Descripción', 'Unidad', 'Total Und'];
    const startX = L.margin;

    // Draw (and re-draw on page breaks) the column header; returns the y of the
    // first data row.
    const drawColHeader = (yTop: number): number => {
      doc.font('Helvetica-Bold').fontSize(this.fz(L, 9));
      let hx = startX;
      headers.forEach((h, i) => {
        doc.text(h, hx, yTop, {
          width: col_widths[i],
          align: aligns[i],
          lineBreak: false,
          ellipsis: true,
        });
        hx += col_widths[i];
      });
      const yAfter = yTop + this.sz(L, 16);
      this.hr(doc, L, yAfter - this.sz(L, 4));
      return yAfter + this.sz(L, 4);
    };

    let y = drawColHeader(doc.y);

    if (articles.rows.length === 0) {
      doc.font('Helvetica').fontSize(this.fz(L, 10)).fillColor('#555');
      doc.text('Sin artículos despachados en esta ruta.', L.margin, y + this.sz(L, 4), {
        width: L.content,
        align: 'left',
      });
      doc.fillColor('black');
      y += this.sz(L, 24);
    } else {
      // Dynamic row height: measure the tallest cell so a long código or
      // descripción makes the ROW grow instead of overlapping the next one.
      // The código keeps its full text (never truncated) — legibility matters
      // on a picking sheet — at a slightly smaller font so most fit one line.
      const CELL_PAD_Y = this.sz(L, 5);
      const CODE_FONT = this.fz(L, 8);
      const BODY_FONT = this.fz(L, 9);
      for (const row of articles.rows) {
        doc.font('Helvetica').fontSize(CODE_FONT);
        const codeH = doc.heightOfString(row.code, {
          width: col_widths[0] - this.sz(L, 4),
        });
        doc.font('Helvetica').fontSize(BODY_FONT);
        const nameH = doc.heightOfString(row.name, {
          width: col_widths[1] - this.sz(L, 4),
        });
        const rowH = Math.max(codeH, nameH, this.sz(L, 11)) + CELL_PAD_Y * 2;

        // Page break accounts for the FULL measured row height. Never on a
        // roll: its page is cut to the content, so a break would desync the
        // measuring pass from the final one.
        if (!L.roll && y + rowH > L.height - this.sz(L, 60)) {
          doc.addPage();
          y = drawColHeader(L.margin);
        }

        const cellY = y + CELL_PAD_Y;
        let x = startX;
        // Col 0: código (smaller font, wraps within the widened column).
        doc.font('Helvetica').fontSize(CODE_FONT).fillColor('black');
        doc.text(row.code, x, cellY, {
          width: col_widths[0] - this.sz(L, 4),
          align: aligns[0],
        });
        x += col_widths[0];
        // Col 1: descripción (wraps within its column).
        doc.font('Helvetica').fontSize(BODY_FONT);
        doc.text(row.name, x, cellY, {
          width: col_widths[1] - this.sz(L, 4),
          align: aligns[1],
        });
        x += col_widths[1];
        // Col 2: unidad
        doc.text(row.unit, x, cellY, {
          width: col_widths[2],
          align: aligns[2],
          lineBreak: false,
          ellipsis: true,
        });
        x += col_widths[2];
        // Col 3: total und
        doc.text(row.total_units.toLocaleString('es-CO'), x, cellY, {
          width: col_widths[3],
          align: aligns[3],
          lineBreak: false,
          ellipsis: true,
        });

        y += rowH;
        this.hr(doc, L, y - this.sz(L, 2));
      }
    }

    // Sheet footer: totals in bold. Push to a new page if too close to the
    // bottom margin band (writing there would auto-append a blank page).
    if (!L.roll && y > L.height - this.sz(L, 80)) {
      doc.addPage();
      y = L.margin;
    }
    const footerY = y + this.sz(L, 8);
    doc
      .font('Helvetica-Bold')
      .fontSize(this.fz(L, 10))
      .text(
        `TOTAL ARTÍCULOS: ${articles.article_count}    TOTAL UNIDADES: ${articles.total_units.toLocaleString('es-CO')}`,
        L.margin,
        footerY,
        { width: L.content, align: 'right' },
      );
    doc.font('Helvetica');
  }

  private drawHeader(doc: PDFKit.PDFDocument, L: PlanillaLayout) {
    doc
      .font('Helvetica-Bold')
      .fontSize(this.fz(L, 18))
      .text('PLANILLA DE DESPACHO', L.margin, L.margin, {
        align: 'center',
        width: L.content,
      });
    doc
      .fontSize(this.fz(L, 10))
      .font('Helvetica')
      .text('(Ruta de Recaudo)', L.margin, doc.y, {
        align: 'center',
        width: L.content,
      });
    doc.moveDown(0.5);
    this.hr(doc, L);
  }

  private drawTitle(doc: PDFKit.PDFDocument, L: PlanillaLayout, route: RouteForPdf) {
    doc.moveDown(0.4);
    doc
      .font('Helvetica-Bold')
      .fontSize(this.fz(L, 14))
      .text(`Planilla N° ${route.route_number}`, L.margin, doc.y, {
        width: L.content,
      });
    if (route.route_code) {
      doc
        .fontSize(this.fz(L, 10))
        .font('Helvetica')
        .text(`Ruta: ${route.route_code}`, { width: L.content });
    }
    doc.fontSize(this.fz(L, 10)).font('Helvetica');
    doc.text(`Estado: ${route.status.toUpperCase()}`, { width: L.content });
    doc.text(`Fecha planeada: ${fmtDate(route.planned_date)}`, { width: L.content });
    if (route.dispatch_started_at) {
      doc.text(`Despachada: ${fmtDate(route.dispatch_started_at)}`, {
        width: L.content,
      });
    }
    if (route.closed_at) {
      doc.text(`Cerrada: ${fmtDate(route.closed_at)}`, { width: L.content });
    }
    doc.moveDown(0.3);
    this.hr(doc, L);
  }

  private drawRouteInfo(doc: PDFKit.PDFDocument, L: PlanillaLayout, route: RouteForPdf) {
    doc.moveDown(0.3);
    doc
      .font('Helvetica-Bold')
      .fontSize(this.fz(L, 11))
      .text('Información de la Ruta', L.margin, doc.y, { width: L.content });
    doc.font('Helvetica').fontSize(this.fz(L, 10));
    if (route.vehicle) {
      doc.text(
        `Vehículo: ${route.vehicle.plate} (${route.vehicle.type || 'N/A'}) ${route.vehicle.brand || ''} ${route.vehicle.model_name || ''}`.trim(),
        { width: L.content },
      );
    } else {
      doc.text('Vehículo: —', { width: L.content });
    }
    if (route.origin_location) {
      doc.text(
        `Origen: ${route.origin_location.name} (${route.origin_location.code || '—'})`,
        { width: L.content },
      );
    }
  }

  private drawDriverInfo(doc: PDFKit.PDFDocument, L: PlanillaLayout, route: RouteForPdf) {
    doc.moveDown(0.2);
    doc
      .font('Helvetica-Bold')
      .fontSize(this.fz(L, 11))
      .text('Conductor / Personal', L.margin, doc.y, { width: L.content });
    doc.font('Helvetica').fontSize(this.fz(L, 10));
    if (route.driver_user) {
      doc.text(
        `Conductor: ${route.driver_user.first_name || ''} ${route.driver_user.last_name || ''}`.trim() +
          (route.driver_user.document_number ? ` (CC ${route.driver_user.document_number})` : ''),
        { width: L.content },
      );
    } else if (route.external_driver_name) {
      doc.text(
        `Conductor externo: ${route.external_driver_name}` +
          (route.external_driver_id_number ? ` (CC ${route.external_driver_id_number})` : ''),
        { width: L.content },
      );
    } else {
      doc.text('Conductor: —', { width: L.content });
    }
    const assistants = (route as any).assistants as Array<any> | undefined;
    if (assistants && assistants.length > 0) {
      const lines = assistants.map((a) => {
        if (a.user_id) {
          return `• Auxiliar #${a.user_id}${a.role ? ` (${a.role})` : ''}`;
        }
        return `• Auxiliar externo: ${a.external_name || '—'}${a.external_id_number ? ` (CC ${a.external_id_number})` : ''}${a.role ? ` - ${a.role}` : ''}`;
      });
      lines.forEach((l) => doc.text(l, { width: L.content }));
    }
    doc.moveDown(0.3);
    this.hr(doc, L);
  }

  private drawStopsTable(doc: PDFKit.PDFDocument, L: PlanillaLayout, route: RouteForPdf) {
    const isClosed = this.isClosedRoute(route);

    doc.moveDown(0.3);
    doc
      .font('Helvetica-Bold')
      .fontSize(this.fz(L, 11))
      .text('Paradas', L.margin, doc.y, { width: L.content });
    doc.fontSize(this.fz(L, 8)).font('Helvetica').fillColor('#666');
    doc.text(
      isClosed
        ? 'Snapshot del cierre: casillas reflejan el estado real de cada parada.'
        : 'Llene en campo: marque las casillas y escriba el monto recaudado.',
      { width: L.content },
    );
    doc.fillColor('black');
    doc.moveDown(0.2);

    // Column PROPORTIONS, redistributed over the real printable width:
    // [#, Remisión, Cliente/Dirección, A cobrar, Entrega, Recaudo, Recaudado $]
    const col_widths = this.scaleColumns([22, 74, 150, 74, 52, 52, 140], L.content);
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

    const startX = L.margin;
    // Taller row: customer name + delivery address on 2 lines.
    const ROW_H = this.sz(L, 28);

    // Re-drawn after every page break so a continuation page is still a table
    // and not a column of orphan numbers.
    const drawColHeader = (yTop: number): number => {
      doc.font('Helvetica-Bold').fontSize(this.fz(L, 9));
      let hx = startX;
      headers.forEach((h, i) => {
        doc.text(h, hx, yTop, {
          width: col_widths[i],
          align: aligns[i],
          lineBreak: false,
          ellipsis: true,
        });
        hx += col_widths[i];
      });
      const yAfter = yTop + this.sz(L, 16);
      this.hr(doc, L, yAfter - this.sz(L, 4));
      return yAfter + this.sz(L, 4);
    };

    let y = drawColHeader(doc.y);

    // Rows
    doc.font('Helvetica').fontSize(this.fz(L, 9));
    for (const stop of route.stops) {
      // Reserve room for the totals + signatures blocks that follow. Never on a
      // roll: its page is cut to the content.
      if (!L.roll && y + ROW_H > L.height - this.sz(L, 200)) {
        doc.addPage();
        y = drawColHeader(L.margin);
        doc.font('Helvetica').fontSize(this.fz(L, 9));
      }
      this.drawStopRow(doc, L, stop, isClosed, startX, y, col_widths, aligns);
      y += ROW_H;
      this.hr(doc, L, y - this.sz(L, 6));
    }

    doc.y = y + this.sz(L, 4);
    this.hr(doc, L);
  }

  /**
   * Draws a single stop row. The same layout serves both purposes:
   * - Operative (route not closed): empty checkboxes + a blank write-in line
   *   for the collected amount.
   * - Snapshot (route closed): checkboxes reflect the real settlement state and
   *   the collected amount is printed.
   *
   * Every narrow cell is `lineBreak: false, ellipsis: true`: on a compressed
   * page a wrapped cell would spill into the next row instead of the row
   * growing, which is the visible way a format change "breaks" a fixed-height
   * table.
   */
  private drawStopRow(
    doc: PDFKit.PDFDocument,
    L: PlanillaLayout,
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

    const clip = { lineBreak: false as const, ellipsis: true as const };
    const line1_y = y + this.sz(L, 4);

    let x = startX;
    // Col 0: sequence
    doc.font('Helvetica').fontSize(this.fz(L, 9));
    doc.text(String(stop.stop_sequence), x, line1_y, {
      width: col_widths[0],
      align: aligns[0],
      ...clip,
    });
    x += col_widths[0];

    // Col 1: remisión number
    doc.text(dn?.dispatch_number || '—', x, line1_y, {
      width: col_widths[1],
      align: aligns[1],
      ...clip,
    });
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
    doc.font('Helvetica').fontSize(this.fz(L, 9)).fillColor('black');
    doc.text(customer, x, y + this.sz(L, 2), {
      width: col_widths[2],
      align: aligns[2],
      ...clip,
    });
    if (addressStr) {
      doc.font('Helvetica').fontSize(this.fz(L, 7)).fillColor('#555');
      doc.text(addressStr, x, y + this.sz(L, 14), {
        width: col_widths[2],
        align: aligns[2],
        ...clip,
      });
      doc.font('Helvetica').fontSize(this.fz(L, 9)).fillColor('black');
    }
    x += col_widths[2];

    // Col 3: A cobrar
    doc.text(toCollect, x, line1_y, {
      width: col_widths[3],
      align: aligns[3],
      ...clip,
    });
    x += col_widths[3];

    // Col 4: Entrega checkbox (centered in its column)
    const box = Math.min(this.sz(L, 12), col_widths[4] - 2, col_widths[5] - 2);
    this.drawCheckbox(
      doc,
      x + col_widths[4] / 2 - box / 2,
      y + this.sz(L, 2),
      box,
      isClosed && delivered,
    );
    x += col_widths[4];

    // Col 5: Recaudo checkbox — N/A for prepaid stops.
    if (stop.is_prepaid) {
      doc
        .font('Helvetica-Bold')
        .fontSize(this.fz(L, 8))
        .text('N/A', x, y + this.sz(L, 5), {
          width: col_widths[5],
          align: 'center',
          ...clip,
        });
      doc.font('Helvetica').fontSize(this.fz(L, 9));
    } else {
      this.drawCheckbox(
        doc,
        x + col_widths[5] / 2 - box / 2,
        y + this.sz(L, 2),
        box,
        isClosed && collectedReal,
      );
    }
    x += col_widths[5];

    // Col 6: Recaudado $ — blank write-in line (operative) or real amount (closed).
    this.drawMoneyField(
      doc,
      L,
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
  private drawCheckbox(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    size: number,
    checked: boolean,
  ) {
    doc.save();
    doc.lineWidth(1.2).strokeColor('#222');
    doc.rect(x, y, size, size).stroke();
    if (checked) {
      doc.lineWidth(2).strokeColor('#000');
      doc
        .moveTo(x + size * 0.21, y + size / 2)
        .lineTo(x + size / 2 - size * 0.08, y + size - size * 0.21)
        .lineTo(x + size - size * 0.13, y + size * 0.17)
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
    L: PlanillaLayout,
    x: number,
    y: number,
    width: number,
    value: string | null,
  ) {
    const pad = this.sz(L, 4);
    const lineY = y + this.sz(L, 14);
    // Underline baseline always present so the field reads the same in both modes.
    doc.save();
    doc.lineWidth(0.8).strokeColor('#444');
    doc.moveTo(x + pad, lineY).lineTo(x + width - pad, lineY).stroke();
    doc.restore();
    doc.strokeColor('black').lineWidth(1);

    if (value === null) {
      doc
        .font('Helvetica')
        .fontSize(this.fz(L, 9))
        .fillColor('#444')
        .text('$', x + pad, y + this.sz(L, 4), { lineBreak: false });
      doc.fillColor('black');
    } else {
      doc
        .font('Helvetica-Bold')
        .fontSize(this.fz(L, 9))
        .text(value, x + pad, y + this.sz(L, 4), {
          width: width - pad * 2,
          align: 'left',
          lineBreak: false,
          ellipsis: true,
        });
      doc.font('Helvetica');
    }
  }

  /** A route shows real state only once it is closed; otherwise it is a blank field form. */
  private isClosedRoute(route: RouteForPdf): boolean {
    return route.status === 'closed';
  }

  private drawTotals(doc: PDFKit.PDFDocument, L: PlanillaLayout, route: RouteForPdf) {
    doc.moveDown(0.4);
    doc
      .font('Helvetica-Bold')
      .fontSize(this.fz(L, 11))
      .text('Resumen de Recaudo', L.margin, doc.y, {
        align: 'right',
        width: L.content,
      });
    doc.font('Helvetica').fontSize(this.fz(L, 10));

    // Right-anchored two-column block, never wider than the printable area —
    // the old absolute offsets (right − 220 / right − 60 with an 80 pt value
    // column) actually ran 20 pt PAST the right margin on letter and would have
    // run off the page entirely on a roll.
    const block_w = Math.min(this.sz(L, 240), L.content);
    const block_x = L.margin + L.content - block_w;
    const label_w = block_w * 0.6;
    const value_w = block_w - label_w;
    const line_h = this.sz(L, 14);
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
      doc.text(label, block_x, y, {
        width: label_w,
        align: 'right',
        lineBreak: false,
        ellipsis: true,
      });
      doc.text(value, block_x + label_w, y, {
        width: value_w,
        align: 'right',
        lineBreak: false,
        ellipsis: true,
      });
      y += line_h;
    }
    doc.y = y + this.sz(L, 10);
    this.hr(doc, L);
  }

  private drawSignatures(doc: PDFKit.PDFDocument, L: PlanillaLayout) {
    doc.moveDown(1.2);
    const y = doc.y;
    const labels = [
      'Conductor / Responsable de la ruta',
      'Quien recibe / Cierra la planilla',
    ];
    doc.font('Helvetica').fontSize(this.fz(L, 9));

    const line_drop = this.sz(L, 40);
    const label_drop = this.sz(L, 42);

    if (L.roll) {
      // Two side-by-side signature boxes are unusable on a 58/80 mm roll; stack
      // them instead so each keeps the full paper width.
      let block_y = y;
      for (const label of labels) {
        doc
          .moveTo(L.margin, block_y + line_drop)
          .lineTo(L.margin + L.content, block_y + line_drop)
          .stroke();
        doc.text(label, L.margin, block_y + label_drop, {
          width: L.content,
          align: 'center',
        });
        block_y += label_drop + this.sz(L, 22);
      }
      doc.y = block_y;
      return;
    }

    const gap = this.sz(L, 20);
    const col_width = (L.content - gap) / 2;
    const col1_x = L.margin;
    const col2_x = L.margin + col_width + gap;

    // Signature lines
    doc.moveTo(col1_x, y + line_drop).lineTo(col1_x + col_width, y + line_drop).stroke();
    doc.moveTo(col2_x, y + line_drop).lineTo(col2_x + col_width, y + line_drop).stroke();

    doc.text(labels[0], col1_x, y + label_drop, {
      width: col_width,
      align: 'center',
    });
    doc.text(labels[1], col2_x, y + label_drop, {
      width: col_width,
      align: 'center',
    });
  }

  private drawFooter(doc: PDFKit.PDFDocument, L: PlanillaLayout) {
    const range = doc.bufferedPageRange();
    const generated = `Generado el ${new Date().toLocaleString('es-CO')}`;
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Writing inside the bottom-margin band makes PDFKit auto-append a blank
      // page and pushes the footer onto it. Temporarily zero the bottom margin
      // (and disable line wrapping) so the footer stays on its own page.
      const prev_bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(this.fz(L, 8)).fillColor('#666');
      doc.text(
        `${generated} — Página ${i + 1} de ${range.count}`,
        L.margin,
        // `doc.page.height`, not `L.height`: on a roll the final page box is
        // computed per render pass and `switchToPage` already points at it.
        doc.page.height - FOOTER_OFFSET,
        { width: L.content, align: 'center', lineBreak: false },
      );
      doc.fillColor('black');
      doc.page.margins.bottom = prev_bottom;
    }
  }

  private hr(
    doc: PDFKit.PDFDocument,
    L: PlanillaLayout,
    y?: number,
    x1?: number,
    x2?: number,
  ) {
    const yPos = y ?? doc.y;
    const a = x1 ?? L.margin;
    const b = x2 ?? L.margin + L.content;
    doc.moveTo(a, yPos).lineTo(b, yPos).strokeColor('#999').stroke();
    doc.strokeColor('black');
  }
}
