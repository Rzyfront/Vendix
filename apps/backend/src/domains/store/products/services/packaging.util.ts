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
 * Unidades de stock que consume una línea de PESO legado (`weight > 0`).
 *
 * En ese camino `order_items.quantity` vale 1 y el peso es solo el
 * multiplicador monetario; sin este snapshot la validación, el commit de
 * inventario (`stock_units_consumed ?? quantity`), las capas de costo y las
 * devoluciones descontaban **1 unidad por línea** pesara lo que pesara.
 *
 * La conversión peso → unidades de stock la hace el POS, que es quien conoce
 * la unidad de stock declarada del producto (`stock_uom` y su
 * `factor_to_base`): 0,180 kg de un producto con stock en gramos llegan como
 * 180. El servidor solo acepta el número si es un entero ≥ 0 (el stock es
 * `Int`); cualquier otra cosa —o una línea que no es de peso— devuelve `null`
 * y la línea sigue con el comportamiento histórico (`quantity`).
 */
export function resolveWeightLineStockUnits(item: {
  weight?: number | string | null;
  stock_units_consumed?: number | string | null;
}): number | null {
  const weight = Number(item.weight ?? 0);
  if (!Number.isFinite(weight) || weight <= 0) return null;
  if (item.stock_units_consumed == null) return null;
  const units = Number(item.stock_units_consumed);
  return Number.isInteger(units) && units >= 0 ? units : null;
}

/**
 * Unidades de stock que mueve una PORCIÓN de una línea ya vendida.
 *
 * Mover 1 bulto de 50 mueve 50 unidades, no 1: la línea de venta guardó cuántas
 * consumió (`stock_units_consumed`) y cualquier operación posterior sobre parte
 * de esa línea mueve la porción proporcional de ese número. Sin ese snapshot
 * —líneas anteriores a la feature, o ventas sin presentación— la cantidad ya
 * está expresada en unidades de stock y se devuelve tal cual, que es el
 * comportamiento histórico.
 *
 * El redondeo es al entero más cercano porque el inventario es `Int`; partir un
 * paquete indivisible es una decisión del operador, no un error de este cálculo.
 *
 * Dos consumidores hoy, y deliberadamente **uno solo** el cálculo: la devolución
 * (`refund_items`) y la entrega por remisión (`dispatch_note_items`, que no
 * persiste su propio snapshot y lo deriva de la línea de orden emparejada).
 * Duplicar esta proporción es cómo se desincronizan las dos puntas del
 * desdoblamiento paquete↔unidad.
 */
export function resolveLineStockUnits(
  lineQuantity: number,
  soldQuantity?: number | null,
  soldStockUnitsConsumed?: number | null,
): number {
  const moved = Number(lineQuantity);
  const sold = Number(soldQuantity);
  const consumed = Number(soldStockUnitsConsumed);

  if (
    !Number.isFinite(consumed) ||
    soldStockUnitsConsumed == null ||
    consumed <= 0 ||
    !Number.isFinite(sold) ||
    sold <= 0
  ) {
    return moved;
  }

  if (moved >= sold) return consumed;
  return Math.round((consumed * moved) / sold);
}

/**
 * Alias histórico de `resolveLineStockUnits` para el flujo de devolución.
 * Mismo cálculo; se conserva el nombre porque nombra la intención en su
 * call site.
 */
export function resolveRefundStockUnits(
  refundedQuantity: number,
  soldQuantity?: number | null,
  soldStockUnitsConsumed?: number | null,
): number {
  return resolveLineStockUnits(
    refundedQuantity,
    soldQuantity,
    soldStockUnitsConsumed,
  );
}
