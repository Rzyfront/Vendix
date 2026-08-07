/**
 * Analytics metric CONTRACT — the single owner of "what a number means".
 *
 * Timezone bucketing already has a single owner (`common/utils/store-timezone.util`).
 * This file closes the other half of the problem: before it existed, each service
 * decided on its own which order states counted, whether VAT was revenue, and
 * where cost came from. The measured result was three different definitions of
 * "ingresos" across three endpoints of the same screen, and a "Ganancia Neta"
 * that never subtracted COGS.
 *
 * Any analytics service that emits revenue, cost, expense or profit MUST source
 * those definitions here. Adding a private variant is the regression.
 */

import { Prisma } from '@prisma/client';

/**
 * Order states that count as a CONSUMMATED sale. A sale is recognized when it
 * reaches the customer — not when the order row is created (`created`,
 * `pending_payment`, `processing`, `shipped` are still in flight) and not when it
 * is undone (`cancelled`).
 *
 * `refunded` is deliberately ABSENT: it is recognized by the returns path, which
 * subtracts the refund in the period the refund occurs. A service that needs the
 * refund-inclusive set (so an order created and refunded inside the same period
 * nets to zero rather than producing a phantom negative) must state that reason
 * explicitly at the call site — see `FinancialAnalyticsService.REVENUE_STATES`.
 */
export const COMPLETED_SALE_STATES = ['delivered', 'finished'] as const;

/**
 * Expense states that count as an expense OF THE PERIOD (accrual / causación):
 * the expense is recognized when it is approved, not when the cash leaves.
 * `pending` is excluded — an unapproved capture is not yet a recognized expense,
 * and counting it lets a mistyped draft hit the store's profit immediately.
 */
export const RECOGNIZED_EXPENSE_STATES = ['approved', 'paid'] as const;

/** Charset guard for a state literal inlined into raw SQL. */
const SAFE_STATE_REGEX = /^[a-z_]+$/;

/**
 * Renders a contract state list as an inline SQL literal list (`'a', 'b'`), for
 * use inside `IN (...)` in a `$queryRaw`.
 *
 * Inlining is safe because every value is charset-validated here, and it keeps
 * the comparison on the native enum type so the `(store_id, state, created_at)`
 * indexes stay usable — a `state::text = ANY($1)` cast would not. The point is
 * that raw SQL derives its state list from the CONTRACT instead of re-typing
 * `IN ('delivered', 'finished')` and drifting from the Prisma-side filter.
 */
export function sqlStateList(states: readonly string[]): Prisma.Sql {
  const safe = states.filter((s) => SAFE_STATE_REGEX.test(s));
  if (safe.length === 0) {
    throw new Error('sqlStateList: no valid state literals');
  }
  return Prisma.raw(safe.map((s) => `'${s}'`).join(', '));
}

/** Raw order-level monetary components, as summed straight from `orders`. */
export interface OperatingRevenueParts {
  /** SUM(orders.subtotal_amount) — line totals before order-level discount. */
  subtotal: number;
  /** SUM(orders.discount_amount) — order-level discount. */
  discounts: number;
  /** SUM(orders.shipping_cost) — freight CHARGED to the customer (revenue). */
  shipping: number;
  /** SUM(orders.tax_amount) — VAT/consumption tax COLLECTED, never revenue. */
  tax: number;
}

/**
 * OPERATING REVENUE — the one number every "Ingresos" card must show.
 *
 *   subtotal − discounts + shipping charged
 *
 * VAT is excluded on purpose: it is money held for the DIAN, not earned income
 * (it is reported separately as `tax_collected`). Freight charged IS included,
 * per the product decision, so revenue matches what the store actually invoiced
 * the customer minus tax.
 *
 * Using `grand_total` instead — the previous behaviour of `sales/summary` — makes
 * the card overstate revenue by exactly the VAT, and puts the margin numerator
 * and denominator on different bases.
 */
export function computeOperatingRevenue(parts: OperatingRevenueParts): number {
  return parts.subtotal - parts.discounts + parts.shipping;
}

/**
 * How much of the sold volume has a KNOWN unit cost.
 *
 * COGS sums `quantity * COALESCE(cost_price, 0)`, so a line whose cost snapshot
 * is NULL contributes zero cost and reads as a 100 % margin. That is
 * indistinguishable from a genuinely free-to-acquire product, which is why the
 * figure must travel with its coverage instead of standing alone. Measured on
 * the reference dataset: 116 of 449 lines had no cost snapshot at all.
 */
