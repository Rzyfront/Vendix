import { Injectable } from '@angular/core';
import { Order, OrderItem } from '../interfaces/order.interface';
import { TicketData, TicketItem } from '../../pos/models/ticket.model';

/**
 * Cashier name printed when the caller does not know who sold the order.
 * The mapper never resolves it from the session — see `toTicketData`.
 */
const DEFAULT_CASHIER_NAME = 'Administrador';

/**
 * Maps the `Order` domain object onto the `TicketData` contract consumed by
 * `PosTicketService`. Extracted from `OrderDetailsPageComponent` so the order
 * detail page and the bulk print flow share one mapping instead of two that
 * drift apart.
 *
 * Deliberately lives under `orders/services/` and NOT inside `PosTicketService`:
 * that service knows `TicketData` and paper formats, not the `Order` domain.
 * Putting the mapping there would invert the dependency — the arrow is
 * `orders → pos` today and must stay one-way.
 *
 * Holds no injected session state, so it is safe to call once per order inside a
 * batch of hundreds.
 */
@Injectable({ providedIn: 'root' })
export class OrderTicketService {
  /**
   * Build the ticket payload for a single order.
   *
   * `options.cashier` must be supplied by the caller that actually knows who
   * sold the order. The mapper does NOT read the current user: in bulk printing
   * that would name the operator running the printer instead of the seller,
   * stamping a false statement on every ticket in the batch.
   */
  toTicketData(order: Order, options?: { cashier?: string }): TicketData {
    const items: TicketItem[] = (order.order_items || []).map((item) => ({
      id: String(item.id || '0'),
      name: item.product_name || 'Producto',
      sku: item.variant_sku || 'N/A',
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unit_price) || 0,
      totalPrice: Number(item.total_price) || 0,
      tax: Number(item.tax_amount_item) || 0,
      appliedPriceTierName: item.applied_price_tier_name_snapshot ?? null,
      isPackageUnit: this.hasPackageStockConsumption(item),
      unitsPerPackage: this.packageMultiplier(item),
    }));

    // Determine payment method from the latest succeeded payment.
    //
    // The name comes from the RELATION, never from `gateway_response.metadata`.
    // The previous cascade read `metadata.payment_method`, a key nobody writes:
    // `PaymentsService` persists `metadata: { register_id, seller_user_id,
    // amount_received, is_pos_payment }` and the method travels as the
    // `store_payment_method_id` FK. So every ticket printed
    // `Método de pago: N/A`, verified against real orders.
    //
    // `store_payment_methods.display_name` is the store's own alias and is
    // nullable, so it falls through to `system_payment_methods.display_name`
    // (NOT NULL, the catalogue name — "Efectivo", "Tarjeta"…) before 'N/A'.
    // The cascade uses trimmed `||` rather than `??` on purpose: the alias is a
    // nullable VarChar, so a store that saved a blank one would otherwise print
    // an empty payment-method line — `??` only catches null/undefined.
    const succeededPayment = (order.payments || []).find((p) => p.state === 'succeeded');
    const paymentRelation = succeededPayment?.store_payment_method;
    const paymentMethod =
      paymentRelation?.display_name?.trim() ||
      paymentRelation?.system_payment_method?.display_name?.trim() ||
      'N/A';
    // These two DO exist in the metadata the POS writes — keep reading them.
    const cashReceived = succeededPayment?.gateway_response?.metadata?.amount_received;
    const change = succeededPayment?.gateway_response?.change;

    // Delivery address from the order's shipping address (may be undefined for
    // counter POS sales without a shipping address).
    const shippingAddress = this.formatShippingAddress(order);

