/**
 * Currency-aware money handling for vision/OCR scanners.
 *
 * ## Why this exists
 *
 * Colombian documents print `24.990` meaning twenty-four thousand nine
 * hundred ninety — `.` is the THOUSANDS separator and `,` is the decimal
 * separator. A vision model with no currency anchor falls back to its
 * decimal-currency prior and reads that as `24.99`, a silent 1000x error
 * that lands straight in `unit_cost` and COGS.
 *
 * Production evidence (2026-08): `expense_invoice_ocr` and `invoice_ocr`
 * share the exact same config (`google/gemini-2.5-flash-lite`,
 * `temperature 0.10`, `max_tokens 4000`) and the same code path. On the same
 * receipt the expense scanner returned `24990` and the purchase scanner
 * returned `24.99`. The only difference between them was that the expense
 * prompt carries a `currency` field and the purchase prompt did not.
 *
 * ## Two layers
 *
 * 1. `buildCurrencyInstruction` — the PRIMARY fix. Anchors the model to the
 *    store's real currency and its decimal places so it emits integers.
 * 2. `repairScannedAmount` — the SAFETY NET. Deterministic, and only ever
 *    active for zero-decimal currencies, where a fractional amount is
 *    structurally impossible rather than merely unlikely.
 */

/** Relative tolerance for "this float is an integer" after scaling. */
const INTEGER_EPSILON = 1e-9;

/**
 * Max digit groups a misread can collapse. `1.234.567.890` → `1.23456789`
 * is 3 groups / 9 decimals, and no printed amount realistically carries more.
 */
const MAX_GROUPS = 3;

/** Relative gap above which line totals vs. grand total is worth a warning. */
const TOTALS_TOLERANCE = 0.02;

export interface StoreCurrencyInfo {
  code: string;
  decimal_places: number;
}

/**
 * Text appended to the vision prompt so the model reasons in the store's
 * actual currency. Zero-decimal currencies get the explicit separator rule,
 * because that is the case the generic "convert 1.234.567,89" instruction
 * fails to cover: a receipt whose amounts carry NO decimal comma at all
 * leaves the `.` ambiguous, and the model resolves the ambiguity wrong.
 */
export function buildCurrencyInstruction(currency: StoreCurrencyInfo): string {
  const { code, decimal_places } = currency;

  if (decimal_places > 0) {
    return [
      `CURRENCY: all monetary amounts in this document are ${code}, which uses ${decimal_places} decimal place(s).`,
      `Return every money field as a plain number (no symbols, no thousands separators).`,
    ].join(' ');
  }

  return [
    `CURRENCY: all monetary amounts in this document are ${code}, which has NO decimals (0 decimal places).`,
    `Therefore "." is a THOUSANDS separator, never a decimal point:`,
    `"24.990" is 24990 (NOT 24.99), "1.985" is 1985, "371.404" is 371404, "1.234.567" is 1234567.`,
    `Only "," introduces decimals, and it appears on quantities (e.g. "0,315 KGM"), not on prices.`,
    `EVERY money field you return MUST be a whole integer — a fractional ${code} amount is impossible.`,
    `Sanity check before answering: the sum of the line totals must be close to the printed grand total.`,
    `If your extracted total is ~1000x smaller than the printed one, you misread the separators — redo it.`,
  ].join(' ');
}

/**
 * Repair one money value read from an OCR reply.
 *
 * Only acts on zero-decimal currencies, where a fractional amount is
 * structurally impossible rather than merely unlikely.
 *
 * The decision is driven by the value's DECIMAL DIGIT COUNT, not by iterative
 * multiplication. A collapsed thousands separator always yields a whole
 * number of 3-digit groups (minus any trailing zeros the JSON number dropped),
 * so at most `MAX_GROUPS * 3` decimals. Anything longer is arithmetic the
 * model performed (`total / quantity` → 3333.3333333333335), not a separator
 * it misread, and is left untouched.
 *
 * Iterating `value *= 1000` and testing for integrality does NOT work here:
 * past ~1e12 the float spacing exceeds the fractional part, so a genuine
 * repeating decimal starts testing as an exact integer and gets inflated.
 *
 * Known limitation: a genuinely fractional amount with <= 9 decimals in a
 * zero-decimal currency will be scaled. No printed COP price has that shape.
 *
 * Never call this on `quantity` (0,315 KGM is real) or on `tax_rate` (0.19 is
 * a fraction by contract).
 */
export function repairScannedAmount(
  value: number,
  currency: StoreCurrencyInfo,
): { value: number; repaired: boolean } {
  if (currency.decimal_places !== 0) return { value, repaired: false };
  if (!Number.isFinite(value) || value === 0) return { value, repaired: false };
  if (Number.isInteger(value)) return { value, repaired: false };

  const text = String(value);
  // Exponential notation is never a misread separator.
  if (text.includes('e') || text.includes('E')) return { value, repaired: false };

  const dot = text.indexOf('.');
  if (dot < 0) return { value, repaired: false };

  const decimals = text.length - dot - 1;
  if (decimals > MAX_GROUPS * 3) return { value, repaired: false };

  // Round the decimal count up to whole 3-digit groups: "24.99" lost a
  // trailing zero from "24.990", so 2 decimals still means one full group.
  const groups = Math.ceil(decimals / 3);
  const scaled = value * Math.pow(10, groups * 3);
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > Math.abs(scaled) * INTEGER_EPSILON) {
    return { value, repaired: false };
  }

  return { value: rounded, repaired: true };
}

/**
 * Cross-check that the repaired line totals still add up to the repaired
 * grand total. A mismatch means the scan is internally inconsistent (a line
 * was dropped, a discount was ignored, or the repair fired unevenly) and the
 * user must see it in the review step rather than have it saved silently.
 *
 * Returns null when everything reconciles or when there is nothing to compare.
 */
export function checkTotalsConsistency(
  lineTotals: number[],
  grandTotal: number,
  currencyCode: string,
): string | null {
  if (!Number.isFinite(grandTotal) || grandTotal === 0) return null;
  if (lineTotals.length === 0) return null;

  const sum = lineTotals.reduce((acc, n) => acc + (Number(n) || 0), 0);
  if (sum === 0) return null;

  const gap = Math.abs(sum - grandTotal) / Math.abs(grandTotal);
  if (gap <= TOTALS_TOLERANCE) return null;

  return (
    `La suma de las líneas (${sum.toLocaleString('es-CO')} ${currencyCode}) no coincide con ` +
    `el total del documento (${grandTotal.toLocaleString('es-CO')} ${currencyCode}). ` +
    `Revisa cantidades y precios antes de confirmar.`
  );
}
