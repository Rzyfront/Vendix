import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_PICKUP_DAYS } from './pickup.service';

/** H7.3 — horizon of the pickup and forecast report. */
export class LodgingPickupQueryDto {
  @ApiPropertyOptional({ description: 'Fechas de estadía desde hoy (días). Por defecto 90.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PICKUP_DAYS)
  days?: number;
}
