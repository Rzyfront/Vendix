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
 * Revenue-recognition order states. Adds `refunded` to the completed set so
 * the matching refunds.tax_refund / refunds.subtotal_refund row can
 * subtract the tax collected at delivery. Using only COMPLETED_SALE_STATES
 * here was a latent double-exclusion (QUI-630 review): an order created and
 * refunded inside the same period would leave the collected bucket and the
 * refund would subtract its tax again, driving net_tax negative. With
 * `refunded` included, the gross/net pair balances to zero in the same
 * period. Shared by `financial/tax-summary` and `financial/refunds`.
 */
export const REVENUE_STATES = [...COMPLETED_SALE_STATES, 'refunded'] as const;

/**
 * Refund states that count as a recognized refund OF THE PERIOD (accrual /
 * causación): the refund is recognized when it completes (completed / approved),
 * NOT when it's pending operator action.
 *
 * Shared by `financial/refunds` (QUI-631) and `products/performance` — both
 * must use the SAME list so the per-product return rate and the totals
 * reported in financial reconcile (defect of QUI-631 catalog: they were
 * hand-rolled in each service and had already drifted apart).
 */
export const REFUND_RECOGNIZED_STATES = ['completed', 'approved'] as const;

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
 * SQL expression for operating revenue (ex-VAT), ready to interpolate into
 * a `$queryRaw` template. Kept in sync with {@link computeOperatingRevenue} so
 * the JS aggregation and the SQL aggregation cannot drift apart.
 *
 * Usage:
 *   `SELECT COALESCE(SUM(${OPERATING_REVENUE_SQL}), 0) AS revenue FROM orders ...`
 *
 * QUI-613 review: avoid the previous drift where day/week/month used the
 * new formula but the hour branch still used `grand_total` (with VAT). A
 * shared SQL fragment enforces one definition across all granularities.
 */
export const OPERATING_REVENUE_SQL = Prisma.raw(
  '(o.subtotal_amount - o.discount_amount + o.shipping_cost)',
) as unknown as Prisma.Sql;

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

// =============================================================================
// PER-PRODUCT MARGIN / MARKUP (rentabilidad por producto) — QUI-623
// -----------------------------------------------------------------------------
// Raw ratio helpers (un-rounded) for emit-time rounding by the service or
// by the matching `product*` helpers below. Keep these pure: every helper is
// a function from numbers to numbers; the SQL aggregation that produced
// `revenue` and `cogs` lives in `products-analytics.service.ts`.
// =============================================================================

/**
 * `cogs` MUST come from the historical snapshot (`SUM(oi.quantity *
 * oi.cost_price)`). Using the current `products.cost_price` would rewrite
 * closed periods on the next cost edit and contradict the Estado de
 * Resultados, which is the regression QUI-623 fixes.
 */

/** Profit = revenue − cogs. Negative when cost exceeds revenue. */
export function computeProductProfit(revenue: number, cogs: number): number {
  return (Number(revenue) || 0) - (Number(cogs) || 0);
}

/**
 * Margin as a RATIO (0..1, possibly negative). Returns `null` when there is no
 * revenue to measure against — never `0`, which would falsely read as a
 * perfectly zero-margin line. `computeGrowth` uses the same null convention.
 */
export function computeProductMargin(
  revenue: number,
  profit: number,
): number | null {
  if (!Number.isFinite(revenue) || revenue <= 0) return null;
  return profit / revenue;
}

/**
 * Markup as a RATIO (0..∞, possibly negative). Returns `null` when COGS is
 * zero OR negative (a refund-only line has no cost basis to mark up). Reads
 * differently from margin: 100 % markup on a 50-cost / 100-revenue line is
 * +100 %, vs 50 % margin — the same line, different denominators.
 */
export function computeProductMarkup(
  cogs: number,
  profit: number,
): number | null {
  if (!Number.isFinite(cogs) || cogs <= 0) return null;
  return profit / cogs;
}

// --- emitted (rounded) helpers --------------------------------------------

/** Emitted product profit, rounded. */
export function productProfitRounded(
  revenue: number,
  cogs: number,
): number {
  return round2(computeProductProfit(revenue, cogs));
}

/** Emitted product margin as PERCENTAGE (e.g. `42.5`), or `null` (UI: "—"). */
export function productMarginPct(
  revenue: number,
  profit: number,
): number | null {
  const m = computeProductMargin(revenue, profit);
  return m === null ? null : round2(m * 100);
}

