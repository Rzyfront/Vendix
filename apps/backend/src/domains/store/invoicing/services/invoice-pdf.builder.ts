import PDFDocument from 'pdfkit';

export interface InvoicePdfData {
  // Emisor
  company_name: string;
  company_nit: string;
  company_address?: string;
  company_phone?: string;
  company_email?: string;
  company_logo_buffer?: Buffer;

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
  qr_code?: string;

  // Pago
  payment_form?: string;
  payment_method?: string;
}

export interface InvoicePdfItem {
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
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

const MARGIN = 40;
const PAGE_WIDTH = 612; // Letter size
const PAGE_HEIGHT = 792;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export class InvoicePdfBuilder {
  /**
   * Generates a professional invoice PDF compliant with Colombian DIAN requirements.
   */
  static async generate(data: InvoicePdfData): Promise<Buffer> {
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

        // --- Header: Logo + Company Info ---
        this.drawHeader(doc, data);

        // --- Invoice Title & Type ---
        doc.moveDown(0.5);
        this.drawInvoiceTitle(doc, data);

        // --- Resolution Info ---
        if (data.resolution_number) {
          this.drawResolutionInfo(doc, data);
        }

        doc.moveDown(0.5);
        this.drawHorizontalLine(doc);

        // --- Customer Info ---
        doc.moveDown(0.5);
        this.drawCustomerInfo(doc, data);

        doc.moveDown(0.5);
        this.drawHorizontalLine(doc);

        // --- Items Table ---
        doc.moveDown(0.5);
        this.drawItemsTable(doc, data.items);

        doc.moveDown(0.5);
        this.drawHorizontalLine(doc);

        // --- Tax Breakdown ---
        if (data.taxes.length > 0) {
          doc.moveDown(0.5);
          this.drawTaxBreakdown(doc, data.taxes);
          doc.moveDown(0.3);
          this.drawHorizontalLine(doc);
        }

        // --- Totals ---
        doc.moveDown(0.5);
        this.drawTotals(doc, data);

        // --- Payment Info ---
        if (data.payment_form || data.notes) {
          doc.moveDown(0.5);
          this.drawPaymentInfo(doc, data);
        }

        // --- CUFE ---
        if (data.cufe) {
          doc.moveDown(0.8);
          this.drawCufe(doc, data.cufe);
        }

        // --- QR Code ---
        if (data.qr_code) {
          doc.moveDown(0.5);
          this.drawQrSection(doc, data.qr_code);
        }

        // --- Footer ---
        this.drawFooter(doc);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // ─── Private Helpers ────────────────────────────────────────────

  private static drawHeader(
    doc: PDFKit.PDFDocument,
    data: InvoicePdfData,
  ): void {
    const header_y = doc.y;

    if (data.company_logo_buffer) {
      try {
        doc.image(data.company_logo_buffer, MARGIN, header_y, {
          width: 60,
          height: 60,
          fit: [60, 60],
        });
      } catch {
        // If logo fails to load, skip it silently
      }
    }

    const text_x = data.company_logo_buffer ? MARGIN + 70 : MARGIN;

    doc
      .font('Helvetica-Bold')
      .fontSize(14)
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

    // Ensure we are past the logo height
    if (data.company_logo_buffer) {
      const min_y = header_y + 65;
      if (doc.y < min_y) {
        doc.y = min_y;
      }
    }
  }

  private static drawInvoiceTitle(
    doc: PDFKit.PDFDocument,
    data: InvoicePdfData,
  ): void {
    const type_labels: Record<string, string> = {
      invoice: 'FACTURA ELECTRONICA DE VENTA',
      credit_note: 'NOTA CREDITO ELECTRONICA',
      debit_note: 'NOTA DEBITO ELECTRONICA',
      purchase_invoice: 'FACTURA DE COMPRA',
    };

    const title = type_labels[data.invoice_type] || 'FACTURA';

    doc.font('Helvetica-Bold').fontSize(14).text(title, MARGIN, doc.y, {
      align: 'center',
      width: CONTENT_WIDTH,
    });

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(`No. ${data.invoice_number}`, MARGIN, doc.y + 4, {
        align: 'center',
        width: CONTENT_WIDTH,
      });

    const date_parts: string[] = [`Fecha de emision: ${data.issue_date}`];
    if (data.due_date) {
      date_parts.push(`Vencimiento: ${data.due_date}`);
    }

    doc
      .font('Helvetica')
      .fontSize(9)
      .text(date_parts.join('  |  '), MARGIN, doc.y + 4, {
        align: 'center',
        width: CONTENT_WIDTH,
      });
  }

  private static drawResolutionInfo(
    doc: PDFKit.PDFDocument,
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
      .fontSize(7)
      .fillColor('#555555')
      .text(parts.join('  |  '), MARGIN, doc.y, {
        align: 'center',
        width: CONTENT_WIDTH,
      });

    doc.fillColor('#000000');
  }

  private static drawCustomerInfo(
    doc: PDFKit.PDFDocument,
    data: InvoicePdfData,
  ): void {
    this.drawSectionTitle(doc, 'DATOS DEL CLIENTE');

    const half = CONTENT_WIDTH / 2;
    doc.font('Helvetica').fontSize(9);

    const y1 = doc.y;
    doc.text(`Nombre: ${data.customer_name}`, MARGIN, y1);
    if (data.customer_tax_id) {
      doc.text(`NIT/CC: ${data.customer_tax_id}`, MARGIN + half, y1);
    }

    if (data.customer_address) {
      const addr =
        typeof data.customer_address === 'string' ? data.customer_address : '';
      if (addr) {
        const y2 = doc.y + 2;
        doc.text(`Direccion: ${addr}`, MARGIN, y2);
      }
    }

    if (data.customer_email) {
      const y3 = doc.y + 2;
      doc.text(`Email: ${data.customer_email}`, MARGIN, y3);
    }
  }

  private static drawItemsTable(
    doc: PDFKit.PDFDocument,
    items: InvoicePdfItem[],
  ): void {
    this.drawSectionTitle(doc, 'DETALLE DE PRODUCTOS / SERVICIOS');

    // Table header
    const col_x = {
      qty: MARGIN,
      description: MARGIN + 50,
      unit_price: MARGIN + 280,
      discount: MARGIN + 360,
      tax: MARGIN + 420,
      total: MARGIN + 470,
    };

    const header_y = doc.y;

    // Header background
    doc
      .save()
      .rect(MARGIN, header_y - 2, CONTENT_WIDTH, 16)
      .fill('#f5f5f5')
      .restore();

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000');
    doc.text('Cant.', col_x.qty, header_y, { width: 45 });
    doc.text('Descripcion', col_x.description, header_y, { width: 225 });
    doc.text('P. Unit.', col_x.unit_price, header_y, {
      width: 75,
      align: 'right',
    });
    doc.text('Desc.', col_x.discount, header_y, {
      width: 55,
      align: 'right',
    });
    doc.text('IVA', col_x.tax, header_y, { width: 45, align: 'right' });
    doc.text('Total', col_x.total, header_y, {
      width: MARGIN + CONTENT_WIDTH - col_x.total,
      align: 'right',
    });

    doc.y = header_y + 18;

    // Table rows
    doc.font('Helvetica').fontSize(8);

    for (const item of items) {
      const row_y = doc.y;

      // Check page break
      if (row_y > PAGE_HEIGHT - 150) {
        doc.addPage();
      }

      const current_y = doc.y;

      doc.text(this.formatQuantity(item.quantity), col_x.qty, current_y, {
        width: 45,
      });
      doc.text(item.description, col_x.description, current_y, {
        width: 225,
      });
      doc.text(COP.format(item.unit_price), col_x.unit_price, current_y, {
        width: 75,
        align: 'right',
      });
      doc.text(
        item.discount_amount > 0 ? COP.format(item.discount_amount) : '-',
        col_x.discount,
        current_y,
        { width: 55, align: 'right' },
      );
      doc.text(
        item.tax_amount > 0 ? COP.format(item.tax_amount) : '-',
        col_x.tax,
        current_y,
        { width: 45, align: 'right' },
      );
      doc.text(COP.format(item.total_amount), col_x.total, current_y, {
        width: MARGIN + CONTENT_WIDTH - col_x.total,
        align: 'right',
      });

      doc.moveDown(0.4);
    }
  }

  private static drawTaxBreakdown(
    doc: PDFKit.PDFDocument,
    taxes: InvoicePdfTax[],
  ): void {
    this.drawSectionTitle(doc, 'IMPUESTOS');

    doc.font('Helvetica').fontSize(8);

    for (const tax of taxes) {
      const y = doc.y;
      doc.text(`${tax.tax_name} (${tax.tax_rate}%)`, MARGIN + 10, y);
      doc.text(`Base: ${COP.format(tax.taxable_amount)}`, MARGIN + 200, y);
      doc.text(COP.format(tax.tax_amount), MARGIN, y, {
        width: CONTENT_WIDTH - 10,
        align: 'right',
      });
      doc.moveDown(0.3);
    }
  }

  private static drawTotals(
    doc: PDFKit.PDFDocument,
    data: InvoicePdfData,
  ): void {
    const totals_x = MARGIN + CONTENT_WIDTH / 2;
    const totals_width = CONTENT_WIDTH / 2;

    doc.font('Helvetica').fontSize(9);

    // Subtotal
    let y = doc.y;
    doc.text('Subtotal:', totals_x, y);
    doc.text(COP.format(data.subtotal_amount), totals_x, y, {
      width: totals_width,
      align: 'right',
    });

    // Discount
    if (data.discount_amount > 0) {
      y = doc.y + 2;
      doc.text('Descuento:', totals_x, y);
      doc.text(`-${COP.format(data.discount_amount)}`, totals_x, y, {
        width: totals_width,
        align: 'right',
      });
    }

    // Tax
    if (data.tax_amount > 0) {
      y = doc.y + 2;
      doc.text('IVA:', totals_x, y);
      doc.text(COP.format(data.tax_amount), totals_x, y, {
        width: totals_width,
        align: 'right',
      });
    }

    // Withholding
    if (data.withholding_amount > 0) {
      y = doc.y + 2;
      doc.text('Retencion:', totals_x, y);
      doc.text(`-${COP.format(data.withholding_amount)}`, totals_x, y, {
        width: totals_width,
        align: 'right',
      });
    }

    // Total
    doc.moveDown(0.5);
    const total_y = doc.y;
    const box_height = 28;

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

    doc.text(COP.format(data.total_amount), totals_x, total_y + 4, {
      width: totals_width,
      align: 'right',
    });

    doc.y = total_y + box_height + 2;
  }

  private static drawPaymentInfo(
    doc: PDFKit.PDFDocument,
    data: InvoicePdfData,
  ): void {
    this.drawSectionTitle(doc, 'INFORMACION DE PAGO');

    doc.font('Helvetica').fontSize(9);

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
      doc.text(`Forma de pago: ${label}`, MARGIN, doc.y);
    }

    if (data.payment_method) {
      doc.text(`Metodo de pago: ${data.payment_method}`, MARGIN, doc.y + 2);
    }

    if (data.notes) {
      doc.moveDown(0.3);
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#444444')
        .text(`Observaciones: ${data.notes}`, MARGIN, doc.y, {
          width: CONTENT_WIDTH,
        });
      doc.fillColor('#000000');
    }
  }

  private static drawCufe(doc: PDFKit.PDFDocument, cufe: string): void {
    this.drawSectionTitle(doc, 'CUFE');

    doc
      .font('Courier')
      .fontSize(7)
      .fillColor('#333333')
      .text(cufe, MARGIN, doc.y, {
        width: CONTENT_WIDTH,
        align: 'center',
      });

    doc.fillColor('#000000');
  }

  private static drawQrSection(doc: PDFKit.PDFDocument, qr_url: string): void {
    // Show QR verification URL as text
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#666666')
      .text('Verificacion DIAN:', MARGIN, doc.y, {
        align: 'center',
        width: CONTENT_WIDTH,
      });

    doc
      .font('Helvetica')
      .fontSize(6)
      .text(qr_url, MARGIN, doc.y + 2, {
        align: 'center',
        width: CONTENT_WIDTH,
        link: qr_url,
      });

    doc.fillColor('#000000');
  }

  private static drawSectionTitle(
    doc: PDFKit.PDFDocument,
    title: string,
  ): void {
    doc.font('Helvetica-Bold').fontSize(10).text(title, MARGIN, doc.y);
    doc.moveDown(0.3);
  }

  private static drawHorizontalLine(doc: PDFKit.PDFDocument): void {
    const y = doc.y;
    doc
      .moveTo(MARGIN, y)
      .lineTo(PAGE_WIDTH - MARGIN, y)
      .strokeColor('#cccccc')
      .lineWidth(0.5)
      .stroke();
    doc.strokeColor('#000000');
  }

  private static drawFooter(doc: PDFKit.PDFDocument): void {
    const now = new Date();
    const date_str = now.toLocaleDateString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    doc.moveDown(1.5);
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#999999')
      .text(
        'Esta factura electronica fue generada por Vendix y es valida conforme a la normativa de la DIAN.',
        MARGIN,
        doc.y,
        { align: 'center', width: CONTENT_WIDTH },
      );

    doc.text(`Documento generado el ${date_str}`, MARGIN, doc.y + 2, {
      align: 'center',
      width: CONTENT_WIDTH,
    });

    doc.fillColor('#000000');
  }

  private static formatQuantity(qty: number): string {
    if (Number.isInteger(qty)) return qty.toString();
    return qty.toFixed(2);
  }
}
