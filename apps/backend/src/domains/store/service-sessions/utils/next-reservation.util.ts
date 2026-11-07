/** Allocation states that block a station (same set `extend` checks for conflicts). */
export const ACTIVE_ALLOCATION_STATES = ['held', 'payment_pending', 'confirmed', 'in_service'];

export interface NextReservation {
  start_at: string;
  booking_id: number | null;
  customer_name: string | null;
}

/** Prisma `select` that carries the customer name of an allocation's booking. */
export const NEXT_RESERVATION_SELECT = {
  id: true,
  station_id: true,
  booking_id: true,
  start_at: true,
  booking: { select: { customer: { select: { first_name: true, last_name: true } } } },
} as const;

interface NextReservationRow {
  booking_id: number | null;
  start_at: Date;
  booking?: { customer?: { first_name: string | null; last_name: string | null } | null } | null;
}

export function toNextReservation(row: NextReservationRow | null | undefined): NextReservation | null {
  if (!row) return null;
  const customer = row.booking?.customer;
  const name = customer ? [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim() : '';
  return {
    start_at: row.start_at.toISOString(),
    booking_id: row.booking_id ?? null,
    customer_name: name || null,
  };
}
