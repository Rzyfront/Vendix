import { Injectable } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { QrService } from '../../../../common/services/qr.service';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';
import {
  FISCAL_DOCUMENT_PRINT_INCLUDE,
  mapFiscalDocumentToPrintData,
} from './fiscal-document-print.mapper';
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
      include: FISCAL_DOCUMENT_PRINT_INCLUDE,
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

    return mapFiscalDocumentToPrintData(invoice, {
      qrBase64,
      acceptedLabel: 'Aprobada por DIAN',
      pendingLabel: 'Pendiente',
    });
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
        // Sin `prefix`: el compositor imprime `doc.prefix + '-'` ANTES del
        // numero, asi que poblarlo con el prefijo que el numero ya lleva
        // rendia `SETP-#SETP-990001` — el prefijo dos veces, en la pantalla
        // de previsualizacion de formatos. La muestra imita ahora al camino
        // real, que tampoco lo pobla.
        number: 'SETP-990001',
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
