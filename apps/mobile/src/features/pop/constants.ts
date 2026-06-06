import type { ShippingMethod, PopCartItem, PopCartSummary, PopProduct, PopProductVariant } from './types';

export const SHIPPING_METHOD_LABELS: Record<ShippingMethod, string> = {
  supplier_transport: 'Transporte Proveedor',
  freight: 'Flete',
  pickup: 'Recolección',
  other: 'Otro',
};

export const ORDER_ACTION_LABELS: Record<string, string> = {
  draft: 'Borrador',
  create: 'Crear Orden',
  'create-receive': 'Crear + Recibir',
};

export const INITIAL_CART_SUMMARY = {
  subtotal: 0,
  tax_amount: 0,
  shipping_cost: 0,
  total: 0,
  itemCount: 0,
  totalItems: 0,
};

export function defaultUnitCost(product: PopProduct, variant?: PopProductVariant | null): number {
  return Number(variant?.cost_price ?? product.cost_price ?? product.cost ?? product.price ?? 0) || 0;
}

export function itemKey(product: PopProduct, variant?: PopProductVariant | null): string {
  return `${product.id}:${variant?.id ?? 'base'}`;
}

function recalcItem(item: PopCartItem): PopCartItem {
  const qty = Math.max(item.quantity, 0);
  const subtotal = qty * item.unit_cost;
  const tax = subtotal * (item.tax_rate ?? 0);
  return { ...item, quantity: qty, subtotal, tax_amount: tax, total: subtotal + tax - (item.discount ?? 0) };
}

function calcSummary(items: PopCartItem[], shippingCost = 0): PopCartSummary {
  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const tax_amount = items.reduce((s, i) => s + (i.tax_amount ?? 0), 0);
  return {
    subtotal,
    tax_amount,
    shipping_cost: shippingCost,
    total: subtotal + tax_amount + shippingCost,
    itemCount: items.length,
    totalItems: items.reduce((s, i) => s + i.quantity, 0),
  };
}

export { recalcItem, calcSummary };
