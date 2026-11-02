import type { BusinessHours } from '../../../../../../core/models/store-settings.interface';

/**
 * Visible time range of the reservation calendar grids, in minutes since
 * midnight (e.g. `{ start: 540, end: 1080 }` = 09:00–18:00).
 */
export interface CalendarRange {
  start: number;
  end: number;
}

/**
 * Legacy hardcoded grid (07:00–22:00). Used only when the store has no
 * usable `business_hours` for the visible days — the grid still expands to
 * fit every booking (see `expandRangeToSpans`).
 */
export const DEFAULT_CALENDAR_RANGE: CalendarRange = { start: 7 * 60, end: 22 * 60 };

/** `business_hours` day keys indexed by `Date.getDay()` (0 = Sunday). */
const DAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export function dayKeyFor(date: Date): string {
  return DAY_KEYS[date.getDay()];
}

/**
 * Parses `"HH:mm"` (also `"H:mm"`, `"HH:mm:ss"` and ISO-ish `"HH:mm:ss.sssZ"`)
 * into minutes since midnight. Returns `null` for `'closed'`, empty or
 * malformed values.
 */
export function parseClockToMinutes(value: string | null | undefined): number | null {
  if (!value || value === 'closed') return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Union of the open/close spans of a single `business_hours` day entry:
 * the top-level `open`/`close` plus every `blocks[]` entry, skipping
 * `'closed'` and degenerate (end ≤ start) spans. Overnight spans
 * (close ≤ open, e.g. 18:00–02:00) are not representable on a single-day
 * grid and are ignored. Returns `null` when the day is closed/unknown.
 */
export function storeRangeForDay(day: BusinessHours | null | undefined): CalendarRange | null {
  if (!day) return null;
  let start: number | null = null;
  let end: number | null = null;
  const push = (open: string, close: string): void => {
    const s = parseClockToMinutes(open);
    const e = parseClockToMinutes(close);
    if (s == null || e == null || e <= s) return;
    start = start == null ? s : Math.min(start, s);
    end = end == null ? e : Math.max(end, e);
  };
  push(day.open, day.close);
  for (const block of day.blocks ?? []) push(block.open, block.close);
  if (start == null || end == null) return null;
  return { start, end };
}

/**
 * Union of the store ranges across the given dates (one date for the day
 * view, seven for the week view). Returns `null` when no date has usable
 * hours (all closed or no settings) so the caller can fall back to
 * `DEFAULT_CALENDAR_RANGE`.
 */
export function storeRangeForDates(
  businessHours: Record<string, BusinessHours> | null | undefined,
  dates: Date[],
): CalendarRange | null {
  if (!businessHours) return null;
  let start: number | null = null;
  let end: number | null = null;
  for (const date of dates) {
    const dayRange = storeRangeForDay(businessHours[dayKeyFor(date)]);
    if (!dayRange) continue;
    start = start == null ? dayRange.start : Math.min(start, dayRange.start);
    end = end == null ? dayRange.end : Math.max(end, dayRange.end);
  }
  if (start == null || end == null) return null;
  return { start, end };
}

/**
 * Expands the range so every span fits inside it — no booking is ever
 * hidden outside the grid, even when it was forced outside store hours
 * (staff override) or the store has no hours configured. Spans with an
 * unparseable start are ignored; a missing/degenerate end still pulls the
 * start into view.
 */
export function expandRangeToSpans(
  range: CalendarRange,
  spans: Array<{ start: string; end: string }>,
): CalendarRange {
  let { start, end } = range;
  for (const span of spans) {
    const spanStart = parseClockToMinutes(span.start);
    if (spanStart == null) continue;
    const spanEnd = parseClockToMinutes(span.end);
    const effectiveEnd = spanEnd != null && spanEnd > spanStart ? spanEnd : spanStart;
    if (spanStart < start) start = spanStart;
    if (effectiveEnd > end) end = effectiveEnd;
  }
  return { start, end };
}

/**
 * Snaps the range to the grid step (start floored, end ceiled) so the
 * first/last grid lines land on slot boundaries. Guarantees `end > start`.
 */
export function snapRangeToStep(range: CalendarRange, stepMinutes: number): CalendarRange {
  const step = stepMinutes > 0 ? stepMinutes : 30;
  const start = Math.max(0, Math.floor(range.start / step) * step);
  let end = Math.ceil(range.end / step) * step;
  if (end <= start) end = start + step;
  return { start, end: Math.min(end, 24 * 60) };
}

/**
 * Full resolution: store hours for the visible dates (or the legacy
 * 07:00–22:00 fallback), expanded to fit every booking, snapped to step.
 */
export function resolveCalendarRange(
  businessHours: Record<string, BusinessHours> | null | undefined,
  dates: Date[],
  spans: Array<{ start: string; end: string }>,
  stepMinutes: number,
): CalendarRange {
  const store = storeRangeForDates(businessHours, dates) ?? { ...DEFAULT_CALENDAR_RANGE };
  return snapRangeToStep(expandRangeToSpans(store, spans), stepMinutes);
}

/** `"HH:mm"` grid labels from `startMin` to `endMin` (inclusive) every step. */
export function generateTimeSlots(startMin: number, endMin: number, stepMinutes: number): string[] {
  const step = stepMinutes > 0 ? stepMinutes : 30;
  const slots: string[] = [];
  for (let t = startMin; t <= endMin; t += step) {
    const h = Math.floor(t / 60);
    const m = t % 60;
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
  return slots;
}

/**
 * Clamps a block's raw grid geometry to the visible [0, 100] range so
 * overlay spans that stick out past store hours (e.g. a red
 * "unavailable" span computed against the legacy 07:00–22:00 window)
 * trim to the grid instead of painting over the header. Bookings always
 * fit (the range expands to them), so this is a no-op for them.
 */
export function clampBlockTop(rawTop: number, rawHeight: number): number {
  if (!isFinite(rawTop) || !isFinite(rawHeight)) return 0;
  return Math.min(Math.max(rawTop, 0), 100);
}

export function clampBlockHeight(rawTop: number, rawHeight: number): number {
  if (!isFinite(rawTop) || !isFinite(rawHeight)) return 0;
  const top = Math.min(Math.max(rawTop, 0), 100);
  const bottom = Math.min(Math.max(rawTop + rawHeight, 0), 100);
  return Math.max(bottom - top, 0);
}
