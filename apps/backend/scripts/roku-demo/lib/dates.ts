/**
 * Historical date generation utilities.
 *
 * Today (anchor): 2026-06-10 (Wednesday).
 * Generates dates with realistic distribution:
 *   - More density on weekdays than weekends (2:1)
 *   - Sales peak on Saturdays
 *   - Payroll runs on day 15 of each month
 *   - Tax declarations on day 10 of the following month
 *   - Inventory initial stock on 2025-11-15
 */

import type { Rng } from './random';

export const TODAY = new Date('2026-06-10T12:00:00Z');
const ANCHOR_DAY = 15; // day of month used for opening stock and similar anchors

export function monthsAgo(months: number, dayOfMonth: number = ANCHOR_DAY): Date {
  const d = new Date(TODAY);
  d.setUTCMonth(d.getUTCMonth() - months);
  d.setUTCDate(Math.min(dayOfMonth, 28));
  d.setUTCHours(12, 0, 0, 0);
  return d;
}

export function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function addMinutes(base: Date, minutes: number): Date {
  const d = new Date(base);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d;
}

export function dayOfWeek(d: Date): number {
  return d.getUTCDay(); // 0=Sun ... 6=Sat
}

export function isWeekend(d: Date): boolean {
  const w = dayOfWeek(d);
  return w === 0 || w === 6;
}

/**
 * Pick a random date in a window, weighted toward weekdays and Saturdays.
 * Returns UTC date with time set to business hours (10:00-19:00).
 */
export function randomDateInWindow(
  rng: Rng,
  start: Date,
  end: Date,
): Date {
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (startMs >= endMs) return new Date(startMs);

  // Try 8 times to land on a business day, then fall back to whatever.
  for (let attempt = 0; attempt < 8; attempt++) {
    const t = startMs + rng.next() * (endMs - startMs);
    const candidate = new Date(t);
    candidate.setUTCHours(rng.int(10, 19), rng.int(0, 59), 0, 0);
    const w = dayOfWeek(candidate);
    const keepProb = w === 0 ? 0.15 : w === 6 ? 0.45 : 1.0;
    if (rng.chance(keepProb)) {
      return candidate;
    }
  }
  // Fallback
  const t = startMs + rng.next() * (endMs - startMs);
  return new Date(t);
}

/**
 * Returns N dates spread evenly within a window.
 * Useful for "5 sales per month" distribution.
 */
export function evenlySpacedDates(
  start: Date,
  end: Date,
  n: number,
): Date[] {
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (n <= 1 || startMs >= endMs) {
    return [new Date(startMs)];
  }
  const step = (endMs - startMs) / n;
  const out: Date[] = [];
  for (let i = 0; i < n; i++) {
    out.push(new Date(startMs + i * step + (step * 0.2) + (Math.random() * step * 0.6)));
  }
  return out;
}

/**
 * Returns the list of month periods (start, end) covering [monthsBack] months back from TODAY.
 * Each period runs from day 1 of the month to the last day of that month.
 */
export function monthlyPeriods(monthsBack: number): Array<{ start: Date; end: Date; year: number; month: number; label: string }> {
  const out: Array<{ start: Date; end: Date; year: number; month: number; label: string }> = [];
  for (let i = monthsBack; i >= 0; i--) {
    const d = new Date(TODAY);
    d.setUTCMonth(d.getUTCMonth() - i);
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    const start = new Date(d);
    const end = new Date(d);
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0); // last day of original month
    end.setUTCHours(23, 59, 59, 999);
    out.push({
      start,
      end,
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      label: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
    });
  }
  return out;
}

/**
 * Payroll due date: day 15 of the month after the period ended.
 */
export function payrollDueDate(year: number, month: number): Date {
  const d = new Date(Date.UTC(year, month, 15, 12, 0, 0)); // month is 1-12 → next month's day 15
  return d;
}

/**
 * VAT declaration due date: typically the 10th-19th of the following month
 * depending on the last digit of NIT. For demo, use day 10.
 */
export function vatDueDate(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 10, 12, 0, 0));
}

/**
 * Income tax annual: due in 2026 for fiscal year 2025.
 * Colombian deadlines depend on NIT digits; we use 2026-04-15 as a representative date.
 */
export function incomeTaxDueDate(year: number): Date {
  return new Date(Date.UTC(year, 4, 15, 12, 0, 0)); // April 15
}

/**
 * Quarterly periods: Q1, Q2, Q3, Q4 of the given year.
 */
export function quarterlyPeriods(year: number): Array<{ start: Date; end: Date; label: string; quarter: number }> {
  return [
    { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year, 2, 31, 23, 59, 59)), label: `${year}-Q1`, quarter: 1 },
    { start: new Date(Date.UTC(year, 3, 1)), end: new Date(Date.UTC(year, 5, 30, 23, 59, 59)), label: `${year}-Q2`, quarter: 2 },
    { start: new Date(Date.UTC(year, 6, 1)), end: new Date(Date.UTC(year, 8, 30, 23, 59, 59)), label: `${year}-Q3`, quarter: 3 },
    { start: new Date(Date.UTC(year, 9, 1)), end: new Date(Date.UTC(year, 11, 31, 23, 59, 59)), label: `${year}-Q4`, quarter: 4 },
  ];
}

/**
 * "Recent" = last 30 days from today
 * "Historical" = older than 30 days
 */
export function isRecent(d: Date): boolean {
  return d.getTime() > Date.now() - 30 * 24 * 3600 * 1000;
}
