import { Granularity } from '../dto/analytics-query.dto';

/**
 * Fills gaps in time-series data so every expected period appears in the output.
 *
 * SQL GROUP BY only returns rows for periods with actual data.
 * This function generates all periods between startDate and endDate,
 * then merges with real data — filling missing periods with the zero template.
 */
export function fillTimeSeries<T extends { period: string }>(
  results: T[],
  startDate: Date,
  endDate: Date,
  granularity: Granularity,
  zeroTemplate: Omit<T, 'period'>,
  formatPeriod: (date: Date, granularity: Granularity) => string,
): T[] {
  const dataMap = new Map<string, T>();
  for (const item of results) {
    dataMap.set(item.period, item);
  }

  const filled: T[] = [];
  let cursor = alignToGranularity(new Date(startDate), granularity);
  const end = endDate;

  while (cursor <= end) {
    const key = formatPeriod(cursor, granularity);

    if (dataMap.has(key)) {
      filled.push(dataMap.get(key)!);
    } else {
      filled.push({ ...zeroTemplate, period: key } as T);
    }

    cursor = advanceCursor(cursor, granularity);
  }

  return filled;
}

/**
 * Aligns a date to the start of the given granularity period.
 * Mirrors PostgreSQL DATE_TRUNC behavior:
 * - HOUR  → start of the hour
 * - DAY   → start of the day (midnight)
 * - WEEK  → Monday (ISO week start, matching PostgreSQL)
 * - MONTH → 1st of the month
 * - YEAR  → January 1st
 */
function alignToGranularity(date: Date, granularity: Granularity): Date {
  const d = new Date(date);

  switch (granularity) {
    case Granularity.HOUR:
      d.setMinutes(0, 0, 0);
      return d;

    case Granularity.DAY:
      d.setHours(0, 0, 0, 0);
      return d;

    case Granularity.WEEK: {
      d.setHours(0, 0, 0, 0);
      // getDay(): 0=Sun, 1=Mon ... 6=Sat
      // ISO weeks start on Monday (day 1)
      const day = d.getDay();
      const diff = day === 0 ? 6 : day - 1; // days since Monday
      d.setDate(d.getDate() - diff);
      return d;
    }

    case Granularity.MONTH:
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      return d;

    case Granularity.YEAR:
      d.setMonth(0, 1);
      d.setHours(0, 0, 0, 0);
      return d;

    default:
      d.setHours(0, 0, 0, 0);
      return d;
  }
}

/** Advances the cursor by one period unit. */
function advanceCursor(date: Date, granularity: Granularity): Date {
  const d = new Date(date);

  switch (granularity) {
    case Granularity.HOUR:
      d.setHours(d.getHours() + 1);
      return d;

    case Granularity.DAY:
      d.setDate(d.getDate() + 1);
      return d;

    case Granularity.WEEK:
      d.setDate(d.getDate() + 7);
      return d;

    case Granularity.MONTH:
      d.setMonth(d.getMonth() + 1);
      return d;

    case Granularity.YEAR:
      d.setFullYear(d.getFullYear() + 1);
      return d;

    default:
      d.setDate(d.getDate() + 1);
      return d;
  }
}
