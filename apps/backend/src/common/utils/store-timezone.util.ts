/**
 * Store timezone — SINGLE SOURCE OF TRUTH.
 *
 * Postgres stores `created_at` as `timestamptz` (UTC). Grouping analytics with
 * a bare `DATE_TRUNC('day', created_at)` truncates in UTC, so a sale at 23:00
 * store-local time (e.g. America/Bogota, UTC-5 → 04:00Z next day) lands in the
 * wrong calendar bucket. This module centralizes every timezone concern used by
 * analytics/report bucketing so the fix lives in exactly one place.
 *
 * Design decisions (verified, not assumed):
 *  - The authoritative period label is produced IN SQL as TEXT via
 *    `to_char(DATE_TRUNC(unit, col AT TIME ZONE 'UTC' AT TIME ZONE tz), fmt)`.
 *    Emitting text avoids the `pg` driver re-parsing a `timestamp without time
 *    zone` (wall-clock) back into a tz-ambiguous JS Date.
 *  - The zero-fill walk (`enumerateLocalPeriodKeys`) walks the store's LOCAL
 *    calendar and MUST produce byte-identical labels to what the SQL produces
 *    for the same local period. `localPeriodSql` and `localPeriodKey` are driven
 *    by the same internal `periodSpec` so they cannot diverge.
 *  - Dependency-free: the backend has no luxon/date-fns. All wall-clock <-> UTC
 *    conversion is derived from `Intl.DateTimeFormat`, so it works for ANY IANA
 *    timezone (including DST zones), not only Colombia.
 *
 * No NestJS DI: this is a pure utility. `resolveStoreTimezone` receives the
 * already-injected `StorePrismaService` as an argument.
 */
import { Prisma } from '@prisma/client';
import type { StorePrismaService } from '../../prisma/services/store-prisma.service';

/** Fallback timezone when a store has no configured/valid IANA timezone. */
export const DEFAULT_STORE_TIMEZONE = 'America/Bogota';

/**
 * Granularity understood by the period helpers. Kept as a domain-agnostic
 * string union (NOT coupled to the analytics `Granularity` enum) so this util
 * can live in `common`. The analytics enum values ('hour'|'day'|'week'|'month'
 * |'year') are structurally assignable to this type.
 */
export type TimeGranularity = 'hour' | 'day' | 'week' | 'month' | 'year';

/** Charset guard: only characters valid in IANA tz names. Prevents SQL injection
 * because `tz` is inlined into raw SQL via `Prisma.raw`. */
const SAFE_TZ_REGEX = /^[A-Za-z0-9_/+-]+$/;

/**
 * Returns `tz` if it is a syntactically safe IANA-like identifier, otherwise the
 * default. Never throws — analytics must degrade gracefully to the default.
 */
export function assertSafeTimezone(tz?: string | null): string {
  if (tz && SAFE_TZ_REGEX.test(tz)) {
    return tz;
  }
  return DEFAULT_STORE_TIMEZONE;
}

/**
 * Resolves a store's IANA timezone from `store_settings.settings.general.timezone`,
 * falling back to {@link DEFAULT_STORE_TIMEZONE}. This is the ONE reader every
 * analytics/report service must use (do not reimplement privately).
 */
export async function resolveStoreTimezone(
  prisma: StorePrismaService,
  storeId: number,
): Promise<string> {
  const settings = await prisma.store_settings.findFirst({
    where: { store_id: storeId },
    select: { settings: true },
  });
  const tz = (settings?.settings as any)?.general?.timezone as
    | string
    | undefined;
  return assertSafeTimezone(tz);
}

// ---------------------------------------------------------------------------
// Wall-clock <-> UTC conversion (Intl-based, dependency-free, DST-safe)
// ---------------------------------------------------------------------------

interface CivilDateTime {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
}

/** Extracts the wall-clock civil parts of a UTC instant in the given tz. */
function getTimeZoneParts(date: Date, tz: string): CivilDateTime {
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
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }
  // Guard the container ICU quirk where midnight can format as hour "24".
  const hour = parseInt(map.hour, 10) % 24;
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: Number.isNaN(hour) ? 0 : hour,
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
  };
}

