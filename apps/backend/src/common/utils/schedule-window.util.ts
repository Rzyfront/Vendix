/**
 * Schedule windows that may cross midnight (S21) — shared pure kernel.
 *
 * Contract:
 *  - A block is `{ start_time, end_time }` in `HH:MM`.
 *  - `end <= start` means the block ends the NEXT day. `00:00-00:00` is 24 h.
 *    A close at `00:00` after a daytime start (e.g. 09:00-00:00) ends at the end
 *    of that same day.
 *  - A block belongs to the day it starts (A5): "open at 01:00 Saturday" is true
 *    when Friday has a block that runs past midnight.
 *  - Spans are expressed in minutes relative to 00:00 of the date under test, so
 *    `endMin` can exceed 1440 (overnight) and a spill from the previous day has
 *    `startMin` clipped to 0.
 *
 * Wall-clock to instant conversion is NOT done here: use `bookingInterval`,
 * which delegates to `zonedWallClockToUtc` (store-timezone.util).
 */
import { daysBetweenDateStrings, zonedWallClockToUtc } from './store-timezone.util';

export interface ClockWindow {
  start_time: string;
  end_time: string;
}

export interface Span {
  startMin: number;
  endMin: number;
}

const DAY_MIN = 1440;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isClockTime(value: unknown): value is string {
  return typeof value === 'string' && HHMM.test(value);
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** True when the block ends on the day after it starts. */
export function isOvernight(w: ClockWindow): boolean {
  return toMinutes(w.end_time) <= toMinutes(w.start_time) && !(w.end_time === '00:00' && w.start_time !== '00:00');
}

/** Span of a block in minutes from its own start day, `endMin` up to 2880. */
export function windowSpan(w: ClockWindow): Span {
  const startMin = toMinutes(w.start_time);
  let endMin = toMinutes(w.end_time);
  if (endMin <= startMin) endMin += DAY_MIN;
  return { startMin, endMin };
}

export function spansOverlap(a: Span, b: Span): boolean {
  return a.startMin < b.endMin && a.endMin > b.startMin;
}

const prevDay = (weekday: number) => (weekday + 6) % 7;
const nextDay = (weekday: number) => (weekday + 1) % 7;

/**
 * Own blocks of `weekday` plus the overnight spill of the previous weekday,
 * in minutes relative to 00:00 of `weekday`. The spill keeps only the part
 * after midnight (`startMin` clipped to 0).
 */
export function windowsForDate(byWeekday: Map<number, ClockWindow[]>, weekday: number): Span[] {
  const spans: Span[] = (byWeekday.get(weekday) ?? []).map(windowSpan);
  for (const w of byWeekday.get(prevDay(weekday)) ?? []) {
    const s = windowSpan(w);
    if (s.endMin > DAY_MIN) spans.push({ startMin: 0, endMin: s.endMin - DAY_MIN });
  }
  return spans.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
}

export function isOpenAt(byWeekday: Map<number, ClockWindow[]>, weekday: number, minuteOfDay: number): boolean {
  return windowsForDate(byWeekday, weekday).some((s) => minuteOfDay >= s.startMin && minuteOfDay < s.endMin);
}

function mergeSpans(spans: Span[]): Span[] {
  const merged: Span[] = [];
  for (const s of [...spans].sort((a, b) => a.startMin - b.startMin)) {
    const last = merged[merged.length - 1];
    if (last && s.startMin <= last.endMin) last.endMin = Math.max(last.endMin, s.endMin);
    else merged.push({ ...s });
  }
  return merged;
}

/**
 * Merged union of every span that covers `weekday` (minutes from its 00:00):
 * own blocks, the previous day's overnight spill (clipped to 0) and the next
 * day's own blocks shifted by +1440.
 */
export function coverageForDate(byWeekday: Map<number, ClockWindow[]>, weekday: number): Span[] {
  const spans = windowsForDate(byWeekday, weekday);
  for (const w of byWeekday.get(nextDay(weekday)) ?? []) {
    const s = windowSpan(w);
    spans.push({ startMin: s.startMin + DAY_MIN, endMin: s.endMin + DAY_MIN });
  }
  return mergeSpans(spans);
}

/**
 * Union coverage: true when [startMin, endMin) (relative to 00:00 of `weekday`,
 * `endMin` may exceed 1440) lies inside `coverageForDate`.
 */
export function coversSpan(byWeekday: Map<number, ClockWindow[]>, weekday: number, startMin: number, endMin: number): boolean {
  return coverageForDate(byWeekday, weekday).some((s) => startMin >= s.startMin && endMin <= s.endMin);
}

/** Intersection of one span with a list of spans (empty intersections dropped). */
export function intersectSpans(span: Span, list: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of list) {
    const startMin = Math.max(span.startMin, s.startMin);
    const endMin = Math.min(span.endMin, s.endMin);
    if (endMin > startMin) out.push({ startMin, endMin });
  }
  return out;
}

