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
   * [print-editor-dsk P8] — `kitchen_ticket` ahora LEE.
   *
   * Origen real: `kitchen_tickets` (cabecera) + `kitchen_ticket_items`
   * (líneas con `notes` por ítem) + la mesa y el mesero derivados vía
   * `orders → table_sessions → tables/opener` (la tabla `orders` no
   * carga `table_id` directo, lo carga la sesión).
   *
   * Las columnas `waiter_name`, `table_number` y `notes` que el token-set
   * declara vienen de ese grafo: `kitchen_tickets` no las trae. La
   * consulta se mantiene en UNA sola ida porque cada salto está
   * indexado por PK.
   */
  async fetchDocumentData(
    storeId: number,
    documentId: number | string,
  ): Promise<StandardPrintDataModel> {
    const id = Number(documentId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new VendixHttpException(
        ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001,
        `Invalid ticket id: ${documentId}`,
      );
    }

    const ticket = await this.prisma.kitchen_tickets.findFirst({
      where: { id, store_id: storeId },
      include: {
        kds: { select: { id: true, name: true, station_type: true } },
        items: {
          orderBy: { id: 'asc' },
          include: {
            product: { select: { id: true, name: true, sku: true } },
            // Exclusiones por línea → el cocinero las ve impresas.
            exclusions: {
              include: {
                // sin relación inversa tipada en el include del producto
                // para evitar arrastrar el producto entero de la exclusión.
                component_product: { select: { id: true, name: true } },
              },
            },
          },
        },
        order: {
          select: {
            id: true,
            order_number: true,
            // Una orden puede tener muchas sesiones; la primera (más antigua)
            // suele ser la activa — `findFirst` por orden ascendente.
            table_sessions: {
              orderBy: { opened_at: 'asc' },
              take: 1,
              include: {
                table: { select: { id: true, name: true, zone: true } },
                opener: { select: { first_name: true, last_name: true } },
              },
            },
          },
        },
      },
    });

    if (!ticket) {
      throw new VendixHttpException(
        ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001,
        `Kitchen ticket ${id} not found in store ${storeId}`,
      );
    }

    const session = ticket.order?.table_sessions?.[0];
    const opener = session?.opener;
    const table = session?.table;

    const waiterName = opener
      ? `${opener.first_name || ''} ${opener.last_name || ''}`.trim()
      : '';
    const tableName = table?.name
      ? `Mesa ${table.name}`
      : '';

    return {
      store: { name: '', tax_id: '' },
      document: {
        id: ticket.id,
        number: `KITCHEN-${ticket.id}`,
        date: ticket.fired_at
          ? new Date(ticket.fired_at).toISOString()
          : ticket.created_at
          ? new Date(ticket.created_at).toISOString()
          : new Date().toISOString(),
        date_formatted: (ticket.fired_at || ticket.created_at)
          ? new Date(ticket.fired_at || ticket.created_at!).toLocaleDateString('es-CO')
          : new Date().toLocaleDateString('es-CO'),
        time: (ticket.fired_at || ticket.created_at)
          ? new Date(ticket.fired_at || ticket.created_at!).toLocaleTimeString('es-CO', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : undefined,
        state: ticket.status,
        state_label: ticket.status,
        table_number: tableName,
        waiter_name: waiterName,
        notes: undefined,
      },
      items: (ticket.items || []).map((it: any, idx: number) => {
        const exclusionNames: string[] = (it.exclusions || []).map((e: any) =>
          e.component_product?.name || '',
        ).filter(Boolean);
        return {
          index: idx + 1,
          product_name: it.product?.name || '',
          variant_sku: it.product?.sku || undefined,
          quantity: Number(it.quantity || 0),
          unit_price: 0,
          total_price: 0,
          notes: it.notes || undefined,
          modifiers: exclusionNames.length > 0 ? exclusionNames : undefined,
        };
      }),
      taxes: [],
      totals: {
        subtotal: 0,
        subtotal_formatted: '$0',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 0,
        tax_total_formatted: '$0',
        grand_total: 0,
        grand_total_formatted: '$0',
      },
      custom_variables: {
        kds_name: ticket.kds?.name || '',
        kds_station_type: ticket.kds?.station_type || '',
        daily_number: ticket.daily_number || 0,
        business_date: ticket.business_date
          ? new Date(ticket.business_date).toISOString()
          : '',
        ready_at: ticket.ready_at ? new Date(ticket.ready_at).toISOString() : '',
        table_zone: table?.zone || '',
        order_number: ticket.order?.order_number
          ? String(ticket.order.order_number)
          : '',
        guests_count: session?.guest_count || 0,
      },
    };
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
   * [print-editor-dsk P8] — `kitchen_ticket` picker: ordena por `fired_at desc`
   * (cuándo se cantó la comanda, no cuándo se creó la fila). Filtra por
   * `store_id` + un subconjunto de estados activos para que la lista no se
   * llene de tickets viejos `delivered`.
   */
  async listRecent(
    storeId: number,
    limit: number,
  ): Promise<RecentDocumentSummary[]> {
    const rows = await this.prisma.kitchen_tickets.findMany({
      where: { store_id: storeId },
      orderBy: { fired_at: 'desc' },
      take: limit,
      select: {
        id: true,
        fired_at: true,
        daily_number: true,
      },
    });
    const fmt = new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
    return rows.map((r) => ({
      id: r.id,
      number: r.daily_number ? `#${r.daily_number}` : `KITCHEN-${r.id}`,
      date_formatted: r.fired_at ? fmt.format(new Date(r.fired_at)) : '',
    }));
  }
}