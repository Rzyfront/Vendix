import { Injectable } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';

@Injectable()
export class TransferNoteDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum = 'transfer_note';

  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Este formato NO tiene lector real todavía, y por eso falla en vez de
   * devolver la muestra.
   *
   * Antes del 2026-08-24 hacía `return this.getSampleData(storeId)` e ignoraba
   * el `documentId`. Como `print-gateway.service.ts:174` alcanza esto por el
   * carril de impresión REAL, el resultado era un 200 con datos inventados:
   * una remisión de traslado que enumera mercancía que no es la del traslado viaja con la carga y la recepción se firma contra ella.
   *
   * La decisión de fallar y no leer se tomó con dato, no por comodidad: el
   * origen real vive en `stock_transfers` (`schema.prisma:2882`), en otro dominio, y proyectarlo bien es
   * trabajo propio con su propia verificación. Mientras eso no exista, negarse
   * es la única respuesta honesta — un documento operativo falso se firma y se
   * archiva como si fuera cierto.
   *
   * No rompe la previsualización del hub: `print-gateway.service.ts:280`
   * envuelve esta llamada en un `try/catch` y cae a `getSampleData`, que es
   * exactamente para lo que la muestra existe.
   */
  async fetchDocumentData(
    storeId: number,
    documentId: number | string,
  ): Promise<StandardPrintDataModel> {
    throw new VendixHttpException(
      ErrorCodes.PRINT_DOCUMENT_READER_MISSING_001,
      `El formato ${this.formatType} todavía no lee su documento real (origen: stock_transfers); no se imprime una muestra en su lugar.`,
    );
  }

  async getSampleData(storeId?: number): Promise<StandardPrintDataModel> {
    return {
      store: {
        name: 'Vendix Almacén Principal',
        legal_name: 'Vendix Operaciones S.A.S.',
        tax_id: '900.123.456-7',
        phone: '+57 601 234 5678',
        address: 'Bodega 14, Centro Logístico Calle 80',
        city: 'Bogotá D.C.',
      },
      document: {
        id: 601,
        number: 'TRAS-2026-00088',
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString('es-CO'),
        state: 'completed',
        state_label: 'Completado',
        origin_location: 'Bodega Central Calle 80',
        destination_location: 'Tienda Unicentro Local 215',
        notes: 'Traslado de mercancía para reposición de inventario de fin de semana.',
      },
      items: [
        {
          index: 1,
          product_name: 'Pantalón Jean Slim Fit Azul Oscuro',
          variant_sku: 'JEA-SLIM-AZU-32',
          quantity: 25,
          unit_price: 89000,
          total_price: 2225000,
        },
        {
          index: 2,
          product_name: 'Chaqueta Impermeable Cortavientos Negra',
          variant_sku: 'CHA-IMP-NEG-L',
          quantity: 15,
          unit_price: 135000,
          total_price: 2025000,
        },
      ],
      taxes: [],
      totals: {
        subtotal: 4250000,
        subtotal_formatted: '$4.250.000',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 0,
        tax_total_formatted: '$0',
        grand_total: 4250000,
        grand_total_formatted: '$4.250.000',
      },
    };
  }

  getAvailableTokens(): PrintTokenDefinition[] {
    return [
      { token: '{{document.number}}', path: 'document.number', description: 'Número de la nota de traslado', example: 'TRAS-0088' },
      { token: '{{document.origin_location}}', path: 'document.origin_location', description: 'Ubicación o bodega de origen', example: 'Bodega Central' },
      { token: '{{document.destination_location}}', path: 'document.destination_location', description: 'Ubicación o tienda de destino', example: 'Tienda Norte' },
    ];
  }
}
