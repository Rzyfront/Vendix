import { Prisma } from '@prisma/client';

/**
 * Fixtures for specs that assert on money. Every monetary field is a
 * Prisma.Decimal: a plain number compares equal where a Decimal would not,
 * which masks exactly the rounding and scaling defects these specs hunt.
 */

const money = (v: number | string) => new Prisma.Decimal(v);

export interface BuildOrderItemOverrides {
  [key: string]: unknown;
}

export function buildOrderItem(overrides: BuildOrderItemOverrides = {}) {
  return {
    id: 1,
    order_id: 9001,
    product_id: 100,
    product_variant_id: null,
    product_name: 'Producto A',
    quantity: 1,
    unit_price: money(50),
    total_price: money(50),
    discount_amount: money(0),
    tax_rate: money(19),
    tax_amount_item: money(9.5),
    price_unit_quantity: 1,
    weight: null,
    weight_unit: null,
    item_type: 'product',
    order_item_taxes: [],
    ...overrides,
  };
}

export function buildOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 9001,
    store_id: 100,
    organization_id: 1,
    customer_id: 42,
    order_number: 'POS-1',
    currency: 'COP',
    channel: 'pos',
    state: 'created',
    delivery_type: 'direct_delivery',
    subtotal_amount: money(50),
    tax_amount: money(9.5),
    discount_amount: money(0),
    tip_amount: money(0),
    shipping_cost: money(0),
    grand_total: money(59.5),
    total_paid: money(0),
    remaining_balance: money(59.5),
    shipping_method_id: null,
    shipping_address_id: null,
    shipping_rate_id: null,
    order_items: [buildOrderItem()],
    payments: [],
    ...overrides,
  };
}

export function buildPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 5001,
    order_id: 9001,
    store_id: 100,
    amount: money(59.5),
    state: 'succeeded',
    payment_method: 'cash',
    gateway_reference: null,
    gateway_response: null,
    metadata: null,
    ...overrides,
  };
}

export function buildInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 7001,
    order_id: 9001,
    store_id: 100,
    organization_id: 1,
    accounting_entity_id: 3,
    invoice_type: 'invoice',
    invoice_number: 'FV-1',
    related_invoice_id: null,
    status: 'accepted',
    subtotal_amount: money(50),
    tax_amount: money(9.5),
    total_amount: money(59.5),
    invoice_items: [],
    invoice_taxes: [],
    ...overrides,
  };
}
