// `import PDFDocument from 'pdfkit'` compila pero revienta en producción con
// `pdfkit_1.default is not a constructor`: tsconfig no tiene `esModuleInterop`,
// así que tsc emite `pdfkit_1.default` sin el helper `__importDefault` y pdfkit
// exporta la clase directamente. Ver `@common/pdf/pdfkit` para el detalle.
import { PDFDocument } from '@common/pdf/pdfkit';
import { amountToSpanishWords } from '@common/utils/amount-in-words.util';
import { PrintFormat } from '../../settings/interfaces/store-settings.interface';

export interface InvoicePdfData {
  // Emisor
  company_name: string;
  company_nit: string;
  company_address?: string;
  company_phone?: string;
  company_email?: string;
  company_logo_buffer?: Buffer;
  /** Commercial name when it differs from the legal one. */
  company_trade_name?: string;
  /** Tax regime label, mandatory on the graphic representation. */
  company_tax_regime?: string;
  /** DIAN tax responsibility codes (O-13, O-47, …). */
  company_tax_responsibilities?: string[];

  // Resolucion DIAN
  resolution_number?: string;
  resolution_date?: string;
  resolution_range_from?: number;
  resolution_range_to?: number;
  resolution_prefix?: string;
  resolution_valid_from?: string;
  resolution_valid_to?: string;

  // Cliente
  customer_name: string;
  customer_tax_id?: string;
  customer_address?: string;
  customer_email?: string;

  // Factura
  invoice_number: string;
  invoice_type: string;
  issue_date: string;
  due_date?: string;
  payment_date?: string;
  currency?: string;
  notes?: string;

  // Items
  items: InvoicePdfItem[];

  // Impuestos desglosados
  taxes: InvoicePdfTax[];

  // Totales
  subtotal_amount: number;
  discount_amount: number;
  tax_amount: number;
  withholding_amount: number;
  total_amount: number;

  // DIAN
  cufe?: string;
  /**
   * CONTENIDO del código QR tal como se transmitió, leído de `invoices.qr_code`.
   *
   * No es «la URL»: el Anexo Técnico 1.9 §11.7 define el QR como un bloque de
   * once líneas —diez campos etiquetados más la URL del catálogo— que permite al
   * adquiriente verificar el documento leyendo el propio código, sin conexión.
   * `CufeCalculator.buildQrContent()` lo compone y el proveedor lo persiste.
   *
   * ESTE BUILDER NO LO RECOMPONE, Y LA DECISIÓN ES DELIBERADA. La representación
   * gráfica debe mostrar lo que se transmitió, no una reconstrucción que puede
   * discrepar: aquí no hay hora de emisión, ni ambiente DIAN, ni el desglose
   * IVA/INC/ICA, ni las identificaciones sin dígito de verificación, y la fecha
   * llega ya formateada como `DD/MM/YYYY` en vez del `AAAA-MM-DD` del anexo.
   * Recomponer con esos datos produciría un QR distinto del que la DIAN validó —
   * exactamente la divergencia que el §11.7 existe para impedir.
   *
   * Se tolera recibir aquí una URL suelta: es lo que persistieron los documentos
   * anteriores al cambio y lo que usa la vista previa de formato.
   */
  qr_code?: string;
  /**
   * `qr_code` rendered as a PNG, ready for `doc.image()`.
   *
   * Passed in rather than generated here for the same reason as
   * `company_logo_buffer`: this builder is a static class, so it cannot inject
   * `QrService`, and keeping it free of I/O leaves it testable without `qrcode`.
   *
   * When absent the section degrades to the URL as text — which is what it used
   * to do unconditionally, and the reason a printed invoice carried no scannable
   * code at all: a PDF hyperlink works on screen and vanishes on paper.
   */
  qr_code_buffer?: Buffer;

  // Pago
  payment_form?: string;
  payment_method?: string;

  /**
   * Paper format of this graphic representation. Comes from
   * `store_settings.settings.receipts.invoice_format`; defaults to `letter`,
   * which is what this builder produced before the format was configurable.
   * The format changes the box only — every mandatory element (issuer legal
   * data, resolution, items, taxes, totals, CUFE, verification URL) is drawn in
   * all formats.
   */
  format?: PrintFormat;
}

export interface InvoicePdfItem {
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  // "Empaque por tarifa" snapshot (mirrors order-pdf.builder): applied price
  // tier label and the real stock units consumed when packaging expands qty.
  applied_price_tier_name?: string | null;
  stock_units_consumed?: number | null;
  // Serial number(s) snapshot (CSV) captured at sale time for serialized
  // products (QUI-431). Rendered as a sub-line under the description.
  serial_numbers_snapshot?: string | null;
}

export interface InvoicePdfTax {
  tax_name: string;
  tax_rate: number;
  taxable_amount: number;
  tax_amount: number;
}

const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
});

/** Millimetres to PostScript points, the unit PDFKit works in. */
const MM = 2.834645669;

/**
 * Page geometry per format. `roll` switches the whole document to a
 * single-column layout: a 6-column table is unreadable at 58 mm, and a receipt
 * printer feeds continuous paper, so the height is measured from the content
 * instead of being fixed (see `generate`).
 */
