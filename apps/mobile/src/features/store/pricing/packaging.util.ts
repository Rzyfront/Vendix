/**
 * Presentaciones de venta ("empaque por tarifa") — cascada del packSize.
 *
 * Espejo móvil de
 * `apps/backend/src/domains/store/products/services/packaging.util.ts` y de
 * `apps/frontend/src/app/shared/services/pricing/packaging.util.ts`. Se copia
 * (no se importa) por `mobile-dev` RULE 4; los nombres son los MISMOS
 * —`resolvePackSize`, `resolveStockUnitsConsumed`— para que la paridad se pueda
 * auditar leyendo los tres archivos en paralelo.
 *
 * El número de unidades por paquete vive en la tarifa (`price_tiers.kind =
 * 'sale_unit'`, columna `units_per_package`), con un override opcional por par
 * producto×presentación (`product_price_tier_overrides.override_units_per_package`).
 * La cascada canónica es:
 *
 *   packSize = override_units_per_package ?? tier.units_per_package ?? 1
 *
 * Un packSize de 1 (o cualquier valor <= 1, incluido null/undefined) significa
 * que la tarifa NO es una presentación de empaque y el comportamiento debe ser
 * IDÉNTICO al de hoy: sin multiplicador, sin consumo extra de stock.
 *
 * Cuando la presentación aplica, la línea del carrito cambia de significado:
 *   - `quantity` cuenta PAQUETES, no unidades de stock.
 *   - `unitPrice` es el precio del PAQUETE COMPLETO.
 *   - el inventario descuenta `quantity × packSize` (`stock_units_consumed`).
 */

/**
 * Resuelve el packSize efectivo de un par (tarifa, override).
 *
 * Cascada: override ?? tier ?? 1. Cualquier valor resuelto que no sea un número
 * mayor que 1 colapsa a 1 (comportamiento sin empaque).
 */
export function resolvePackSize(
  tierUnits?: number | null,
  overrideUnits?: number | null,
): number {
  const v = overrideUnits ?? tierUnits ?? 1;
  const n = Number(v);
  return Number.isFinite(n) && n > 1 ? n : 1;
}

/**
 * Unidades de stock que consume una cantidad de PAQUETES.
 *
 * Devuelve `quantity × packSize` cuando packSize > 1, y `null` cuando no hay
 * multiplicador de empaque (packSize === 1 → comportamiento sin cambios).
 * Devolver `null` en vez de `quantity` permite al caller persistir el snapshot
 * SOLO cuando el empaque realmente expandió el consumo — exactamente el
 * criterio del backend para escribir `order_items.stock_units_consumed`.
 */
export function resolveStockUnitsConsumed(
  quantity: number,
  tierUnits?: number | null,
  overrideUnits?: number | null,
): number | null {
  const packSize = resolvePackSize(tierUnits, overrideUnits);
  return packSize > 1 ? Number(quantity) * packSize : null;
}

/**
 * Unidades de stock que hay que reponer al devolver parte de una línea.
 *
 * Devolver 1 bulto de 50 repone 50 unidades, no 1: la línea guardó cuántas
 * consumió al venderse (`stock_units_consumed`) y la devolución mueve la parte
 * proporcional de ese número. Sin ese snapshot —líneas anteriores a la feature
 * o ventas sin presentación— la cantidad devuelta ya está en unidades de stock
 * y se devuelve tal cual, que es el comportamiento histórico.
 *
 * El redondeo es al entero más cercano porque el inventario es `Int`.
 */
export function resolveRefundStockUnits(
  refundedQuantity: number,
  soldQuantity?: number | null,
  soldStockUnitsConsumed?: number | null,
): number {
  const refunded = Number(refundedQuantity);
  const sold = Number(soldQuantity);
  const consumed = Number(soldStockUnitsConsumed);

  if (
    !Number.isFinite(consumed) ||
    soldStockUnitsConsumed == null ||
    consumed <= 0 ||
    !Number.isFinite(sold) ||
    sold <= 0
  ) {
    return refunded;
  }

  if (refunded >= sold) return consumed;
  return Math.round((consumed * refunded) / sold);
}
