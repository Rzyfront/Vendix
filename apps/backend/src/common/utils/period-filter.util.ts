/**
 * Shared period-filter helpers.
 *
 * Single source of truth for building Prisma `where` clauses that filter by
 * a date range. Resolves the user's timezone from the request context (store
 * or organization), expands `date_to` to end-of-day in that timezone, and
 * returns an `{ gte, lte }` object ready to spread into `where.<field>`.
 *
 * Replaces the ad-hoc `new Date(date_from)` pattern scattered across ~20
 * services that previously caused "the period filter doesn't load the correct
 * information" (data from the wrong day leaking in / last day of range being
 * silently dropped because `new Date('YYYY-MM-DD')` parses as UTC midnight).
 *
 * Migrated from `apps/backend/src/domains/store/analytics/utils/date.util.ts`
 * so non-analytics domains inherit the same TZ-aware semantics.
 */

// ----- Public enums (mirror analytics DTO enums so non-analytics modules
// don't have to import from a sibling domain) -------------------------

export enum DatePreset {
  TODAY = 'today',
  YESTERDAY = 'yesterday',
  THIS_WEEK = 'thisWeek',
  LAST_WEEK = 'lastWeek',
  THIS_MONTH = 'thisMonth',
  LAST_MONTH = 'lastMonth',
  THIS_YEAR = 'thisYear',
  LAST_YEAR = 'lastYear',
  CUSTOM = 'custom',
}

export enum Granularity {
  HOUR = 'hour',
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
}

// ----- Public types ----------------------------------------------------

export interface PeriodQuery {
  date_from?: string;
  date_to?: string;
  date_preset?: DatePreset | string;
  timezone?: string;
}

export interface PeriodFilterOptions {
  /** Explicit timezone (IANA). Wins over every other source. */
  timezone?: string;
  /** Store id from the request context. Used to read `stores.timezone`. */
  storeId?: number;
  /** Organization id fallback if the store has no timezone configured. */
  organizationId?: number;
  /**
   * Prisma client used to resolve the timezone when `opts.timezone` is not
   * provided. Optional — if omitted, the helper falls back to UTC.
   *
   * Typed loosely on purpose so this helper doesn't require `@prisma/client`
   * types in consumers' tsc runs (services can pass their injected
   * `PrismaService` and the call will resolve at runtime).
   */
  prisma?: unknown;
}

export interface PeriodRange {
  startDate: Date;
  endDate: Date;
  /** The timezone effectively used to compute the range (for logs/debug). */
  timezone: string;
}

// ----- Timezone helpers (moved from analytics/date.util.ts) ------------

/** Offset in ms between UTC and the given timezone at the supplied instant. */
function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = date.toLocaleString('en-US', { timeZone: timezone });
  return new Date(tzStr).getTime() - new Date(utcStr).getTime();
}

/** Build a UTC Date that represents a local wall-clock instant in `timezone`. */
function localDateToUTC(
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  timezone: string,
): Date {
  const naive = Date.UTC(y, m - 1, d, h, mi, s, 0);
  return new Date(naive - getTimezoneOffsetMs(new Date(naive), timezone));
}

function nowInZone(_timezone?: string): Date {
  return new Date();
}

