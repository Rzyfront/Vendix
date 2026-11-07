/**
 * Absolute payment page to share with the customer. The backend answers
 * `payment_url` on the store's public domain (the admin app has no `/pagar`
 * route); the current origin is only a fallback for an older response.
 */
export function bookingPaymentUrl(link: { payment_url?: string | null; payment_path?: string | null } | null | undefined): string {
  if (link?.payment_url) return link.payment_url;
  return link?.payment_path ? `${window.location.origin}${link.payment_path}` : '';
}

/** "Serie 3/6" for an occurrence of a recurring series (S19); "Serie 3" when the size is unknown; '' otherwise. */
export function bookingSeriesLabel(
  item: { series_id?: number | null; series_index?: number | null; series?: { occurrences?: number | null } | null } | null | undefined,
): string {
  if (!item?.series_id) return '';
  const position = (item.series_index ?? 0) + 1;
  const size = item.series?.occurrences;
  return size ? `Serie ${position}/${size}` : `Serie ${position}`;
}
