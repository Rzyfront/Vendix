import { lodging_reservation_status_enum } from '@prisma/client';

type Status = lodging_reservation_status_enum;

/**
 * Hospitality Suite (H1.2) — valid status changes of a reservation (same
 * shape as the bookings state machine). Check-in/out arrive in H1.4.
 */
export const LODGING_VALID_TRANSITIONS: Record<Status, Status[]> = {
  tentative: ['confirmed', 'cancelled'],
  confirmed: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['checked_out'],
  checked_out: [],
  cancelled: [],
  no_show: [],
};

/** Statuses that hold sold nights; leaving them releases the nights. */
export const NIGHT_HOLDING_STATUSES: Status[] = ['tentative', 'confirmed', 'checked_in'];

/** Statuses a reservation may leave to reach `to`. */
export function statusesThatCanReach(to: Status): Status[] {
  return (Object.keys(LODGING_VALID_TRANSITIONS) as Status[]).filter((from) =>
    LODGING_VALID_TRANSITIONS[from].includes(to),
  );
}

export function canTransition(from: Status, to: Status): boolean {
  return LODGING_VALID_TRANSITIONS[from].includes(to);
}

/** Default no-show time: next morning after the arrival day, store time. */
export const DEFAULT_NO_SHOW_TIME = '06:00';

/**
 * Confirmed reservations whose guest never arrived become no-show on the day
 * after arrival at `no_show_time` (store time), so late arrivals still check
 * in during the arrival night. Returns the exclusive upper bound of arrival
 * dates that are overdue now: arrivals before it are no-show.
 *
 * @param today store-civil date `YYYY-MM-DD`
 * @param nowTime store-civil time `HH:mm`
 */
export function noShowArrivalCutoff(
  today: string,
  nowTime: string,
  noShowTime: string = DEFAULT_NO_SHOW_TIME,
): string {
  const reached = nowTime >= noShowTime;
  // Reached: arrivals up to yesterday are overdue (< today).
  // Not yet: only arrivals up to the day before yesterday (< yesterday).
  return reached ? today : addDays(today, -1);
}

/** `YYYY-MM-DD` ± days. */
export function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}