/** 00:00:00 local of "today" in `timezone` (UTC midnight if no timezone). */
function startOfTodayInZone(timezone?: string): Date {
  const now = nowInZone(timezone);
  if (!timezone) {
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  return localDateToUTC(get('year'), get('month'), get('day'), 0, 0, 0, timezone);
}

/** 23:59:59.999 local of "today" in `timezone` (UTC end-of-day if no timezone). */
function endOfTodayInZone(timezone?: string): Date {
  const now = nowInZone(timezone);
  if (!timezone) {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    d.setUTCHours(23, 59, 59, 999);
    return d;
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  return new Date(
    localDateToUTC(
      get('year'),
      get('month'),
      get('day'),
      0,
      0,
      0,
      timezone,
    ).getTime() +
      24 * 60 * 60 * 1000 -
      1,
  );
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function dateAtLocalMidnight(
  y: number,
  m: number,
  d: number,
  timezone?: string,
): Date {
  if (!timezone) {
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  }
  return localDateToUTC(y, m, d, 0, 0, 0, timezone);
}

/** Day-of-week index 0..6 (Mon=0) in `timezone`, matching analytics behavior. */
function weekdayIndexInZone(now: Date, timezone?: string): number {
  if (!timezone) {
    return (now.getUTCDay() + 6) % 7;
  }
  const dow = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).formatToParts(now);
  const weekdayMap: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return (
    weekdayMap[dow.find((p) => p.type === 'weekday')?.value || 'Mon'] || 0
  );
}

// ----- Timezone resolution --------------------------------------------

/**
 * Resolve the timezone to apply when none is provided in the query.
 * Priority: explicit option → `stores.timezone` → `store_settings.settings.general.timezone` → 'UTC'.
 *
 * The `prisma` argument is typed as `unknown` at the boundary so this helper
 * doesn't require `@prisma/client` types. Calls are guarded by lightweight
 * runtime shape checks so a malformed/missing client doesn't crash callers.
 */
async function resolvePeriodTimezone(opts: PeriodFilterOptions): Promise<string> {
  if (opts.timezone) return opts.timezone;
  if (!opts.prisma || typeof opts.prisma !== 'object') return 'UTC';

  // Loose typing on purpose — see comment on PeriodFilterOptions.prisma.
  const prisma = opts.prisma as {
    stores?: {
      findUnique?: (args: unknown) => Promise<{
        timezone?: string | null;
        store_settings?: { settings?: unknown } | null;
      } | null>;
    };
    organizations?: {
      findUnique?: (args: unknown) => Promise<{
        settings?: unknown;
        stores?: Array<{
          timezone?: string | null;
          store_settings?: { settings?: unknown } | null;
        }>;
      } | null>;
    };
  };

  try {
    if (opts.storeId && prisma.stores?.findUnique) {
      const store = await prisma.stores.findUnique({
        where: { id: opts.storeId },
        select: {
          timezone: true,
          store_settings: { select: { settings: true } },
        },
      });
      if (store?.timezone) return store.timezone;
      const generalTz = readGeneralTimezone(store?.store_settings?.settings);
      if (generalTz) return generalTz;
      return 'UTC';
    }

    if (opts.organizationId && prisma.organizations?.findUnique) {
      const org = await prisma.organizations.findUnique({
        where: { id: opts.organizationId },
        select: {
          settings: true,
          stores: {
            take: 1,
            select: {
              timezone: true,
              store_settings: { select: { settings: true } },
            },
          },
        },
      });
      const firstStore = org?.stores?.[0];
      if (firstStore?.timezone) return firstStore.timezone;
      const storeGeneral = readGeneralTimezone(
        firstStore?.store_settings?.settings,
      );
      if (storeGeneral) return storeGeneral;
      const orgGeneral = readGeneralTimezone(org?.settings);
      if (orgGeneral) return orgGeneral;
      return 'UTC';
    }
  } catch {
    // Lookup failure should never break the user's request — fall back gracefully.
    return 'UTC';
  }

  return 'UTC';
}

/** Safely read `settings.general.timezone` from a free-form settings payload. */
function readGeneralTimezone(settings: unknown): string | undefined {
  if (!settings || typeof settings !== 'object') return undefined;
  const general = (settings as { general?: unknown }).general;
  if (!general || typeof general !== 'object') return undefined;
  const tz = (general as { timezone?: unknown }).timezone;
  return typeof tz === 'string' && tz.length > 0 ? tz : undefined;
}

// ----- Public API ------------------------------------------------------

/**
 * Detect whether a date string is `YYYY-MM-DD` (date-only) vs ISO with time.
 * Used to decide whether to expand `date_to` to end-of-day.
 */
function isDateOnlyString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Sync range parser. Requires an explicit timezone — used internally and
 * exposed for unit tests / callers that already know the TZ.
 *
 * Returns `null` when neither `date_from/date_to` nor `date_preset` is set.
 */
export function parsePeriodRangeSync(
  query: PeriodQuery,
  timezone: string,
): PeriodRange | null {
  const tz = timezone;

  if (query.date_from && query.date_to) {
    if (isDateOnlyString(query.date_from) && isDateOnlyString(query.date_to)) {
      const [yf, mf, df] = query.date_from.split('-').map(Number);
      const [yt, mt, dt] = query.date_to.split('-').map(Number);
      const start = dateAtLocalMidnight(yf, mf, df, tz);
      const endBase = dateAtLocalMidnight(yt, mt, dt, tz);
      return {
        startDate: start,
        endDate: new Date(endBase.getTime() + 24 * 60 * 60 * 1000 - 1),
        timezone: tz,
      };
    }

    // Policy C: only expand to end-of-day when the input is date-only.
    // If the caller sent an ISO with time (e.g. `2026-04-11T15:00:00Z`),
    // trust that exact instant — overwriting it with UTC end-of-day was the
    // silent data-loss bug this helper was created to fix.
    const endDate = isDateOnlyString(query.date_to)
      ? (() => {
          const [yt, mt, dt] = query.date_to.split('-').map(Number);
          return new Date(
            dateAtLocalMidnight(yt, mt, dt, tz).getTime() +
              24 * 60 * 60 * 1000 -
              1,
          );
        })()
      : new Date(query.date_to);
    return {
      startDate: new Date(query.date_from),
      endDate,
      timezone: tz,
    };
  }

  const todayStart = startOfTodayInZone(tz);

  switch (query.date_preset) {
    case DatePreset.TODAY:
      return { startDate: todayStart, endDate: endOfTodayInZone(tz), timezone: tz };
    case DatePreset.YESTERDAY: {
      const yesterdayStart = addDays(todayStart, -1);
      return {
        startDate: yesterdayStart,
        endDate: addDays(todayStart, -1),
        timezone: tz,
      };
    }
    case DatePreset.THIS_WEEK: {
      const dayIdx = weekdayIndexInZone(todayStart, tz);
      const weekStart = addDays(todayStart, -dayIdx);
      return { startDate: weekStart, endDate: endOfTodayInZone(tz), timezone: tz };
    }
    case DatePreset.LAST_WEEK: {
      const dayIdx = weekdayIndexInZone(todayStart, tz);
      const thisWeekStart = addDays(todayStart, -dayIdx);
      const lastWeekStart = addDays(thisWeekStart, -7);
      const lastWeekEnd = addDays(thisWeekStart, -1);
      return {
        startDate: lastWeekStart,
        endDate: lastWeekEnd,
        timezone: tz,
      };
    }
    case DatePreset.LAST_MONTH: {
      const now = nowInZone(tz);
      let y: number, m: number;
      if (tz) {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
        }).formatToParts(now);
        y = Number(parts.find((p) => p.type === 'year')?.value || 0);
        m = Number(parts.find((p) => p.type === 'month')?.value || 1);
      } else {
        y = now.getUTCFullYear();
        m = now.getUTCMonth() + 1;
      }
      const lastMonthStart = dateAtLocalMidnight(y, m - 1, 1, tz);
      const lastMonthEnd = dateAtLocalMidnight(y, m, 0, tz);
      return {
        startDate: lastMonthStart,
        endDate: new Date(lastMonthEnd.getTime() + 24 * 60 * 60 * 1000 - 1),
        timezone: tz,
      };
    }
    case DatePreset.THIS_YEAR:
    case DatePreset.LAST_YEAR: {
      const now = nowInZone(tz);
      let y: number;
      if (tz) {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          year: 'numeric',
        }).formatToParts(now);
        y = Number(parts.find((p) => p.type === 'year')?.value || 0);
      } else {
        y = now.getUTCFullYear();
      }
      const startYear = query.date_preset === DatePreset.THIS_YEAR ? y : y - 1;
      const start = dateAtLocalMidnight(startYear, 1, 1, tz);
      const end =
        query.date_preset === DatePreset.THIS_YEAR
          ? endOfTodayInZone(tz)
          : dateAtLocalMidnight(startYear, 12, 31, tz);
      return {
        startDate: start,
        endDate:
          query.date_preset === DatePreset.THIS_YEAR
            ? end
            : new Date(end.getTime() + 24 * 60 * 60 * 1000 - 1),
        timezone: tz,
      };
    }
    case DatePreset.THIS_MONTH:
    default: {
      const now = nowInZone(tz);
      let y: number, m: number;
      if (tz) {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
        }).formatToParts(now);
        y = Number(parts.find((p) => p.type === 'year')?.value || 0);
        m = Number(parts.find((p) => p.type === 'month')?.value || 1);
      } else {
        y = now.getUTCFullYear();
        m = now.getUTCMonth() + 1;
      }
      const start = dateAtLocalMidnight(y, m, 1, tz);
      return { startDate: start, endDate: endOfTodayInZone(tz), timezone: tz };
    }
  }
}

