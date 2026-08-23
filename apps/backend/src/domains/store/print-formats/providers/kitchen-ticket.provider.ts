import { Injectable } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';

@Injectable()
export class KitchenTicketDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum = 'kitchen_ticket';

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
}
