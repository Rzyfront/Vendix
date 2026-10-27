import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Change of one reservation room (H1.4): a physical room (assign or move)
 * and/or new stay dates (resize). Omitted fields keep their current value.
 */
export class RoomChangeDto {
  @ApiProperty({ required: false, description: 'Habitación física de destino.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  unit_id?: number;

  @ApiProperty({ required: false, description: 'Nueva llegada (YYYY-MM-DD).' })
  @IsOptional()
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  arrival_date?: string;

  @ApiProperty({ required: false, description: 'Nueva salida, exclusiva (YYYY-MM-DD).' })
  @IsOptional()
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  departure_date?: string;

  @ApiProperty({
    required: false,
    description: 'Motivo para forzar un cambio que rompe restricciones de venta (requiere permiso de tarifas).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  restriction_override_reason?: string;
}
