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
 *  - Línea con PRESENTACIÓN aplicada: ahí el precio es el del paquete completo
 *    y `quantity` cuenta paquetes; volver a dividir cobraría de menos.
 *
 * EL CRITERIO DE EXCLUSIÓN ES EL EMPAQUE, NO "LA LÍNEA TRAE TARIFA".
 *
 * `price_tiers` cumple dos papeles y solo uno saca la escala de la ecuación:
 *  - PRESENTACIÓN (`kind='sale_unit'`, "Rollo 20 m", empaque > 1): cambia la
 *    MAGNITUD de `quantity` —pasa a contar paquetes— y el precio publicado ya
 *    es el del paquete entero.
 *  - TARIFA DE CLIENTE (`kind='customer_tier'`, "Mayorista"): cambia solo el
 *    NÚMERO del precio, que sigue expresado por unidad de precio. La escala del
 *    producto aplica igual que sin tarifa.
 *
 * Preguntar por `applied_price_tier_id` confundía las dos y dejaba sin dividir
 * a las líneas con tarifa de cliente: 2 m de un cable a $4.500 el metro
 * (`quantity = 2000`, escala 1000) mostraban **$9.000.000** en el carrito, y el
 * backend rechazaba la venta con "El producto no permite editar el precio en
 * POS" porque el precio unitario derivado no cuadraba con el catálogo. Con eso,
 * ningún producto con escala se podía vender con tarifa de cliente aplicada.
 *
 * Por eso el criterio es `packSize > 1`, espejo exacto de
 * `isPresentationAtIndex` en
 * `apps/backend/src/domains/store/products/services/price-unit.util.ts`.
 */

/** Vista mínima de una línea para resolver su multiplicador. */
export interface LineUnitsInput {
  quantity: number;
  weight?: number;
  weight_unit?: string;
  is_weight_product?: boolean;
  /**
   * Tarifa aplicada. NO decide si la escala aplica —ver el encabezado—: se lee
   * solo para identificar la línea. El criterio es el empaque.
   */
  applied_price_tier_id?: number | null;
  /** Bandera que el resolver mantiene en sincronía con `units_per_package`. */
  is_package_unit?: boolean;
  /**
   * Empaque resuelto de la tarifa aplicada (cascada
   * `override_units_per_package ?? tier.units_per_package`). Con > 1 la línea
   * es una PRESENTACIÓN y `quantity` cuenta paquetes.
   */
  units_per_package?: number | null;
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
 * Empaque efectivo de la línea: entero > 1, o 1 (sin empaque). `units_per_package`
 * es la autoridad —es el número por el que se multiplica el stock consumido— y
 * `is_package_unit` es la bandera que el resolver mantiene en sincronía con él
 * (`isPackageUnit: packSize > 1`). Una bandera en `true` con empaque 1 o nulo NO
 * es una presentación: no hay paquete que contar.
 */
export function resolveLinePackSize(item: LineUnitsInput): number {
  const n = Number(item.units_per_package ?? 1);
  return Number.isFinite(n) && n > 1 ? n : 1;
}

/**
 * `true` cuando la tarifa aplicada es una PRESENTACIÓN: `quantity` cuenta
 * paquetes y el precio es el del paquete entero, así que la escala del producto
 * ya no aplica. Una tarifa de CLIENTE devuelve `false` — cambia el precio, no la
 * magnitud.
 */
export function isPresentationLine(item: LineUnitsInput): boolean {
  return resolveLinePackSize(item) > 1;
}

/**
 * Multiplicador monetario de la línea. Multiplicá `finalPrice` (o `unitPrice`)
 * por este valor para obtener el total (o la base gravable) de la línea.
 */
export function resolveLineUnits(item: LineUnitsInput): number {
  const quantity = Number(item.quantity ?? 0) || 0;
  const weight = Number(item.weight ?? 0) || 0;
  if (item.is_weight_product && weight > 0) return weight;
  if (isPresentationLine(item)) return quantity;
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
