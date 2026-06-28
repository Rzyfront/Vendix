/**
 * Chart label and axis number formatting helpers.
 *
 * Used to:
 * - Truncate long category labels (store, product, customer, location) so they
 *   fit cleanly on the xAxis without overflowing the chart container.
 * - Compact large numeric axis values to a readable K/M format so the yAxis
 *   doesn't crowd when values exceed 1.000 or 1.000.000.
 *
 * Pair with the existing `CurrencyFormatService.formatChartAxis()` for
 * currency-formatted yAxis values (already used in `sales-trends` and
 * `overview-summary`).
 */

/**
 * Truncates a string with an ellipsis if it exceeds `max` characters.
 *
 * Use for xAxis category labels that may be long (store, product, customer,
 * supplier, location). The tooltip should still show the full value — the
 * existing tooltip formatters already do this.
 *
 * @param value - The label value (string, number, null, or undefined).
 * @param max - Maximum allowed length before truncation (default 14).
 * @returns The original string if short enough, otherwise truncated with `…`.
 */
export function truncateLabel(
  value: string | number | null | undefined,
  max = 14,
): string {
  if (value == null) return '';
  const s = String(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Compact integer formatter for yAxis when the metric is a count (units,
 * orders, customers) and is NOT currency.
 *
 * - `999`       → `"999"`
 * - `1.500`     → `"2K"`     (rounded)
 * - `2.300.000` → `"2M"`     (rounded)
 *
 * For currency yAxis, use `currencyService.formatChartAxis()` instead — it
 * applies the same K/M logic but prepends the configured currency symbol.
 *
 * @param value - The numeric axis tick value.
 * @returns Compact representation, or empty string when value is null/NaN.
 */
export function compactCountAxis(value: number | null | undefined): string {
  if (value == null || isNaN(Number(value))) return '';
  const v = Number(value);
  if (v >= 1_000_000) return `${Math.round(v / 1_000_000)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}K`;
  return `${Math.round(v)}`;
}