/**
 * Async entry point. Resolves timezone from request context if not provided,
 * then computes the inclusive `PeriodRange` for the query.
 *
 * Returns `null` if no filter applies (caller can skip the where clause).
 */
export async function parsePeriodRange(
  query: PeriodQuery,
  opts: PeriodFilterOptions = {},
): Promise<PeriodRange | null> {
  // Fast path — if nothing to filter on, skip TZ resolution entirely.
  const hasExplicitDates = !!(query.date_from && query.date_to);
  const hasPreset = !!query.date_preset;
  if (!hasExplicitDates && !hasPreset) return null;

  const tz = await resolvePeriodTimezone(opts);
  return parsePeriodRangeSync(query, tz);
}

/**
 * Convenience: returns a `{ gte, lte }` object (with each side possibly
 * `undefined`) ready to spread into a Prisma `where.<field>`. If no filter
 * applies the result is `{}` — safe to spread unconditionally.
 */
export async function buildPeriodWhere(
  query: PeriodQuery,
  opts: PeriodFilterOptions = {},
): Promise<{ gte?: Date; lte?: Date }> {
  const range = await parsePeriodRange(query, opts);
  if (!range) return {};
  return { gte: range.startDate, lte: range.endDate };
}

/**
 * Returns the previous period of the same length. Used for "vs previous"
 * comparisons in analytics. UTC-safe.
 */
