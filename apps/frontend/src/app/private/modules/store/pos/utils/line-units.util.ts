/**
 * Cuántas "unidades de precio" cobra una línea del carrito — QUI-648.
 *
 * El POS guarda `quantity` SIEMPRE en la unidad mínima del producto (mm, g, ml,
 * unidad), igual que `order_items.quantity`. Lo que cambia es cuántas de esas
 * unidades cubre el precio publicado:
 *
 *   total = finalPrice × quantity / price_unit_quantity
 *
 * que es exactamente la fórmula del servidor
 * (`apps/backend/src/domains/store/products/services/price-unit.util.ts`).
 * Con `price_unit_quantity = 1` —la inmensa mayoría del catálogo— la fórmula
 * colapsa a `finalPrice × quantity`, que es la aritmética histórica: ninguna
 * línea existente cambia de total.
 *
 * Dos exclusiones, ambas espejo del backend:
 *  - Línea de PESO legado (`is_weight_product`): `quantity` es 1 y el peso
 *    capturado es el multiplicador. Se conserva para no reescribir las ventas
 *    que ya viven así.
 *  - Línea con PRESENTACIÓN aplicada (`applied_price_tier_id`): ahí el precio
 *    es el del paquete completo y `quantity` cuenta paquetes; volver a dividir
 *    cobraría de menos. El backend excluye estas líneas con `hasTierAtIndex`.
 */

/** Vista mínima de una línea para resolver su multiplicador. */
export interface LineUnitsInput {
  quantity: number;
  weight?: number;
  weight_unit?: string;
  is_weight_product?: boolean;
  applied_price_tier_id?: number | null;
  price_unit_quantity?: number | null;
  sale_unit_code?: string | null;
  stock_units_per_sale_unit?: number | null;
}

/** Escala de precio saneada: entero > 1, o 1 (sin escala). */
export function resolvePriceUnitQuantity(value: unknown): number {
  const n = Number(value ?? 1);
  return Number.isFinite(n) && n > 1 ? Math.trunc(n) : 1;
}

/**
 * Multiplicador monetario de la línea. Multiplicá `finalPrice` (o `unitPrice`)
 * por este valor para obtener el total (o la base gravable) de la línea.
 */
export function resolveLineUnits(item: LineUnitsInput): number {
  const quantity = Number(item.quantity ?? 0) || 0;
  const weight = Number(item.weight ?? 0) || 0;
  if (item.is_weight_product && weight > 0) return weight;
  if (item.applied_price_tier_id != null) return quantity;
  const scale = resolvePriceUnitQuantity(item.price_unit_quantity);
  return scale > 1 ? quantity / scale : quantity;
}

/**
 * Cantidad en la unidad que el cajero ve ("3" de "3 m"). El cajero nunca ve la
 * unidad mínima: la conversión a milímetros o gramos es interna.
 */
export function resolveSaleQuantity(item: LineUnitsInput): number {
  const quantity = Number(item.quantity ?? 0) || 0;
  const weight = Number(item.weight ?? 0) || 0;
  if (item.is_weight_product && weight > 0) return weight;
  const factor = Number(item.stock_units_per_sale_unit ?? 1) || 1;
  return factor > 1 ? quantity / factor : quantity;
}

/** `true` cuando la línea se capturó en una unidad de venta distinta a la mínima. */
export function isSaleUnitLine(item: LineUnitsInput): boolean {
  return (
    !item.is_weight_product &&
    !!item.sale_unit_code &&
    Number(item.stock_units_per_sale_unit ?? 1) > 1
  );
}

/** "3 m", "2,35 kg", "4". Hasta 3 decimales, sin ceros de relleno. */
export function formatSaleQuantity(item: LineUnitsInput): string {
  const value = resolveSaleQuantity(item);
  const text = Number.isInteger(value)
    ? value.toLocaleString('es-CO')
    : value.toLocaleString('es-CO', { maximumFractionDigits: 3 });
  const unit = item.is_weight_product
    ? item.weight_unit || 'kg'
    : item.sale_unit_code;
  return unit ? `${text} ${unit}` : text;
}
