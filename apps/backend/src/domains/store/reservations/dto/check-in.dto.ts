import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * DTO for `POST /ecommerce/reservations/:id/check-in`.
 *
 * Allows the customer (authenticated via ecommerce JWT) to mark themselves
 * as physically present at the venue. Sets `bookings.checked_in_at` and
 * emits a `booking.checked_in` event with `source='customer'` for SSE
 * broadcast and queue recomputation.
 */
export class CheckInDto {
  /// Optional notes from the customer about their arrival (table #, parking, etc.).
  @IsOptional()
  @IsString()
  @MaxLength(500)
  arrival_notes?: string;
}
