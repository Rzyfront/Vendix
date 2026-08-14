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

/**
 * Purchase-order states that count as a COMMITTED purchase of the period.
 *
 * A purchase becomes an economic commitment when it is approved: from that
 * point the store owes the supplier regardless of whether the goods arrived.
 * `draft` is excluded because a draft is a shopping list, not an obligation —
 * counting it lets a test order hit the month's spend. `cancelled` is excluded
 * because the commitment was undone.
 *
 * `partial` and `received` are included: a partially received order is already
 * committed for its full ordered amount, which is why the gap between ordered
 * and received units is reported separately instead of shrinking the spend.
 */
export const PURCHASE_COMMITTED_STATES = [
  'approved',
  'partial',
  'received',
] as const;

/**
 * Sales-order states that count as a CONSUMMATED sale of the period.
 *
 * A `sales_order` is a PoS / pre-invoice entity that progresses from draft to
 * confirmed to shipped to invoiced. The economic sale is realized at `shipped`
 * (goods left) and remains at `invoiced` (fiscal document emitted); the two
 * states are interchangeable for revenue/totals reporting. `draft` is a
 * shopping list, `confirmed` is an in-flight order, `cancelled` is undone.
 *
 * Mirrors the sames naming convention as `COMPLETED_SALE_STATES` (which
 * concerns `orders`) — kept separate so the contract makes the universe
 * explicit at the call site.
 */
export const SALES_ORDER_COMPLETED_STATES = ['shipped', 'invoiced'] as const;

/**
 * Tipos de movimiento que SUMAN existencias.
 *
 * `production` entra: producir una receta crea unidades del producto terminado,
 * y son unidades tan reales como las que llegan de un proveedor.
 */
export const INBOUND_MOVEMENT_TYPES = [
  'stock_in',
  'return',
  'production',
] as const;

/**
 * Tipos de movimiento que RESTAN existencias.
 *
 * `consumption` entra: consumir un insumo lo saca del inventario aunque nadie
 * lo haya vendido.
 */
export const OUTBOUND_MOVEMENT_TYPES = [
  'stock_out',
  'sale',
  'damage',
  'expiration',
  'consumption',
] as const;

/**
 * Un traslado no es entrada ni salida: mueve unidades entre bodegas de la misma
 * tienda. Se cuenta aparte para que el total de movimiento no se lea como
 * actividad comercial que nunca ocurrió.
 *
 * `adjustment` tampoco aparece en las listas de arriba porque su dirección no
 * está en el tipo sino en las dos patas de ubicación: sale de donde dice
 * `from_location_id` y entra a donde dice `to_location_id`. Quien lo agrupe
 * debe resolverlo por las patas, no por el tipo.
 *
 * Por qué viven aquí: la serie de analítica y las tarjetas del listado de
 * movimientos definían "entrada" cada una por su cuenta —la serie dejaba
 * `production` y `consumption` fuera de los dos cubos pero dentro del total—,
 * así que las dos pantallas respondían distinto a la misma pregunta y ninguna
 * fallaba.
 */
export const TRANSFER_MOVEMENT_TYPE = 'transfer' as const;

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
 * Inputs of the tax-summary aggregate, ONE block per fiscal figure the DIAN's
 * declaración needs. The contract does NOT read the DB — every helper here is
 * a pure function that takes the pre-aggregated sums and returns the derived
 * figure. The service is responsible for the SQL that produces those sums.
 *
 * `iva_generado` + `inc_generado` + `ica_generado` are the store-side taxes
 * collected on sales (a liability to the DIAN). `iva_descontable` is the
 * VAT sealed as DESCONTABLE on recognized purchases (a credit against the
 * liability). `rete_practicadas` are sales-side withholdings
 * (tax_type IN ('withholding','reteiva','reteica')) over COMPLETED_SALE_STATES
 * — a credit that REDUCES the store's obligation. `rete_sufridas` are
 * purchase-side withholdings over PURCHASE_COMMITTED_STATES — also a credit
 * that REDUCES the store's obligation (the supplier already moved the money
 * to the DIAN on the store's behalf, so it nets against the gross tax).
 * Both retenciones are SUBTRACTED from `gross_generado` in the formula
 * below — the column used to be `+ practiced` which over-stated the position
 * by 2× the sales-side retenciones (QUI-630 review).
 *
 * Source schema: `tax_type_enum` = `iva | inc | ica | withholding | reteiva |
 * reteica`. The `retefuente` value described in the ticket text does not exist
 * as a distinct enum value — it is recorded as `tax_type = 'withholding'` and
 * distinguished from `reteiva`/`reteica` by `tax_name`.
 */
