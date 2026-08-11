import { Prisma } from '@prisma/client';

/**
 * Canonical monetary/rate formatting for every DIAN artifact.
 *
 * WHY THIS EXISTS — the defect it closes:
 *
 * `Prisma.Decimal` (decimal.js) drops trailing zeros on `toString()`:
 *
 *   new Prisma.Decimal('1000.00').toString()  // => '1000'   ← scale lost
 *   new Prisma.Decimal('119000.00').toString() // => '119000'
 *
 * The provider payload used to be built with `.toString()`, so the CUFE hashed
 * `'1000'` while the UBL XML emitted `parseFloat(...).toFixed(2)` = `'1000.00'`.
 * The DIAN recomputes the CUFE **from the XML it receives**, so the two hashes
 * never matched and every invoice whose subtotal or total landed on whole pesos
 * — the overwhelming majority in COP — was rejected. Taxes were already padded
 * (`.toFixed(2)`) inside the very same CUFE call, which is what made the bug
 * look like a rounding nuance instead of a scale mismatch.
 *
 * On top of that, Anexo Técnico 1.9 §11.2 (p.655-658) requires amounts
 * **TRUNCATED** to 2 decimals, not rounded. `.toFixed(2)` rounds
 * (`1000.005 -> '1000.01'`), so a half-cent could still diverge from the DIAN's
 * own recomputation.
 *
 * Both problems collapse into one rule: every value that reaches a CUFE/CUDE/CUDS
 * hash or a UBL element goes through this module, and nothing else formats money.
 *
 * @see docs/facturacion-electronica-dian-software-propio.md §20.0-bis
 */

/** Truncate toward zero — Anexo 1.9 §11.2 forbids rounding. */
const TRUNCATE = Prisma.Decimal.ROUND_DOWN;

/** DIAN emits monetary values and tax rates with exactly 2 decimals. */
const DIAN_SCALE = 2;

export type DianNumericInput =
  | string
  | number
  | Prisma.Decimal
  | null
  | undefined;

/**
 * Formats a monetary value exactly as the DIAN expects it, in the CUFE string
 * and in the XML alike: dot separator, exactly 2 decimals, truncated (never
 * rounded), no thousands separator, no currency symbol.
 *
 * Non-finite or unparseable input yields `'0.00'` rather than `'NaN'`, because a
 * `NaN` inside a CUFE concatenation produces a silently invalid hash instead of
 * a loud failure.
 *
 * ```ts
 * dianAmount(new Prisma.Decimal('1000.00')) // '1000.00'  (was '1000')
 * dianAmount('1000')                        // '1000.00'
 * dianAmount(1000.005)                      // '1000.00'  (truncated, not '1000.01')
 * dianAmount(null)                          // '0.00'
 * ```
 */
export function dianAmount(value: DianNumericInput): string {
  return formatWithScale(value, DIAN_SCALE);
}

/**
 * Formats a tax rate for `cac:TaxCategory/cbc:Percent`.
 *
 * Same contract as {@link dianAmount}: `invoice_taxes.tax_rate` is a
 * `Decimal(5,2)`, so `19.00` serialized to `'19'` and reached the XML without
 * decimals. The DIAN validates the percent against `base × tarifa`, and the
 * declared scale is part of the document contract.
 *
 * ```ts
 * dianRate(new Prisma.Decimal('19.00')) // '19.00'  (was '19')
 * ```
 */
export function dianRate(value: DianNumericInput): string {
  return formatWithScale(value, DIAN_SCALE);
}

/**
 * Sums already-formatted or raw amounts and returns the DIAN-formatted total.
 *
 * Used to make `LegalMonetaryTotal/LineExtensionAmount` the exact sum of the
 * line-level `LineExtensionAmount` values (rule `FAU14`). Summing in `Decimal`
 * instead of `number` keeps the header from drifting a cent away from the lines
 * on long invoices.
 */
export function dianSum(values: DianNumericInput[]): string {
  const total = values.reduce<Prisma.Decimal>(
    (acc, value) => acc.plus(toDecimal(value)),
    new Prisma.Decimal(0),
  );
  return applyScale(total);
}

/**
 * Adds/subtracts in `Decimal` space and formats once, so intermediate results
 * never round-trip through `number`.
 */
export function dianArithmetic(
  operands: { value: DianNumericInput; sign: 1 | -1 }[],
): string {
  const total = operands.reduce<Prisma.Decimal>((acc, operand) => {
    const term = toDecimal(operand.value);
    return operand.sign === 1 ? acc.plus(term) : acc.minus(term);
  }, new Prisma.Decimal(0));
  return applyScale(total);
}

