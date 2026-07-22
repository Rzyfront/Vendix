import { MenuNextAvailable } from './catalog.service';

/**
 * Consolidated, timezone-aware "next opening" label for menu (carta)
 * off-schedule items. Replaces the four duplicated formatters that existed
 * previously in `catalog.service.ts`, `menus-showcase.component.ts`,
 * `menus-page.component.ts` and `product-detail.component.ts` (each with a
 * subtle bug around TZ, day-of-week or delta calculation).
 *
 * The block-skeleton that consumes this lives in
 * `<app-next-available-notice>` (private/modules/ecommerce/components/next-available-notice).
 */

export interface NextAvailableDetailed {
  /** Human label e.g. "Sábado a las 08:00" — short noun suitable for inline. */
  label: string;
  /** Coarse countdown e.g. "hoy a las 19:30", "mañana", "en 5d 9h". */
  delta: string;
  /** Absolute Date of the next occurrence in `storeTimezone`. */
  target: Date;
}

/** Spanish day names aligned to JS Date.getDay() (0=Domingo..6=Sábado). */
const DAY_NAMES_ES = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
] as const;

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

interface TzWallClock {
  y: number;
  m: number;
  d: number;
  /** 0=Domingo..6=Sábado (JS getDay() convention). */
  dow: number;
  /** 0..23 (with the ICU h24 quirk normalized to 0..23). */
  h: number;
  mi: number;
}

/**
 * Decomposes `now` into the wall-clock components of `tz` using
 * `Intl.DateTimeFormat`. Falls back to the browser's local TZ components
 * if the store TZ is unknown (defensive — `Intl` rarely throws).
 */
export function getNowInTimezone(now: Date, tz: string | null | undefined): TzWallClock {
  if (!tz) {
    return {
      y: now.getFullYear(),
      m: now.getMonth() + 1,
      d: now.getDate(),
      dow: now.getDay(),
      h: now.getHours(),
      mi: now.getMinutes(),
    };
  }
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const lookup: Record<string, string> = {};
    for (const p of parts) lookup[p.type] = p.value;

    const y = parseInt(lookup['year'] ?? '', 10);
    const m = parseInt(lookup['month'] ?? '', 10);
    const d = parseInt(lookup['day'] ?? '', 10);
    const dow = WEEKDAY_MAP[lookup['weekday'] ?? ''] ?? now.getDay();
    // ICU quirk: midnight can come back as h=24 — normalize to 0.
    let h = parseInt(lookup['hour'] ?? '0', 10);
    if (h === 24) h = 0;
    const mi = parseInt(lookup['minute'] ?? '0', 10);

    return {
      y: Number.isFinite(y) ? y : now.getFullYear(),
      m: Number.isFinite(m) ? m : now.getMonth() + 1,
      d: Number.isFinite(d) ? d : now.getDate(),
      dow: Number.isFinite(dow) ? dow : now.getDay(),
      h: Number.isFinite(h) ? h : now.getHours(),
      mi: Number.isFinite(mi) ? mi : now.getMinutes(),
    };
  } catch {
    return {
      y: now.getFullYear(),
      m: now.getMonth() + 1,
      d: now.getDate(),
      dow: now.getDay(),
      h: now.getHours(),
      mi: now.getMinutes(),
    };
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Adds N calendar days to a (y/m/d) tuple and rolls over month/year. */
function addDays(y: number, m: number, d: number, days: number): { y: number; m: number; d: number } {
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
  };
}

function sameYmd(a: TzWallClock, b: TzWallClock): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d;
}

function isNextDay(prev: TzWallClock, next: TzWallClock): boolean {
  const n = addDays(prev.y, prev.m, prev.d, 1);
  return n.y === next.y && n.m === next.m && n.d === next.d;
}

/**
 * Builds an absolute Date for `(targetY, targetM, targetD, hh, mm)` interpreted
 * as a wall-clock in `tz`. Iteratively corrects the TZ offset — converges in
 * ≤3 iterations even across DST transitions because TZ offsets are piecewise
 * constant (change only at DST boundary moments, not between arbitrary dates).
 */
