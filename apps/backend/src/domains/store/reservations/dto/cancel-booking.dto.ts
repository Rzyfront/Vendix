import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** Body of `PATCH store/reservations/:id/cancel`. Optional: no body keeps the old behavior. */
export class CancelBookingDto {
  /**
   * What happens with the money received on the booking (A1): `refund` returns it,
   * `credit` leaves it as the customer's credit, `retain` keeps it as "Gastos de reserva".
   * A booking with a received charge needs one (409 STATION_BOOKING_012); a booking with only a
   * deposit keeps its old default (credit).
   */
  @IsOptional()
  @IsIn(['refund', 'credit', 'retain'], {
    message: 'El dinero recibido se devuelve, queda como saldo a favor o se retiene',
  })
  leftover_action?: 'refund' | 'credit' | 'retain';

  @IsOptional()
  @IsIn(['cash', 'bank_transfer', 'card', 'wompi'])
  refund_method?: string;

  /** Idempotency key of the dialog: a double submit reaches the ledger as the same decision. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  request_id?: string;
}
