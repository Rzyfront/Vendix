import { Injectable } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';

@Injectable()
export class CreditNoteDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum = 'credit_note';

  constructor(private readonly prisma: StorePrismaService) {}

  async fetchDocumentData(
    storeId: number,
    documentId: number | string,
  ): Promise<StandardPrintDataModel> {
    const sample = await this.getSampleData(storeId);
    return sample;
  }

  async getSampleData(storeId?: number): Promise<StandardPrintDataModel> {
    return {
      store: {
        name: 'Vendix Retail Store',
        legal_name: 'Vendix Retail S.A.S.',
        tax_id: '900.555.444-3',
        phone: '+57 301 222 3344',
        email: 'atencionalcliente@vendix.com',
        address: 'Centro Comercial Unicentro, Local 215',
        city: 'Medellín',
      },
      customer: {
        name: 'María Fernanda Restrepo',
        tax_id: '43.999.888',
        phone: '+57 314 777 8899',
        email: 'mafe.restrepo@gmail.com',
      },
      document: {
        id: 901,
        number: 'NC-2026-0034',
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString('es-CO'),
        state: 'applied',
        state_label: 'Aplicada',
        reference_document_number: 'ORD-2026-0089',
        notes: 'Devolución de producto por cambio de talla solicitado por el cliente.',
      },
      items: [
        {
          index: 1,
          product_name: 'Zapatos Deportivos Running Pro (Devolución)',
          variant_sku: 'ZAP-RUN-NEG-38',
          quantity: 1,
          unit_price: 240000,
          unit_price_formatted: '$240.000',
          total_price: 240000,
          total_price_formatted: '$240.000',
        },
      ],
      taxes: [],
      totals: {
        subtotal: 240000,
        subtotal_formatted: '$240.000',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 0,
        tax_total_formatted: '$0',
        grand_total: 240000,
        grand_total_formatted: '$240.000',
      },
    };
  }

  getAvailableTokens(): PrintTokenDefinition[] {
    return [
      { token: '{{document.number}}', path: 'document.number', description: 'Número de la nota crédito', example: 'NC-0012' },
      { token: '{{document.reference_document_number}}', path: 'document.reference_document_number', description: 'Factura u orden referenciada', example: 'ORD-1002' },
      { token: '{{customer.name}}', path: 'customer.name', description: 'Nombre del cliente', example: 'María Restrepo' },
      { token: '{{totals.grand_total}}', path: 'totals.grand_total_formatted', description: 'Monto total acreditado', example: '$240.000' },
    ];
  }
}
