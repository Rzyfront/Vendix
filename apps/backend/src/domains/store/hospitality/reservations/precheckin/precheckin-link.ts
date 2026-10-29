import { randomBytes } from 'crypto';
import { dateOnlyString } from '@common/utils/store-timezone.util';

/** Statuses whose online check-in link still works (stay ahead or in progress). */
export const PRECHECKIN_OPEN_STATUSES = ['tentative', 'confirmed', 'checked_in'];

/** Storefront path of the online check-in page. */
export const PRECHECKIN_PATH = 'pre-registro';

/** Unguessable link token (192 bits, URL-safe). */
export function newPrecheckinToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Hospitality Suite (H8.1) — the online check-in link works while the stay is
 * ahead or in progress: it expires once the guest checks out (or the stay is
 * cancelled / no-show) and, if nobody checks the guest out, after the
 * departure day in the store's calendar.
 */
export function precheckinLinkOpen(
  reservation: { status: string; departure_date: Date },
  storeToday: string,
): boolean {
  if (!PRECHECKIN_OPEN_STATUSES.includes(reservation.status)) return false;
  return storeToday <= dateOnlyString(reservation.departure_date);
}
