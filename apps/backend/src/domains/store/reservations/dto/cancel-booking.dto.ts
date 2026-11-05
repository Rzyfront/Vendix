import { IsIn, IsOptional } from 'class-validator';

/** Body of `PATCH store/reservations/:id/cancel`. Optional: no body keeps the old behavior. */
export class CancelBookingDto {
  /** What happens with the deposit left on the booking (A1). Credit by default. */
  @IsOptional()
  @IsIn(['refund', 'credit'], { message: 'El anticipo se devuelve o queda como saldo a favor' })
  leftover_action?: 'refund' | 'credit';

  @IsOptional()
  @IsIn(['cash', 'bank_transfer', 'card', 'wompi'])
  refund_method?: string;
}
