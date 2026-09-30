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

// ---------------------------------------------------------------------------
// Store-timezone-aware presentation formatters (order-truth-and-invoice-tz-plan
// Step 9 / Specific Objectives 9-10).
//
// Mirrors, on the frontend, the exact bifurcation used by the backend's
// `fiscalIssueDate`/`formatStoreDate` in
// `apps/backend/src/common/utils/store-timezone.util.ts`:
//   - A value that carries a REAL time-of-day (e.g. `orders.created_at`,
//     `invoices.created_at`, DIAN event timestamps) is a genuine instant and
//     must be converted to the STORE's local calendar day/time.
//   - A value at EXACT UTC midnight (e.g. `invoices.issue_date`/`due_date`
//     when written as a naive calendar date) is a civil date stored verbatim
//     in UTC. Converting it with the store offset would push a negative-offset
//     store (e.g. America/Bogota, UTC-5) back to the PREVIOUS calendar day —
//     the exact "invoice shows the wrong day after 19:00" bug this exists to
//     prevent. Such a value is read back in UTC, never re-converted.
//
// A genuinely date-only field with NO time semantics at all (`valid_to`,
// `fx.date`) does NOT go through these helpers — it stays on
// `formatDateOnlyUTC()` above, unconditionally in UTC, per the plan's Step 9
// business decision.
// ---------------------------------------------------------------------------

interface StoreCivilParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
}

/** Wall-clock civil parts of a UTC instant in the given IANA timezone. */
function getStoreCivilParts(date: Date, tz: string): StoreCivilParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  // Guard the ICU quirk where midnight can format as hour "24".
  const hour = parseInt(map['hour'], 10) % 24;
  return {
    year: parseInt(map['year'], 10),
    month: parseInt(map['month'], 10),
    day: parseInt(map['day'], 10),
    hour: Number.isNaN(hour) ? 0 : hour,
    minute: parseInt(map['minute'], 10),
    second: parseInt(map['second'], 10),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** True when `date`'s UTC clock components are exactly midnight — the shape a
 * date-only value takes once Prisma round-trips it as a naive timestamp. */
function isUtcMidnight(date: Date): boolean {
  return (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0
  );
}

/**
 * Civil date for DISPLAY (`DD/MM/YYYY`), store-tz aware.
 *
 * Same bifurcation as the backend's `formatStoreDate`/`fiscalIssueDate`:
 * - Real time-of-day → convert to the store's local calendar date.
 * - Exact UTC midnight → read the UTC components verbatim (already a
 *   calendar date, not an instant); never re-converted, so a negative-offset
 *   store never sees it slip to the previous day.
 *
 * For a column that ALWAYS carries a genuine instant (`orders.created_at`),
 * only the first branch ever fires, so this is safe to use everywhere a
 * `date` is printed for `issue_date`/`due_date`-shaped fields.
 */
export function formatStoreDate(value: string | Date, tz: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  if (!isUtcMidnight(date)) {
    const p = getStoreCivilParts(date, tz);
    return `${pad2(p.day)}/${pad2(p.month)}/${p.year}`;
  }
  return [
    pad2(date.getUTCDate()),
    pad2(date.getUTCMonth() + 1),
    String(date.getUTCFullYear()),
  ].join('/');
}

/**
 * Date + time for DISPLAY (`DD/MM/YYYY HH:mm`), store-tz aware, for columns
 * that ALWAYS carry a genuine instant (contingency deadlines, DIAN retry
 * timestamps, DIAN event `issued_at`/`created_at`, ...).
 *
 * `options` lets a call site keep its own existing `Intl.DateTimeFormatOptions`
 * (e.g. a short month name, 12h clock) while still sourcing the timezone from
 * the store — only the tz changes, not the shape already on screen. Without
 * `options`, the default is the fixed `dd/MM/yyyy HH:mm` shape already used
 * across invoice-detail.
 */
export function formatStoreDateTime(
  value: string | Date,
  tz: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  if (options) {
    return new Intl.DateTimeFormat('es-CO', { timeZone: tz, ...options }).format(date);
  }
  const p = getStoreCivilParts(date, tz);
  return `${pad2(p.day)}/${pad2(p.month)}/${p.year} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/**
 * Today's date as `YYYY-MM-DD` in the STORE's timezone — the store-aware
 * counterpart of `toLocalDateString()` (browser-local). Use this for
 * defaulting fiscal-document date inputs (e.g. a new invoice's `issue_date`)
 * so the proposed date matches the store's business day, not the visiting
 * browser's clock.
 */
export function storeToday(tz: string): string {
  const p = getStoreCivilParts(new Date(), tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}