export function getPreviousPeriod(
  startDate: Date,
  endDate: Date,
): { previousStartDate: Date; previousEndDate: Date } {
  const duration = endDate.getTime() - startDate.getTime();
  const previousEndDate = new Date(startDate.getTime() - 1);
  const previousStartDate = new Date(previousEndDate.getTime() - duration);
  return { previousStartDate, previousEndDate };
}

/**
 * Bucket key formatter (e.g. "2026-04", "2026-04-11") used by analytics
 * time-series. Moved here verbatim from `analytics/utils/date.util.ts` so
 * all period-related helpers live in one place.
 */
export function formatPeriodFromDate(
  date: Date,
  granularity: Granularity,
  timezone?: string,
): string {
  const fmt = timezone
    ? new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hour12: false,
      })
    : null;

  let y: string, m: string, d: string, h: string;
  if (fmt) {
    const parts = fmt.formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
    y = get('year');
    m = get('month');
    d = get('day');
    h = get('hour');
  } else {
    y = String(date.getUTCFullYear());
    m = String(date.getUTCMonth() + 1).padStart(2, '0');
    d = String(date.getUTCDate()).padStart(2, '0');
    h = String(date.getUTCHours()).padStart(2, '0');
  }

  switch (granularity) {
    case Granularity.HOUR:
      return `${y}-${m}-${d}T${h}:00`;
    case Granularity.DAY:
      return `${y}-${m}-${d}`;
    case Granularity.WEEK:
      return `${y}-${m}-${d}`;
    case Granularity.MONTH:
      return `${y}-${m}`;
    case Granularity.YEAR:
      return `${y}`;
    default:
      return `${y}-${m}-${d}`;
  }
}

/** Returns the SQL `DATE_TRUNC` interval for a given granularity. */
export function getDateTruncInterval(granularity: Granularity): string {
  switch (granularity) {
    case Granularity.HOUR:
      return 'hour';
    case Granularity.DAY:
      return 'day';
    case Granularity.WEEK:
      return 'week';
    case Granularity.MONTH:
      return 'month';
    case Granularity.YEAR:
      return 'year';
    default:
      return 'day';
  }
}