/** Minimal shape every UBL line exposes for its net extension amount. */
export interface DianLineAmounts {
  quantity: DianNumericInput;
  unit_price: DianNumericInput;
  discount_amount?: DianNumericInput;
  /**
   * QUI-648 — a cuántas unidades de la cantidad declarada corresponde
   * `unit_price` (`products.price_unit_quantity`, la *price unit* de SAP).
   *
   * Sin esto el importe de la línea es `quantity × unit_price`, que para un
   * queso a $28.000 el kilo con el stock en gramos declara **$70.000.000** por
   * una venta de **$70.000**. Y no se queda en la línea: el mismo cálculo
   * alimenta `dianLineExtensionTotal` —el total legal de la cabecera— y el
   * `ValFac` del CUFE, así que el factor N se propaga al documento entero y a
   * su huella, que es precisamente lo que la DIAN recomputa.
   *
   * Ausente, 0, 1 o no numérico ⇒ divisor 1, la aritmética histórica de todo el
   * catálogo por pieza.
   */
  price_unit_quantity?: DianNumericInput;
}

/**
 * Net `cbc:LineExtensionAmount` of one line: `quantity × unit_price − discount`.
 *
 * UBL defines `LineExtensionAmount` as net of line-level allowances, so the
 * discount is subtracted here and represented once more as the line's
 * `cac:AllowanceCharge` (which is descriptive, not additive).
 */
export function dianLineExtension(line: DianLineAmounts): string {
  return applyScale(lineExtensionDecimal(line));
}

/**
 * Sum of every line's net extension amount — the value that
 * `cac:LegalMonetaryTotal/cbc:LineExtensionAmount` **must** equal (rule
 * `FAU14`).
 *
 * This exists so the CUFE's `ValFac` and the XML's header amount are computed by
 * the SAME function instead of two independent expressions. The header used to
 * carry the gross subtotal while the lines carried net amounts, so any invoice
 * with a discount violated FAU14; deriving both from here makes that divergence
 * unrepresentable.
 */
export function dianLineExtensionTotal(lines: DianLineAmounts[]): string {
  const total = lines.reduce<Prisma.Decimal>(
    (acc, line) => acc.plus(lineExtensionDecimal(line)),
    new Prisma.Decimal(0),
  );
  return applyScale(total);
}

/**
 * Parses any accepted input into a `Decimal`, collapsing invalid values to zero.
 * Exposed so callers doing multi-step math stay in `Decimal` space instead of
 * formatting and re-parsing between operations.
 */
export function toDecimal(value: DianNumericInput): Prisma.Decimal {
  if (value === null || value === undefined || value === '') {
    return new Prisma.Decimal(0);
  }

  if (value instanceof Prisma.Decimal) {
    return value.isFinite() ? value : new Prisma.Decimal(0);
  }

  try {
    const parsed = new Prisma.Decimal(value);
    return parsed.isFinite() ? parsed : new Prisma.Decimal(0);
  } catch {
    return new Prisma.Decimal(0);
  }
}

// --- Private helpers ---

function lineExtensionDecimal(line: DianLineAmounts): Prisma.Decimal {
  return toDecimal(line.quantity)
    .times(toDecimal(line.unit_price))
    .dividedBy(priceUnitDivisor(line.price_unit_quantity))
    .minus(toDecimal(line.discount_amount));
}

/**
 * Divisor de la *price unit*: un entero > 1, o 1. Se sanea acá y no en el
 * llamador para que ningún camino pueda dividir por cero ni por un negativo y
 * convertir un importe legal en basura.
 */
function priceUnitDivisor(value: DianNumericInput): Prisma.Decimal {
  const n = toDecimal(value);
  return n.greaterThan(1) ? n : new Prisma.Decimal(1);
}

function formatWithScale(value: DianNumericInput, scale: number): string {
  return applyScale(toDecimal(value), scale);
}

function applyScale(value: Prisma.Decimal, scale: number = DIAN_SCALE): string {
  const formatted = value.toFixed(scale, TRUNCATE);
  // Truncating a tiny negative (-0.001) yields '-0.00'. A signed zero inside a
  // CUFE concatenation changes the hash, so it is normalized away.
  return formatted === '-' + (0).toFixed(scale) ? (0).toFixed(scale) : formatted;
}
