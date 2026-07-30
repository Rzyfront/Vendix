import { IsDateString, IsString, IsOptional, IsBoolean, Matches } from 'class-validator';

export class RescheduleBookingDto {
  @IsDateString()
  date: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'start_time debe tener formato HH:mm',
  })
  start_time: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'end_time debe tener formato HH:mm',
  })
  end_time: string;

  /**
   * Cuando `true` y el pedido asociado a la booking está en estado
   * `cancelled`, el reschedule también lo reactiva (vuelve a `pending`).
   * Solo aplica al flujo ecommerce, donde el cliente puede querer
   * recuperar un pedido cancelado reagendando la cita. Default `false`
   * para preservar el comportamiento histórico del admin flow.
   */
  @IsOptional()
  @IsBoolean()
  reopen_order?: boolean;
}
