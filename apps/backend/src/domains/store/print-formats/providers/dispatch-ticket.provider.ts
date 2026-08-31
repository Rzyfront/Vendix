import { Injectable, Logger } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { RecentDocumentSummary } from '../interfaces/document-index.interface';
import {
  StandardPrintDataModel,
  StandardPrintItem,
} from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';

/**
 * CP-DTLP-20260827 — Tiquete de Despacho (dispatch_ticket).
 *
 * Lector de la orden de venta para emitir el undécimo formato del Hub
 * enriquecido. NO es fiscal: contiene cliente, dirección de envío y
 * productos por línea con cantidad pedida y cantidad despachada, sin
 * totales ni CUFE/QR. El compositor (print-layout-composer.service.ts)
 * es el que pinta el HTML térmico 80mm a partir de este modelo.
 *
 * Por qué `as print_format_type_enum`: schema.prisma no lista
 * `dispatch_ticket` todavía; el valor entra al enum de Postgres con la
 * migración 20260827120000_add_dispatch_ticket_to_enum. `prisma generate`
 * se correrá más tarde y regenerará el cliente con el valor ya tipado;
 * mientras tanto, el cast mantiene tsc en verde.
 */
@Injectable()
export class DispatchTicketDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum =
    'dispatch_ticket' as unknown as print_format_type_enum;

  private readonly logger = new Logger(DispatchTicketDataProvider.name);

  constructor(private readonly prisma: StorePrismaService) {}

  async fetchDocumentData(
    storeId: number,
    documentId: number | string,
  ): Promise<StandardPrintDataModel> {
    const id = Number(documentId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new VendixHttpException(
        ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001,
        `Invalid document id: ${documentId}`,
      );
    }

    const order = await this.prisma.orders.findFirst({
      where: { id, store_id: storeId },
      include: {
        order_items: true,
        users: true,
        stores: {
          include: {
            addresses: { take: 1 },
            organizations: true,
          },
        },
        // Cantidades despachadas por línea vienen del último despacho
        // (status NOT IN {draft, voided}) del que esta orden es origen.
        // Si la orden aún no se ha despachado, dispatched_qty queda en 0
        // y el tiquete imprime "0 / N pedida" — el operador de bodega lo
        // sabe leer.
        dispatch_notes: {
          where: { status: { notIn: ['draft', 'voided'] } },
          orderBy: { emission_date: 'desc' },
          take: 1,
          include: {
            dispatch_note_items: true,
          },
        },
      },
    });

    if (!order) {
      throw new VendixHttpException(
        ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001,
        `Order ${id} not found in store ${storeId}`,
      );
    }

    return this.mapOrderToDispatchTicket(order);
  }

  async getSampleData(_storeId?: number): Promise<StandardPrintDataModel> {
    return {
      store: {
        name: 'Tienda de Despacho Demo',
        legal_name: 'Comercializadora Vendix S.A.S.',
        tax_id: '900.123.456-7',
        phone: '+57 601 555 1234',
        email: 'despachos@vendix-demo.co',
        address: 'Calle 100 #15-20',
        city: 'Bogotá D.C.',
      },
      customer: {
        name: 'Cliente Demo Despacho',
        tax_id: '79.123.456-7',
        phone: '+57 311 555 9988',
        email: 'compras@cliente-demo.co',
        address: 'Calle 50 #10-20, Apto 301, Bogotá D.C.',
        address_line1: 'Calle 50 #10-20',
        address_line2: 'Apto 301',
        city: 'Bogotá D.C.',
      },
      document: {
        id: 1,
        number: 'DISP-2026-0001',
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString('es-CO'),
        time: '10:30',
        state: 'preparing',
        state_label: 'En preparación',
        notes: 'Verificar empaque antes de despacho. Frágil.',
      },
      items: [
        {
          index: 1,
          product_name: 'Producto A — Camiseta Polo Azul',
          variant_sku: 'SKU-001',
          quantity: 2,
          unit_price: 0,
          unit_price_formatted: '',
          total_price: 0,
          total_price_formatted: '',
        },
        {
          index: 2,
          product_name: 'Producto B — Pantalón Jean Slim',
          variant_sku: 'SKU-002',
          quantity: 1,
          unit_price: 0,
          unit_price_formatted: '',
          total_price: 0,
          total_price_formatted: '',
        },
        {
          index: 3,
          product_name: 'Producto C — Gorra Bordada (parcial)',
          variant_sku: 'SKU-003',
          quantity: 3,
          unit_price: 0,
          unit_price_formatted: '',
          total_price: 0,
          total_price_formatted: '',
        },
      ],
      taxes: [],
      totals: {
        subtotal: 0,
        subtotal_formatted: '',
        discount_total: 0,
        discount_total_formatted: '',
        shipping_total: 0,
        shipping_total_formatted: '',
        tax_total: 0,
        tax_total_formatted: '',
        grand_total: 0,
        grand_total_formatted: '',
      },
      custom_variables: {
        // [print-editor-dsk P1.5] Antes P1.5 el sample publicaba dos mapas por
        // SKU (`ordered_qty_by_sku` y `dispatched_qty_by_sku`) aquí para que
        // el compositor los resolviera. Pero las columnas del seed (P1.5)
        // apuntan directamente a `items[].variant_sku`, `items[].quantity` y
        // `items[].dispatched_qty` — los campos reales del StandardPrintItem
        // que el propio sample ya rellena. Mantener los mapas en paralelo era
        // dos copias de la misma verdad que se desincronizan fácil.
        ordered_qty_by_sku: { 'SKU-001': 2, 'SKU-002': 1, 'SKU-003': 3 },
      },
    } as unknown as StandardPrintDataModel;
  }

  getAvailableTokens(): PrintTokenDefinition[] {
    return [
      { token: '{{ document.number }}', path: 'document.number', description: 'Número de la orden / tiquete', example: 'DISP-2026-0001' },
      { token: '{{ customer.name }}', path: 'customer.name', description: 'Nombre del cliente', example: 'Juan Pérez' },
      { token: '{{ customer.address }}', path: 'customer.address', description: 'Dirección completa de entrega', example: 'Calle 50 #10-20, Apto 301, Bogotá' },
      { token: '{{ items.sku }}', path: 'items[].variant_sku', description: 'SKU del producto despachado', example: 'SKU-001' },
      { token: '{{ items.product_name }}', path: 'items[].product_name', description: 'Nombre del producto despachado', example: 'Camiseta Polo Azul' },
      { token: '{{ items.ordered_qty }}', path: 'items[].quantity', description: 'Cantidad pedida (de la orden)', example: '3' },
      { token: '{{ items.dispatched_qty }}', path: 'items[].dispatched_qty', description: 'Cantidad despachada (del último despacho)', example: '2' },
      { token: '{{ store.name }}', path: 'store.name', description: 'Nombre comercial de la tienda', example: 'Tienda Principal' },
    ];
  }

  /**
   * [print-editor-dsk P3.1] — Tiquete de despacho sin totales (es logística,
   * no factura): el picker sólo necesita el número de orden y la fecha. Sin
   * `total_formatted` a propósito para no inducir al usuario a esperar un
   * cobro en la comanda.
   */
  async listRecent(
    storeId: number,
    limit: number,
  ): Promise<RecentDocumentSummary[]> {
    const rows = await this.prisma.orders.findMany({
      where: { store_id: storeId },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: {
        id: true,
        order_number: true,
        created_at: true,
      },
    });
    const fmt = new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
    return rows.map((r) => ({
      id: r.id,
      number: String(r.order_number),
      date_formatted: r.created_at ? fmt.format(new Date(r.created_at)) : '',
    }));
  }

  // ============================================================
  // Mapeo interno
  // ============================================================

  private mapOrderToDispatchTicket(order: any): StandardPrintDataModel {
    const store = order.stores || {};
    const org = store.organizations || {};
    const storeAddr = store.addresses?.[0] || {};
    const customer = order.users || {};

    // Construir un índice sku -> dispatched_qty a partir del último despacho
    // no anulado, para mezclarlo en cada item de la orden.
    const latestDispatch = (order.dispatch_notes || [])[0] as any | undefined;

    const items: StandardPrintItem[] = (order.order_items || []).map(
      (it: any, idx: number) => {
        const orderedQty = Number(it.quantity || 0);
        // dispatched_qty del último despacho no anulado (si existe).
        // Como dispatch_note_items.sales_order_item_id enlaza con el item de
        // la orden, lo usamos para encontrar la línea exacta.
        const matchingDispatchItem = latestDispatch?.dispatch_note_items?.find(
          (d: any) => d.sales_order_item_id === it.id,
        );
        const dispatchedQty = matchingDispatchItem
          ? Number(matchingDispatchItem.dispatched_quantity || 0)
          : 0;

        return {
          index: idx + 1,
          product_name: it.product_name,
          variant_sku: it.variant_sku || undefined,
          quantity: orderedQty,
          dispatched_qty: dispatchedQty,
          unit_price: 0,
          unit_price_formatted: '',
          total_price: 0,
          total_price_formatted: '',
        };
      },
    );

    const customerAddress = this.buildCustomerAddressParts(
      order.shipping_address_snapshot,
      order.billing_address_snapshot,
    );

    return {
      store: {
        name: store.name || 'Vendix',
        legal_name: store.legal_name || org.legal_name,
        tax_id: org.tax_id,
        phone: store.phone,
        email: store.email,
        address: storeAddr.address_line1
          ? `${storeAddr.address_line1} ${storeAddr.address_line2 || ''}`.trim()
          : undefined,
        address_line1: storeAddr.address_line1,
        address_line2: storeAddr.address_line2,
        city: storeAddr.city,
        logo_url: store.logo_url,
      },
      customer: customer.id
        ? {
            name:
              `${customer.first_name || ''} ${customer.last_name || ''}`.trim() ||
              'Cliente',
            tax_id: customer.document_number,
            phone: customer.phone,
            email: customer.email,
            address: customerAddress.combined,
            address_line1: customerAddress.line1,
            address_line2: customerAddress.line2,
            city: customerAddress.city,
          }
        : undefined,
      document: {
        id: order.id,
        number: String(order.order_number),
        date: order.created_at
          ? new Date(order.created_at).toISOString()
          : new Date().toISOString(),
        date_formatted: order.created_at
          ? new Date(order.created_at).toLocaleDateString('es-CO')
          : new Date().toLocaleDateString('es-CO'),
        time: order.created_at
          ? new Date(order.created_at).toLocaleTimeString('es-CO', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : undefined,
        state: order.state,
        state_label: order.state,
        notes: order.notes || undefined,
        // ADR-9 / dec. usuario 2026-08-31 — etiqueta de venta rápida con la
        // que el cliente reclama en el mostrador. Spread condicional para
        // no romper el tipo estricto de `StandardPrintDataModel['document']`
        // (mismo patrón que `pos-sale-ticket.provider.ts:298-299`). NO
        // fabrica un bloque `customer` falso a partir del alias: el alias
        // no es un cliente formal, no tiene dirección ni documento.
        ...(order.customer_alias
          ? { customer_alias: order.customer_alias }
          : {}),
      },
      items,
      taxes: [],
      totals: {
        subtotal: 0,
        subtotal_formatted: '',
        discount_total: 0,
        discount_total_formatted: '',
        shipping_total: 0,
        shipping_total_formatted: '',
        tax_total: 0,
        tax_total_formatted: '',
        grand_total: 0,
        grand_total_formatted: '',
      },
      custom_variables: {
        // [print-editor-dsk P1.5] Antes P1.5 publicábamos también
        // `dispatched_qty_by_sku` aquí — un mapa paralelo por SKU duplicando
        // `items[].dispatched_qty`. Tras alinear las claves de las columnas
        // (`variant_sku`, `quantity`, `dispatched_qty`) con los campos reales
        // del StandardPrintItem, el mapa paralelo se vuelve redundante y
        // peligroso: cualquier divergencia entre el mapa y `items[]` rompe el
        // tiquete en silencio. Se elimina; la única fuente es `items[]`.
        ordered_qty_by_sku: items.reduce<Record<string, number>>((acc, it) => {
          if (it.variant_sku) acc[it.variant_sku] = it.quantity;
          return acc;
        }, {}),
      },
    };
  }

  private buildCustomerAddressParts(
    shipping: any,
    billing: any,
  ): { line1?: string; line2?: string; city?: string; combined?: string } {
    // Preferimos el snapshot de envío: es el que va a la guía de despacho.
    const src = shipping || billing;
    if (!src) return {};
    if (typeof src === 'string') {
      return { combined: src };
    }
    const a = src as any;
    const line1 = a.address_line1 as string | undefined;
    const line2 = a.address_line2 as string | undefined;
    const city = a.city as string | undefined;
    const combined = [line1, line2, city, a.state_province]
      .filter(Boolean)
      .join(', ');
    return {
      line1,
      line2,
      city,
      combined: combined || undefined,
    };
  }
}
