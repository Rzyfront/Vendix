/**
 * Shared date utilities for analytics services.
 * All date operations respect the user's timezone when provided (via
 * `Intl.DateTimeFormat`), falling back to UTC for legacy callers.
 */
import { DatePreset, Granularity } from '../dto/analytics-query.dto';

/** Offset en ms entre UTC y la zona dada en el instante `date`. */
function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = date.toLocaleString('en-US', { timeZone: timezone });
  return new Date(tzStr).getTime() - new Date(utcStr).getTime();
}

/**
 * Construye un `Date` UTC que representa el instante local dado
 * (año/mes/día/hora/minuto/segundo) interpretado en la `timezone`.
 */
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
  // Ajustamos por el offset real de la zona en ese instante
  return new Date(naive - getTimezoneOffsetMs(new Date(naive), timezone));
}

/** "Ahora" interpretado en la zona (o UTC si no hay zona). */
function nowInZone(timezone?: string): Date {
  return new Date();
}

/** Inicio del día actual en la zona (00:00:00.000 local). */
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
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value || 0);
  return localDateToUTC(
    get('year'),
    get('month'),
    get('day'),
    0,
    0,
    0,
    timezone,
  );
}

/** Fin del día actual en la zona (23:59:59.999 local). */
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
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value || 0);
  // sumamos 24h - 1ms al inicio del día
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

/** Suma/resta días a un Date (UTC-safe). */
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Construye un Date en zona local para año/mes/día dados. */
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

export function formatPeriodFromDate(
  date: Date,
  granularity: Granularity,
  timezone?: string,
): string {
  // Si hay timezone, formateamos en esa zona; si no, UTC.
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

export function parseDateRange(query: {
  date_from?: string;
  date_to?: string;
  date_preset?: DatePreset;
  timezone?: string;
}): { startDate: Date; endDate: Date } {
  const tz = query.timezone;

  if (query.date_from && query.date_to) {
    // Si hay timezone, interpretamos date_from/date_to como fechas locales
    // en esa zona (00:00:00 local del día 'date_from' hasta 23:59:59.999 local del día 'date_to')
    if (tz) {
      const [yf, mf, df] = query.date_from.split('-').map(Number);
      const [yt, mt, dt] = query.date_to.split('-').map(Number);
      const start = dateAtLocalMidnight(yf, mf, df, tz);
      const end = dateAtLocalMidnight(yt, mt, dt, tz);
      // end = fin del día local
      return {
        startDate: start,
        endDate: new Date(end.getTime() + 24 * 60 * 60 * 1000 - 1),
      };
    }
    // Fallback UTC (legacy)
    const endDate = new Date(query.date_to);
    endDate.setUTCHours(23, 59, 59, 999);
    return {
      startDate: new Date(query.date_from),
      endDate,
    };
  }

  const todayStart = startOfTodayInZone(tz);

  switch (query.date_preset) {
    case DatePreset.TODAY:
      return { startDate: todayStart, endDate: endOfTodayInZone(tz) };
    case DatePreset.YESTERDAY: {
      const yesterdayStart = addDays(todayStart, -1);
      return { startDate: yesterdayStart, endDate: addDays(todayStart, -1) };
    }
    case DatePreset.THIS_WEEK: {
      // Lunes de esta semana (en la zona horaria del usuario)
      const dow = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday: 'short',
      }).formatToParts(todayStart);
      const weekdayMap: Record<string, number> = {
        Mon: 0,
        Tue: 1,
        Wed: 2,
        Thu: 3,
        Fri: 4,
        Sat: 5,
        Sun: 6,
      };
      const dayIdx = weekdayMap[dow.find((p) => p.type === 'weekday')?.value || 'Mon'] || 0;
      const weekStart = addDays(todayStart, -dayIdx);
      return { startDate: weekStart, endDate: endOfTodayInZone(tz) };
    }
    case DatePreset.LAST_WEEK: {
      const dow = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday: 'short',
      }).formatToParts(todayStart);
      const weekdayMap: Record<string, number> = {
        Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
      };
      const dayIdx = weekdayMap[dow.find((p) => p.type === 'weekday')?.value || 'Mon'] || 0;
      const thisWeekStart = addDays(todayStart, -dayIdx);
      const lastWeekStart = addDays(thisWeekStart, -7);
      const lastWeekEnd = addDays(thisWeekStart, -1);
      return { startDate: lastWeekStart, endDate: lastWeekEnd };
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
      const lastMonthEnd = dateAtLocalMidnight(y, m, 0, tz); // día 0 = último día del mes anterior
      // end = fin del día del último día del mes anterior
      return {
        startDate: lastMonthStart,
        endDate: new Date(lastMonthEnd.getTime() + 24 * 60 * 60 * 1000 - 1),
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
      return { startDate: start, endDate: endOfTodayInZone(tz) };
    }
  }
}

export function getPreviousPeriod(
  startDate: Date,
  endDate: Date,
): { previousStartDate: Date; previousEndDate: Date } {
  const duration = endDate.getTime() - startDate.getTime();
  const previousEndDate = new Date(startDate.getTime() - 1);
  const previousStartDate = new Date(previousEndDate.getTime() - duration);
  return { previousStartDate, previousEndDate };
}

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
