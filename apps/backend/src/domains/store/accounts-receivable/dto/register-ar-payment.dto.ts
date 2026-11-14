import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class RegisterArPaymentDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  payment_method?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

/**
 * QUI-893 — entrada interna del servicio. `payment_id` liga el abono a un
 * cobro que ya pasó por el gate de caja (listener de `payment.received` /
 * `installment_payment.received`); nunca viene del cliente HTTP, porque con él
 * el abono se salta el gate y el movimiento de caja.
 */
export interface RegisterArPaymentInput extends RegisterArPaymentDto {
  payment_id?: number;
}