export interface PdfLayout {
  format: PrintFormat;
  width: number;
  height: number;
  margin: number;
  /** Drawable width — every `width:` option derives from this. */
  content: number;
  roll: boolean;
  /** Multiplies every font size so narrow paper stays legible. */
  font_scale: number;
  /**
   * Blank space before the legal footer, in `moveDown` units. Generous on a
   * letter sheet, minimal where every point counts (half letter) or where it
   * would only waste paper (roll).
   */
  footer_gap: number;
  /**
   * Banda al pie que el contenido NO puede ocupar, reservada para repetir el QR
   * en cada página (Anexo Técnico 1.9 §11.7).
   *
   * Vale 0 salvo en documentos de más de una página: reservarla siempre encogería
   * la caja de la factura de una sola página —el caso normal— sin que nadie
   * aproveche el hueco, y en `half_letter` esos ~72 pt son el 18% del pliego, lo
   * justo para empujar una venta de dos ítems a una segunda página. `generate`
   * mide primero y solo entonces reserva.
   */
  bottom_reserve: number;
}

export const GEOMETRY: Record<
  PrintFormat,
  // `bottom_reserve` queda fuera: no es geometría del papel sino una decisión de
  // esta impresión concreta, que `generate` toma después de contar las páginas.
  Omit<PdfLayout, 'format' | 'content' | 'bottom_reserve'> & { height: number }
> = {
  letter: {
    width: 612,
    height: 792,
    margin: 40,
    roll: false,
    font_scale: 1,
    footer_gap: 1.5,
  },
  a4: {
    // 210 × 297 mm. Narrower and taller than letter, so the same margin leaves
    // less printable width; the rest of the rhythm matches letter.
    width: 210 * MM,
    height: 297 * MM,
    margin: 40,
    roll: false,
    font_scale: 1,
    footer_gap: 1.5,
  },
  half_letter: {
    // Half of a letter sheet, the usual pre-printed invoice stationery.
    width: 612,
    height: 396,
    // Tighter than letter on purpose: the fixed blocks of an electronic invoice
    // (issuer, resolution, client, taxes, totals, CUFE, verification URL) add up
    // to ~514 pt at letter density — more than the whole sheet — so a 2-item
    // sale spilled onto a second page. `moveDown` is measured in the current
    // font size, so scaling the type down compresses the vertical rhythm too.
    margin: 14,
    roll: false,
    font_scale: 0.66,
    footer_gap: 0.3,
  },
  thermal_80: {
    width: 80 * MM,
    // Replaced by the measured content height; see `generate`.
    height: 0,
    margin: 10,
    roll: true,
    font_scale: 0.82,
    footer_gap: 0.8,
  },
  thermal_58: {
    width: 58 * MM,
    height: 0,
    margin: 7,
    roll: true,
    font_scale: 0.74,
    footer_gap: 0.8,
  },
};

/** Probe height for the measuring pass: tall enough never to break a page. */
const ROLL_PROBE_HEIGHT = 20000;

/**
 * Lado mínimo del código QR: 2 cm (Anexo Técnico 1.9 §11.7).
 *
 * Es un mínimo legible, no estético: por debajo de 2 cm un QR con las once líneas
 * del anexo deja de leerse con la cámara de un teléfono sobre papel térmico, y el
 * adquiriente pierde la única vía de verificación que le da el documento impreso.
 */
const QR_MIN_SIDE = 20 * MM;

/**
 * Alto de la banda al pie que se reserva —solo en documentos de varias páginas—
 * para repetir el QR: el código al mínimo del anexo más su rótulo y aire.
 */
const QR_STAMP_BAND = QR_MIN_SIDE + 16;

export class InvoicePdfBuilder {
  /**
   * Generates a professional invoice PDF compliant with Colombian DIAN requirements.
   */
  static async generate(data: InvoicePdfData): Promise<Buffer> {
    const layout = this.resolveLayout(data.format);

    if (!layout.roll) {
      const first = await this.render(data, layout);

      // EL QR VA EN TODAS LAS PÁGINAS (Anexo Técnico 1.9 §11.7). En un documento
      // de una sola página la sección de verificación ya lo pone ahí, así que no
      // hay nada que repetir y reservar la banda al pie solo encogería la caja.
      // Cuando SÍ hay varias, se vuelve a componer con la banda reservada para que
      // el sello de cada página no caiga encima del contenido: es la única forma
      // de garantizar que no se solapen, porque PDFKit pagina contra el margen
      // inferior y no sabe nada de un sello dibujado en coordenadas absolutas.
      if (first.pages <= 1 || !data.qr_code_buffer) {
        return first.buffer;
      }

      const { buffer } = await this.render(data, {
        ...layout,
        bottom_reserve: QR_STAMP_BAND,
      });
      return buffer;
    }

    // Roll paper has no fixed height. Render once on a very tall page just to
    // measure where the content ends, then render again on a page cut to that
    // height. Two passes over a small document cost milliseconds and remove the
    // guesswork entirely: estimating from the item count either wastes paper or
    // spills onto a second page, and a receipt printer cuts between pages.
    const probe = await this.render(data, {
      ...layout,
      height: ROLL_PROBE_HEIGHT,
    });
    // `margin * 2`, not `margin`: PDFKit breaks the page as soon as the next
    // line would cross `height - bottomMargin`, so cutting the page exactly at
    // the measured end still spills the last line onto a second page — and a
    // receipt printer cuts the paper between pages.
    const { buffer } = await this.render(data, {
      ...layout,
      height: Math.max(probe.end_y + layout.margin * 2, 120),
    });
    return buffer;
  }

