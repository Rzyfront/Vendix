import { dateOnlyString } from '@common/utils/store-timezone.util';

/** Storefront path of the stay rating page (same token as the online check-in). */
export const STAY_REVIEW_PATH = 'calificar-estadia';

/** `order_reviews.source` of a rating given from the stay link. */
export const STAY_REVIEW_SOURCE = 'stay_review';

/** Days after the departure day the guest can still rate the stay. */
export const STAY_REVIEW_DAYS = 30;

/**
 * Hospitality Suite (H8.5) — the rating link opens once the guest checked out
 * and works until `STAY_REVIEW_DAYS` after the departure day (store calendar).
 */
export function stayReviewOpen(
  reservation: { status: string; departure_date: Date },
  storeToday: string,
): boolean {
  if (reservation.status !== 'checked_out') return false;
  const last = new Date(`${dateOnlyString(reservation.departure_date)}T00:00:00.000Z`);
  last.setUTCDate(last.getUTCDate() + STAY_REVIEW_DAYS);
  return storeToday <= last.toISOString().slice(0, 10);
}
