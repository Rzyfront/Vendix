/**
 * Date utilities for consistent timezone handling across the frontend.
 *
 * Rules:
 * - Dates from the backend (date-only fields like expense_date) are stored as midnight UTC.
 *   Use formatDateOnlyUTC() or toUTCDateString() to display/extract them.
 * - Dates representing "today" for form defaults should use the user's local timezone.
 *   Use toLocalDateString() for these.
 */

/**
 * Formats a date-only value from the backend for display.
 * Uses timeZone: 'UTC' to prevent timezone offset from shifting the date.
 * Example: "2026-04-11T00:00:00Z" → "11/4/2026" (in es-CO locale)
 */
export function formatDateOnlyUTC(value: string | Date): string {
  const d = new Date(value);
  return d.toLocaleDateString('es-CO', { timeZone: 'UTC' });
}

/**
 * Converts a Date to YYYY-MM-DD string using LOCAL timezone.
 * Use for form defaults like "today's date" where the user's local date matters.
 * Example: new Date() at 8pm Colombia → "2026-04-11" (correct local date)
 */
export function toLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Extracts YYYY-MM-DD from a Date using UTC timezone.
 * Use when converting backend dates back to input values.
 * Example: new Date("2026-04-11T00:00:00Z") → "2026-04-11" (correct UTC date)
 */
export function toUTCDateString(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns the first day of the current month as YYYY-MM-DD (local timezone).
 * Replaces 18+ duplicate getDefaultStartDate() across analytics components.
 */
export function getDefaultStartDate(): string {
  const date = new Date();
  date.setDate(1);
  return toLocalDateString(date);
}

/**
 * Returns today's date as YYYY-MM-DD (local timezone).
 * Replaces 18+ duplicate getDefaultEndDate() across analytics components.
 */
export function getDefaultEndDate(): string {
  return toLocalDateString();
}

/**
 * Formats a period string from the backend for chart axis labels.
 * Uses timeZone: 'UTC' to prevent the day-shift bug where
 * "2026-04-12" (UTC midnight) displays as "11 abr" in UTC-5 timezones.
 */
export function formatChartPeriod(period: string, granularity: string): string {
  if (granularity === 'year') return period;
  if (granularity === 'month') {
    const [year, month] = period.split('-');
    const date = new Date(Date.UTC(Number(year), Number(month) - 1));
    return date.toLocaleDateString('es', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  }
  if (granularity === 'hour') {
    const parts = period.split('T');
    return parts[1] || period;
  }
  try {
    const date = new Date(period);
    return date.toLocaleDateString('es', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  } catch {
    return period;
  }
}