function wallClockToAbsoluteDate(
  targetY: number,
  targetM: number,
  targetD: number,
  hh: number,
  mm: number,
  tz: string | null | undefined,
  now: Date,
): Date {
  if (!tz) {
    // No TZ → fall back to a date interpreted as local. Defensive: caller
    // should always pass a TZ, but we don't want to throw.
    return new Date(targetY, targetM - 1, targetD, hh, mm, 0, 0);
  }
  let targetMs = now.getTime();
  for (let i = 0; i < 4; i++) {
    const wc = getNowInTimezone(new Date(targetMs), tz);
    const wcAsUtc = Date.UTC(wc.y, wc.m - 1, wc.d, wc.h, wc.mi);
    const desiredAsUtc = Date.UTC(targetY, targetM - 1, targetD, hh, mm);
    const correction = desiredAsUtc - wcAsUtc;
    if (correction === 0) break;
    targetMs += correction;
  }
  return new Date(targetMs);
}

/**
 * Formats a coarse countdown: "hoy a las HH:mm", "mañana", "en Xd Yh".
 * Drops minutes when hours present to keep the inline block compact.
 */
function formatDelta(
  now: Date,
  target: Date,
  here: TzWallClock,
  there: TzWallClock,
): string {
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return 'ahora';

  if (sameYmd(here, there)) {
    return `hoy a las ${pad2(there.h)}:${pad2(there.mi)}`;
  }
  if (isNextDay(here, there)) {
    return 'mañana';
  }

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);

  if (days >= 7) {
    // For wrap-weekly windows, prefer a friendlier "la próxima semana"
    // phrasing to keep the inline block small.
    return `la próxima semana`;
  }
  if (hours === 0) return `en ${days}d`;
  return `en ${days}d ${hours}h`;
}

/**
 * Returns a structured `{label, delta, target}` describing when a menu item
 * (or carta/section) with availability window `{day_of_week, start_time}` will
 * next be available in the store's timezone.
 *
 * - `next`: the `{day_of_week, start_time}` descriptor from the backend.
 * - `storeTimezone`: IANA tz (e.g. "America/Bogota"). May be null/undefined;
 *   the helper falls back to the browser's local clock in that case.
 * - `now`: optional reference instant (default `new Date()`). Tests pass a
 *   fixed Date to assert exact output.
 *
 * Returns `null` when `next` is `null`/undefined so callers can use
 * `@if (nextAvailableFor(...))` directly.
 */
export function formatNextAvailableDetailed(
  next: MenuNextAvailable | null | undefined,
  storeTimezone: string | null | undefined,
  now: Date = new Date(),
): NextAvailableDetailed | null {
  if (!next) return null;
  const dow = next.day_of_week;
  if (typeof dow !== 'number' || dow < 0 || dow > 6) return null;

  const [hStr, mStr] = (next.start_time ?? '').split(':');
  const tH = parseInt(hStr ?? '', 10);
  const tM = parseInt(mStr ?? '', 10);
  if (!Number.isFinite(tH) || !Number.isFinite(tM)) return null;

  const here = getNowInTimezone(now, storeTimezone);
  const hereMinutes = here.h * 60 + here.mi;
  const targetMinutes = tH * 60 + tM;

  // Weekly wrap: if today's slot already passed, jump to next week's same DOW.
  let dayDiff = (dow - here.dow + 7) % 7;
  if (dayDiff === 0 && hereMinutes >= targetMinutes) dayDiff = 7;

  const targetDate = addDays(here.y, here.m, here.d, dayDiff);
  const target = wallClockToAbsoluteDate(
    targetDate.y,
    targetDate.m,
    targetDate.d,
    tH,
    tM,
    storeTimezone,
    now,
  );
  const there = getNowInTimezone(target, storeTimezone);

  const dayName = DAY_NAMES_ES[dow] ?? '';
  const label = `${dayName} a las ${pad2(tH)}:${pad2(tM)}`;
  const delta = formatDelta(now, target, here, there);

  return { label, delta, target };
}

/**
 * Convenience: wraps `formatNextAvailableDetailed` returning a
 * `NextAvailableDetailed | null` that can be fed straight into
 * `<app-next-available-notice [next]="...">`. Useful in template expressions.
 */
export function nextAvailableFor(
  entity: { next_available: MenuNextAvailable | null | undefined } | null | undefined,
  storeTimezone: string | null | undefined,
  now: Date = new Date(),
): NextAvailableDetailed | null {
  if (!entity) return null;
  return formatNextAvailableDetailed(entity.next_available, storeTimezone, now);
}
