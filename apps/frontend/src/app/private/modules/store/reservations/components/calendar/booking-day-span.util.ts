import { clipBookingToDay } from '../../../../../../shared/utils/schedule-window.util';

type DaySpanBooking = {
  date: string;
  end_date?: string | null;
  start_time: string;
  end_time: string;
};

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** `YYYY-MM-DD` of a local `Date` (the calendar works with local civil days). */
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Part of a booking drawn on `day` (A14): an overnight booking is clipped on
 * both days (start day until 24:00, end day from 00:00). A daytime booking
 * returns its own times unchanged.
 */
export function bookingDaySpan(
  booking: DaySpanBooking,
  day: string,
): { start: string; end: string } {
  const start = String(booking.start_time).slice(0, 5);
  const end = String(booking.end_time).slice(0, 5);
  const clipped = clipBookingToDay(
    { ...booking, date: String(booking.date), start_time: start, end_time: end },
    day,
  );
  if (!clipped) return { start, end };
  return {
    start: hhmm(clipped.startMin),
    end: clipped.endMin >= 1440 ? '24:00' : hhmm(clipped.endMin),
  };
}
