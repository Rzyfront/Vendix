import PDFDocument from 'pdfkit';
import {
  GEOMETRY,
  PdfLayout,
} from '../invoicing/services/invoice-pdf.builder';
import {
  PRINT_FORMATS,
  PrintFormat,
} from '../settings/interfaces/store-settings.interface';

/**
 * Data needed to render one order in the bulk print PDF (QUI-599).
 *
 * This is the order equivalent of {@link InvoicePdfData}: an order
 * "comprobante" that respects the store print config but does NOT carry DIAN
 * fiscal fields (CUFE, resolution, taxes breakdown) — those belong to the
 * invoice domain. When an order has been invoiced, the operator prints the
 * invoice from the invoicing module; the bulk print here is the order
 * receipt / packing-slip view that the POS and the dispatch flow already use
 * for the single-order print.
 */
export interface OrderPdfData {
  // Emisor (resuelto desde fiscal_data del scope que posee la habilitación)
  company_name: string;
  company_nit: string;
  company_address?: string;
  company_phone?: string;
  company_email?: string;
  company_logo_buffer?: Buffer;
  company_trade_name?: string;
  company_tax_regime?: string;
  company_tax_responsibilities?: string[];

  // Orden
  order_number: string;
  /** Estado actual de la orden (legible para el operador). */
  order_state: string;
  issue_date: string;
  /** Canal: pos, ecommerce, … para traza. */
  channel?: string;
  currency?: string;
  notes?: string;

  // Cliente
  customer_name: string;
  customer_tax_id?: string;
  customer_address?: string;
  customer_email?: string;

  // Items de la orden
  items: OrderPdfItem[];

  // Totales (espejan orders: subtotal, shipping_cost, discount, tax, total)
  subtotal_amount: number;
  discount_amount: number;
  tax_amount: number;
  shipping_cost: number;
  total_amount: number;

  /**
   * Paper format. Resuelto desde `store_settings.receipts.invoice_format`
   * (o `pos_ticket_format` cuando la orden no tiene factura y la tienda
   * imprime POS). Nunca viene del cliente: el builder lo resuelve o cae a
   * `letter`.
   */
  format?: PrintFormat;
}

export interface OrderPdfItem {
  description: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  /** Etiqueta de tarifa aplicada (multi-tarifa), si existe. */
  applied_price_tier_name?: string | null;
}

const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
});

/** Probe height para medir roll paper; igual que InvoicePdfBuilder. */
const ROLL_PROBE_HEIGHT = 20000;

/**
 * Builder de PDF multi-página para impresión masiva de órdenes (QUI-599).
 *
 * Reutiliza la `GEOMETRY` y el `PdfLayout` de `InvoicePdfBuilder` para que la
 * caja de página y el escalado de fuente sean idénticos al del POS. El
 * contenido es el de la orden (no el de la factura): sin CUFE, sin resolución
 * DIAN, sin desglose de impuestos por tarifa — ese es el dominio de
 * `InvoicePdfBuilder`. Lo que imprime el bulk de órdenes es el
 * "comprobante de orden" que el operador ya imprime uno a uno desde la lista
 * de órdenes, ahora concatenado en un solo documento.
 *
 * El formato de papel se decide UNA vez (fuera del loop de órdenes) porque
 * es configuración de la tienda, no de la orden: todas las páginas del
 * documento usan el mismo `PrintFormat`.
 */
export class OrderPdfBuilder {
  /**
   * Genera un PDF con una página (o sección de roll) por orden. El formato
   * de papel se aplica a todo el documento.
   */
  static async generate(
    orders: OrderPdfData[],
    format?: PrintFormat,
  ): Promise<Buffer> {
    if (orders.length === 0) {
      // Sin órdenes: devolver un PDF de una página en blanco para que el
      // controller siempre tenga un Buffer válido que mandar.
      return this.renderEmpty(format);
    }

    const layout = this.resolveLayout(format);

    if (!layout.roll) {
      return this.renderSheetDocument(orders, layout);
    }

    return this.renderRollDocument(orders, layout);
  }

  // ─── Non-roll (letter / half_letter) ─────────────────────────────────

