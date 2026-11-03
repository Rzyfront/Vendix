/**
 * QUI-978 — cantidad de una línea de orden con su unidad ("300 g", "0,5 lb").
 *
 * Misma regla que el tiquete del backend
 * (`print-formats/providers/ticket-line-quantity.util.ts`), para que el
 * detalle de la orden y el papel digan lo mismo:
 *
 * 1. Snapshot de la unidad elegida al vender.
 * 2. Peso legado de balanza.
 * 3. UoM de stock del producto (órdenes sin snapshot, salvo paquetes y
 *    UoMs de conteo: "2", nunca "2 unit").
 *
 * Sin unidad devuelve solo el número, como antes.
 *
 * DUPLICADA a propósito (PR #1062 ronda 3, H7): cambiar la cascada aquí
 * obliga a cambiarla en el backend. No se movió a `libs/shared-types` por
 * los tipos (Decimal vs number) y el formato por locale de cada lado; ver la
 * nota del archivo del backend.
 */
export interface OrderLineQuantitySource {
  quantity?: number | string | null;
  sale_unit_code_snapshot?: string | null;
  sale_quantity_snapshot?: number | string | null;
  weight?: number | string | null;
  weight_unit?: string | null;
  stock_units_consumed?: number | string | null;
  products?: {
    stock_uom?: { code?: string | null; dimension?: string | null } | null;
  } | null;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatAmount(value: number): string {
  return value.toLocaleString('es-CO', { maximumFractionDigits: 3 });
}

export function formatOrderLineQuantity(item: OrderLineQuantitySource): string {
  const saleUnit = item.sale_unit_code_snapshot?.trim();
  const saleQuantity = toFiniteNumber(item.sale_quantity_snapshot);
  if (saleUnit && saleQuantity !== null) {
    return `${formatAmount(saleQuantity)} ${saleUnit}`;
  }

  const weight = toFiniteNumber(item.weight);
  if (weight !== null && weight > 0) {
    return `${formatAmount(weight)} ${item.weight_unit?.trim() || 'kg'}`;
  }

  const quantity = toFiniteNumber(item.quantity) ?? 0;
  const stockUom = item.products?.stock_uom;
  const stockUnit =
    stockUom?.dimension === 'count' ? undefined : stockUom?.code?.trim();
  const isPackageLine = (toFiniteNumber(item.stock_units_consumed) ?? 0) > 0;
  if (stockUnit && !isPackageLine) {
    return `${formatAmount(quantity)} ${stockUnit}`;
  }
  return formatAmount(quantity);
}