    // Fiscal fix: an order that already produced a validated electronic invoice
    // must print as an informative copy pointing at that invoice, instead of
    // repeating a tax breakdown and claiming "no es una factura electrónica".
    //
    // `dian_status === 'accepted'` used to live filtered into the backend
    // query, so any row present meant "accepted". `OrdersService.findOne`
    // stopped pre-filtering (the order detail's invoice card needs to see
    // rejected / pending / contingency invoices too), so that endpoint's rows
    // now carry the real `dian_status` and the acceptance check has to be
    // written here.
    //
    // La comparación es ESTRICTA contra `'accepted'`: ausencia de columna no
    // cuenta como aceptación. Este mapper también sirve a la impresión masiva
    // (`OrdersBulkService.bulkPrint`), cuya consulta es otra y conserva su
    // `where: { dian_status: 'accepted' }` — así que ahí la fila ya está
    // pre-filtrada y `dian_status` viaja igual, redundante a propósito
    // (`orders-bulk.service.ts`), para que este chequeo pueda exigir la
    // columna. Tratar `undefined` como «aceptada» dejaría el pie afirmando
    // validación DIAN por omisión: cualquier consulta futura que llene
    // `invoices` sin proyectar `dian_status` imprimiría la afirmación falsa sin
    // que nada falle.
    const invoice = order.invoices?.[0];
    const electronicInvoice =
      invoice?.dian_status === 'accepted' && invoice.invoice_number
        ? { number: invoice.invoice_number, cufe: invoice.cufe ?? undefined }
        : undefined;

    // [print-fiscal-gate] — El alias vive en `customer_alias` (columna del
    // modelo `orders` introducida por keilis en el payload de listado/detalle).
    // Si está presente, el renderer del tiquete lo prefiere sobre el nombre
    // del cliente. Va por separado de `customer` porque el alias NO es
    // identificación fiscal — no debe leerse como nombre del cliente a efectos
    // del QR de FE ni del encabezado fiscal.
    const customerAlias = order.customer_alias ?? null;

    return {
      id: order.order_number || 'N/A',
      orderId: order.id,
      date: new Date(order.created_at || Date.now()),
      items,
      subtotal: Number(order.subtotal_amount) || 0,
      tax: Number(order.tax_amount) || 0,
      discount: Number(order.discount_amount) || 0,
      total: Number(order.grand_total) || 0,
      paymentMethod,
      cashReceived: cashReceived ? Number(cashReceived) : undefined,
      change: cashReceived ? Number(change || 0) : undefined,
      cashier: options?.cashier || DEFAULT_CASHIER_NAME,
      transactionId: order.order_number,
      customer: order.users
        ? {
            name: `${order.users.first_name || ''} ${order.users.last_name || ''}`.trim() || 'Consumidor Final',
            email: order.users.email,
            phone: order.users.phone,
            shippingAddress,
            customerAlias,
          }
        : { name: 'Consumidor Final', shippingAddress, customerAlias },
      store: order.stores
        ? {
            name: order.stores.name,
            address: '',
            phone: '',
            email: '',
            taxId: '',
            id: order.stores.id,
          }
        : undefined,
      electronicInvoice,
    };
  }

  /**
   * Build a single-line delivery address from the order's shipping address
   * relation. Returns `undefined` when there is no address (e.g. counter POS
   * sales) so the ticket omits the line entirely. Empty parts are skipped.
   */
  formatShippingAddress(order: Order): string | undefined {
    const addr = order.addresses_orders_shipping_address_idToaddresses;
    if (!addr) return undefined;
    const parts = [
      addr.address_line1,
      addr.address_line2,
      addr.city,
      addr.state_province,
    ]
      .map((p) => (p ?? '').trim())
      .filter((p) => p.length > 0);
    return parts.length > 0 ? parts.join(', ') : undefined;
  }

  /**
   * True when the line consumed a different number of stock units than the
   * quantity sold — i.e. the product was sold by package while stock is kept in
   * the contained unit.
   */
  hasPackageStockConsumption(item: OrderItem): boolean {
    const consumed = Number(item.stock_units_consumed || 0);
    const quantity = Number(item.quantity || 0);
    return consumed > 0 && quantity > 0 && consumed !== quantity;
  }

  /** Units contained per sold package, or `null` when the line is not packaged. */
  packageMultiplier(item: OrderItem): number | null {
    if (!this.hasPackageStockConsumption(item)) return null;
    const consumed = Number(item.stock_units_consumed || 0);
    const quantity = Number(item.quantity || 0);
    if (quantity <= 0) return null;
    return consumed / quantity;
  }
}
