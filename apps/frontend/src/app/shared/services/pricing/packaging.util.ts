/**
 * Packaging cascade helpers (frontend mirror of the backend).
 *
 * "Empaque por tarifa": the number of units per package now lives on the
 * price tier (`tier.units_per_package`), with an optional per-product /
 * per-variant override (`override_units_per_package`). The product no longer
 * carries packaging fields.
 *
 * These helpers mirror the backend
 * `apps/backend/src/domains/store/products/services/price-resolver.service.ts`
 * (`resolvePackSize`) so POS, product form, orders and quotations compute the
 * same numbers the server persists. The backend re-resolves and stores the
 * canonical snapshot; the frontend only presents.
 *
 * Canonical cascade:
 *   packSize = override_units_per_package ?? tier.units_per_package ?? 1
 * collapsing to `1` whenever the resolved value is not a number > 1, which
 * makes every downstream calculation identical to the legacy single-unit
 * behavior (zero regression for non-package tiers).
 */

/**
 * Resolve the effective pack size for a tier/override pair.
 *
 * @param tierUnits     `price_tier.units_per_package` (nullable).
 * @param overrideUnits `override_units_per_package` from the matching
 *                      per-product/per-variant override row (nullable).
 * @returns The pack size (>= 1). Returns `1` for any value <= 1 or non-number.
 */
export function resolvePackSize(
  tierUnits?: number | null,
  overrideUnits?: number | null,
): number {
  const v = overrideUnits ?? tierUnits ?? 1;
  return typeof v === 'number' && v > 1 ? v : 1;
}

/**
 * Compute the number of stock units consumed by a sale quantity, given the
 * packaging cascade. Returns `null` when the pack size is 1 (single-unit sale,
 * no multiplication needed) so callers can short-circuit packaging UI/logic.
 *
 * @param quantity      Quantity of packages being sold.
 * @param tierUnits     `price_tier.units_per_package` (nullable).
 * @param overrideUnits `override_units_per_package` (nullable).
 * @returns `quantity * packSize` when packaging applies, otherwise `null`.
 */
export function resolveStockUnitsConsumed(
  quantity: number,
  tierUnits?: number | null,
  overrideUnits?: number | null,
): number | null {
  const packSize = resolvePackSize(tierUnits, overrideUnits);
  return packSize > 1 ? quantity * packSize : null;
}