/** `YYYY-MM-DD` + n days (UTC calendar arithmetic, no timezone involved). */
export function addDaysToDateString(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** `end_date` to store for a booking: D+1 when it crosses midnight, null otherwise. */
export function bookingEndDateFor(date: string, startTime: string, endTime: string): string | null {
  return toMinutes(endTime) <= toMinutes(startTime) ? addDaysToDateString(date, 1) : null;
}

type DateLike = Date | string;

function dateOnly(value: DateLike): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

/**
 * Real instants of a booking in the store timezone.
 * End day = `end_date` ?? (end <= start ? date + 1 : date).
 */
export function bookingInterval(
  b: { date: DateLike; end_date?: DateLike | null; start_time: string; end_time: string },
  tz: string,
): { startAt: Date; endAt: Date } {
  const startDay = dateOnly(b.date);
  const endDay = b.end_date ? dateOnly(b.end_date) : bookingEndDateFor(startDay, b.start_time, b.end_time) ?? startDay;
  const at = (day: string, hhmm: string) => {
    const [y, mo, d] = day.split('-').map(Number);
    const [h, mi] = hhmm.split(':').map(Number);
    return zonedWallClockToUtc(y, mo, d, h, mi, 0, 0, tz);
  };
  return { startAt: at(startDay, b.start_time), endAt: at(endDay, b.end_time) };
}

/**
 * Booking as a span in wall-clock minutes relative to 00:00 of `refDate`
 * (`YYYY-MM-DD`), honoring `end_date` (or D+1 when end <= start). Pure calendar
 * arithmetic, so it needs no timezone.
 */
export function bookingMinuteSpan(
  b: { date: DateLike; end_date?: DateLike | null; start_time: string; end_time: string },
  refDate: string,
): Span {
  const startDay = dateOnly(b.date);
  const endDay = b.end_date ? dateOnly(b.end_date) : bookingEndDateFor(startDay, b.start_time, b.end_time) ?? startDay;
  return {
    startMin: daysBetweenDateStrings(refDate, startDay) * DAY_MIN + toMinutes(b.start_time),
    endMin: daysBetweenDateStrings(refDate, endDay) * DAY_MIN + toMinutes(b.end_time),
  };
}

export interface WeeklyBlock {
  day: number;
  start_time: string;
  end_time: string;
}

/**
 * Validates a week of blocks: HH:MM format and no overlap on spans, including
 * the previous day's overnight spill. Returns the first offending day or null.
 */
export function validateWeeklyBlocks(blocks: WeeklyBlock[]): { day: number; reason: 'format' | 'overlap' } | null {
  for (const b of blocks) {
    if (!isClockTime(b.start_time) || !isClockTime(b.end_time)) return { day: b.day, reason: 'format' };
  }
  const byDay = new Map<number, ClockWindow[]>();
  for (const b of blocks) {
    const list = byDay.get(b.day) ?? [];
    list.push({ start_time: b.start_time, end_time: b.end_time });
    byDay.set(b.day, list);
  }
  for (const [day, own] of byDay) {
    const spans: Span[] = own.map(windowSpan);
    for (const w of byDay.get(prevDay(day)) ?? []) {
      const s = windowSpan(w);
      if (s.endMin > DAY_MIN) spans.push({ startMin: 0, endMin: s.endMin - DAY_MIN });
    }
    for (let i = 0; i < spans.length; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        if (spansOverlap(spans[i], spans[j])) return { day, reason: 'overlap' };
      }
    }
  }
  return null;
}