  /**
   * Documento con páginas fijas: cada orden empieza en una página nueva.
   * `bufferPages: true` permite que PDFKit encadene páginas automáticamente
   * cuando el contenido de una orden no cabe en una sola hoja.
   */
  private static renderSheetDocument(
    orders: OrderPdfData[],
    L: PdfLayout,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: [L.width, L.height],
          margin: L.margin,
          bufferPages: true,
        });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        orders.forEach((order, idx) => {
          if (idx > 0) doc.addPage();
          this.drawOrder(doc, L, order);
        });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  // ─── Roll (thermal_80 / thermal_58) ──────────────────────────────────

  /**
   * Documento roll: cada orden es su propia página, cortada a la altura de SU
   * contenido. Mismo razonamiento que `InvoicePdfBuilder.generate`, extendido a
   * N órdenes.
   *
   * ## Por qué dos pasadas y no una
   *
   * El papel de rollo no tiene altura fija: hay que medir dónde termina el
   * contenido. Se renderiza todo el lote una vez sobre páginas-sonda de
   * `ROLL_PROBE_HEIGHT` (suficientemente altas para que ninguna orden salte de
   * página), se anota el `doc.y` final de cada orden, y se vuelve a renderizar
   * con `addPage({ size: [width, alturaMedida_i] })` por orden.
   *
   * Son 2 renders del documento completo, NO 2·N renders aislados: el alto del
   * contenido depende del ANCHO de página, no del alto, así que una sola pasada
   * de sonda mide las N órdenes de golpe.
   *
   * `margin * 2`, no `margin`: PDFKit salta de página en cuanto la siguiente
   * línea cruzaría `height - bottomMargin`, así que cortar exactamente en el
   * final medido empujaría la última línea a una página extra — y una impresora
   * de tickets corta el papel entre páginas.
   *
   * Antes de esto el rollo se quedaba con la altura de sonda: cada ticket salía
   * de 20000pt (≈7 m) de papel, casi todo en blanco. En una térmica el driver lo
   * disimulaba con el form-feed, pero el flujo real abre el PDF en una pestaña
   * del navegador para imprimir, y ahí se veía roto.
   */
  private static async renderRollDocument(
    orders: OrderPdfData[],
    L: PdfLayout,
  ): Promise<Buffer> {
    const heights = await this.measureRollHeights(orders, L);

    return new Promise((resolve, reject) => {
      try {
        // El TAMAÑO FÍSICO de cada página es la altura medida; el LAYOUT que se
        // le pasa a `drawOrder` conserva la altura de sonda. Desacoplarlos es
        // obligatorio: `drawOrder` usa `L.height` para decidir si pagina
        // (`ensureSpace`, `row_limit`), así que darle la altura recortada —
        // exactamente el alto que su propio contenido ocupa — lo hace concluir
        // que no cabe, llamar a `doc.addPage()`, volver a no caber, y encadenar
        // páginas hasta agotar el heap del proceso.
        //
        // Con la altura de sonda, el dibujo cree tener sitio de sobra y nunca
        // pagina; el corte lo impone el MediaBox. Que no pagine es justamente lo
        // que valida la medición.
        const probeLayout: PdfLayout = { ...L, height: ROLL_PROBE_HEIGHT };
        const doc = new PDFDocument({
          size: [L.width, heights[0]],
          margin: L.margin,
          bufferPages: true,
        });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        orders.forEach((order, idx) => {
          if (idx > 0) {
            doc.addPage({ size: [L.width, heights[idx]], margin: L.margin });
          }
          this.drawOrder(doc, probeLayout, order);
        });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Pasada de medición: dibuja el lote sobre páginas-sonda y devuelve la altura
   * de corte de cada orden. El buffer resultante se descarta.
   *
   * El piso de 120pt evita una página degenerada si una orden dibujara casi
   * nada; el techo de `ROLL_PROBE_HEIGHT` es defensivo: si una orden llenara la
   * sonda entera, cortar más alto produciría un MediaBox inválido.
   */
  private static measureRollHeights(
    orders: OrderPdfData[],
    L: PdfLayout,
  ): Promise<number[]> {
    return new Promise((resolve, reject) => {
      try {
        const probeLayout: PdfLayout = { ...L, height: ROLL_PROBE_HEIGHT };
        const doc = new PDFDocument({
          size: [L.width, ROLL_PROBE_HEIGHT],
          margin: L.margin,
          bufferPages: true,
        });
        // Hay que consumir 'data' o el stream no fluye y 'end' nunca llega.
        doc.on('data', () => undefined);
        doc.on('error', reject);

        const heights: number[] = [];
        doc.on('end', () => resolve(heights));

        orders.forEach((order, idx) => {
          if (idx > 0) {
            doc.addPage({
              size: [L.width, ROLL_PROBE_HEIGHT],
              margin: L.margin,
            });
          }
          this.drawOrder(doc, probeLayout, order);
          heights.push(
            Math.min(
              ROLL_PROBE_HEIGHT,
              Math.max(doc.y + L.margin * 2, 120),
            ),
          );
        });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  private static renderEmpty(format?: PrintFormat): Promise<Buffer> {
    const L = this.resolveLayout(format);
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: [L.width, L.height],
          margin: L.margin,
        });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc
          .font('Helvetica')
          .fontSize(this.fs(L, 10))
          .text('No hay ordenes para imprimir.', L.margin, L.margin, {
            width: L.content,
          });
        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  // ─── Drawing ────────────────────────────────────────────────────────

  /**
   * Dibuja una orden completa en la página actual. Reusa los primitivos de
   * `InvoicePdfBuilder` en estilo (header centrado en roll, tabla en sheet,
   * lista en roll, totales a la derecha) pero con los campos de orden.
   */
  private static drawOrder(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    data: OrderPdfData,
  ): void {
    this.drawHeader(doc, L, data);

    doc.moveDown(0.5);
    this.drawOrderTitle(doc, L, data);

    doc.moveDown(0.5);
    this.drawHorizontalLine(doc, L);

    doc.moveDown(0.5);
    this.drawCustomerInfo(doc, L, data);

    doc.moveDown(0.5);
    this.drawHorizontalLine(doc, L);

    doc.moveDown(0.5);
    if (L.roll) {
      this.drawItemsRoll(doc, L, data.items);
    } else {
      this.drawItemsTable(doc, L, data.items);
    }

    doc.moveDown(0.5);
    this.drawHorizontalLine(doc, L);

    this.ensureSpace(doc, L, 80);
    doc.moveDown(0.5);
    this.drawTotals(doc, L, data);

    if (data.notes) {
      doc.moveDown(0.4);
      this.drawNotes(doc, L, data.notes);
    }

    this.drawFooter(doc, L, data);
  }

  private static drawHeader(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    data: OrderPdfData,
  ): void {
    const header_y = doc.y;

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
          // skip logo
        }
      }

      const center = { align: 'center' as const, width: L.content };

      doc
        .font('Helvetica-Bold')
        .fontSize(this.fs(L, 11))
        .text(data.company_name, L.margin, doc.y, center);

      if (data.company_trade_name && data.company_trade_name !== data.company_name) {
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

      const contact: string[] = [];
      if (data.company_phone) contact.push(`Tel: ${data.company_phone}`);
      if (data.company_email) contact.push(data.company_email);
      if (contact.length > 0) {
        doc.text(contact.join('  |  '), L.margin, doc.y + 1, center);
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
        // skip logo
      }
    }

    const text_x = data.company_logo_buffer ? L.margin + 70 : L.margin;
    const text_width = L.margin + L.content - text_x;

    doc
      .font('Helvetica-Bold')
      .fontSize(this.fs(L, 14))
      .text(data.company_name, text_x, header_y, { width: text_width });

    if (data.company_trade_name && data.company_trade_name !== data.company_name) {
      doc
        .font('Helvetica')
        .fontSize(this.fs(L, 9))
        .text(data.company_trade_name, text_x, doc.y + 1, { width: text_width });
    }

    doc
      .font('Helvetica')
      .fontSize(this.fs(L, 9))
      .text(`NIT: ${data.company_nit}`, text_x, doc.y + 2, { width: text_width });

    this.drawIssuerFiscalLines(doc, L, data, text_x, { width: text_width });

    if (data.company_address) {
      doc.text(data.company_address, text_x, doc.y + 1, { width: text_width });
    }

    const parts: string[] = [];
    if (data.company_phone) parts.push(`Tel: ${data.company_phone}`);
    if (data.company_email) parts.push(data.company_email);
    if (parts.length > 0) {
      doc.text(parts.join('  |  '), text_x, doc.y + 1, { width: text_width });
    }

    if (data.company_logo_buffer) {
      const min_y = header_y + 65;
      if (doc.y < min_y) doc.y = min_y;
    }
  }

  private static drawIssuerFiscalLines(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    data: OrderPdfData,
    x: number,
    options: PDFKit.Mixins.TextOptions,
  ): void {
    const fiscal: string[] = [];
    if (data.company_tax_regime) fiscal.push(`Regimen: ${data.company_tax_regime}`);
    if (data.company_tax_responsibilities?.length) {
      fiscal.push(`Responsabilidades: ${data.company_tax_responsibilities.join(', ')}`);
    }
    if (fiscal.length === 0) return;
    doc
      .font('Helvetica')
      .fontSize(this.fs(L, 8))
      .text(fiscal.join('  |  '), x, doc.y + 1, options);
  }

  private static drawOrderTitle(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    data: OrderPdfData,
  ): void {
    const center = { align: 'center' as const, width: L.content };
    doc
      .font('Helvetica-Bold')
      .fontSize(this.fs(L, 14))
      .text('ORDEN DE VENTA', L.margin, doc.y, center);

    doc
      .font('Helvetica-Bold')
      .fontSize(this.fs(L, 11))
      .text(`No. ${data.order_number}`, L.margin, doc.y + 4, center);

    const meta: string[] = [`Fecha: ${data.issue_date}`, `Estado: ${data.order_state}`];
    if (data.channel) meta.push(`Canal: ${data.channel}`);

    doc
      .font('Helvetica')
      .fontSize(this.fs(L, 9))
      .text(meta.join(L.roll ? '\n' : '  |  '), L.margin, doc.y + 4, center);
  }

  private static drawCustomerInfo(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    data: OrderPdfData,
  ): void {
    this.drawSectionTitle(doc, L, 'CLIENTE');
    doc.font('Helvetica').fontSize(this.fs(L, 9));

    if (L.roll) {
      doc.text(`Nombre: ${data.customer_name}`, L.margin, doc.y, { width: L.content });
      if (data.customer_tax_id) {
        doc.text(`NIT/CC: ${data.customer_tax_id}`, L.margin, doc.y + 1, { width: L.content });
      }
      if (data.customer_address) {
        doc.text(`Direccion: ${data.customer_address}`, L.margin, doc.y + 1, { width: L.content });
      }
      if (data.customer_email) {
        doc.text(`Email: ${data.customer_email}`, L.margin, doc.y + 1, { width: L.content });
      }
      return;
    }

    const half = L.content / 2;
    const y1 = doc.y;
    doc.text(`Nombre: ${data.customer_name}`, L.margin, y1, { width: half });
    if (data.customer_tax_id) {
      doc.text(`NIT/CC: ${data.customer_tax_id}`, L.margin + half, y1, { width: half });
    }
    if (data.customer_address) {
      doc.text(`Direccion: ${data.customer_address}`, L.margin, doc.y + 2, { width: L.content });
    }
    if (data.customer_email) {
      doc.text(`Email: ${data.customer_email}`, L.margin, doc.y + 2, { width: L.content });
    }
  }

  private static drawItemsTable(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    items: OrderPdfItem[],
  ): void {
    this.drawSectionTitle(doc, L, 'DETALLE');

    const w = L.content;
    const col_x = {
      qty: L.margin,
      description: L.margin + w * 0.1,
      unit_price: L.margin + w * 0.6,
      total: L.margin + w * 0.85,
    };
    const col_w = {
      qty: w * 0.09,
      description: w * 0.49,
      unit_price: w * 0.24,
      total: L.margin + w - col_x.total,
    };

    const header_y = doc.y;
    doc
      .save()
      .rect(L.margin, header_y - 2, w, 16)
      .fill('#f5f5f5')
      .restore();

    doc.font('Helvetica-Bold').fontSize(this.fs(L, 8)).fillColor('#000000');
    doc.text('Cant.', col_x.qty, header_y, { width: col_w.qty });
    doc.text('Descripcion', col_x.description, header_y, { width: col_w.description });
    doc.text('P. Unit.', col_x.unit_price, header_y, { width: col_w.unit_price, align: 'right' });
    doc.text('Total', col_x.total, header_y, { width: col_w.total, align: 'right' });

    doc.y = header_y + 18;
    doc.font('Helvetica').fontSize(this.fs(L, 8));

    const row_limit = L.height - L.margin - this.fs(L, 8) * 3;
    for (const item of items) {
      if (doc.y > row_limit) doc.addPage();
      const y = doc.y;
      doc.text(this.formatQuantity(item.quantity), col_x.qty, y, { width: col_w.qty });
      doc.text(item.description, col_x.description, y, { width: col_w.description });
      doc.text(COP.format(item.unit_price), col_x.unit_price, y, { width: col_w.unit_price, align: 'right' });
      doc.text(COP.format(item.total_amount), col_x.total, y, { width: col_w.total, align: 'right' });
      doc.moveDown(0.4);

      if (item.applied_price_tier_name) {
        doc
          .font('Helvetica')
          .fontSize(this.fs(L, 7))
          .fillColor('#666666')
          .text(`Tarifa: ${item.applied_price_tier_name}`, col_x.description + 6, doc.y, { width: col_w.description - 6 });
        doc.fillColor('#000000').fontSize(this.fs(L, 8));
        doc.moveDown(0.3);
      }
    }
  }

  private static drawItemsRoll(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    items: OrderPdfItem[],
  ): void {
    this.drawSectionTitle(doc, L, 'DETALLE');

    for (const item of items) {
      doc
        .font('Helvetica-Bold')
        .fontSize(this.fs(L, 8))
        .fillColor('#000000')
        .text(item.description, L.margin, doc.y, { width: L.content });

      const y = doc.y + 1;
      doc
        .font('Helvetica')
        .fontSize(this.fs(L, 8))
        .text(`${this.formatQuantity(item.quantity)} x ${COP.format(item.unit_price)}`, L.margin, y, { width: L.content * 0.6 });
      doc.text(COP.format(item.total_amount), L.margin, y, { width: L.content, align: 'right' });

      if (item.applied_price_tier_name) {
        doc
          .fontSize(this.fs(L, 7))
          .fillColor('#666666')
          .text(`Tarifa: ${item.applied_price_tier_name}`, L.margin + 4, doc.y + 1, { width: L.content - 4 });
        doc.fillColor('#000000');
      }
      doc.moveDown(0.35);
    }
  }

  private static drawTotals(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    data: OrderPdfData,
  ): void {
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
    if (data.shipping_cost > 0) {
      line('Envio:', COP.format(data.shipping_cost), doc.y + 2);
    }

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
    doc.text(COP.format(data.total_amount), totals_x, total_y + 4, { width: totals_width, align: 'right' });

    doc.y = total_y + box_height + 2;
  }

  private static drawNotes(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    notes: string,
  ): void {
    doc
      .font('Helvetica')
      .fontSize(this.fs(L, 8))
      .fillColor('#444444')
      .text(`Observaciones: ${notes}`, L.margin, doc.y, { width: L.content });
    doc.fillColor('#000000');
  }

  private static drawFooter(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    data: OrderPdfData,
  ): void {
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
        `Comprobante de orden generado por Vendix${data.currency ? ` | Moneda: ${data.currency}` : ''}.`,
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

  // ─── Helpers (espejo de InvoicePdfBuilder) ──────────────────────────

  private static resolveLayout(format?: PrintFormat): PdfLayout {
    const key: PrintFormat =
      format && PRINT_FORMATS.includes(format) ? format : 'letter';
    const geometry = GEOMETRY[key];
    return {
      ...geometry,
      format: key,
      content: geometry.width - geometry.margin * 2,
    };
  }

  private static fs(L: PdfLayout, size: number): number {
    return Math.round(size * L.font_scale * 10) / 10;
  }

  private static ensureSpace(
    doc: PDFKit.PDFDocument,
    L: PdfLayout,
    needed: number,
  ): void {
    if (L.roll) return;
    if (doc.y + needed > L.height - L.margin) doc.addPage();
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

  private static formatQuantity(qty: number): string {
    if (Number.isInteger(qty)) return qty.toString();
    return qty.toFixed(2);
  }
}