  private static resolveLayout(format?: PrintFormat): PdfLayout {
    const key: PrintFormat = format && GEOMETRY[format] ? format : 'letter';
    const geometry = GEOMETRY[key];
    return {
      ...geometry,
      format: key,
      content: geometry.width - geometry.margin * 2,
      bottom_reserve: 0,
    };
  }

  private static render(
    data: InvoicePdfData,
    L: PdfLayout,
  ): Promise<{ buffer: Buffer; end_y: number; pages: number }> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: [L.width, L.height],
          // `margins` y no `margin`: el inferior lleva la banda del QR cuando hay
          // varias páginas, y es ese margen el que hace que PDFKit corte el texto
          // antes de invadirla.
          margins: {
            top: L.margin,
            left: L.margin,
            right: L.margin,
            bottom: L.margin + L.bottom_reserve,
          },
          bufferPages: true,
        });
        const chunks: Buffer[] = [];
        // Captured before `doc.end()`: reading `doc.y` from the `end` callback
        // would report the cursor after PDFKit finalised the document.
        let end_y = L.margin;
        let pages = 1;

        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () =>
          resolve({ buffer: Buffer.concat(chunks), end_y, pages }),
        );
        doc.on('error', reject);

        // --- Header: Logo + Company Info ---
        this.drawHeader(doc, L, data);

        // --- Invoice Title & Type ---
        doc.moveDown(0.5);
        this.drawInvoiceTitle(doc, L, data);

        // --- Resolution Info ---
        if (data.resolution_number) {
          this.drawResolutionInfo(doc, L, data);
        }

        doc.moveDown(0.5);
        this.drawHorizontalLine(doc, L);

        // --- Customer Info ---
        doc.moveDown(0.5);
        this.drawCustomerInfo(doc, L, data);

        doc.moveDown(0.5);
        this.drawHorizontalLine(doc, L);

        // --- Items ---
        doc.moveDown(0.5);
        if (L.roll) {
          this.drawItemsRoll(doc, L, data.items);
        } else {
          this.drawItemsTable(doc, L, data.items);
        }

        doc.moveDown(0.5);
        this.drawHorizontalLine(doc, L);

        // --- Tax Breakdown ---
        if (data.taxes.length > 0) {
          doc.moveDown(0.5);
          this.drawTaxBreakdown(doc, L, data.taxes);
          doc.moveDown(0.3);
          this.drawHorizontalLine(doc, L);
        }

        // --- Totals ---
        // The totals block paints a filled rectangle at absolute coordinates,
        // which PDFKit will not reflow, so it needs whole-block room.
        // 80 pt bastaban antes del valor en letras; la frase ocupa una o dos
        // líneas más y, si el bloque se parte, la caja gris del TOTAL queda en
        // una página y su importe en letras en la siguiente.
        this.ensureSpace(doc, L, 110);
        doc.moveDown(0.5);
        this.drawTotals(doc, L, data);

        // --- Payment Info ---
        if (data.payment_form || data.notes) {
          doc.moveDown(0.5);
          this.drawPaymentInfo(doc, L, data);
        }

        // --- CUFE ---
        if (data.cufe) {
          doc.moveDown(0.8);
          this.drawCufe(doc, L, data.cufe);
        }

        // --- QR Code ---
        // Se anota en qué página cayó la sección de verificación: es la única que
        // NO recibe el sello repetido, porque ya lleva el código a tamaño grande
        // con su URL debajo.
        let qr_page_index = -1;
        if (data.qr_code) {
          doc.moveDown(0.5);
          this.drawQrSection(doc, L, data.qr_code, data.qr_code_buffer);
          qr_page_index = this.currentPageIndex(doc);
        }

        // --- Footer ---
        this.drawFooter(doc, L);

        const range = doc.bufferedPageRange();
        pages = range.count;
        // Antes del sello: `switchToPage` + `text` mueven el cursor, y en rollo el
        // alto del papel se corta justo por `end_y`.
        end_y = doc.y;

        this.stampQrOnRemainingPages(doc, L, data, qr_page_index);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // ─── Private Helpers ────────────────────────────────────────────

  /** Scales a design font size to the current paper width. */
  private static fs(L: PdfLayout, size: number): number {
    return Math.round(size * L.font_scale * 10) / 10;
  }

  /**
   * Última `y` utilizable por el contenido. Descuenta la banda del QR, que existe
   * justamente para que nada del flujo entre en ella.
   */
  private static bottomLimit(L: PdfLayout): number {
    return L.height - L.margin - L.bottom_reserve;
  }

  /**
   * Starts a new page when `needed` points do not fit. No-op on roll paper,
   * whose height is cut to the measured content, so nothing can overflow.
   */
  private static ensureSpace(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    needed: number,
  ): void {
    if (L.roll) return;
    if (doc.y + needed > this.bottomLimit(L)) {
      doc.addPage();
    }
  }

  /**
   * Índice de la página que se está dibujando, dentro del rango que `bufferPages`
   * mantiene abierto. Las páginas solo se añaden al final, así que la actual es
   * siempre la última del rango.
   */
  private static currentPageIndex(doc: PDFKit.PDFDocument): number {
    const range = doc.bufferedPageRange();
    return range.start + range.count - 1;
  }

  /** Lado del QR, nunca por debajo del mínimo del anexo ni más ancho que el papel. */
  private static qrSide(L: PdfLayout, preferred: number): number {
    return Math.min(Math.max(preferred, QR_MIN_SIDE), L.content);
  }

  /**
   * Repite el QR en las páginas que no llevan la sección de verificación
   * (Anexo Técnico 1.9 §11.7: el código va en TODAS las páginas del documento).
   *
   * Se sella en la banda inferior que `generate` reservó, así que no puede pisar
   * el contenido. Solo se dibuja el código y su rótulo: el CUFE y la URL viven en
   * la sección completa, y repetir un bloque de texto en cada página no aporta
   * verificación, únicamente ruido.
   */
  private static stampQrOnRemainingPages(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    data: InvoicePdfData,
    qr_page_index: number,
  ): void {
    const qr_buffer = data.qr_code_buffer;
    if (!qr_buffer) return;

    const range = doc.bufferedPageRange();
    if (range.count <= 1) return;

    // Al mínimo del anexo: el sello gasta el menor pie posible en cada página, y
    // el tamaño grande se reserva para la sección de verificación.
    const side = this.qrSide(L, QR_MIN_SIDE);
    const x = L.margin + L.content - side;

    for (let i = range.start; i < range.start + range.count; i++) {
      if (i === qr_page_index) continue;
      doc.switchToPage(i);

      // `doc.page.height` y no `L.height`: en rollo la caja definitiva se calcula
      // por pasada y `switchToPage` ya apunta a la página real.
      const band_top = doc.page.height - L.margin - QR_STAMP_BAND;

      // Escribir dentro de la banda del margen inferior hace que PDFKit añada una
      // página en blanco y se lleve el sello a ella. Se anula el margen mientras
      // dura el sello, igual que en `dispatch-note-pdf.builder.ts`.
      const prev_bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;

      doc
        .font('Helvetica')
        .fontSize(this.fs(L, 6))
        .fillColor('#666666')
        .text('Verificacion DIAN', L.margin, band_top + 2, {
          width: L.content,
          align: 'right',
          lineBreak: false,
        });

      try {
        doc.image(qr_buffer, x, band_top + 11, { fit: [side, side] });
      } catch {
        // Un buffer corrupto no puede tumbar el documento: el resto de la
        // representación gráfica sigue siendo válido.
      }

      doc.fillColor('#000000');
      doc.page.margins.bottom = prev_bottom;
    }
  }

  private static drawHeader(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    data: InvoicePdfData,
  ): void {
    const header_y = doc.y;

    // On roll paper the issuer block is centred under the logo: there is no
    // horizontal room for a logo-beside-text arrangement.
    if (L.roll) {
      if (data.company_logo_buffer) {
        const size = Math.min(48, L.content);
        try {
          doc.image(
            data.company_logo_buffer,
            L.margin + (L.content - size) / 2,
            header_y,
            { fit: [size, size] },
          );
          doc.y = header_y + size + 4;
        } catch {
          // If logo fails to load, skip it silently
        }
      }

      const center = { align: 'center' as const, width: L.content };

      doc
        .font('Helvetica-Bold')
        .fontSize(this.fs(L, 11))
        .text(data.company_name, L.margin, doc.y, center);

      if (
        data.company_trade_name &&
        data.company_trade_name !== data.company_name
      ) {
        doc
          .font('Helvetica')
          .fontSize(this.fs(L, 8))
          .text(data.company_trade_name, L.margin, doc.y + 1, center);
      }

      doc
        .font('Helvetica')
        .fontSize(this.fs(L, 8))
        .text(`NIT: ${data.company_nit}`, L.margin, doc.y + 2, center);

      this.drawIssuerFiscalLines(doc, L, data, L.margin, center);

      if (data.company_address) {
        doc.text(data.company_address, L.margin, doc.y + 1, center);
      }

      const roll_contact: string[] = [];
      if (data.company_phone) roll_contact.push(`Tel: ${data.company_phone}`);
      if (data.company_email) roll_contact.push(data.company_email);
      if (roll_contact.length > 0) {
        doc.text(roll_contact.join('  |  '), L.margin, doc.y + 1, center);
      }
      return;
    }

    if (data.company_logo_buffer) {
      try {
        doc.image(data.company_logo_buffer, L.margin, header_y, {
          width: 60,
          height: 60,
          fit: [60, 60],
        });
      } catch {
        // If logo fails to load, skip it silently
      }
    }

    const text_x = data.company_logo_buffer ? L.margin + 70 : L.margin;
    const text_width = L.margin + L.content - text_x;

    doc
      .font('Helvetica-Bold')
      .fontSize(this.fs(L, 14))
      .text(data.company_name, text_x, header_y, { width: text_width });

    if (
      data.company_trade_name &&
      data.company_trade_name !== data.company_name
    ) {
      doc
        .font('Helvetica')
        .fontSize(this.fs(L, 9))
        .text(data.company_trade_name, text_x, doc.y + 1, {
          width: text_width,
        });
    }

    doc
      .font('Helvetica')
      .fontSize(this.fs(L, 9))
      .text(`NIT: ${data.company_nit}`, text_x, doc.y + 2, {
        width: text_width,
      });

    this.drawIssuerFiscalLines(doc, L, data, text_x, { width: text_width });

    if (data.company_address) {
      doc.text(data.company_address, text_x, doc.y + 1, { width: text_width });
    }

    const contact_parts: string[] = [];
    if (data.company_phone) contact_parts.push(`Tel: ${data.company_phone}`);
    if (data.company_email) contact_parts.push(data.company_email);
    if (contact_parts.length > 0) {
      doc.text(contact_parts.join('  |  '), text_x, doc.y + 1, {
        width: text_width,
      });
    }

    // Ensure we are past the logo height
    if (data.company_logo_buffer) {
      const min_y = header_y + 65;
      if (doc.y < min_y) {
        doc.y = min_y;
      }
    }
  }

  /**
   * Regime and DIAN tax responsibilities. Mandatory content of the graphic
   * representation, so it is drawn identically in every format.
   */
  private static drawIssuerFiscalLines(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    data: InvoicePdfData,
    x: number,
    options: PDFKit.Mixins.TextOptions,
  ): void {
    const fiscal_parts: string[] = [];
    if (data.company_tax_regime) {
      fiscal_parts.push(`Regimen: ${data.company_tax_regime}`);
    }
    if (data.company_tax_responsibilities?.length) {
      fiscal_parts.push(
        `Responsabilidades: ${data.company_tax_responsibilities.join(', ')}`,
      );
    }
    if (fiscal_parts.length === 0) return;

    doc
      .font('Helvetica')
      .fontSize(this.fs(L, 8))
      .text(fiscal_parts.join('  |  '), x, doc.y + 1, options);
  }

  private static drawInvoiceTitle(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    data: InvoicePdfData,
  ): void {
    const type_labels: Record<string, string> = {
      invoice: 'FACTURA ELECTRONICA DE VENTA',
      credit_note: 'NOTA CREDITO ELECTRONICA',
      debit_note: 'NOTA DEBITO ELECTRONICA',
      purchase_invoice: 'FACTURA DE COMPRA',
    };

    const title = type_labels[data.invoice_type] || 'FACTURA';
    const center = { align: 'center' as const, width: L.content };

    doc
      .font('Helvetica-Bold')
      .fontSize(this.fs(L, 14))
      .text(title, L.margin, doc.y, center);

    doc
      .font('Helvetica-Bold')
      .fontSize(this.fs(L, 11))
      .text(`No. ${data.invoice_number}`, L.margin, doc.y + 4, center);

    const date_parts: string[] = [`Fecha de emision: ${data.issue_date}`];
    if (data.due_date) {
      date_parts.push(`Vencimiento: ${data.due_date}`);
    }

    doc
      .font('Helvetica')
      .fontSize(this.fs(L, 9))
      .text(date_parts.join(L.roll ? '\n' : '  |  '), L.margin, doc.y + 4, center);
  }

  private static drawResolutionInfo(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    data: InvoicePdfData,
  ): void {
    doc.moveDown(0.3);

    const parts: string[] = [`Resolucion DIAN No. ${data.resolution_number}`];

    if (data.resolution_date) {
      parts[0] += ` del ${data.resolution_date}`;
    }

    if (
      data.resolution_prefix &&
      data.resolution_range_from !== undefined &&
      data.resolution_range_to !== undefined
    ) {
      parts.push(
        `Rango autorizado: ${data.resolution_prefix}${data.resolution_range_from} a ${data.resolution_prefix}${data.resolution_range_to}`,
      );
    }

    if (data.resolution_valid_from && data.resolution_valid_to) {
      parts.push(
        `Vigencia: ${data.resolution_valid_from} - ${data.resolution_valid_to}`,
      );
    }

    doc
      .font('Helvetica')
      .fontSize(this.fs(L, 7))
      .fillColor('#555555')
      .text(parts.join(L.roll ? '\n' : '  |  '), L.margin, doc.y, {
        align: 'center',
        width: L.content,
      });

    doc.fillColor('#000000');
  }

  private static drawCustomerInfo(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    data: InvoicePdfData,
  ): void {
    this.drawSectionTitle(doc, L, 'DATOS DEL CLIENTE');

    doc.font('Helvetica').fontSize(this.fs(L, 9));

    // Roll paper: stack every field, there is no room for two columns.
    if (L.roll) {
      doc.text(`Nombre: ${data.customer_name}`, L.margin, doc.y, {
        width: L.content,
      });
      if (data.customer_tax_id) {
        doc.text(`NIT/CC: ${data.customer_tax_id}`, L.margin, doc.y + 1, {
          width: L.content,
        });
      }
      if (typeof data.customer_address === 'string' && data.customer_address) {
        doc.text(`Direccion: ${data.customer_address}`, L.margin, doc.y + 1, {
          width: L.content,
        });
      }
      if (data.customer_email) {
        doc.text(`Email: ${data.customer_email}`, L.margin, doc.y + 1, {
          width: L.content,
        });
      }
      return;
    }

    const half = L.content / 2;

    const y1 = doc.y;
    doc.text(`Nombre: ${data.customer_name}`, L.margin, y1, { width: half });
    if (data.customer_tax_id) {
      doc.text(`NIT/CC: ${data.customer_tax_id}`, L.margin + half, y1, {
        width: half,
      });
    }

    if (data.customer_address) {
      const addr =
        typeof data.customer_address === 'string' ? data.customer_address : '';
      if (addr) {
        const y2 = doc.y + 2;
        doc.text(`Direccion: ${addr}`, L.margin, y2, { width: L.content });
      }
    }

    if (data.customer_email) {
      const y3 = doc.y + 2;
      doc.text(`Email: ${data.customer_email}`, L.margin, y3, {
        width: L.content,
      });
    }
  }

  private static drawItemsTable(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    items: InvoicePdfItem[],
  ): void {
    this.drawSectionTitle(doc, L, 'DETALLE DE PRODUCTOS / SERVICIOS');

    // Column x positions as fractions of the drawable width, so the table also
    // fits half-letter without overflowing into the margin.
    const w = L.content;
    const col_x = {
      qty: L.margin,
      description: L.margin + w * 0.095,
      unit_price: L.margin + w * 0.53,
      discount: L.margin + w * 0.68,
      tax: L.margin + w * 0.795,
      total: L.margin + w * 0.89,
    };
    const col_w = {
      qty: w * 0.085,
      description: w * 0.42,
      unit_price: w * 0.14,
      discount: w * 0.105,
      tax: w * 0.085,
      total: L.margin + w - col_x.total,
    };

    const header_y = doc.y;

    // Header background
    doc
      .save()
      .rect(L.margin, header_y - 2, w, 16)
      .fill('#f5f5f5')
      .restore();

    doc.font('Helvetica-Bold').fontSize(this.fs(L, 8)).fillColor('#000000');
    doc.text('Cant.', col_x.qty, header_y, { width: col_w.qty });
    doc.text('Descripcion', col_x.description, header_y, {
      width: col_w.description,
    });
    doc.text('P. Unit.', col_x.unit_price, header_y, {
      width: col_w.unit_price,
      align: 'right',
    });
    doc.text('Desc.', col_x.discount, header_y, {
      width: col_w.discount,
      align: 'right',
    });
    doc.text('IVA', col_x.tax, header_y, {
      width: col_w.tax,
      align: 'right',
    });
    doc.text('Total', col_x.total, header_y, {
      width: col_w.total,
      align: 'right',
    });

    doc.y = header_y + 18;

    // Table rows
    doc.font('Helvetica').fontSize(this.fs(L, 8));

    // Break only when the next row itself would not fit. The old fixed 150 pt
    // reserve was calibrated for letter: on half-letter it threw away 38% of the
    // sheet, pushing the second item to a new page. The blocks that follow the
    // table get their own reserve via `ensureSpace`.
    const row_limit = this.bottomLimit(L) - this.fs(L, 8) * 3;

    for (const item of items) {
      if (doc.y > row_limit) {
        doc.addPage();
      }

      const current_y = doc.y;

      doc.text(this.formatQuantity(item.quantity), col_x.qty, current_y, {
        width: col_w.qty,
      });
      doc.text(item.description, col_x.description, current_y, {
        width: col_w.description,
      });
      doc.text(COP.format(item.unit_price), col_x.unit_price, current_y, {
        width: col_w.unit_price,
        align: 'right',
      });
      doc.text(
        item.discount_amount > 0 ? COP.format(item.discount_amount) : '-',
        col_x.discount,
        current_y,
        { width: col_w.discount, align: 'right' },
      );
      doc.text(
        item.tax_amount > 0 ? COP.format(item.tax_amount) : '-',
        col_x.tax,
        current_y,
        { width: col_w.tax, align: 'right' },
      );
      doc.text(COP.format(item.total_amount), col_x.total, current_y, {
        width: col_w.total,
        align: 'right',
      });

      doc.moveDown(0.4);

      const sub_lines = this.itemSubLines(item);
      if (sub_lines.length > 0) {
        doc.font('Helvetica').fontSize(this.fs(L, 7)).fillColor('#666666');
        for (const line of sub_lines) {
          doc.text(line, col_x.description + 6, doc.y, {
            width: col_w.description - 6,
          });
        }
        doc.font('Helvetica').fontSize(this.fs(L, 8)).fillColor('#000000');
        doc.moveDown(0.4);
      }
    }
  }

  /**
   * Single-column item list for roll paper: description on its own line, then
   * `qty × unit price` on the left with the line total right-aligned. Same data
   * as the table, including the per-line IVA the tabular layout shows.
   */
  private static drawItemsRoll(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    items: InvoicePdfItem[],
  ): void {
    this.drawSectionTitle(doc, L, 'DETALLE');

    for (const item of items) {
      doc
        .font('Helvetica-Bold')
        .fontSize(this.fs(L, 8))
        .fillColor('#000000')
        .text(item.description, L.margin, doc.y, { width: L.content });

      const amount_y = doc.y + 1;
      doc
        .font('Helvetica')
        .fontSize(this.fs(L, 8))
        .text(
          `${this.formatQuantity(item.quantity)} x ${COP.format(item.unit_price)}`,
          L.margin,
          amount_y,
          { width: L.content * 0.6 },
        );
      doc.text(COP.format(item.total_amount), L.margin, amount_y, {
        width: L.content,
        align: 'right',
      });

      const extra: string[] = [];
      if (item.discount_amount > 0) {
        extra.push(`Descuento: -${COP.format(item.discount_amount)}`);
      }
      if (item.tax_amount > 0) {
        extra.push(`IVA: ${COP.format(item.tax_amount)}`);
      }
      extra.push(...this.itemSubLines(item));

      if (extra.length > 0) {
        doc.fontSize(this.fs(L, 7)).fillColor('#666666');
        for (const line of extra) {
          doc.text(line, L.margin + 4, doc.y + 1, { width: L.content - 4 });
        }
        doc.fillColor('#000000');
      }

      doc.moveDown(0.35);
    }
  }

  /** Tier / packaging / serial snapshot lines shared by both item layouts. */
  private static itemSubLines(item: InvoicePdfItem): string[] {
    const lines: string[] = [];

    if (item.applied_price_tier_name) {
      lines.push(`Tarifa: ${item.applied_price_tier_name}`);
    }

    if (
      typeof item.stock_units_consumed === 'number' &&
      item.stock_units_consumed > 0 &&
      item.stock_units_consumed !== item.quantity &&
      item.quantity !== 0
    ) {
      const per_unit =
        Math.round((item.stock_units_consumed / item.quantity) * 100) / 100;
      lines.push(
        `× ${per_unit} unid/empaque (desconto ${item.stock_units_consumed} unid. de stock)`,
      );
    }

    if (
      typeof item.serial_numbers_snapshot === 'string' &&
      item.serial_numbers_snapshot.trim().length > 0
    ) {
      lines.push(`Serial(es): ${item.serial_numbers_snapshot.trim()}`);
    }

    return lines;
  }

  private static drawTaxBreakdown(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    taxes: InvoicePdfTax[],
  ): void {
    this.drawSectionTitle(doc, L, 'IMPUESTOS');

    doc.font('Helvetica').fontSize(this.fs(L, 8));

    for (const tax of taxes) {
      const y = doc.y;

      if (L.roll) {
        doc.text(
          `${tax.tax_name} (${tax.tax_rate}%) base ${COP.format(tax.taxable_amount)}`,
          L.margin,
          y,
          { width: L.content * 0.68 },
        );
        doc.text(COP.format(tax.tax_amount), L.margin, y, {
          width: L.content,
          align: 'right',
        });
      } else {
        doc.text(`${tax.tax_name} (${tax.tax_rate}%)`, L.margin + 10, y, {
          width: L.content * 0.35,
        });
        doc.text(
          `Base: ${COP.format(tax.taxable_amount)}`,
          L.margin + L.content * 0.4,
          y,
          { width: L.content * 0.3 },
        );
        doc.text(COP.format(tax.tax_amount), L.margin, y, {
          width: L.content - 10,
          align: 'right',
        });
      }

      doc.moveDown(0.3);
    }
  }

  private static drawTotals(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    data: InvoicePdfData,
  ): void {
    // Roll paper uses the full width; page formats keep the totals block on the
    // right half, as the letter invoice always did.
    const totals_x = L.roll ? L.margin : L.margin + L.content / 2;
    const totals_width = L.roll ? L.content : L.content / 2;

    doc.font('Helvetica').fontSize(this.fs(L, 9));

    const line = (label: string, value: string, y: number) => {
      doc.text(label, totals_x, y, { width: totals_width * 0.6 });
      doc.text(value, totals_x, y, { width: totals_width, align: 'right' });
    };

    line('Subtotal:', COP.format(data.subtotal_amount), doc.y);

    if (data.discount_amount > 0) {
      line('Descuento:', `-${COP.format(data.discount_amount)}`, doc.y + 2);
    }

    if (data.tax_amount > 0) {
      line('IVA:', COP.format(data.tax_amount), doc.y + 2);
    }

    if (data.withholding_amount > 0) {
      line('Retencion:', `-${COP.format(data.withholding_amount)}`, doc.y + 2);
    }

    // Total
    doc.moveDown(0.5);
    const total_y = doc.y;
    const box_height = L.roll ? 24 : 28;

    doc
      .save()
      .rect(totals_x - 4, total_y - 4, totals_width + 4, box_height)
      .fill('#f0f0f0')
      .restore();

    doc
      .font('Helvetica-Bold')
      .fontSize(this.fs(L, 12))
      .fillColor('#000000')
      .text('TOTAL:', totals_x, total_y + 4, { width: totals_width * 0.5 });

    doc.text(COP.format(data.total_amount), totals_x, total_y + 4, {
      width: totals_width,
      align: 'right',
    });

    doc.y = total_y + box_height + 2;

    // VALOR EN LETRAS. Es la única cifra del documento que se escribe dos veces
    // —en números y en palabras—, así que las dos salen del MISMO
    // `data.total_amount` y por el mismo camino de truncado que el XML
    // (`amountToSpanishWords` trunca a 2 decimales, Anexo 1.9 §11.2). Una
    // segunda fuente aquí sería una discrepancia visible al adquiriente sobre un
    // consecutivo ya quemado.
    //
    // Va a ancho completo y no en la columna de totales porque la frase de un
    // importe de nueve cifras no cabe en media página sin partirse en cuatro
    // líneas.
    // La guarda no es paranoia: `amountToSpanishWords` LANZA ante un importe no
    // finito, y este builder es el camino de `GET /:id/pdf`. Un documento sin la
    // línea en letras es recuperable; un 500 al descargar la factura no.
    if (Number.isFinite(data.total_amount)) {
      doc
        .font('Helvetica')
        .fontSize(this.fs(L, 8))
        .fillColor('#000000')
        .text(
          `Valor en letras: ${amountToSpanishWords(data.total_amount, {
            suffix: 'M/CTE',
          })}`,
          L.margin,
          doc.y + 2,
          { width: L.content },
        );
      doc.moveDown(0.2);
    }
  }

  private static drawPaymentInfo(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    data: InvoicePdfData,
  ): void {
    this.drawSectionTitle(doc, L, 'INFORMACION DE PAGO');

    doc.font('Helvetica').fontSize(this.fs(L, 9));

    if (data.payment_form) {
      const payment_labels: Record<string, string> = {
        cash: 'Contado',
        credit: 'Credito',
        debit_card: 'Tarjeta Debito',
        credit_card: 'Tarjeta Credito',
        bank_transfer: 'Transferencia Bancaria',
        electronic: 'Pago Electronico',
      };
      const label = payment_labels[data.payment_form] || data.payment_form;
      doc.text(`Forma de pago: ${label}`, L.margin, doc.y, {
        width: L.content,
      });
    }

    if (data.payment_method) {
      doc.text(`Metodo de pago: ${data.payment_method}`, L.margin, doc.y + 2, {
        width: L.content,
      });
    }

    if (data.notes) {
      doc.moveDown(0.3);
      doc
        .font('Helvetica')
        .fontSize(this.fs(L, 8))
        .fillColor('#444444')
        .text(`Observaciones: ${data.notes}`, L.margin, doc.y, {
          width: L.content,
        });
      doc.fillColor('#000000');
    }
  }

  private static drawCufe(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    cufe: string,
  ): void {
    this.drawSectionTitle(doc, L, 'CUFE');

    doc
      .font('Courier')
      .fontSize(this.fs(L, 7))
      .fillColor('#333333')
      .text(cufe, L.margin, doc.y, {
        width: L.content,
        align: 'center',
      });

    doc.fillColor('#000000');
  }

  /**
   * Verification block: the scannable QR first, the catalogue URL underneath as
   * backup.
   *
   * The QR is what makes the printed invoice verifiable — the acquirer points a
   * phone at the paper. The URL stays because a hyperlink still helps on screen
   * and because a QR damaged by a worn thermal head leaves something readable,
   * but it is no longer the only thing printed.
   *
   * Lo que se IMPRIME como texto es solo la URL, aunque el código lleve las once
   * líneas del §11.7: los otros diez campos ya están en la cara del documento
   * (número, fecha, NIT, importes, CUFE) y repetirlos como un bloque suelto no
   * añade verificación.
   */
  private static drawQrSection(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    qr_content: string,
    qr_buffer?: Buffer,
  ): void {
    doc
      .font('Helvetica')
      .fontSize(this.fs(L, 7))
      .fillColor('#666666')
      .text('Verificacion DIAN:', L.margin, doc.y, {
        align: 'center',
        width: L.content,
      });

    if (qr_buffer) {
      // Sized off the printable width, never a fixed pixel box: on `thermal_80`
      // the content is ~207 pt, so a 200 pt code would eat the margins. Capped
      // so it never dominates a letter sheet either, y con el suelo de 2 cm que
      // exige el anexo por debajo del cual el código deja de leerse en papel.
      const side = this.qrSide(L, L.roll ? 84 : 110);
      const x = L.margin + (L.content - side) / 2;
      const y = doc.y + 3;
      try {
        doc.image(qr_buffer, x, y, { fit: [side, side] });
        // `doc.image` does not advance the cursor, and on roll formats the whole
        // page height is derived from where the cursor ends — so failing to
        // advance it here would make the sheet too short and clip the footer.
        doc.y = y + side + 3;
      } catch {
        // A malformed buffer must not take the invoice down with it: the URL
        // below still prints and the document stays valid.
      }
    }

    const url = this.qrDisplayUrl(qr_content);
    doc
      .font('Helvetica')
      .fontSize(this.fs(L, 6))
      .text(url, L.margin, doc.y + 2, {
        align: 'center',
        width: L.content,
        link: url,
      });

    doc.fillColor('#000000');
  }

  /**
   * URL del catálogo dentro del contenido del QR.
   *
   * El §11.7 la fija como última de las once líneas, así que se busca desde el
   * final. Un `qr_code` que sea una URL suelta —documentos anteriores al cambio,
   * y la vista previa de formato— cae en el mismo camino sin ramas aparte.
   */
  private static qrDisplayUrl(qr_content: string): string {
    const lines = qr_content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].startsWith('http')) return lines[i];
    }

    return lines[lines.length - 1] ?? qr_content.trim();
  }

  private static drawSectionTitle(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    title: string,
  ): void {
    doc
      .font('Helvetica-Bold')
      .fontSize(this.fs(L, 10))
      .text(title, L.margin, doc.y, { width: L.content });
    doc.moveDown(0.3);
  }

  private static drawHorizontalLine(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
  ): void {
    const y = doc.y;
    doc
      .moveTo(L.margin, y)
      .lineTo(L.width - L.margin, y)
      .strokeColor('#cccccc')
      .lineWidth(0.5)
      .stroke();
    doc.strokeColor('#000000');
  }

  private static drawFooter(doc: PDFKit.PDFDocument, L: PdfLayout): void {
    const now = new Date();
    const date_str = now.toLocaleDateString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    doc.moveDown(L.footer_gap);
    doc
      .font('Helvetica')
      .fontSize(this.fs(L, 7))
      .fillColor('#999999')
      .text(
        'Esta factura electronica fue generada por Vendix y es valida conforme a la normativa de la DIAN.',
        L.margin,
        doc.y,
        { align: 'center', width: L.content },
      );

    doc.text(`Documento generado el ${date_str}`, L.margin, doc.y + 2, {
      align: 'center',
      width: L.content,
    });

    doc.fillColor('#000000');
  }

  private static formatQuantity(qty: number): string {
    if (Number.isInteger(qty)) return qty.toString();
    return qty.toFixed(2);
  }
}
