import { Injectable } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { RecentDocumentSummary } from '../interfaces/document-index.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';
import { resolveKitchenMode } from '../../kitchen-fire/kitchen-mode.util';

/** Estados de ítem que ya no van en la hoja de comanda. */
const DEAD_ITEM_STATES = ['delivered', 'cancelled'] as const;

const ITEM_INCLUDE = {
  product: { select: { id: true, name: true, sku: true } },
  // Marca por plato "para llevar" (misma fuente que la tarjeta virtual).
  order_item: { select: { is_takeaway: true } },
  // Exclusiones por línea → el cocinero las ve impresas.
  exclusions: {
    include: {
      // sin relación inversa tipada en el include del producto
      // para evitar arrastrar el producto entero de la exclusión.
      component_product: { select: { id: true, name: true } },
    },
  },
} as const;

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
        kds: { select: { id: true, name: true, code: true } },
        table: { select: { id: true, name: true, zone: true } },
        items: {
          orderBy: { id: 'asc' },
          include: ITEM_INCLUDE,
        },
        order: {
          select: {
            id: true,
            order_number: true,
            notes: true,
            delivery_type: true,
            customer_alias: true,
            users: { select: { first_name: true, last_name: true } },
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

    // CP-POLLO-ARABE-727 A.7 — la última sesión de la orden se resuelve
    // con un `findFirst` top-level en vez del include anidado. El `$extends` de
    // `StorePrismaService` es por modelo/operación top-level y NO recorre
    // `include`/`select`, así que el tramo anidado no recibía `store_id` y ningún
    // índice lo servía. Este `findFirst` sí pasa por el scoping e inyecta
    // `store_id`, haciendo innecesario el índice DB-16. `ticket.order?.id` es la
    // única clave que tenemos: la relación vive al revés (table_sessions.order_id).
    // Incluye sesiones cerradas para que una reimpresión conserve la mesa y
    // su opener histórico; una transferencia crea la nueva sesión más tarde.
    const session = ticket.order?.id
      ? await this.prisma.table_sessions.findFirst({
          where: { order_id: ticket.order.id },
          orderBy: { opened_at: 'desc' },
          take: 1,
          include: {
            table: {
              select: {
                id: true,
                name: true,
                zone: true,
              },
            },
            opener: { select: { first_name: true, last_name: true } },
          },
        })
      : undefined;
    const opener = session?.opener;
    // Misma regla que la tarjeta virtual: nombre desde `kitchen_tickets.table`,
    // con fallback a la mesa de la última sesión.
    const table = (ticket as any).table || session?.table;
    // ADR-04: el mesero de la mesa es quien abrió su sesión, no la asignación
    // estática de table_waiters (que puede cambiar después del servicio).
    const waiterName = opener
      ? `${opener.first_name || ''} ${opener.last_name || ''}`.trim()
      : '';
    const tableName = table?.name
      ? `Mesa ${table.name}`
      : '';

    const order: any = ticket.order;
    const deliveryType: string | undefined = order?.delivery_type;
    const hasTable = ticket.table_id != null || !!table;
    // `isTableTicket` de la tarjeta virtual.
    const isTableTicket = hasTable || deliveryType === 'dine_in';

    const customerName =
      (order?.customer_alias || '').trim() ||
      `${(order?.users?.first_name || '').trim()} ${(order?.users?.last_name || '').trim()}`.trim();

    let serviceTypeLabel = '';
    if (deliveryType === 'home_delivery') serviceTypeLabel = 'Domicilio';
    else if (tableName) serviceTypeLabel = tableName;
    else if (
      !hasTable &&
      (deliveryType === 'pickup' || deliveryType === 'direct_delivery')
    ) {
      serviceTypeLabel = 'Para llevar';
    } else if (isTableTicket) serviceTypeLabel = 'Mesa';

    // `itemDeliveryBadge` de la tarjeta virtual.
    const packagingLabel = (it: any): string => {
      if (deliveryType === 'home_delivery') return 'ENVÍO';
      const takeaway = it.order_item?.is_takeaway === true;
      if (isTableTicket) return takeaway ? 'PARA LLEVAR' : '';
      return deliveryType === 'direct_delivery' || takeaway
        ? 'PARA LLEVAR'
        : '';
    };

    // Modo físico: UNA hoja por orden con todos los ítems vivos de todos los
    // tickets de la orden. Virtual: solo los del ticket pedido.
    const kitchenMode = await resolveKitchenMode(this.prisma, storeId);
    const isPhysical = kitchenMode === 'physical';
    let sheetItems: any[] = ticket.items || [];
    if (isPhysical && order?.id) {
      const siblings: any[] = await this.prisma.kitchen_tickets.findMany({
        where: { order_id: order.id, store_id: storeId },
        orderBy: [{ fired_at: 'asc' }, { id: 'asc' }],
        include: {
          items: {
            where: { status: { notIn: [...DEAD_ITEM_STATES] } },
            orderBy: { id: 'asc' },
            include: ITEM_INCLUDE,
          },
        },
      });
      sheetItems = siblings.flatMap((t) => t.items || []);
    }

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
        notes: order?.notes?.trim() || undefined,
        is_kitchen_ticket: true,
        order_number: order?.order_number ? String(order.order_number) : '',
        daily_number: ticket.daily_number || 0,
        customer_name: customerName,
        service_type_label: serviceTypeLabel,
      },
      // C.2 (ADR-12, G-12) — irrelevante en la práctica: `unit_price` es
      // siempre 0 en este formato (comanda de cocina, sin dinero).
      // `taxable_base`/`false` por default de R-2: no hay settings de
      // tienda/organización en memoria (este provider ni siquiera trae
      // `store` real, ver `store: { name: '', tax_id: '' }` arriba).
      money_basis: 'taxable_base',
      prints_vat_breakdown: false,
      items: sheetItems.map((it: any, idx: number) => {
        const exclusionNames: string[] = (it.exclusions || [])
          .map((e: any) => e.component_product?.name || '')
          .filter(Boolean)
          .map((n: string) => `SIN ${n}`);
        return {
          index: idx + 1,
          product_name: it.product?.name || '',
          variant_sku: it.product?.sku || undefined,
          // CP-POLLO-ARABE-727 ADR-7: la variante impresa viaja por
          // `StandardPrintItem.variant_attributes`, NO por un campo nuevo.
          // `it` es un `kitchen_ticket_item` (include sin select → trae todos
          // los campos), cuyo `variant_label` es el snapshot inmutable al fire.
          variant_attributes: it.variant_label || undefined,
          quantity: Number(it.quantity || 0),
          unit_price: 0,
          total_price: 0,
          notes: it.notes || undefined,
          modifiers: exclusionNames.length > 0 ? exclusionNames : undefined,
          packaging_label: packagingLabel(it) || undefined,
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
        // En físico la hoja mezcla estaciones: no se declara una sola.
        ...(isPhysical
          ? {}
          : {
              kds_name: ticket.kds?.name || '',
              kds_station_type: ticket.kds?.code || '',
            }),
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
      // C.2 (ADR-12) — muestra en paridad con `fetchDocumentData`.
      money_basis: 'taxable_base',
      prints_vat_breakdown: false,
      items: [
        {
          index: 1,
          product_name: 'Hamburguesa Artesanal Doble Carne',
          variant_attributes: 'Término: 3/4',
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
