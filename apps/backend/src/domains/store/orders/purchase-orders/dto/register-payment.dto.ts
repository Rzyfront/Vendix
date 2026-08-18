import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

export class RegisterPaymentDto {
  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @IsDateString()
  payment_date: string;

  @IsString()
  @IsNotEmpty()
  payment_method: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * QUI-647 — id de la cuota del plan (`purchase_order_payment_schedules`)
   * que se está saldando con este pago. Opcional: si viene, el backend
   * marca la cuota como `status='paid'` dentro de la misma transacción
   * del pago, para que la tabla del detail deje de mostrarla como
   * "Programada" al refrescar. Sin este link, el schedule queda en
   * `planned` aunque el pago quede registrado (ver knowledge gap del
   * plan original: schema solo permitía `'planned' | 'materialized'`,
   * `'paid'` es un valor defensivo válido del varchar(20)).
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  payment_schedule_id?: number;
}
