import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { S3Service } from '../../../../common/services/s3.service';
import { InvoicePdfBuilder, InvoicePdfData } from './invoice-pdf.builder';

const INVOICE_PDF_INCLUDE = {
  invoice_items: true,
  invoice_taxes: true,
  resolution: true,
  organization: {
    select: {
      id: true,
      name: true,
      legal_name: true,
      tax_id: true,
      phone: true,
      email: true,
      logo_url: true,
      addresses: { take: 1 },
    },
  },
  customer: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      email: true,
    },
  },
};

@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3_service: S3Service,
    private readonly event_emitter: EventEmitter2,
  ) {}

  /**
   * Generates a PDF for an invoice, uploads to S3, and updates the invoice record.
   */
  async generatePdf(invoice_id: number): Promise<{ key: string; url: string }> {
    const invoice = await this.prisma.invoices.findFirst({
      where: { id: invoice_id },
      include: INVOICE_PDF_INCLUDE,
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const org = invoice.organization;

    // Optionally download logo
    let logo_buffer: Buffer | undefined;
    if (org?.logo_url) {
      try {
        logo_buffer = await this.s3_service.downloadImage(org.logo_url);
      } catch {
        this.logger.warn(
          'Could not download organization logo for invoice PDF',
        );
      }
    }

    const address = org?.addresses?.[0];
    const address_line = address
      ? [address.address_line1, address.city, address.state_province]
          .filter(Boolean)
          .join(', ')
      : undefined;

    // Build customer address string from JSON
    const customer_address = this.formatCustomerAddress(
      invoice.customer_address,
    );

    // Build customer name
    const customer = invoice.customer;
    const customer_name =
      invoice.customer_name ||
      (customer
        ? `${customer.first_name} ${customer.last_name}`
        : 'Consumidor Final');

    const resolution = invoice.resolution;

    const pdf_data: InvoicePdfData = {
      // Emisor
      company_name: org?.legal_name || org?.name || 'N/A',
      company_nit: org?.tax_id || 'N/A',
      company_address: address_line,
      company_phone: org?.phone || undefined,
      company_email: org?.email || undefined,
      company_logo_buffer: logo_buffer,

      // Resolucion
      resolution_number: resolution?.resolution_number,
      resolution_date: resolution?.resolution_date
        ? this.formatDate(resolution.resolution_date)
        : undefined,
      resolution_range_from: resolution?.range_from,
      resolution_range_to: resolution?.range_to,
      resolution_prefix: resolution?.prefix,
      resolution_valid_from: resolution?.valid_from
        ? this.formatDate(resolution.valid_from)
        : undefined,
      resolution_valid_to: resolution?.valid_to
        ? this.formatDate(resolution.valid_to)
        : undefined,

      // Cliente
      customer_name,
      customer_tax_id: invoice.customer_tax_id || undefined,
      customer_address,
      customer_email: customer?.email || undefined,

      // Factura
      invoice_number: invoice.invoice_number,
      invoice_type: invoice.invoice_type,
      issue_date: this.formatDate(invoice.issue_date),
      due_date: invoice.due_date
        ? this.formatDate(invoice.due_date)
        : undefined,
      payment_date: invoice.payment_date
        ? this.formatDate(invoice.payment_date)
        : undefined,
      currency: invoice.currency || 'COP',
      notes: invoice.notes || undefined,

      // Items
      items: (invoice.invoice_items || []).map((item: any) => ({
        description: item.description,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        discount_amount: Number(item.discount_amount),
        tax_amount: Number(item.tax_amount),
        total_amount: Number(item.total_amount),
      })),

      // Taxes
      taxes: (invoice.invoice_taxes || []).map((tax: any) => ({
        tax_name: tax.tax_name,
        tax_rate: Number(tax.tax_rate),
        taxable_amount: Number(tax.taxable_amount),
        tax_amount: Number(tax.tax_amount),
      })),

      // Totals
      subtotal_amount: Number(invoice.subtotal_amount),
      discount_amount: Number(invoice.discount_amount),
      tax_amount: Number(invoice.tax_amount),
      withholding_amount: Number(invoice.withholding_amount),
      total_amount: Number(invoice.total_amount),

      // DIAN
      cufe: invoice.cufe || undefined,
      qr_code: invoice.qr_code || undefined,
    };

    const pdf_buffer = await InvoicePdfBuilder.generate(pdf_data);

    // Upload to S3
    const s3_key = `stores/${invoice.store_id}/invoices/${invoice.id}/invoice-${invoice.invoice_number}.pdf`;
    await this.s3_service.uploadFile(pdf_buffer, s3_key, 'application/pdf');

    // Persist S3 key on the invoice
    await this.prisma.invoices.update({
      where: { id: invoice_id },
      data: { pdf_url: s3_key },
    });

    const url = await this.s3_service.getPresignedUrl(s3_key);

    this.logger.log(
      `PDF generated for invoice #${invoice.invoice_number} (${s3_key})`,
    );

    return { key: s3_key, url };
  }

  /**
   * Gets the PDF URL for an invoice. Generates lazily if not yet created.
   */
  async getPdf(invoice_id: number): Promise<string> {
    const invoice = await this.prisma.invoices.findFirst({
      where: { id: invoice_id },
      select: { id: true, pdf_url: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    // If PDF already exists, return a fresh signed URL
    if (invoice.pdf_url) {
      return this.s3_service.getPresignedUrl(invoice.pdf_url);
    }

    // Generate on demand
    const result = await this.generatePdf(invoice_id);
    return result.url;
  }

  /**
   * Automatically generates invoice PDF when an invoice is accepted.
   */
  @OnEvent('invoice.accepted')
  async onInvoiceAccepted(payload: { invoice_id: number }): Promise<void> {
    try {
      const result = await this.generatePdf(payload.invoice_id);
      this.logger.log(
        `Auto-generated PDF for accepted invoice #${payload.invoice_id}`,
      );

      // Emit event so downstream listeners (e.g. email) know the PDF is ready
      this.event_emitter.emit('invoice.pdf.generated', {
        invoice_id: payload.invoice_id,
        pdf_key: result.key,
      });
    } catch (error) {
      this.logger.error(
        `Failed to auto-generate PDF for invoice #${payload.invoice_id}: ${error.message}`,
      );
    }
  }

  /**
   * Automatically generates invoice PDF when an invoice is sent to DIAN.
   * This ensures PDF is available even before acceptance.
   */
  @OnEvent('invoice.sent')
  async onInvoiceSent(payload: { invoice_id: number }): Promise<void> {
    try {
      // Only generate if not already generated
      const invoice = await this.prisma.invoices.findFirst({
        where: { id: payload.invoice_id },
        select: { id: true, pdf_url: true },
      });

      if (invoice && !invoice.pdf_url) {
        await this.generatePdf(payload.invoice_id);
        this.logger.log(
          `Auto-generated PDF for sent invoice #${payload.invoice_id}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to auto-generate PDF for invoice #${payload.invoice_id}: ${error.message}`,
      );
    }
  }

  // ─── Private Helpers ─────────────────────────────────────────────

  /** Formats a Date as DD/MM/YYYY. */
  private formatDate(date: Date): string {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /** Extracts a displayable address from the customer_address JSON field. */
  private formatCustomerAddress(address: any): string | undefined {
    if (!address) return undefined;

    if (typeof address === 'string') return address;

    if (typeof address === 'object') {
      const parts: string[] = [];
      if (address.address_line1) parts.push(address.address_line1);
      if (address.address_line2) parts.push(address.address_line2);
      if (address.city) parts.push(address.city);
      if (address.state) parts.push(address.state);
      if (address.state_province) parts.push(address.state_province);
      if (address.country) parts.push(address.country);
      return parts.length > 0 ? parts.join(', ') : undefined;
    }

    return undefined;
  }
}
