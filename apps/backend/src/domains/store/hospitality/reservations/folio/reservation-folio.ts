import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/** Order number of a folio: one per reservation, so unique per store. */
export function folioOrderNumber(reservation_number: string): string {
  return `F-${reservation_number}`;
}

/** Store-wide upper bound for "every night of the stay" (date-only column). */
export const WHOLE_STAY_BOUND = '9999-12-31';

/**
 * QUI-1063 — the draft POS order of a reservation's holder at $0 and its
 * folio (1:1). Born when the reservation is confirmed (or at check-in for a
 * reservation confirmed before this existed); the caller posts the nights.
 * No `order.created` is emitted: a draft folio order books nothing.
 */
export async function createReservationFolioInTx(
  tx: Tx,
  input: {
    store_id: number;
    reservation_id: number;
    reservation_number: string;
    customer_id: number;
    user_id: number | null;
    currency: string;
    now: Date;
  },
): Promise<{ folio_id: number; order_id: number }> {
  const order = await tx.orders.create({
    data: {
      store_id: input.store_id,
      created_by_user_id: input.user_id,
      customer_id: input.customer_id,
      order_number: folioOrderNumber(input.reservation_number),
      state: 'draft',
      channel: 'pos',
      currency: input.currency,
      subtotal_amount: 0,
      tax_amount: 0,
      shipping_cost: 0,
      discount_amount: 0,
      grand_total: 0,
      total_paid: 0,
      remaining_balance: 0,
      internal_notes: `Folio de la reserva ${input.reservation_number}`,
      updated_at: input.now,
    },
    select: { id: true },
  });
  const folio = await tx.lodging_folios.create({
    data: {
      store_id: input.store_id,
      reservation_id: input.reservation_id,
      order_id: order.id,
      opened_at: input.now,
    },
    select: { id: true },
  });
  return { folio_id: folio.id, order_id: order.id };
}
