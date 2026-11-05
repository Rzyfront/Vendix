/**
 * A station "charges to book online" when it requires a deposit or a payment to book (A12/A17).
 * Such a booking goes through the hold plus payment page, never through the cart: the cart
 * would sell the slot without collecting that money. One rule, two shapes, so the checkout
 * guard and the availability the storefront reads cannot drift apart.
 */
export const STATION_CHARGES_ONLINE_WHERE = {
  OR: [{ deposit_policy: 'required' as const }, { booking_prepay_mode: { not: 'none' as const } }],
};

export function stationChargesOnline(station: {
  deposit_policy?: string | null;
  booking_prepay_mode?: string | null;
}): boolean {
  if (station.deposit_policy === 'required') return true;
  return station.booking_prepay_mode != null && station.booking_prepay_mode !== 'none';
}
