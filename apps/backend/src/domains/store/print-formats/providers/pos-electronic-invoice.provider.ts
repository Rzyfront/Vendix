import { Injectable, Logger } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { QrService } from '../../../../common/services/qr.service';
import { S3Service } from '../../../../common/services/s3.service';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { RecentDocumentSummary } from '../interfaces/document-index.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';
import {
  FISCAL_DOCUMENT_PRINT_INCLUDE,
  mapFiscalDocumentToPrintData,
  resolveRawLogoKey,
} from './fiscal-document-print.mapper';
import { signStoreLogoUrl } from '../lib/print-logo.util';

@Injectable()
export class PosElectronicInvoiceDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum = 'pos_electronic_invoice' as unknown as print_format_type_enum;
  private readonly logger = new Logger(PosElectronicInvoiceDataProvider.name);

  // `s3Service` opcional: ver mismo criterio en `fiscal-invoice.provider.ts`.
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly qrService: QrService,
    private readonly s3Service?: S3Service,
  ) {}

  async fetchDocumentData(
    storeId: number,
    documentId: number | string,
  ): Promise<StandardPrintDataModel> {
    const id = Number(documentId);
    if (isNaN(id)) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    // Buscar por ID de factura directa o por ID de orden
    let invoice = await this.prisma.invoices.findFirst({
      where: { id, store_id: storeId },
      include: FISCAL_DOCUMENT_PRINT_INCLUDE,
    });

    if (!invoice) {
      invoice = await this.prisma.invoices.findFirst({
        where: { order_id: id, store_id: storeId },
        include: FISCAL_DOCUMENT_PRINT_INCLUDE,
      });
    }

    if (!invoice) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    let qrBase64: string | undefined;
    if (invoice.qr_code) {
      try {
        const qrBuffer = await this.qrService.generateBuffer(invoice.qr_code, 240);
        qrBase64 = qrBuffer.toString('base64');
      } catch (e) {
        // QR rendering fallback
      }
    }

    const signedLogoUrl = await signStoreLogoUrl(this.s3Service, resolveRawLogoKey(invoice), this.logger);

    const printData = mapFiscalDocumentToPrintData(invoice, {
      qrBase64,
      acceptedLabel: 'Aprobada por DIAN',
      pendingLabel: 'Pendiente',
      signedLogoUrl,
    });

    // Si la factura tiene orden asociada, enriquecer con mesa/cajero si existen
    if (invoice.order_id) {
      const order = await this.prisma.orders.findFirst({
        where: { id: invoice.order_id, store_id: storeId },
        include: {
          users: { select: { first_name: true, last_name: true } },
          table_sessions: {
            where: { closed_at: null },
            orderBy: { opened_at: 'desc' },
            take: 1,
            include: {
              table: { select: { id: true, name: true, zone: true } },
            },
          },
        },
      });

      if (order) {
        if (order.users) {
          printData.document.cashier_name = `${order.users.first_name || ''} ${order.users.last_name || ''}`.trim() || undefined;
        }
        if (order.table_sessions && order.table_sessions.length > 0 && order.table_sessions[0].table) {
          printData.document.table_number = order.table_sessions[0].table.name;
        }
      }
    }

    return printData;
  }

  async getSampleData(storeId?: number): Promise<StandardPrintDataModel> {
    return {
      store: {
        name: 'Vendix POS Express',
        legal_name: 'Vendix Retail POS S.A.S.',
        tax_id: '901.555.333-2',
        phone: '+57 601 310 9900',
        email: 'pos@vendix.com',
        address: 'Carrera 7 # 72-01, Local 102',
        city: 'Bogotá D.C.',
        tax_regime: 'Responsable de IVA - Régimen Común',
      },
      customer: {
        name: 'Consumidor Final / Cliente Frecuente',
        legal_name: 'Consumidor Final',
        tax_id: '222222222222',
        phone: '+57 300 000 0000',
        email: 'cliente@ejemplo.com',
        address: 'Bogotá D.C.',
      },
      document: {
        id: 999,
        number: 'POS-FE-00124',
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString('es-CO'),
        time: '12:30',
        state: 'accepted',
        state_label: 'Aprobada por DIAN',
        cashier_name: 'María Cardona',
        pos_terminal: 'Caja Principal 01',
        payment_method: 'Efectivo / Tarjeta',
      },
      fiscal: {
        cufe: 'c3f1e5a890123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef089b',
        qr_code_content: 'NumFac:POS-FE-00124\nFecFac:2026-08-31\nNitFac:9015553332\nDocAdq:222222222222\nValFac:75000.00\nValIva:14250.00\nValOtro:0.00\nValTotal:89250.00\nCUFE:c3f1e5...',
        resolution_number: '18764000001234',
        resolution_prefix: 'SETP',
        resolution_range_from: 1,
        resolution_range_to: 100000,
        resolution_valid_from: '2026-01-01',
        resolution_valid_to: '2027-01-01',
        technical_key: '3a8f9c1b',
        environment: 'production',
      },
      // La discriminación de impuestos vive en `taxes` a nivel raíz, no dentro
      // de `fiscal`: es el arreglo que `print-layout-composer` recorre para la
      // sección `fiscal_tax_breakdown`, y los otros diez formatos del dominio
      // lo alimentan por ahí.
      taxes: [
        {
          name: 'IVA 19%',
          rate: 19,
          base_amount: 75000,
          tax_amount: 14250,
          base_formatted: '$75.000',
          tax_formatted: '$14.250',
        },
      ],
      items: [
        {
          index: 1,
          product_name: 'Combo Almuerzo Especial',
          quantity: 1,
          unit_price: 35000,
          unit_price_formatted: '$35.000',
          total_price: 35000,
          total_price_formatted: '$35.000',
          tax_rate: 19,
          tax_amount: 6650,
        },
        {
          index: 2,
          product_name: 'Bebida Refrescante 400ml',
          quantity: 2,
          unit_price: 20000,
          unit_price_formatted: '$20.000',
          total_price: 40000,
          total_price_formatted: '$40.000',
          tax_rate: 19,
          tax_amount: 7600,
        },
      ],
      totals: {
        subtotal: 75000,
        subtotal_formatted: '$75.000',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 14250,
        tax_total_formatted: '$14.250',
        grand_total: 89250,
        grand_total_formatted: '$89.250',
        grand_total_in_words:
          'OCHENTA Y NUEVE MIL DOSCIENTOS CINCUENTA PESOS M/CTE',
      },
    };
  }

  async listRecentDocuments(storeId: number, limit = 10): Promise<RecentDocumentSummary[]> {
    const invoices = await this.prisma.invoices.findMany({
      where: { store_id: storeId },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: {
        id: true,
        invoice_number: true,
        status: true,
        total_amount: true,
        issue_date: true,
        customer_name: true,
      },
    });

    return invoices.map((inv) => ({
      document_id: inv.id,
      number: inv.invoice_number || `#${inv.id}`,
      title: inv.customer_name ? `FE a ${inv.customer_name}` : `Factura ${inv.invoice_number}`,
      date: inv.issue_date ? inv.issue_date.toISOString() : new Date().toISOString(),
      amount_formatted: `$${Number(inv.total_amount || 0).toLocaleString('es-CO')}`,
      status: inv.status,
    }));
  }

  getAvailableTokens(): PrintTokenDefinition[] {
    return [
      { token: '{{fiscal.cufe}}', path: 'fiscal.cufe', description: 'CUFE de la factura electrónica', example: 'c3f1e5a8...' },
      { token: '{{fiscal.qr_code_content}}', path: 'fiscal.qr_code_content', description: 'Contenido del QR DIAN', example: 'NumFac:POS-FE-001...' },
      { token: '{{fiscal.resolution_number}}', path: 'fiscal.resolution_number', description: 'Número de resolución DIAN', example: '18764000001234' },
      { token: '{{fiscal.resolution_prefix}}', path: 'fiscal.resolution_prefix', description: 'Prefijo de la resolución', example: 'SETP' },
      { token: '{{fiscal.resolution_range_from}}', path: 'fiscal.resolution_range_from', description: 'Rango autorizado desde', example: '1' },
      { token: '{{fiscal.resolution_range_to}}', path: 'fiscal.resolution_range_to', description: 'Rango autorizado hasta', example: '100000' },
      { token: '{{fiscal.resolution_valid_from}}', path: 'fiscal.resolution_valid_from', description: 'Vigencia de la resolución desde', example: '2026-01-01' },
      { token: '{{fiscal.resolution_valid_to}}', path: 'fiscal.resolution_valid_to', description: 'Vigencia de la resolución hasta', example: '2027-01-01' },
      { token: '{{taxes}}', path: 'taxes', description: 'Discriminación de impuestos', example: 'IVA 19% — $14.250' },
      { token: '{{store.name}}', path: 'store.name', description: 'Nombre comercial de la tienda', example: 'Vendix POS Express' },
      { token: '{{store.tax_id}}', path: 'store.tax_id', description: 'NIT o identificación fiscal', example: '901.555.333-2' },
      { token: '{{customer.name}}', path: 'customer.name', description: 'Nombre del cliente', example: 'Consumidor Final' },
      { token: '{{totals.grand_total}}', path: 'totals.grand_total_formatted', description: 'Total a pagar con formato', example: '$89.250' },
    ];
  }
}
