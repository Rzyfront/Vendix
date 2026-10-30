import { BadRequestException } from '@nestjs/common';
import { localCivil } from '@common/utils/store-timezone.util';

/**
 * QUI-966 (S4) — single source of the date/time rules every booking entry
 * point (create, hold, reschedule, reschedule requests, ecommerce DTOs) must
 * enforce. Pure helpers: callers resolve the store timezone and business
 * hours and pass them in.
 */

/** Civil date only: `YYYY-MM-DD`, no time and no offset. */
export const CIVIL_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
/** Wall-clock `HH:mm` (00:00–23:59). */
export const TIME_HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface BookingSlotInput {
  date: string;
  start_time: string;
  end_time: string;
}

export type StoreHoursMap = Map<
  number,
  { start_time: string; end_time: string }
>;

const DAY_NAMES = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
];

/**
 * True when `value` is a plain `YYYY-MM-DD` that names a real calendar day
 * (`2026-02-30` is rejected instead of rolling over to March 2).
 */
export function isValidCivilDate(value: unknown): value is string {
  if (typeof value !== 'string' || !CIVIL_DATE_REGEX.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** End strictly after start, same day (no zero length, no crossing midnight). */
export function isValidTimeRange(start_time: unknown, end_time: unknown) {
  if (typeof start_time !== 'string' || typeof end_time !== 'string') {
    return false;
  }
  if (!TIME_HHMM_REGEX.test(start_time) || !TIME_HHMM_REGEX.test(end_time)) {
    return false;
  }
  return timeToMinutes(end_time) > timeToMinutes(start_time);
}

/** Day of week (0 = Sunday) of a civil date, independent of the server TZ. */
export function civilDayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** True when the slot start is already behind "now" in the store timezone. */
export function isSlotStartInPast(
  slot: Pick<BookingSlotInput, 'date' | 'start_time'>,
  timezone: string,
  now: Date = new Date(),
): boolean {
  const p = localCivil(now, timezone);
  const pad = (n: number) => String(n).padStart(2, '0');
  const nowKey = `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
  return `${slot.date} ${slot.start_time}` < nowKey;
}

/**
 * True when the slot already ENDED in the store timezone (`date end_time`
 * is behind "now"). This is the booking gate's notion of "in the past": a
 * slot in progress is still bookable, because POS charges first and creates
 * the booking right after (a 10:00 slot charged at 10:02 must be accepted).
 * The availability grid keeps using `isSlotStartInPast` for its listing.
 */
export function isSlotEndInPast(
  slot: Pick<BookingSlotInput, 'date' | 'end_time'>,
  timezone: string,
  now: Date = new Date(),
): boolean {
  return isSlotStartInPast(
    { date: slot.date, start_time: slot.end_time },
    timezone,
    now,
  );
}

/**
 * Rules that can NEVER be overridden: real civil date and end > start.
 * Throws 400 with a Spanish message.
 */
export function assertBookingSlotShape(slot: BookingSlotInput): void {
  if (!isValidCivilDate(slot.date)) {
    throw new BadRequestException(
      'La fecha de la reserva no es válida; usa el formato AAAA-MM-DD',
    );
  }
  if (!isValidTimeRange(slot.start_time, slot.end_time)) {
    throw new BadRequestException(
      'La hora de fin debe ser posterior a la hora de inicio el mismo día',
    );
  }
}

/**
 * Rules staff may override with `skip_availability_check`: the slot has not
 * already ended (store timezone) and falls inside the store business hours.
 * An empty `storeHours` map means the store never configured its hours, so
 * the window is not enforced (legacy fallback shared with availability).
 */
export function assertBookingSlotOpen(
  slot: BookingSlotInput,
  ctx: { timezone: string; storeHours: StoreHoursMap; now?: Date },
): void {
  if (isSlotEndInPast(slot, ctx.timezone, ctx.now)) {
    throw new BadRequestException(
      'No se puede reservar en una fecha u hora que ya pasó',
    );
  }
  if (ctx.storeHours.size === 0) return;

  const dayOfWeek = civilDayOfWeek(slot.date);
  const window = ctx.storeHours.get(dayOfWeek);
  if (!window) {
    throw new BadRequestException(
      `La tienda no atiende el día ${DAY_NAMES[dayOfWeek]}`,
    );
  }
  const start = timeToMinutes(slot.start_time);
  const end = timeToMinutes(slot.end_time);
  if (
    start < timeToMinutes(window.start_time) ||
    end > timeToMinutes(window.end_time)
  ) {
    throw new BadRequestException(
      `El horario solicitado está fuera del horario de atención (${window.start_time} - ${window.end_time})`,
    );
  }
}
