/** Mirrors getSettledOrderAmount in the backend payment validator. */
export const SETTLED_PAYMENT_STATES_FE: ReadonlySet<string> = new Set([
  'succeeded',
  'captured',
  'partially_refunded',
  'refunded',
]);
