/**
 * Schedule windows that may cross midnight (S21) — frontend mirror of the
 * backend kernel (`apps/backend/src/common/utils/schedule-window.util.ts`).
 *
 * Contract (identical to the backend):
 *  - A block is `{ start_time, end_time }` in `HH:MM`.
 *  - `end <= start` means the block ends the NEXT day. `00:00-00:00` is 24 h.
 *    A close at `00:00` after a daytime start (09:00-00:00) ends that same day.
 *  - A block belongs to the day it starts (A5).
 *
 * Pure functions, no Angular and no timezone math: wall-clock minutes only.
 */
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
  return (
    toMinutes(w.end_time) <= toMinutes(w.start_time) &&
    !(w.end_time === '00:00' && w.start_time !== '00:00')
  );
}

/** Span of a block in minutes from its own start day, `endMin` up to 2880. */
export function windowSpan(w: ClockWindow): Span {
  const startMin = toMinutes(w.start_time);
  let endMin = toMinutes(w.end_time);
  if (endMin <= startMin) endMin += DAY_MIN;
  return { startMin, endMin };
}

/** Duration of a block in minutes (overnight aware). */
export function windowMinutes(w: ClockWindow): number {
  const s = windowSpan(w);
  return s.endMin - s.startMin;
}

export function spansOverlap(a: Span, b: Span): boolean {
  return a.startMin < b.endMin && a.endMin > b.startMin;
}

/** `YYYY-MM-DD` + n days (UTC calendar arithmetic). */
export function addDaysToDateString(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** `end_date` of a booking: D+1 when it crosses midnight, null otherwise. */
export function bookingEndDateFor(
  date: string,
  startTime: string,
  endTime: string,
): string | null {
  return toMinutes(endTime) <= toMinutes(startTime)
    ? addDaysToDateString(date, 1)
    : null;
}

export interface WeeklyBlock {
  day: number;
  start_time: string;
  end_time: string;
}

/**
 * Validates a week of blocks: HH:MM format and no overlap, including the
 * previous day's overnight spill. Returns the first offending day or null.
 */
export function validateWeeklyBlocks(
  blocks: WeeklyBlock[],
): { day: number; reason: 'format' | 'overlap' } | null {
  for (const b of blocks) {
    if (!isClockTime(b.start_time) || !isClockTime(b.end_time)) {
      return { day: b.day, reason: 'format' };
    }
  }
  const byDay = new Map<number, ClockWindow[]>();
  for (const b of blocks) {
    const list = byDay.get(b.day) ?? [];
    list.push({ start_time: b.start_time, end_time: b.end_time });
    byDay.set(b.day, list);
  }
  for (const [day, own] of byDay) {
    const spans: Span[] = own.map(windowSpan);
    for (const w of byDay.get((day + 6) % 7) ?? []) {
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

/**
 * Part of a booking that falls on `day` (A14): an overnight booking is drawn
 * clipped on both days. Minutes are relative to 00:00 of `day`; null when the
 * booking does not touch it.
 */
export function clipBookingToDay(
  b: { date: string; end_date?: string | null; start_time: string; end_time: string },
  day: string,
): Span | null {
  const startDay = b.date.slice(0, 10);
  const endDay = b.end_date
    ? b.end_date.slice(0, 10)
    : (bookingEndDateFor(startDay, b.start_time, b.end_time) ?? startDay);
  const offset = (d: string) =>
    Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
  const startMin = offset(startDay) * DAY_MIN + toMinutes(b.start_time);
  const endMin = offset(endDay) * DAY_MIN + toMinutes(b.end_time);
  const start = Math.max(0, startMin);
  const end = Math.min(DAY_MIN, endMin);
  return end > start ? { startMin: start, endMin: end } : null;
}
