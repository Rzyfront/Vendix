import { Injectable } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { RecentDocumentSummary } from '../interfaces/document-index.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';

@Injectable()
export class KitchenTicketDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum = 'kitchen_ticket';

  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Este formato NO tiene lector real todavía, y por eso falla en vez de
   * devolver la muestra.
   *
   * Antes del 2026-08-24 hacía `return this.getSampleData(storeId)` e ignoraba
   * el `documentId`. Como `print-gateway.service.ts:174` alcanza esto por el
   * carril de impresión REAL, el resultado era un 200 con datos inventados:
   * una comanda que enumera platos que no son los de esa mesa llega a la cocina y se prepara.
   *
   * La decisión de fallar y no leer se tomó con dato, no por comodidad: el
   * origen real vive en `kitchen_tickets` (`schema.prisma:10300`), en otro dominio, y proyectarlo bien es
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
      `El formato ${this.formatType} todavía no lee su documento real (origen: kitchen_tickets); no se imprime una muestra en su lugar.`,
    );
  }

  async getSampleData(storeId?: number): Promise<StandardPrintDataModel> {
    return {
      store: {
        name: 'Vendix Bistro & Café',
        legal_name: 'Gastronomía Vendix S.A.S.',
        phone: '+57 300 444 8899',
      },
      document: {
        id: 777,
        number: 'KITCHEN-#42',
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString('es-CO'),
        time: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
        state: 'fired',
        state_label: 'Enviado a Cocina',
        table_number: 'Mesa 04',
        waiter_name: 'Mateo Sánchez',
        guests_count: 3,
        notes: 'Marchar platos principales juntos. Mesa con comensal alérgico a los frutos secos.',
      },
      items: [
        {
          index: 1,
          product_name: 'Hamburguesa Artesanal Doble Carne',
          quantity: 2,
          unit_price: 34000,
          total_price: 68000,
          notes: 'Término 3/4. Sin cebolla. Papas rústicas.',
          modifiers: ['Término: 3/4', 'Sin cebolla', 'Papas rústicas'],
        },
        {
          index: 2,
          product_name: 'Pizza Napolitana Mediana',
          quantity: 1,
          unit_price: 42000,
          total_price: 42000,
          notes: 'Masa delgada crocante. Albahaca fresca al servir.',
          modifiers: ['Masa delgada', 'Albahaca extra'],
        },
      ],
      taxes: [],
      totals: {
        subtotal: 110000,
        subtotal_formatted: '$110.000',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 0,
        tax_total_formatted: '$0',
        grand_total: 110000,
        grand_total_formatted: '$110.000',
      },
    };
  }

  getAvailableTokens(): PrintTokenDefinition[] {
    return [
      { token: '{{document.table_number}}', path: 'document.table_number', description: 'Número o nombre de la mesa', example: 'Mesa 04' },
      { token: '{{document.waiter_name}}', path: 'document.waiter_name', description: 'Nombre del mesero que atendió', example: 'Mateo Sánchez' },
      { token: '{{document.time}}', path: 'document.time', description: 'Hora de envío de la comanda', example: '14:25' },
      { token: '{{document.notes}}', path: 'document.notes', description: 'Observaciones generales de cocina', example: 'Sin sal' },
    ];
  }

  /**
   * [print-editor-dsk P3.1] — `kitchen_ticket` aún no tiene lector real
   * (`fetchDocumentData` lanza 501). El picker del Hub degrada a `[]` y
   * el editor usa `getSampleData`. La implementación real contra
   * `kitchen_tickets` llega en Fase 8 con el lector del documento.
   */
  async listRecent(
    _storeId: number,
    _limit: number,
  ): Promise<RecentDocumentSummary[]> {
    return [];
  }
}
