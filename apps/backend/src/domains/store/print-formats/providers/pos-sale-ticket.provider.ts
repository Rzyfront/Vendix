import { Injectable, Logger } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { S3Service } from '../../../../common/services/s3.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { RecentDocumentSummary } from '../interfaces/document-index.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';
import { signStoreLogoUrl } from '../lib/print-logo.util';
import { mapUserAddress } from '../lib/customer-address';

@Injectable()
export class PosSaleTicketDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum = 'pos_sale_ticket';
  private readonly logger = new Logger(PosSaleTicketDataProvider.name);

  // `s3Service` es opcional en la firma (no `@Optional()`) para no romper los
  // specs que instancian el provider a mano con un solo argumento
  // (`new PosSaleTicketDataProvider(prisma)`); en runtime Nest siempre lo
  // inyecta porque `print-formats.module.ts` ya importa `S3Module`.
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3Service?: S3Service,
  ) {}

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
        // QUI-751 — el impuesto vive a nivel de línea (`order_item_taxes`),
        // no existe la relación `order_taxes`. Antes del fix esto compilaba
        // porque TypeScript no valida nombres de `include` contra Prisma, pero
        // la 1ª llamada runtime hubiera sido `PrismaClientValidationError` 500.
        //
        // [resid-fiscal] — Filtramos líneas canceladas (D2). El
        // `aggregateTaxes` que sigue más abajo sumaba sus impuestos y los
        // imprimía en el breakdown; el `order.tax_amount` ya los excluye,
        // así que el tiquete salía con un desglose que NO cuadraba con el
        // total agregado — inconsistencia visible para el cliente.
        order_items: {
          where: { cancelled_at: null },
          include: { order_item_taxes: true },
        },
        // CP-print-token-flow A.1 — dirección del cliente para el ticket.
        // `take: 1` sobre la relación vigente (misma forma que
        // `stores.addresses` arriba); sin direcciones el array queda vacío.
        users: { include: { addresses: { take: 1 } } },
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

    // El logo se firma acá (única llamada `async` de este flujo) porque
    // `mapOrderToStandardModel` es un mapeador puro y síncrono que también
    // usan otros callers de este provider — no podíamos meterle un `await`
    // sin volverlo async y arrastrar ese cambio a todos sus usos.
    const signedLogoUrl = await signStoreLogoUrl(this.s3Service, order.stores?.logo_url, this.logger);
    return this.mapOrderToStandardModel(order, signedLogoUrl);
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
        // CP-print-token-flow A.1 — paridad muestra/real (ADR-2).
        address: 'Carrera 15 # 88-64, Bogotá D.C.',
        address_line1: 'Carrera 15 # 88-64',
        city: 'Bogotá D.C.',
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
      { token: '{{customer.address}}', path: 'customer.address', description: 'Dirección del cliente', example: 'Carrera 15 # 88-64, Bogotá D.C.' },
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

  private mapOrderToStandardModel(order: any, signedLogoUrl?: string): StandardPrintDataModel {
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

    const taxes = this.aggregateTaxes(order.order_items);

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
        logo_url: signedLogoUrl,
      },
      // CP-print-token-flow A.1 — dirección del cliente. Sin direcciones
      // queda `undefined` (el compositor no emite fila: invariante 1).
      customer: user.id
        ? {
            name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Cliente',
            tax_id: user.document_number,
            phone: user.phone,
            email: user.email,
            ...mapUserAddress(user.addresses?.[0]),
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

  /**
   * QUI-751 — agrega los impuestos de línea en uno por cabecera.
   *
   * El esquema NO tiene una fila de impuesto a nivel de orden; los tributos
   * viven en `order_item_taxes` (uno por línea, uno por tarifa). Para
   * presentarlos en la sección "Tributos" del tiquete se agrupan por
   * `(tax_name, tax_rate)` y se suman los `tax_amount`.
   *
   * NO recalculamos la base con `base × tarifa` — eso introduce un céntimo
   * de más por redondeo y descuadra contra `order.tax_amount`. La base se
   * DERIVA de la línea (`tax_amount / tax_rate` cuando `tax_rate > 0`,
   * 0 en otro caso) y se suma dentro del grupo. La suma de bases dentro
   * del grupo no es igual a `tax_amount_total / tax_rate` porque la base
   * de cada línea arrastra su propio redondeo — pero es la forma
   * contablemente honesta: cada línea aporta lo que aportó.
   *
   * La escala cruda de `rate` se preserva (`Decimal(6,5)` ⇒ 0.19, NO 19).
   */
  private aggregateTaxes(orderItems: any[]): Array<{
    name: string;
    rate: number;
    base_amount: number;
    tax_amount: number;
    base_formatted: string;
    tax_formatted: string;
  }> {
    const grouped = new Map<
      string,
      { name: string; rate: number; tax_amount: number; base_amount: number }
    >();

    for (const item of orderItems || []) {
      for (const t of item.order_item_taxes || []) {
        const name = t.tax_name || 'IVA';
        const rate = Number(t.tax_rate || 0);
        const taxAmount = Number(t.tax_amount || 0);
        const key = `${name}|${rate}`;

        const lineBase = rate > 0 ? taxAmount / rate : 0;
        const existing = grouped.get(key);
        if (existing) {
          existing.tax_amount += taxAmount;
          existing.base_amount += lineBase;
        } else {
          grouped.set(key, {
            name,
            rate,
            tax_amount: taxAmount,
            base_amount: lineBase,
          });
        }
      }
    }

    return Array.from(grouped.values()).map((g) => ({
      name: g.name,
      rate: g.rate,
      base_amount: g.base_amount,
      tax_amount: g.tax_amount,
      base_formatted: `$${g.base_amount.toLocaleString('es-CO')}`,
      tax_formatted: `$${g.tax_amount.toLocaleString('es-CO')}`,
    }));
  }
}
