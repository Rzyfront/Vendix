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

@Injectable()
export class SalesOrderInvoiceDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum = 'sales_order_invoice';
  private readonly logger = new Logger(SalesOrderInvoiceDataProvider.name);

  // `s3Service` opcional en la firma por la misma razón que en
  // `pos-sale-ticket.provider.ts`: specs que instancian con un solo
  // argumento no deben romper; Nest siempre lo inyecta en runtime.
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
        order_items: {
      // [resid-fiscal] — Mismo criterio que pos-sale-ticket: la factura
      // comercial también agrega impuestos por línea y debe cuadrar con
      // el `order.tax_amount`, que ya excluye cancelados.
      where: { cancelled_at: null },
      include: { order_item_taxes: true },
    },
        users: true,
        addresses_orders_shipping_address_idToaddresses: true,
        stores: {
          include: {
            addresses: { take: 1 },
            organizations: true,
          },
        },
      },
    });

    if (!order) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    const store = order.stores || {};
    const org = store.organizations || {};
    const storeAddr = store.addresses?.[0] || {};
    const user = order.users || {};
    const shippingAddr = order.addresses_orders_shipping_address_idToaddresses;

    const customerAddress = shippingAddr
      ? [shippingAddr.address_line1, shippingAddr.address_line2, shippingAddr.city, shippingAddr.state_province]
          .filter(Boolean)
          .join(', ')
      : undefined;

    const items = (order.order_items || []).map((it: any, idx: number) => ({
      index: idx + 1,
      product_name: it.product_name,
      variant_sku: it.variant_sku || undefined,
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
    const grandTotal = Number(order.grand_total || subtotal - discount + tax + shipping);
    const signedLogoUrl = await signStoreLogoUrl(this.s3Service, store.logo_url, this.logger);

    return {
      store: {
        name: store.name || 'Vendix',
        legal_name: store.legal_name || org.legal_name,
        tax_id: org.tax_id,
        phone: store.phone,
        email: store.email,
        address: storeAddr.address_line1 ? `${storeAddr.address_line1} ${storeAddr.address_line2 || ''}`.trim() : undefined,
        city: storeAddr.city,
        logo_url: signedLogoUrl,
      },
      customer: user.id
        ? {
            name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Cliente Final',
            tax_id: user.document_number,
            phone: user.phone,
            email: user.email,
            address: customerAddress,
          }
        : undefined,
      document: {
        id: order.id,
        number: String(order.order_number),
        date: order.created_at ? new Date(order.created_at).toISOString() : new Date().toISOString(),
        date_formatted: order.created_at ? new Date(order.created_at).toLocaleDateString('es-CO') : new Date().toLocaleDateString('es-CO'),
        state: order.state,
        state_label: order.state,
        channel: order.channel,
        notes: order.notes,
        internal_notes: order.internal_notes,
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
   * Espejo del helper de `pos-sale-ticket.provider.ts`. Mismo invariante:
   * la base se deriva `tax_amount / tax_rate` (no `base × tarifa`), la
   * escala cruda de `rate` se preserva (`Decimal(6,5)` ⇒ 0.19, NO 19),
   * y se agrupa por `(tax_name, tax_rate)` para que dos tarifas del
   * mismo tributo no se sumen en una sola fila.
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

  async getSampleData(storeId?: number): Promise<StandardPrintDataModel> {
    return {
      store: {
        name: 'Vendix Enterprise Store',
        legal_name: 'Soluciones Comerciales Vendix S.A.S.',
        tax_id: '900.876.543-2',
        phone: '+57 601 555 0199',
        email: 'facturacion@vendix.com',
        address: 'Carrera 7 # 71-21, Torre B Piso 8',
        city: 'Bogotá D.C.',
      },
      customer: {
        name: 'Inversiones y Distribuciones Andinas S.A.',
        tax_id: '901.444.888-1',
        phone: '+57 310 444 5566',
        email: 'compras@andinas.com.co',
        address: 'Zona Industrial Montevideo, Calle 19 # 68-50',
      },
      document: {
        id: 501,
        number: 'ORD-2026-0089',
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString('es-CO'),
        state: 'processing',
        state_label: 'En Proceso',
        channel: 'ecommerce',
      },
      items: [
        {
          index: 1,
          product_name: 'Impresora Térmica de Recibos 80mm USB/Ethernet',
          variant_sku: 'IMP-TERM-80-ETH',
          quantity: 2,
          unit_price: 350000,
          unit_price_formatted: '$350.000',
          total_price: 700000,
          total_price_formatted: '$700.000',
        },
        {
          index: 2,
          product_name: 'Rollo Papel Térmico 80mm x 60m (Caja x 50 unid)',
          variant_sku: 'PAP-ROLL-80X60-CJ',
          quantity: 1,
          unit_price: 120000,
          unit_price_formatted: '$120.000',
          total_price: 120000,
          total_price_formatted: '$120.000',
        },
      ],
      taxes: [
        {
          name: 'IVA 19%',
          rate: 19,
          base_amount: 689076,
          tax_amount: 130924,
          base_formatted: '$689.076',
          tax_formatted: '$130.924',
        },
      ],
      totals: {
        subtotal: 820000,
        subtotal_formatted: '$820.000',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 15000,
        shipping_total_formatted: '$15.000',
        tax_total: 130924,
        tax_total_formatted: '$130.924',
        grand_total: 835000,
        grand_total_formatted: '$835.000',
      },
    };
  }

  getAvailableTokens(): PrintTokenDefinition[] {
    return [
      { token: '{{store.name}}', path: 'store.name', description: 'Nombre comercial de la tienda', example: 'Mi Tienda' },
      { token: '{{customer.name}}', path: 'customer.name', description: 'Nombre o razón social del cliente', example: 'Empresa ABC' },
      { token: '{{customer.address}}', path: 'customer.address', description: 'Dirección de entrega del cliente', example: 'Calle 100 # 15-20' },
      { token: '{{order.order_number}}', path: 'document.number', description: 'Número de orden de venta', example: 'ORD-1002' },
      { token: '{{totals.grand_total}}', path: 'totals.grand_total_formatted', description: 'Monto total de la orden', example: '$835.000' },
    ];
  }

  /**
   * [print-editor-dsk P3.1] — Factura de orden de venta: comparte tabla
   * `orders` con POS pero como previsualización de factura normalmente
   * se monta sobre órdenes `state IN ('completed','invoiced','shipped')`;
   * por ahora el picker devuelve las últimas N órdenes sin filtrar y el
   * filtrado por estado se queda para cuando el editor pida estado, no
   * documento.
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
}
