import { IsDateString, IsString, IsOptional, IsBoolean, IsInt, Matches } from 'class-validator';
import { Type } from 'class-transformer';

export class RescheduleBookingDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  station_id?: number;

  /**
   * QUI-972: move the booking to another professional. When omitted the
   * booking keeps its provider. The provider must offer the service
   * and be active; availability is validated against this provider.
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  provider_id?: number;

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
