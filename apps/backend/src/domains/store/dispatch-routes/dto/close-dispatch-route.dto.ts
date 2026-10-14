import { IsInt, IsNumber, Min, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class CloseDispatchRouteDto {
  @Transform(({ value }) => Number(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  declared_cash: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /** Sesión de caja abierta contra la que se asienta el recaudo de la ruta. */
  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  cash_register_session_id?: number;
}