/** Public accessor for a UTC instant's local wall-clock parts. */
export function localCivil(date: Date, tz: string): CivilDateTime {
  return getTimeZoneParts(date, assertSafeTimezone(tz));
}

/**
 * Offset (localWallClock - UTC) in ms for a given UTC instant in tz.
 *
 * The wall-clock parts only carry second precision, so the probe instant is
 * floored to whole seconds before subtracting. Timezone offsets are always a
 * whole number of minutes, so this yields a clean offset and — crucially —
 * prevents the sub-second remainder of `utcMs` (e.g. the .999 of an end-of-day
 * boundary) from leaking into the offset and shifting the result by ~1s.
 */
function tzOffsetMs(utcMs: number, tz: string): number {
  const p = getTimeZoneParts(new Date(utcMs), tz);
  const asIfUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  const utcSeconds = Math.floor(utcMs / 1000) * 1000;
  return asIfUtc - utcSeconds;
}

/**
 * Converts a LOCAL wall-clock time (in `tz`) to the corresponding UTC instant.
 * DST-safe: derives the offset at the target instant and refines once so it is
 * correct across a DST transition. Works for any IANA timezone.
 */
export function zonedWallClockToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  tz: string,
): Date {
  const safeTz = assertSafeTimezone(tz);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const offset1 = tzOffsetMs(asUtc, safeTz);
  let utc = asUtc - offset1;
  const offset2 = tzOffsetMs(utc, safeTz);
  if (offset2 !== offset1) {
    utc = asUtc - offset2;
  }
  return new Date(utc);
}

// ---------------------------------------------------------------------------
// Period spec — the ONE place that defines both the SQL and the JS labeling
// ---------------------------------------------------------------------------

interface PeriodSpec {
  /** Postgres DATE_TRUNC unit. */
  pgUnit: string;
  /** Postgres to_char format that yields the authoritative label string. */
  pgFormat: string;
}