/** Emitted product markup as PERCENTAGE, or `null`. */
export function productMarkupPct(
  cogs: number,
  profit: number,
): number | null {
  const m = computeProductMarkup(cogs, profit);
  return m === null ? null : round2(m * 100);
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

// =============================================================================
// CASH BASIS (base caja) — el panel principal
// -----------------------------------------------------------------------------
// Todo lo de arriba mide DEVENGO: reconoce la venta cuando la orden se
// consuma (`COMPLETED_SALE_STATES`), sin importar si el cliente pagó. El panel
// principal mide otra cosa: CAJA — cuánto dinero entró y salió ese día. Son
// dos preguntas distintas y ambas son válidas; lo que no es válido es
// mezclarlas dentro de una misma tarjeta.
//
// Regla divisoria: si la cifra responde "¿cuánto vendí?" usa el bloque de
// devengo. Si responde "¿cuánta plata entró?" usa este bloque.
// =============================================================================

/**
 * Estados de `payments` en los que EL DINERO YA ENTRÓ a la tienda.
 *
 * `refunded` y `partially_refunded` están incluidos DELIBERADAMENTE, y omitirlos
 * es el error más fácil de cometer aquí. `RefundFlowService.createRefund` muta el
 * pago original a `refunded`/`partially_refunded` cuando se procesa la
 * devolución (refund-flow.service.ts, "4. Update payment state"). Si el filtro
 * de ingresos sólo aceptara `succeeded`/`captured`, un cobro hecho hoy y
 * devuelto hoy DESAPARECERÍA del numerador y ADEMÁS se restaría en la línea de
 * reembolsos — se descontaría dos veces. Medido en producción el 2026-08-18:
 * 218 pagos ya están en esos dos estados.
 *
 * El dinero entró: eso es un hecho histórico que una devolución posterior no
 * borra. La devolución se refleja por separado, en la fecha en que salió.
 *
 * Excluidos y por qué:
 *  - `pending`   — cobro iniciado, plata no confirmada.
 *  - `failed`    — nunca entró.
 *  - `cancelled` — anulado antes de entrar.
 *  - `authorized`— autorizado pero NO capturado; el cupo está reservado en la
 *                  tarjeta del cliente, la plata no está en la tienda.
 */
export const CASH_INCOME_PAYMENT_STATES = [
  'succeeded',
  'captured',
  'refunded',
  'partially_refunded',
] as const;

/**
 * Estados de `refunds` en los que EL DINERO YA SALIÓ de la tienda.
 *
 * `pending_approval`, `requested` y `processing` quedan fuera: representan una
 * devolución INTENCIONADA, no ejecutada. Contarlas restaría plata que sigue en
 * la caja.
 *
 * Esto obliga a una garantía del lado del flujo de devoluciones: ningún refund
 * puede quedar aparcado para siempre en un estado no terminal. Un refund
 * atascado es plata que salió en la vida real y nunca aparece en la analítica.
 * `RefundFlowService` sólo puede aparcar en `pending_approval` cuando existe una
 * pasarela reversible por API que lo va a promover; ver
 * `refund-channel.util.ts`. La analítica expone además el conteo pendiente
 * (`refunds.pending_count`) para que un atasco sea VISIBLE en vez de silencioso.
 */
export const REFUND_CASH_OUT_STATES = ['completed', 'approved'] as const;

/**
 * Estados de `refunds` que representan una devolución declarada pero AÚN NO
 * ejecutada. Se reportan como advertencia, nunca se restan de la caja.
 */
export const REFUND_PENDING_STATES = [
  'requested',
  'pending_approval',
  'processing',
] as const;

/**
 * Estados de `expenses` en los que EL DINERO YA SALIÓ.
 *
 * Más estricto que {@link RECOGNIZED_EXPENSE_STATES} a propósito: `approved` es
 * causación (el gasto se reconoce), `paid` es caja (el efectivo se fue). La
 * tarjeta Gastos usa el set de causación; el Balance usa este.
 */
export const EXPENSE_CASH_OUT_STATES = ['paid'] as const;

/**
 * Impuestos que la tienda RECAUDA PARA EL ESTADO y por tanto nunca son ingreso
 * propio, aunque entren por caja junto al precio.
 *
 * `iva` e `inc` son trasladables: el comerciante los cobra al cliente y los
 * gira a la DIAN. `ica` NO entra aquí — es un impuesto municipal a cargo del
 * comerciante sobre sus ingresos, es decir un GASTO suyo, no un recaudo de
 * terceros. Las retenciones (`withholding`/`reteiva`/`reteica`) tampoco: son
 * anticipos que el cliente descuenta del pago, no algo que la tienda recaude.
 *
 * Ojo con `orders.tax_amount`: es la suma de LOS SEIS tipos. Restarlo entero
 * como si fuera IVA descuenta retenciones e ICA de más. Para el neto sin
 * impuestos trasladables hay que ir a `order_item_taxes` filtrando por estos
 * dos tipos.
 */
export const PASSTHROUGH_TAX_TYPES = ['iva', 'inc'] as const;

/** Forma runtime de {@link PASSTHROUGH_TAX_TYPES} para chequeos `.has`. */
export const PASSTHROUGH_TAX_SET: ReadonlySet<string> = new Set(
  PASSTHROUGH_TAX_TYPES,
);

/**
 * Prorratea un componente de la orden (IVA, COGS) en proporción a lo COBRADO.
 *
 * Necesario porque en base caja el numerador son pagos, no órdenes. Si un
 * cliente abona el 40 % de una venta, a ese ingreso le corresponde el 40 % de su
 * IVA y el 40 % de su costo. Traer el componente completo con un abono parcial
 * hunde la ganancia y puede volverla negativa; no traer nada la infla al 100 %
 * de margen.
 *
 * @param orderComponent  Valor total del componente en la orden (IVA o COGS).
 * @param paymentAmount   Monto del pago recibido.
 * @param orderTotal      `orders.grand_total` de esa orden.
 * @returns La fracción del componente imputable a ese pago. `0` cuando
 *          `orderTotal <= 0`, para no dividir por cero ni invertir el signo.
 *
 * El ratio se recorta a 1: un sobrepago (propina registrada como pago, o un
 * abono duplicado) no debe imputar más costo del que la orden tiene.
 */
export function prorateByPayment(
  orderComponent: number,
  paymentAmount: number,
  orderTotal: number,
): number {
  const total = Number(orderTotal) || 0;
  if (total <= 0) return 0;
  const component = Number(orderComponent) || 0;
  const paid = Number(paymentAmount) || 0;
  const ratio = Math.min(paid / total, 1);
  return component * ratio;
}
