export type ProductionDisposition = 'release' | 'waste';

/**
 * QUI-995 — what to suggest when a sale with an already COMPLETED production
 * order is cancelled. A made-to-order item (add-ons or notes such as a
 * dedication) cannot be resold, so it is suggested as waste; a plain one goes
 * back to sellable stock (release). It is a suggestion only: the operator may
 * pick the other one, and omitting it never blocks the cancellation.
 */
export function suggestProductionDisposition(
  lines: Array<{ notes?: string | null; order_item_options?: unknown[] | null }>,
): ProductionDisposition {
  const customized = lines.some(
    (l) => (l.order_item_options?.length ?? 0) > 0 || !!l.notes?.trim(),
  );
  return customized ? 'waste' : 'release';
}
