import { IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { payment_methods_type_enum } from '@prisma/client';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Body of `POST store/reservations/:id/deposit-decision` (S17). */
export class DepositDecisionDto {
  @IsIn(['retain', 'reschedule', 'refund', 'credit'], {
    message: 'La decisión del anticipo es retener, reagendar, devolver o dejar como saldo a favor',
  })
  action: 'retain' | 'reschedule' | 'refund' | 'credit';

  /** Idempotency key of the decision. */
  @IsString()
  @MaxLength(100)
  request_id: string;

  /** How a refund leaves: cash, bank_transfer... Defaults to cash. */
  @IsOptional()
  @IsIn(Object.values(payment_methods_type_enum), { message: 'El método de pago no es válido' })
  refund_method?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  store_payment_method_id?: number;

  @IsOptional()
  @IsDateString()
  new_date?: string;

  @IsOptional()
  @Matches(TIME, { message: 'La hora debe tener formato HH:MM' })
  new_start_time?: string;

  @IsOptional()
  @Matches(TIME, { message: 'La hora debe tener formato HH:MM' })
  new_end_time?: string;
}
