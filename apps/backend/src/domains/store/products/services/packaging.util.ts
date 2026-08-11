/**
 * Packaging helpers for the "Empaque por tarifa" feature.
 *
 * Packaging (units-per-package) lives on the price tier, with an optional
 * per-product override. The effective pack size follows this cascade:
 *
 *   packSize = override_units_per_package ?? tier.units_per_package ?? 1
 *
 * A pack size of 1 (or any value <= 1, including null/undefined) means the
 * tier is NOT a package tier and behavior must be IDENTICAL to today (no
 * packaging multiplier, no extra stock consumption).
 *
 * These are pure functions (no NestJS injectable needed) so they can be reused
 * by the price resolver, cart/checkout, orders, quotations, and any future
 * consumer without DI coupling.
 */

/**
 * Resolve the effective pack size from the tier quantity and the optional
 * per-product override.
 *
 * Cascade: override ?? tier ?? 1. Any resolved value that is not a number
 * greater than 1 collapses to 1 (non-package behavior).
 */
export function resolvePackSize(
  tierUnits?: number | null,
  overrideUnits?: number | null,
): number {
  const v = overrideUnits ?? tierUnits ?? 1;
  return typeof v === 'number' && v > 1 ? v : 1;
}

/**
 * Resolve the stock units consumed for a given quantity of PACKAGES.
 *
 * Returns `quantity * packSize` when packSize > 1, otherwise `null` to signal
 * that no packaging multiplier applies (packSize === 1 → behavior unchanged).
 * Returning `null` (instead of `quantity`) lets callers persist a snapshot
 * only when packaging actually expanded the stock consumption.
 */
export function resolveStockUnitsConsumed(
  quantity: number,
  tierUnits?: number | null,
  overrideUnits?: number | null,
): number | null {
  const packSize = resolvePackSize(tierUnits, overrideUnits);
  return packSize > 1 ? quantity * packSize : null;
}

/**
 * Unidades de stock que hay que mover al devolver parte de una línea.
 *
 * Devolver 1 bulto de 50 repone 50 unidades, no 1: la línea guardó cuántas
 * consumió al venderse (`stock_units_consumed`) y la devolución mueve la parte
 * proporcional de ese número. Sin ese snapshot —líneas anteriores a la feature
 * o ventas sin presentación— la cantidad devuelta ya está en unidades de stock
 * y se devuelve tal cual, que es el comportamiento histórico.
 *
 * El redondeo es al entero más cercano porque el inventario es `Int`; una
 * devolución parcial de un paquete indivisible es una decisión del operador,
 * no un error de este cálculo.
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
