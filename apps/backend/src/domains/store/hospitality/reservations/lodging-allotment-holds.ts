import { addDays } from './reservation-status';

/** Allotment of one room type, dates as `YYYY-MM-DD` (to_date = last night). */
export interface AllotmentHoldInput {
  customer_id: number;
  from_date: string;
  to_date: string;
  rooms: number;
  release_days: number;
}

/** Day the unbooked rooms of `night` return to public sale. */
export function allotmentReleaseDate(
  night: string,
  release_days: number,
): string {
  return addDays(night, -release_days);
}

/** Key of the rooms a customer booked on a night, for `consumed`. */
export const consumedKey = (customer_id: number, night: string) =>
  `${customer_id}:${night}`;

/**
 * Hospitality Suite (H2.5) — rooms of a type held out of public sale on each
 * night. Per customer: the rooms of its allotments still held that night
 * (`today` in the store's civil date is before the release date) minus the
 * rooms it already booked that night, never below 0. From the release date
 * on, the unbooked rooms are public again: the release is computed on read,
 * so it happens on time in every store's time zone without a job writing.
 * The buyer's own allotments are left out (`buyer_customer_id`): its sale
 * takes rooms from its allotment instead of from the public.
 */
export function allotmentHolds(input: {
  nights: string[];
  allotments: AllotmentHoldInput[];
  /** Rooms each customer booked per night, keyed by `consumedKey`. */
  consumed: Map<string, number>;
  today: string;
  buyer_customer_id?: number;
}): number[] {
  return input.nights.map((night) => {
    const heldByCustomer = new Map<number, number>();
    for (const a of input.allotments) {
      if (a.customer_id === input.buyer_customer_id) continue;
      if (night < a.from_date || night > a.to_date) continue;
      if (input.today >= allotmentReleaseDate(night, a.release_days)) continue;
      heldByCustomer.set(
        a.customer_id,
        (heldByCustomer.get(a.customer_id) ?? 0) + a.rooms,
      );
    }
    let held = 0;
    for (const [customer_id, rooms] of heldByCustomer) {
      held += Math.max(
        0,
        rooms - (input.consumed.get(consumedKey(customer_id, night)) ?? 0),
      );
    }
    return held;
  });
}
