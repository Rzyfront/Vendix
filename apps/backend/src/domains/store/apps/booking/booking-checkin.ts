import {
  PRECHECKIN_PATH,
  precheckinLinkOpen,
} from '../../hospitality/reservations/precheckin/precheckin-link';

/**
 * What the booking page offers the guest for the online check-in of one
 * reservation:
 * - `available`: confirmed (or in house) and inside the PMS window; fill it in.
 * - `completed`: the whole party is registered; the link still opens to review it.
 * - `not_confirmed`: the hold is waiting for its payment.
 * - `closed`: cancelled, no-show, checked out, or past the departure day.
 */
export type OnlineCheckinState =
  | 'available'
  | 'completed'
  | 'not_confirmed'
  | 'closed';

/** Statuses whose online check-in the booking page opens: paid stays only. */
const CHECKIN_STATUSES = ['confirmed', 'checked_in'];

/**
 * Same window as the PMS link (`precheckinLinkOpen`), narrowed to confirmed
 * stays: the brief asks for check-in once the reservation is confirmed, and
 * an unpaid web hold may still expire.
 */
export function onlineCheckinState(
  reservation: {
    status: string;
    departure_date: Date;
    precheckin_completed_at: Date | null;
  },
  storeToday: string,
): OnlineCheckinState {
  if (reservation.status === 'tentative') return 'not_confirmed';
  if (!CHECKIN_STATUSES.includes(reservation.status)) return 'closed';
  if (!precheckinLinkOpen(reservation, storeToday)) return 'closed';
  return reservation.precheckin_completed_at ? 'completed' : 'available';
}

/** Path of the PMS online check-in page on the current domain. */
export function onlineCheckinPath(token: string): string {
  return `/${PRECHECKIN_PATH}/${token}`;
}
