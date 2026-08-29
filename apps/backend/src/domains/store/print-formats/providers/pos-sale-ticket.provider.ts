import { Injectable } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { RecentDocumentSummary } from '../interfaces/document-index.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';

@Injectable()
export class PosSaleTicketDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum = 'pos_sale_ticket';

  constructor(private readonly prisma: StorePrismaService) {}

  async fetchDocumentData(
    storeId: number,
    documentId: number | string,
  ): Promise<StandardPrintDataModel> {
    const orderId = Number(documentId);
    if (isNaN(orderId)) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    const order = await this.prisma.orders.findFirst({
      where: { id: orderId, store_id: storeId },
      include: {
        order_items: true,
        order_taxes: true,
        users: true,
        stores: {
          include: {
            addresses: { take: 1 },
            organizations: true,
          },
        },
        // C.3 QUI-733 — mesa + mesero en el recibo POS. Se une la sesión
        // ABIERTA (closed_at IS NULL, la más reciente) para derivar
        // `document.table_number` / `document.waiter_name` igual que el
        // proveedor de ticket de cocina. Sin sesión (venta de mostrador)
        // el array queda vacío y el recibo sale sin mesa/mesero.
        table_sessions: {
          where: { closed_at: null },
          orderBy: { opened_at: 'desc' },
          take: 1,
          include: {
            table: {
              select: {
                id: true,
                name: true,
                zone: true,
                // mesero asignado vía table_waiters, prioridad sobre opener
                table_waiters: {
                  select: {
                    user: { select: { first_name: true, last_name: true } },
                  },
                },
              },
            },
            opener: { select: { first_name: true, last_name: true } },
          },
        },
      },
    });

    if (!order) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    return this.mapOrderToStandardModel(order);
  }

  async getSampleData(storeId?: number): Promise<StandardPrintDataModel> {
    return {
      store: {
        name: 'Vendix Store Demo',
        legal_name: 'Vendix Comercio S.A.S.',
        tax_id: '901.234.567-8',
        phone: '+57 300 123 4567',
        email: 'ventas@vendix.com',
        address: 'Calle 100 # 15-20, Oficina 401',
        city: 'Bogotá D.C.',
        tax_regime: 'Responsable de IVA',
      },
      customer: {
        name: 'Juan Pérez Rodríguez',
        tax_id: '1.020.304.050',
        phone: '+57 311 987 6543',
        email: 'juan.perez@ejemplo.com',
      },
      document: {
        id: 101,
        number: 'POS-00428',
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString('es-CO'),
        time: '14:30',
        state: 'finished',
        state_label: 'Completada',
        cashier_name: 'Carlos Gómez',
        pos_terminal: 'Caja 01',
        payment_method: 'Efectivo',
        amount_received: 100000,
        amount_received_formatted: '$100.000',
        change_due: 12500,
        change_due_formatted: '$12.500',
      },
      items: [
        {
          index: 1,
          product_name: 'Camisa Oxford Manga Larga',
          variant_sku: 'CAM-OXF-AZ-M',
          variant_attributes: 'Talla: M, Color: Azul',
          quantity: 1,
          unit_price: 65000,
          unit_price_formatted: '$65.000',
          discount_amount: 5000,
          discount_formatted: '-$5.000',
          tax_rate: 19,
          total_price: 60000,
          total_price_formatted: '$60.000',
        },
        {
          index: 2,
          product_name: 'Gorra Deportiva Bordada',
          variant_sku: 'GOR-DEP-NEG',
          quantity: 1,
          unit_price: 27500,
          unit_price_formatted: '$27.500',
          tax_rate: 19,
          total_price: 27500,
          total_price_formatted: '$27.500',
        },
      ],
      taxes: [
        {
          name: 'IVA General',
          rate: 19,
          base_amount: 73529,
          tax_amount: 13971,
          base_formatted: '$73.529',
          tax_formatted: '$13.971',
        },
      ],
      totals: {
        subtotal: 92500,
        subtotal_formatted: '$92.500',
        discount_total: 5000,
        discount_total_formatted: '$5.000',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 13971,
        tax_total_formatted: '$13.971',
        grand_total: 87500,
        grand_total_formatted: '$87.500',
      },
    };
  }

  getAvailableTokens(): PrintTokenDefinition[] {
    return [
      { token: '{{store.name}}', path: 'store.name', description: 'Nombre comercial de la tienda', example: 'Mi Tienda' },
      { token: '{{store.tax_id}}', path: 'store.tax_id', description: 'NIT o documento de la tienda', example: '900.123.456-7' },
      { token: '{{order.order_number}}', path: 'document.number', description: 'Número de ticket u orden', example: 'POS-1002' },
      { token: '{{order.cashier_name}}', path: 'document.cashier_name', description: 'Nombre del cajero', example: 'Ana Torres' },
      { token: '{{customer.name}}', path: 'customer.name', description: 'Nombre del cliente', example: 'Consumidor Final' },
      { token: '{{order.grand_total}}', path: 'totals.grand_total_formatted', description: 'Total a pagar con formato', example: '$87.500' },
      { token: '{{order.change_due}}', path: 'document.change_due_formatted', description: 'Cambio o vuelto entregado', example: '$12.500' },
    ];
  }

  /**
   * [print-editor-dsk P3.1] — Selector del Hub para el tiquete POS:
   * lee SOLO lo necesario (id, número, fecha, total) sobre `orders`,
   * que es la misma tabla que consume `fetchDocumentData` pero sin los
   * `include` de líneas/tributos. El cap lo pone `DocumentIndexService`,
   * aquí se respeta ciegamente.
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
        grand_total: true,
      },
    });
    const fmt = new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
    const cop = new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
    return rows.map((r) => ({
      id: r.id,
      number: String(r.order_number),
      date_formatted: r.created_at ? fmt.format(new Date(r.created_at)) : '',
      total_formatted: cop.format(Number(r.grand_total || 0)),
    }));
  }

  private mapOrderToStandardModel(order: any): StandardPrintDataModel {
    const store = order.stores || {};
    const org = store.organizations || {};
    const addr = store.addresses?.[0] || {};
    const user = order.users || {};

    // C.3 QUI-733 — mesa + mesero derivados de la sesión ABIERTA. El mesero
    // asignado (table_waiters) manda sobre el opener. Sin sesión (venta de
    // mostrador) ambos quedan vacíos y el recibo no muestra bloque de mesa.
    const session = (order.table_sessions || [])[0];
    const table = session?.table;
    const opener = session?.opener;
    const assignedWaiter = table?.table_waiters?.[0]?.user;
    const waiterName =
      assignedWaiter && (assignedWaiter.first_name || assignedWaiter.last_name)
        ? `${assignedWaiter.first_name || ''} ${assignedWaiter.last_name || ''}`.trim()
        : opener
        ? `${opener.first_name || ''} ${opener.last_name || ''}`.trim()
        : '';
    const tableName = table?.name ? `Mesa ${table.name}` : '';

    const items = (order.order_items || []).map((it: any, i: number) => ({
      index: i + 1,
      product_name: it.product_name,
      variant_sku: it.variant_sku || undefined,
      // CP-POLLO-ARABE-727 ADR-7: la variante del recibo POS viaja por
      // `StandardPrintItem.variant_attributes` (column `order_items.variant_attributes`,
      // snapshot al crear la línea), no por un campo nuevo del modelo.
      variant_attributes: it.variant_attributes || undefined,
      quantity: Number(it.quantity || 1),
      unit_price: Number(it.unit_price || 0),
      unit_price_formatted: `$${Number(it.unit_price || 0).toLocaleString('es-CO')}`,
      discount_amount: Number(it.discount_amount || 0),
      discount_formatted: it.discount_amount ? `-$${Number(it.discount_amount).toLocaleString('es-CO')}` : undefined,
      total_price: Number(it.total_price || 0),
      total_price_formatted: `$${Number(it.total_price || 0).toLocaleString('es-CO')}`,
    }));

    const taxes = (order.order_taxes || []).map((t: any) => ({
      name: t.tax_name || 'IVA',
      rate: Number(t.tax_rate || 0),
      base_amount: Number(t.taxable_amount || 0),
      tax_amount: Number(t.tax_amount || 0),
      base_formatted: `$${Number(t.taxable_amount || 0).toLocaleString('es-CO')}`,
      tax_formatted: `$${Number(t.tax_amount || 0).toLocaleString('es-CO')}`,
    }));

    const subtotal = Number(order.subtotal_amount || 0);
    const discount = Number(order.discount_amount || 0);
    const tax = Number(order.tax_amount || 0);
    const shipping = Number(order.shipping_cost || 0);
    const grandTotal = Number(order.grand_total || (subtotal - discount + tax + shipping));

    return {
      store: {
        name: store.name || 'Vendix',
        legal_name: store.legal_name || org.legal_name,
        tax_id: org.tax_id,
        phone: store.phone,
        email: store.email,
        address: addr.address_line1 ? `${addr.address_line1} ${addr.address_line2 || ''}`.trim() : undefined,
        city: addr.city,
        logo_url: store.logo_url,
      },
      customer: user.id
        ? {
            name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Cliente',
            tax_id: user.document_number,
            phone: user.phone,
            email: user.email,
          }
        : undefined,
      document: {
        id: order.id,
        number: String(order.order_number),
        date: order.created_at ? new Date(order.created_at).toISOString() : new Date().toISOString(),
        date_formatted: order.created_at ? new Date(order.created_at).toLocaleDateString('es-CO') : new Date().toLocaleDateString('es-CO'),
        time: order.created_at ? new Date(order.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : undefined,
        state: order.state,
        state_label: order.state,
        channel: order.channel,
        notes: order.notes,
        internal_notes: order.internal_notes,
        // C.3 QUI-733 — mesa + mesero en el recibo POS.
        table_number: tableName,
        waiter_name: waiterName,
        // QUI-737 (B.4) — alias de venta rápida ("Mesa 5"). Va en la CABECERA
        // junto al número de orden, NO bajo el bloque "Datos del Cliente"
        // (`customer`): el alias no es un cliente formal y no debe leerse como
        // identificación fiscal. Se expone sin tocar `customer` (que sigue
        // gateado por `user.id`). Spread condicional para no romper el tipo
        // estricto de `StandardPrintDataModel['document']`.
        ...(order.customer_alias
          ? { customer_alias: order.customer_alias }
          : {}),
      },
      items,
      taxes,
      totals: {
        subtotal,
        subtotal_formatted: `$${subtotal.toLocaleString('es-CO')}`,
        discount_total: discount,
        discount_total_formatted: `$${discount.toLocaleString('es-CO')}`,
        shipping_total: shipping,
        shipping_total_formatted: `$${shipping.toLocaleString('es-CO')}`,
        tax_total: tax,
        tax_total_formatted: `$${tax.toLocaleString('es-CO')}`,
        grand_total: grandTotal,
        grand_total_formatted: `$${grandTotal.toLocaleString('es-CO')}`,
      },
    };
  }
}
