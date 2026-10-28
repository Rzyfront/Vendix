import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { daysBetweenDateStrings } from '@common/utils/store-timezone.util';

/** Longest stay a single reservation accepts (guards the per-night rows). */
export const MAX_STAY_NIGHTS = 365;

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** `YYYY-MM-DD` civil date → value for a `@db.Date` column (midnight UTC). */
export function dateOnlyToDb(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/**
 * Nights of a stay as `YYYY-MM-DD`: from arrival up to the night before
 * departure (the departure night is not occupied). Dates are store-civil
 * dates, so no timezone conversion applies.
 */
export function stayNights(arrival_date: string, departure_date: string): string[] {
  const count = daysBetweenDateStrings(arrival_date, departure_date);
  if (!(count >= 1)) {
    throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_DATES_001);
  }
  if (count > MAX_STAY_NIGHTS) {
    throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_DATES_002);
  }
  const start = dateOnlyToDb(arrival_date).getTime();
  return Array.from({ length: count }, (_, i) =>
    new Date(start + i * 86_400_000).toISOString().slice(0, 10),
  );
}

/** `2026-11-10` → `10-nov` (short date for messages). */
export function formatShortDate(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${day}-${MONTHS[month - 1]}`;
}
