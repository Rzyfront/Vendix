import { Booking } from '../../interfaces/reservation.interface';

/**
 * One "casilla" of the calendar grid: all bookings sharing the same
 * start time on a day. QUI-971 renders multi-booking groups as a
 * vertical stack so same-hour appointments never hide each other.
 */
export interface BookingStackGroup {
  /** Normalized "HH:mm" start shared by the group. */
  startKey: string;
  /** Group members, oldest first. */
  bookings: Booking[];
}

/** Groups bookings by start time ("HH:mm"), groups sorted by start. */
export function groupBookingsByStart(
  bookings: Booking[] | null | undefined,
): BookingStackGroup[] {
  const list = Array.isArray(bookings) ? bookings : [];
  const byStart = new Map<string, Booking[]>();
  for (const booking of list) {
    const key = String(booking?.start_time ?? '').slice(0, 5);
    const group = byStart.get(key);
    if (group) group.push(booking);
    else byStart.set(key, [booking]);
  }
  return [...byStart.entries()]
    .map(([startKey, group]) => ({
      startKey,
      bookings: [...group].sort((a, b) => (a?.id ?? 0) - (b?.id ?? 0)),
    }))
    .sort((a, b) => (a.startKey < b.startKey ? -1 : a.startKey > b.startKey ? 1 : 0));
}

/** "First Last" or 'Sin cliente' when the booking has no customer. */
export function bookingCustomerName(booking: Booking | null | undefined): string {
  const first = booking?.customer?.first_name?.trim() ?? '';
  const last = booking?.customer?.last_name?.trim() ?? '';
  const full = `${first} ${last}`.trim();
  return full || 'Sin cliente';
}

/** Provider display name, or '' when the booking has no provider. */
export function bookingProviderName(booking: Booking | null | undefined): string {
  return (
    booking?.provider?.display_name?.trim() ||
    booking?.provider?.employee?.first_name?.trim() ||
    ''
  );
}
