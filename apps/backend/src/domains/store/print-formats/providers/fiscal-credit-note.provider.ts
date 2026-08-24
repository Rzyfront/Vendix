import { Injectable } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';

@Injectable()
export class FiscalCreditNoteDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum = 'fiscal_credit_note';

  constructor(private readonly prisma: StorePrismaService) {}

  async fetchDocumentData(
    storeId: number,
    documentId: number | string,
  ): Promise<StandardPrintDataModel> {
    return this.getSampleData(storeId);
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
        tax_regime: 'Responsable de IVA',
      },
      customer: {
        name: 'Compañía Minera y Comercial del Pacífico S.A.',
        tax_id: '800.123.987-6',
        phone: '+57 602 888 1234',
        email: 'facturaelectronica@pacificomin.com',
      },
      document: {
        id: 999,
        // Mismo motivo que en fiscal-invoice.provider.ts: con `prefix` poblado
        // la muestra rendia `NC-SETP-#NC-SETP-0012`.
        number: 'NC-SETP-0012',
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString('es-CO'),
        state: 'accepted',
        state_label: 'Aprobada por DIAN',
        reference_document_number: 'SETP-990001',
        notes: 'Anulación parcial por descuento comercial acordado posterior a la emisión.',
      },
      fiscal: {
        cude: 'c1d2e3f4a5b67890123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0',
      },
      items: [
        {
          index: 1,
          product_name: 'Ajuste de Tarifa Consultoría Arquitectura Cloud',
          quantity: 1,
          unit_price: 500000,
          unit_price_formatted: '$500.000',
          tax_rate: 19,
          tax_amount: 95000,
          total_price: 500000,
          total_price_formatted: '$500.000',
        },
      ],
      taxes: [
        {
          name: 'IVA 19%',
          rate: 19,
          base_amount: 500000,
          tax_amount: 95000,
          base_formatted: '$500.000',
          tax_formatted: '$95.000',
        },
      ],
      totals: {
        subtotal: 500000,
        subtotal_formatted: '$500.000',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 95000,
        tax_total_formatted: '$95.000',
        grand_total: 595000,
        grand_total_formatted: '$595.000',
      },
    };
  }

  getAvailableTokens(): PrintTokenDefinition[] {
    return [
      { token: '{{fiscal.cude}}', path: 'fiscal.cude', description: 'Código Único de Documento Electrónico (CUDE)', example: 'c1d2e3f4...' },
      { token: '{{document.reference_document_number}}', path: 'document.reference_document_number', description: 'Factura electrónica afectada', example: 'SETP-990001' },
      { token: '{{totals.grand_total}}', path: 'totals.grand_total_formatted', description: 'Monto total acreditado', example: '$595.000' },
    ];
  }
}
