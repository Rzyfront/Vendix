import { Booking, BookingStatus } from '../../interfaces/reservation.interface';

/**
 * Booking statuses that can become "expired" (no-shows) when their
 * `end_time` passes. Anything beyond pre-service (arriving/attending/
 * in_progress/completed) or terminal (cancelled/no_show) is never flagged.
 */
const EXPIRABLE_STATUSES: ReadonlySet<BookingStatus> = new Set([
  'pending',
  'confirmed',
] as BookingStatus[]);

/**
 * Grace period after `end_time` before a pre-service booking is flagged
 * as expired (no-show). Two hours matches typical booking-system behavior
 * — long enough to cover traffic / last-minute reschedules, short enough
 * that real no-shows surface the same day. Override per call if a
 * specific flow needs different behavior.
 */
export const DEFAULT_EXPIRATION_GRACE_MINUTES = 120;

/**
 * Tells whether the booking is past its grace window after `end_time`.
 * Used by both `CalendarWeekViewComponent` and `CalendarDayViewComponent`
 * to flag no-shows visually (paint them red).
 *
 * Returns false for any non-expirable status (cancelled, no_show, active
 * service states) so we don't double-flag bookings that already have a
 * terminal status or are actively being serviced.
 *
 * Note: `Booking.date` may arrive from the backend as either:
 *   - `"2026-07-21"` (plain YYYY-MM-DD)
 *   - `"2026-07-21T00:00:00.000Z"` (Prisma Date serialized to ISO)
 * `Booking.end_time` may arrive as `"08:40:00"`, `"08:40"`, or
 * `"08:40:00.000Z"`. The parser below normalizes all variants before
 * constructing the final Date.
 */
export function isBookingExpired(
  booking: Booking,
  now: Date,
  graceMinutes: number = DEFAULT_EXPIRATION_GRACE_MINUTES,
): boolean {
  if (!EXPIRABLE_STATUSES.has(booking.status)) {
    return false;
  }
  const endDateTime = parseEndDateTime(booking);
  if (!endDateTime) return false;
  const graceEnd = new Date(endDateTime.getTime() + graceMinutes * 60_000);
  return now > graceEnd;
}

/**
 * Builds a `Date` from `booking.date` + `booking.end_time`, accepting
 * the multiple shapes Prisma + JSON serialization can produce. Returns
 * `null` if the inputs can't be parsed (caller should treat as not-expired).
 */
function parseEndDateTime(booking: Booking): Date | null {
  // Normalize the date portion. `String(...)` handles the case where the
  // backend returned a JS Date (Prisma @db.Date) — in that case the
  // value gets coerced to its ISO string representation.
  const rawDate = String(booking.date);
  // Strip any time component if the date arrived as ISO timestamp.
  const dateStr = rawDate.split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return null;
  }

  // Normalize the time portion. Strip timezone marker and any seconds
  // we don't need (we only compare against current time, not store it).
  const rawTime = String(booking.end_time);
  // Take just the leading HH:mm[:ss] — anything after is timezone/format noise.
  const timeMatch = rawTime.match(/^(\d{2}:\d{2}(?::\d{2})?)/);
  if (!timeMatch) return null;
  const timeStr = timeMatch[1];

  // Construct a local-time Date. `new Date('YYYY-MM-DDTHH:mm:ss')` is
  // parsed as LOCAL time (per the ES spec) — no `Z`, so no UTC drift.
  const endDateTime = new Date(`${dateStr}T${timeStr}`);
  if (isNaN(endDateTime.getTime())) return null;
  return endDateTime;
}