export interface CostCoverage {
  /** Units sold in the period. */
  units_total: number;
  /** Units whose line had NO cost snapshot (`cost_price IS NULL`). */
  units_without_cost: number;
  /** Fraction of units WITH a known cost, 0..1 (1 = fully costed). */
  coverage_ratio: number;
}

/** Builds a {@link CostCoverage} from raw counts, safe on an empty period. */
export function buildCostCoverage(
  unitsTotal: number,
  unitsWithoutCost: number,
): CostCoverage {
  const total = Number(unitsTotal) || 0;
  const uncosted = Number(unitsWithoutCost) || 0;
  return {
    units_total: total,
    units_without_cost: uncosted,
    coverage_ratio: total > 0 ? (total - uncosted) / total : 1,
  };
}

/**
 * Period-over-period growth as a PERCENTAGE, or `null` when there is no base to
 * compare against.
 *
 * Returning `0` for an empty previous period — the previous behaviour in 11
 * places — asserts "no change" about a period that had nothing, which reads as a
 * flat business instead of a new one. `null` means "sin base de comparación" and
 * the UI must render it as such, not as `0 %`.
 */
export function computeGrowth(
  current: number,
  previous: number,
): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * SINGLE rounding policy for every emitted number: round-half-away-from-zero to
 * 2 decimals. The `Number.EPSILON` nudge cancels binary-float artifacts
 * (`1234.5600000000003`) and the explicit sign keeps it symmetric for negative
 * money (net_profit, cash difference) instead of `Math.round`'s toward-`+∞` bias.
 *
 * Round only what you EMIT: keep the intermediate math at full precision so
 * derived figures are not built from already-rounded components.
 */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100;
}

/**
 * PRODUCT PROFITABILITY — per-product COGS-based formulas used by the
 * `products/profitability` analytics view (QUI-623).
 *
 * The unit of every input is **whole-currency** (revenue and COGS are sums
 * across the period for one product). All three helpers keep full precision
 * inside and return ROUNDED values for emission, per the `round2` policy.
 *
 * `cogs` MUST come from the historical snapshot (`SUM(oi.quantity *
 * oi.cost_price)`). Using the current `products.cost_price` would rewrite
 * closed periods on the next cost edit and contradict the Estado de
 * Resultados, which is the regression QUI-623 fixes.
 */

// --- raw (un-rounded) helpers ---------------------------------------------

/** Profit = revenue − cogs. Negative when cost exceeds revenue. */
export function computeProductProfit(revenue: number, cogs: number): number {
  return (Number(revenue) || 0) - (Number(cogs) || 0);
}

/**
 * Margin as a RATIO (0..1, possibly negative). Returns `null` when there is no
 * revenue to measure against — never `0`, which would falsely read as a
 * perfectly zero-margin line. `computeGrowth` uses the same null convention.
 */
export function computeProductMargin(revenue: number, profit: number): number | null {
  if (!Number.isFinite(revenue) || revenue <= 0) return null;
  return profit / revenue;
}

/**
 * Markup as a RATIO (0..∞, possibly negative). Returns `null` when COGS is
 * zero OR negative (a refund-only line has no cost basis to mark up). Reads
 * differently from margin: 100 % markup on a 50-cost / 100-revenue line is
 * +100 %, vs 50 % margin — the same line, different denominators.
 */
export function computeProductMarkup(cogs: number, profit: number): number | null {
  if (!Number.isFinite(cogs) || cogs <= 0) return null;
  return profit / cogs;
}

// --- emitted (rounded) helpers --------------------------------------------

/** Emitted product profit, rounded. */
export function productProfitRounded(revenue: number, cogs: number): number {
  return round2(computeProductProfit(revenue, cogs));
}

/** Emitted product margin as PERCENTAGE (e.g. `42.5`), or `null` (UI: "—"). */
export function productMarginPct(revenue: number, profit: number): number | null {
  const m = computeProductMargin(revenue, profit);
  return m === null ? null : round2(m * 100);
}

/** Emitted product markup as PERCENTAGE, or `null`. */
export function productMarkupPct(cogs: number, profit: number): number | null {
  const m = computeProductMarkup(cogs, profit);
  return m === null ? null : round2(m * 100);
}