function periodSpec(granularity: string): PeriodSpec {
  switch (granularity) {
    case 'hour':
      return { pgUnit: 'hour', pgFormat: 'YYYY-MM-DD"T"HH24:00' };
    case 'week':
      return { pgUnit: 'week', pgFormat: 'YYYY-MM-DD' };
    case 'month':
      return { pgUnit: 'month', pgFormat: 'YYYY-MM' };
    case 'year':
      return { pgUnit: 'year', pgFormat: 'YYYY' };
    case 'day':
    default:
      return { pgUnit: 'day', pgFormat: 'YYYY-MM-DD' };
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// ---------------------------------------------------------------------------
// SQL fragments
// ---------------------------------------------------------------------------

/**
 * Returns the safe SQL fragment `(column AT TIME ZONE 'UTC' AT TIME ZONE 'tz')`
 * that reinterprets a `timestamptz` column as the store's local wall clock.
 * `column` is a trusted code-supplied identifier (e.g. 'o.created_at'); `tz` is
 * charset-validated before being inlined.
 */
export function localBucketSql(column: string, tz: string): Prisma.Sql {
  const safeTz = assertSafeTimezone(tz);
  return Prisma.sql`(${Prisma.raw(column)} AT TIME ZONE 'UTC' AT TIME ZONE ${Prisma.raw(`'${safeTz}'`)})`;
}

/**
 * Returns the SQL fragment that produces the authoritative LOCAL period label as
 * TEXT: `to_char(DATE_TRUNC(unit, col AT TIME ZONE 'UTC' AT TIME ZONE tz), fmt)`.
 * Use this in SELECT and `GROUP BY 1` / `ORDER BY 1`. The label matches exactly
 * what {@link localPeriodKey} / {@link enumerateLocalPeriodKeys} produce in JS.
 */
export function localPeriodSql(
  column: string,
  tz: string,
  granularity: string,
): Prisma.Sql {
  const safeTz = assertSafeTimezone(tz);
  const { pgUnit, pgFormat } = periodSpec(granularity);
  return Prisma.sql`to_char(DATE_TRUNC(${Prisma.raw(`'${pgUnit}'`)}, ${localBucketSql(column, safeTz)}), ${Prisma.raw(`'${pgFormat}'`)})`;
}

// ---------------------------------------------------------------------------
// Local-calendar labeling & zero-fill (mirror of the SQL labels)
// ---------------------------------------------------------------------------

interface CivilCursor {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
}

/** Aligns civil parts down to the start of the granularity period (local). */
function truncateCivil(c: CivilDateTime, granularity: string): CivilCursor {
  switch (granularity) {
    case 'hour':
      return { year: c.year, month: c.month, day: c.day, hour: c.hour };
    case 'week': {
      const base = new Date(Date.UTC(c.year, c.month - 1, c.day));
      const dow = base.getUTCDay(); // 0=Sun..6=Sat
      const diff = dow === 0 ? 6 : dow - 1; // days since Monday (ISO, matches PG)
      base.setUTCDate(base.getUTCDate() - diff);
      return {
        year: base.getUTCFullYear(),
        month: base.getUTCMonth() + 1,
        day: base.getUTCDate(),
        hour: 0,
      };
    }
    case 'month':
      return { year: c.year, month: c.month, day: 1, hour: 0 };
    case 'year':
      return { year: c.year, month: 1, day: 1, hour: 0 };
    case 'day':
    default:
      return { year: c.year, month: c.month, day: c.day, hour: 0 };
  }
}

/** Formats an aligned cursor to the same label the SQL `to_char` produces. */
function formatCivilKey(c: CivilCursor, granularity: string): string {
  switch (granularity) {
    case 'hour':
      return `${c.year}-${pad(c.month)}-${pad(c.day)}T${pad(c.hour)}:00`;
    case 'month':
      return `${c.year}-${pad(c.month)}`;
    case 'year':
      return `${c.year}`;
    case 'week':
    case 'day':
    default:
      return `${c.year}-${pad(c.month)}-${pad(c.day)}`;
  }
}

/** Advances an aligned cursor by exactly one period unit (local calendar). */
function advanceCivil(c: CivilCursor, granularity: string): CivilCursor {
  const base = new Date(Date.UTC(c.year, c.month - 1, c.day, c.hour));
  switch (granularity) {
    case 'hour':
      base.setUTCHours(base.getUTCHours() + 1);
      break;
    case 'week':
      base.setUTCDate(base.getUTCDate() + 7);
      break;
    case 'month':
      base.setUTCMonth(base.getUTCMonth() + 1);
      break;
    case 'year':
      base.setUTCFullYear(base.getUTCFullYear() + 1);
      break;
    case 'day':
    default:
      base.setUTCDate(base.getUTCDate() + 1);
      break;
  }
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
    hour: base.getUTCHours(),
  };
}

/**
 * The LOCAL period label for a single UTC instant — identical to the label the
 * SQL `to_char(DATE_TRUNC(...))` produces for the same order. This is the
 * bucketing contract used to prove correctness.
 */
export function localPeriodKey(
  date: Date,
  granularity: string,
  tz: string,
): string {
  const safeTz = assertSafeTimezone(tz);
  const aligned = truncateCivil(getTimeZoneParts(date, safeTz), granularity);
  return formatCivilKey(aligned, granularity);
}

/**
 * Enumerates every LOCAL period label between two UTC instants (inclusive),
 * walking the store's local calendar. Used by the zero-fill so every expected
 * bucket appears even when the SQL GROUP BY returned no row for it. The labels
 * are byte-identical to {@link localPeriodSql}'s output.
 */
export function enumerateLocalPeriodKeys(
  startDate: Date,
  endDate: Date,
  granularity: string,
  tz: string,
): string[] {
  const safeTz = assertSafeTimezone(tz);
  const keys: string[] = [];
  let cursor = truncateCivil(getTimeZoneParts(startDate, safeTz), granularity);
  const endMs = endDate.getTime();
  const MAX_ITERATIONS = 200000; // safety cap (~22 years of hourly buckets)
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const startUtc = zonedWallClockToUtc(
      cursor.year,
      cursor.month,
      cursor.day,
      cursor.hour,
      0,
      0,
      0,
      safeTz,
    );
    if (startUtc.getTime() > endMs) {
      break;
    }
    keys.push(formatCivilKey(cursor, granularity));
    cursor = advanceCivil(cursor, granularity);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Date range resolution (TZ-aware replacement for the UTC parseDateRange)
// ---------------------------------------------------------------------------

interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number;
}

/** Parses a 'YYYY-MM-DD' (optionally with time) string as a calendar date. */
function parseCalendarDate(value: string): CalendarDate {
  const [y, m, d] = value.slice(0, 10).split('-').map((x) => parseInt(x, 10));
  return { year: y, month: m, day: d };
}

function addCivilDays(c: CalendarDate, n: number): CalendarDate {
  const base = new Date(Date.UTC(c.year, c.month - 1, c.day));
  base.setUTCDate(base.getUTCDate() + n);
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
}

function mondayOfCivil(c: CalendarDate): CalendarDate {
  const base = new Date(Date.UTC(c.year, c.month - 1, c.day));
  const dow = base.getUTCDay();
  const diff = dow === 0 ? 6 : dow - 1;
  base.setUTCDate(base.getUTCDate() - diff);
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
}

/**
 * TZ-aware date range. Interprets `date_from`/`date_to` as CALENDAR dates in the
 * store timezone, and computes presets against the store's LOCAL clock. Returns
 * UTC instants for the LOCAL boundaries:
 *   - bounded ranges: [local 00:00:00.000, local 23:59:59.999]
 *   - open/"current" presets (today/thisWeek/thisMonth/thisYear): end = now
 *     (preserves "vs same time in previous period" growth semantics).
 *
 * `date_preset` values match the analytics `DatePreset` enum
 * (today|yesterday|thisWeek|lastWeek|thisMonth|lastMonth|thisYear|lastYear|custom).
 */
export function resolveLocalDateRange(
  query: { date_from?: string; date_to?: string; date_preset?: string },
  tz: string,
): { startDate: Date; endDate: Date } {
  const safeTz = assertSafeTimezone(tz);

  const startOfDay = (c: CalendarDate) =>
    zonedWallClockToUtc(c.year, c.month, c.day, 0, 0, 0, 0, safeTz);
  const endOfDay = (c: CalendarDate) =>
    zonedWallClockToUtc(c.year, c.month, c.day, 23, 59, 59, 999, safeTz);

  // Explicit custom range — calendar dates in the store timezone.
  if (query.date_from && query.date_to) {
    return {
      startDate: startOfDay(parseCalendarDate(query.date_from)),
      endDate: endOfDay(parseCalendarDate(query.date_to)),
    };
  }

  const now = new Date();
  const todayParts = getTimeZoneParts(now, safeTz);
  const today: CalendarDate = {
    year: todayParts.year,
    month: todayParts.month,
    day: todayParts.day,
  };

  switch (query.date_preset) {
    case 'today':
      return { startDate: startOfDay(today), endDate: now };
    case 'yesterday': {
      const y = addCivilDays(today, -1);
      return { startDate: startOfDay(y), endDate: endOfDay(y) };
    }
    case 'thisWeek': {
      const monday = mondayOfCivil(today);
      return { startDate: startOfDay(monday), endDate: now };
    }
    case 'lastWeek': {
      const thisMonday = mondayOfCivil(today);
      const lastMonday = addCivilDays(thisMonday, -7);
      const lastSunday = addCivilDays(thisMonday, -1);
      return { startDate: startOfDay(lastMonday), endDate: endOfDay(lastSunday) };
    }
    case 'lastMonth': {
      const firstOfThisMonth: CalendarDate = {
        year: today.year,
        month: today.month,
        day: 1,
      };
      const lastMonthLastDay = addCivilDays(firstOfThisMonth, -1);
      const lastMonthFirstDay: CalendarDate = {
        year: lastMonthLastDay.year,
        month: lastMonthLastDay.month,
        day: 1,
      };
      return {
        startDate: startOfDay(lastMonthFirstDay),
        endDate: endOfDay(lastMonthLastDay),
      };
    }
    case 'thisYear':
      return {
        startDate: startOfDay({ year: today.year, month: 1, day: 1 }),
        endDate: now,
      };
    case 'lastYear':
      return {
        startDate: startOfDay({ year: today.year - 1, month: 1, day: 1 }),
        endDate: endOfDay({ year: today.year - 1, month: 12, day: 31 }),
      };
    case 'thisMonth':
    default:
      return {
        startDate: startOfDay({ year: today.year, month: today.month, day: 1 }),
        endDate: now,
      };
  }
}