export interface VatPositionParts {
  /** Sales-side IVA collected (tax_type='iva') over COMPLETED_SALE_STATES. */
  iva_generado: number;
  /** Sales-side INC collected (tax_type='inc') over COMPLETED_SALE_STATES. */
  inc_generado: number;
  /** Sales-side ICA collected (tax_type='ica') over COMPLETED_SALE_STATES. */
  ica_generado: number;
  /** Purchase-side IVA sealed as DESCONTABLE (purchase_order_items.deductible_tax_amount) over PURCHASE_COMMITTED_STATES. */
  iva_descontable: number;
  /** Sales-side retenciones practicadas (tax_type IN ('withholding','reteiva','reteica')) over COMPLETED_SALE_STATES — credit. */
  rete_practicadas: number;
  /** Purchase-side retenciones sufridas (tax_type IN ('withholding','reteiva','reteica')) over PURCHASE_COMMITTED_STATES — credit. */
  rete_sufridas: number;
}

/**
 * NET VAT POSITION — la cifra que la declaración DIAN cierra.
 *
 *   POSITION = (iva_generado + inc_generado + ica_generado)
 *            − iva_descontable
 *            − rete_sufridas
 *            − rete_practicadas
 *
 * Convention:
 *   - POSITIVE: the store OWES the DIAN (saldo a cargo).
 *   - NEGATIVE: the store has a credit with the DIAN (saldo a favor).
 *
 * Pure function — the SOURCE OF TRUTH for the formula lives here, NOT in the
 * service. Any other fiscal aggregate that needs the same figure must call this
 * helper instead of re-deriving the formula.
 *
 * QUI-630 review: the formula was `+ rete_practicadas` which treated the
 * credit as a debit and over-stated the position by 2× the sales-side
 * retenciones. Corrected to `- rete_practicadas` so both retenciones are
 * subtracted (both are credits that reduce the obligation).
 */
export function computeNetVatPosition(parts: VatPositionParts): number {
  const grossGenerated =
    Number(parts.iva_generado ?? 0) +
    Number(parts.inc_generado ?? 0) +
    Number(parts.ica_generado ?? 0);
  const deductible = Number(parts.iva_descontable ?? 0);
  const suffered = Number(parts.rete_sufridas ?? 0);
  const practiced = Number(parts.rete_practicadas ?? 0);
  return grossGenerated - deductible - suffered - practiced;
}

/**
 * Effective tax rate as a percentage of the taxable revenue, or `null` when the
 * period has no taxable base (matches the contract's `computeGrowth(null)`
 * semantics — the UI must render "sin base", never "0 %").
 */
export function computeEffectiveTaxRate(
  totalTax: number,
  totalTaxableRevenue: number,
): number | null {
  if (totalTaxableRevenue <= 0) return null;
  return (totalTax / totalTaxableRevenue) * 100;
}

/**
 * `tax_type_enum` values that count as RETENCIONES (withholdings) for the
 * DIAN posición. Subdivided by name (Tax name) when rendered; the enum value
 * alone is what the analytics aggregates over.
 *
 *   `withholding`  — retefuente (the `retefuente` literal value described in
 *                    the ticket text does not exist as a distinct enum value
 *                    — see the `VatPositionParts` block comment above).
 *   `reteiva`      — retención sobre el IVA.
 *   `reteica`      — retención sobre el ICA.
 *
 * Source schema: `tax_type_enum` ∈ `iva | inc | ica | withholding | reteiva |
 * reteica`. The const tuple is the type-level source of truth; the Set helper
 * is provided for runtime `.has` checks on values typed as `string` from raw
 * SQL rows.
 */
export const WITHHOLDING_TAX_TYPES = [
  'withholding',
  'reteiva',
  'reteica',
] as const;

/**
 * Runtime Set form of {@link WITHHOLDING_TAX_TYPES}, used for `.has` checks
 * on values typed as `string` from raw SQL rows. The const tuple is the
 * type-level source of truth; the Set is the runtime helper.
 */
export const WITHHOLDING_SET: ReadonlySet<string> = new Set(
  WITHHOLDING_TAX_TYPES,
);
