import { Injectable } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { QrService } from '../../../../common/services/qr.service';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';
import { RESOLUTION_PUBLIC_SELECT } from '../../invoicing/utils/technical-key.util';
import { amountToSpanishWords } from '@common/utils/amount-in-words.util';

@Injectable()
export class FiscalInvoiceDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum = 'fiscal_electronic_invoice';

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly qrService: QrService,
  ) {}

  async fetchDocumentData(
    storeId: number,
    documentId: number | string,
  ): Promise<StandardPrintDataModel> {
    const id = Number(documentId);
    if (isNaN(id)) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    const invoice = await this.prisma.invoices.findFirst({
      where: { id, store_id: storeId },
      include: {
        invoice_items: true,
        invoice_taxes: true,
        resolution: { select: RESOLUTION_PUBLIC_SELECT },
        organization: {
          include: {
            addresses: { take: 1 },
          },
        },
        store: {
          include: {
            addresses: { take: 1 },
          },
        },
        customer: true,
      },
    });

    if (!invoice) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    let qrBase64: string | undefined;
    if (invoice.qr_code) {
      try {
        const qrBuffer = await this.qrService.generateBuffer(invoice.qr_code, 240);
        qrBase64 = qrBuffer.toString('base64');
      } catch (e) {
        // QR rendering error fallback
      }
    }

    const store = invoice.store || {};
    const org = invoice.organization || {};
    const cust = invoice.customer || ({} as any);
    const res = invoice.resolution || ({} as any);

    const items = (invoice.invoice_items || []).map((it: any, idx: number) => ({
      index: idx + 1,
      product_name: it.name || it.description || 'Ítem',
      variant_sku: it.sku || undefined,
      quantity: Number(it.quantity || 1),
      unit_price: Number(it.price || 0),
      unit_price_formatted: `$${Number(it.price || 0).toLocaleString('es-CO')}`,
      discount_amount: Number(it.discount_amount || 0),
      discount_formatted: it.discount_amount ? `-$${Number(it.discount_amount).toLocaleString('es-CO')}` : undefined,
      tax_rate: Number(it.tax_rate || 0),
      tax_amount: Number(it.tax_amount || 0),
      total_price: Number(it.total || 0),
      total_price_formatted: `$${Number(it.total || 0).toLocaleString('es-CO')}`,
    }));

    const taxes = (invoice.invoice_taxes || []).map((t: any) => ({
      name: t.tax_name || 'IVA',
      rate: Number(t.tax_rate || 0),
      base_amount: Number(t.taxable_amount || 0),
      tax_amount: Number(t.tax_amount || 0),
      base_formatted: `$${Number(t.taxable_amount || 0).toLocaleString('es-CO')}`,
      tax_formatted: `$${Number(t.tax_amount || 0).toLocaleString('es-CO')}`,
    }));

    const subtotal = Number(invoice.subtotal_amount || 0);
    const discount = Number(invoice.discount_amount || 0);
    const tax = Number(invoice.tax_amount || 0);
    const total = Number(invoice.total_amount || (subtotal - discount + tax));

    return {
      store: {
        name: store.name || org.name || 'Vendix',
        legal_name: store.legal_name || org.legal_name,
        tax_id: org.tax_id,
        phone: store.phone || org.phone,
        email: store.email || org.email,
        address: store.addresses?.[0]?.address_line1 || org.addresses?.[0]?.address_line1,
        city: store.addresses?.[0]?.city || org.addresses?.[0]?.city,
        logo_url: store.logo_url || org.logo_url,
      },
      customer: {
        name: `${cust.first_name || ''} ${cust.last_name || ''}`.trim() || 'Consumidor Final',
        tax_id: cust.document_number || '222222222222',
        phone: cust.phone,
        email: cust.email,
      },
      document: {
        id: invoice.id,
        number: invoice.invoice_number ? `${invoice.prefix || ''}${invoice.invoice_number}` : String(invoice.id),
        prefix: invoice.prefix || undefined,
        date: invoice.issue_date ? new Date(invoice.issue_date).toISOString() : new Date().toISOString(),
        date_formatted: invoice.issue_date ? new Date(invoice.issue_date).toLocaleDateString('es-CO') : new Date().toLocaleDateString('es-CO'),
        state: invoice.dian_status || 'draft',
        state_label: invoice.dian_status === 'accepted' ? 'Aprobada por DIAN' : 'Pendiente',
      },
      fiscal: {
        cufe: invoice.cufe || undefined,
        qr_code_content: invoice.qr_code || undefined,
        qr_code_png_base64: qrBase64,
        resolution_number: res.resolution_number,
        resolution_prefix: res.prefix,
        resolution_range_from: res.range_from,
        resolution_range_to: res.range_to,
        resolution_date: res.resolution_date ? new Date(res.resolution_date).toLocaleDateString('es-CO') : undefined,
        resolution_valid_from: res.valid_from ? new Date(res.valid_from).toLocaleDateString('es-CO') : undefined,
        resolution_valid_to: res.valid_to ? new Date(res.valid_to).toLocaleDateString('es-CO') : undefined,
      },
      items,
      taxes,
      totals: {
        subtotal,
        subtotal_formatted: `$${subtotal.toLocaleString('es-CO')}`,
        discount_total: discount,
        discount_total_formatted: `$${discount.toLocaleString('es-CO')}`,
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: tax,
        tax_total_formatted: `$${tax.toLocaleString('es-CO')}`,
        grand_total: total,
        grand_total_formatted: `$${total.toLocaleString('es-CO')}`,
        // Mismo `total` que la fila en cifras: una segunda fuente aquí sería una
        // contradicción interna del documento legal.
        grand_total_in_words: Number.isFinite(total)
          ? amountToSpanishWords(total, { suffix: 'M/CTE' })
          : undefined,
      },
    };
  }

  async getSampleData(storeId?: number): Promise<StandardPrintDataModel> {
    return {
      store: {
        name: 'Vendix Enterprise Solutions',
        legal_name: 'Vendix Facturación Electrónica S.A.S.',
        tax_id: '901.555.333-2',
        phone: '+57 601 310 9900',
        email: 'fe@vendix.com',
        address: 'Calle 93B # 13-40, Oficina 502',
        city: 'Bogotá D.C.',
        tax_regime: 'Responsable de IVA - Gran Contribuyente',
      },
      customer: {
        name: 'Compañía Minera y Comercial del Pacífico S.A.',
        legal_name: 'Compañía Minera y Comercial del Pacífico S.A.',
        tax_id: '800.123.987-6',
        phone: '+57 602 888 1234',
        email: 'facturaelectronica@pacificomin.com',
        address: 'Avenida Colombia # 1-50, Cali',
      },
      document: {
        id: 888,
        number: 'SETP-990001',
        prefix: 'SETP',
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString('es-CO'),
        time: '11:45',
        state: 'accepted',
        state_label: 'Aprobada por DIAN',
      },
      fiscal: {
        cufe: 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0',
        qr_code_content: 'NumFac:SETP-990001\nFecFac:2026-08-22\nNitFac:9015553332\nDocAdq:8001239876\nValFac:4500000.00\nValIva:855000.00\nValOtro:0.00\nValTotal:5355000.00\nCUFE:a1b2c3d4e5...',
        resolution_number: '18764000001234',
        resolution_prefix: 'SETP',
        resolution_range_from: 990000,
        resolution_range_to: 999999,
        resolution_date: '2026-01-15',
        resolution_valid_from: '2026-01-15',
        resolution_valid_to: '2027-01-15',
      },
      items: [
        {
          index: 1,
          product_name: 'Consultoría Especializada en Arquitectura Cloud (Mes)',
          quantity: 1,
          unit_price: 4500000,
          unit_price_formatted: '$4.500.000',
          tax_rate: 19,
          tax_amount: 855000,
          total_price: 4500000,
          total_price_formatted: '$4.500.000',
        },
      ],
      taxes: [
        {
          name: 'IVA 19%',
          rate: 19,
          base_amount: 4500000,
          tax_amount: 855000,
          base_formatted: '$4.500.000',
          tax_formatted: '$855.000',
        },
      ],
      totals: {
        subtotal: 4500000,
        subtotal_formatted: '$4.500.000',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 855000,
        tax_total_formatted: '$855.000',
        grand_total: 5355000,
        grand_total_formatted: '$5.355.000',
        grand_total_in_words: amountToSpanishWords(5355000, {
          suffix: 'M/CTE',
        }),
      },
    };
  }

  getAvailableTokens(): PrintTokenDefinition[] {
    return [
      { token: '{{fiscal.cufe}}', path: 'fiscal.cufe', description: 'Código Único de Factura Electrónica (CUFE)', example: 'a1b2c3d4...' },
      { token: '{{fiscal.resolution_number}}', path: 'fiscal.resolution_number', description: 'Número de resolución de facturación DIAN', example: '18764000001234' },
      { token: '{{fiscal.qr_code_png_base64}}', path: 'fiscal.qr_code_png_base64', description: 'Imagen Base64 del código QR oficial DIAN', example: 'iVBORw0KGgo...' },
      { token: '{{store.legal_name}}', path: 'store.legal_name', description: 'Razón social del emisor fiscal', example: 'Mi Empresa S.A.S.' },
      { token: '{{customer.legal_name}}', path: 'customer.name', description: 'Razón social del adquirente', example: 'Cliente S.A.' },
    ];
  }
}
