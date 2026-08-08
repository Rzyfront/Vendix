import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { S3Service } from '../../../../common/services/s3.service';
import { InvoicePdfBuilder, InvoicePdfData } from './invoice-pdf.builder';
import {
  PRINT_FORMATS,
  PrintFormat,
} from '../../settings/interfaces/store-settings.interface';
import { resolveTenantFiscalIdentity } from '@common/helpers/fiscal-identity.helper';

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
      fiscal_scope: true,
      addresses: { take: 1 },
      organization_settings: { select: { settings: true } },
    },
  },
  // The graphic representation must show the issuer that actually signed the
  // XML. Under `fiscal_scope = STORE` that identity lives in the store's
  // `fiscal_data`, not in the organization row, so both are loaded and the
  // scope decides. The store also carries the print format.
  store: {
    select: {
      id: true,
      name: true,
      legal_name: true,
      logo_url: true,
      addresses: { orderBy: [{ is_primary: 'desc' }, { id: 'asc' }], take: 1 },
      store_settings: { select: { settings: true } },
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

/** Readable labels for the regime stored in `fiscal_data.tax_regime`. */
const TAX_REGIME_LABELS: Record<string, string> = {
  COMUN: 'Responsable de IVA',
  SIMPLIFICADO: 'No responsable de IVA',
  SIMPLE: 'Regimen Simple de Tributacion (RST)',
  GRAN_CONTRIBUYENTE: 'Gran contribuyente',
  NO_RESPONSABLE: 'No responsable de IVA',
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
    const store = invoice.store;
    const issuer = this.resolveIssuer(org, store);

    // Optionally download logo
    const logo_url = issuer.logo_url;
    let logo_buffer: Buffer | undefined;
    if (logo_url) {
      try {
        logo_buffer = await this.s3_service.downloadImage(logo_url);
      } catch {
        this.logger.warn('Could not download issuer logo for invoice PDF');
      }
    }

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
      company_name: issuer.legal_name,
      company_nit: issuer.nit,
      company_address: issuer.address_line,
      company_phone: issuer.phone,
      company_email: issuer.email,
      company_logo_buffer: logo_buffer,
      company_trade_name: issuer.trade_name,
      company_tax_regime: issuer.tax_regime,
      company_tax_responsibilities: issuer.tax_responsibilities,

      // Paper format configured for this store.
      format: this.resolveInvoiceFormat(store),

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
        // "Empaque por tarifa" snapshot — tier label + stock units consumed.
        applied_price_tier_name: item.applied_price_tier_name ?? null,
        stock_units_consumed:
          typeof item.stock_units_consumed === 'number'
            ? item.stock_units_consumed
            : null,
        // Serial number(s) snapshot (CSV) for serialized products (QUI-431).
        serial_numbers_snapshot: item.serial_numbers_snapshot ?? null,
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
   * Renders a sample invoice in the requested format so the merchant can see how
   * their paper choice looks before saving it.
   *
   * Deliberately built from fabricated document data — never from a real sale and
   * never through the invoice pipeline — so previewing cannot consume resolution
   * numbering, hit the DIAN, or persist anything. The issuer block IS real,
   * because the point of the preview is checking that the store's own legal data
   * fits the chosen format.
   */
  async previewPdf(format: PrintFormat): Promise<Buffer> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    const organization_id = context?.organization_id;

    const store = store_id
      ? await this.prisma.withoutScope().stores.findFirst({
          where: { id: store_id },
          select: {
            id: true,
            name: true,
            legal_name: true,
            logo_url: true,
            addresses: {
              orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
              take: 1,
            },
            store_settings: { select: { settings: true } },
          },
        })
      : null;

    const org = organization_id
      ? await this.prisma.withoutScope().organizations.findFirst({
          where: { id: organization_id },
          select: {
            id: true,
            name: true,
            legal_name: true,
            tax_id: true,
            phone: true,
            email: true,
            logo_url: true,
            fiscal_scope: true,
            addresses: { take: 1 },
            organization_settings: { select: { settings: true } },
          },
        })
      : null;

    const issuer = this.resolveIssuer(org, store);

    let logo_buffer: Buffer | undefined;
    if (issuer.logo_url) {
      try {
        logo_buffer = await this.s3_service.downloadImage(issuer.logo_url);
      } catch {
        this.logger.warn('Could not download issuer logo for PDF preview');
      }
    }

    const today = this.formatDate(new Date());

    return InvoicePdfBuilder.generate({
      company_name: issuer.legal_name,
      company_nit: issuer.nit,
      company_address: issuer.address_line,
      company_phone: issuer.phone,
      company_email: issuer.email,
      company_logo_buffer: logo_buffer,
      company_trade_name: issuer.trade_name,
      company_tax_regime: issuer.tax_regime,
      company_tax_responsibilities: issuer.tax_responsibilities,

      format,

      resolution_number: '00000000000',
      resolution_date: today,
      resolution_prefix: 'MUESTRA',
      resolution_range_from: 1,
      resolution_range_to: 1000,
      resolution_valid_from: today,
      resolution_valid_to: today,

      customer_name: 'CLIENTE DE MUESTRA S.A.S.',
      customer_tax_id: '900000000-0',
      customer_address: 'Direccion del cliente',
      customer_email: 'cliente@ejemplo.com',

      invoice_number: 'MUESTRA-0001',
      invoice_type: 'invoice',
      issue_date: today,
      currency: 'COP',
      notes: 'Documento de muestra: no corresponde a una venta real.',

      items: [
        {
          description: 'Producto de ejemplo con nombre largo para ver el ajuste',
          quantity: 2,
          unit_price: 50000,
          discount_amount: 5000,
          tax_amount: 18050,
          total_amount: 113050,
        },
        {
          description: 'Servicio de ejemplo',
          quantity: 1,
          unit_price: 120000,
          discount_amount: 0,
          tax_amount: 22800,
          total_amount: 142800,
        },
      ],
      taxes: [
        {
          tax_name: 'IVA',
          tax_rate: 19,
          taxable_amount: 215000,
          tax_amount: 40850,
        },
      ],
      subtotal_amount: 220000,
      discount_amount: 5000,
      tax_amount: 40850,
      withholding_amount: 0,
      total_amount: 255850,

      cufe: 'MUESTRA0000000000000000000000000000000000000000000000000000000000000000000000000000',
      qr_code: 'https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=MUESTRA',
      payment_form: 'cash',
      payment_method: 'Efectivo',
    });
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

  /**
   * Legal identity of whoever issues this invoice. Pasa por el resolvedor único
   * (`resolveTenantFiscalIdentity`) — el mismo que consumen `dian-direct` y
   * `dian-test` — para que la razón social y el NIT impresos en el PDF sean
   * exactamente los que firmó el XML. Antes esta función duplicaba la cascada
   * y podía imprimir un NIT rancio o 'N/A' si `fiscal_data` no estaba cargado,
   * además de leer `nit_dv` directamente del JSON (que es una columna derivada).
   */
  private resolveIssuer(org: any, store: any) {
    const scope: string = org?.fiscal_scope ?? 'STORE';
    const scoped_settings =
      scope === 'STORE'
        ? store?.store_settings?.settings
        : org?.organization_settings?.settings;
    // `settings` is a Prisma Json column, untyped at runtime.
    const fiscal = ((scoped_settings as any)?.fiscal_data ?? null) as
      | Record<string, unknown>
      | null;

    const owner = scope === 'STORE' ? store : org;
    const address = owner?.addresses?.[0] ?? org?.addresses?.[0];

    let identity;
    try {
      identity = resolveTenantFiscalIdentity({
        nit: org?.tax_id || store?.tax_id || '',
        fiscal_data: fiscal,
        entity: org
          ? { legal_name: org.legal_name, name: org.name }
          : null,
        organization: org
          ? {
              legal_name: org.legal_name,
              name: org.name,
              email: org.email,
              phone: org.phone,
              document_type: org.document_type,
              person_type: org.person_type,
            }
          : null,
        address: address
          ? {
              address_line1: address.address_line1,
              city: address.city,
              state_province: address.state_province,
              municipality_code: address.municipality_code,
              postal_code: address.postal_code,
              phone_number: address.phone_number,
            }
          : null,
        email: org?.email,
      });
    } catch {
      // El PDF debe imprimirse aunque el resolvedor lance (ej: `municipality_code`
      // ausente). En ese caso caemos a los datos crudos sin inventar NIT/DV.
      identity = {
        nit: (typeof fiscal?.['nit'] === 'string' && fiscal['nit']) ||
          org?.tax_id || '',
        nit_dv: typeof fiscal?.['nit_dv'] === 'string' ? fiscal['nit_dv'] : '',
        legal_name:
          (typeof fiscal?.['legal_name'] === 'string' && fiscal['legal_name']) ||
          owner?.legal_name ||
          org?.name ||
          'N/A',
        fiscal_address:
          (typeof fiscal?.['fiscal_address'] === 'string' &&
            fiscal['fiscal_address']) ||
          address?.address_line1 ||
          '',
        city: address?.city || '',
        department: address?.state_province || '',
        country: 'CO',
        email: org?.email || '',
        phone: address?.phone_number || org?.phone || undefined,
        tax_responsibilities: Array.isArray(fiscal?.['tax_responsibilities'])
          ? (fiscal['tax_responsibilities'] as string[])
          : [],
        tax_regime: typeof fiscal?.['tax_regime'] === 'string'
          ? fiscal['tax_regime']
          : undefined,
      };
    }

    const address_line =
      identity.fiscal_address && (identity.city || identity.department)
        ? [identity.fiscal_address, identity.city, identity.department]
            .filter(Boolean)
            .join(', ')
        : identity.fiscal_address || undefined;

    const nit = identity.nit
      ? identity.nit_dv
        ? `${identity.nit}-${identity.nit_dv}`
        : identity.nit
      : 'N/A';

    return {
      legal_name: identity.legal_name,
      nit,
      trade_name: owner?.name || undefined,
      address_line,
      phone: identity.phone,
      email: identity.email || org?.email || undefined,
      logo_url: store?.logo_url || org?.logo_url || undefined,
      tax_regime:
        TAX_REGIME_LABELS[(identity.tax_regime || '').toUpperCase()] ||
        identity.tax_regime ||
        undefined,
      tax_responsibilities: identity.tax_responsibilities,
    };
  }

  /**
   * Paper format for the graphic representation. Always the store's setting —
   * printing is a per-store concern even when the fiscal identity is the
   * organization's. Falls back to `letter`, the historical hardcoded layout.
   */
  private resolveInvoiceFormat(store: any): PrintFormat {
    const receipts = (store?.store_settings?.settings as any)?.receipts;
    const format = receipts?.invoice_format;
    return PRINT_FORMATS.includes(format) ? format : 'letter';
  }

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
