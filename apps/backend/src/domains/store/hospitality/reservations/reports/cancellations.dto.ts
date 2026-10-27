import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, Matches } from 'class-validator';
import { LODGING_CHANNELS, LodgingChannel } from './reservation-channel';
import { LodgingLossType, LOSS_TYPES } from './cancellations.service';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** H7.4 — filters of the no-shows and cancellations report (screen and XLSX). */
export class LodgingCancellationsQueryDto {
  @ApiPropertyOptional({ description: 'Primer día (YYYY-MM-DD, zona de la tienda). Por defecto, el 1 del mes en curso.' })
  @IsOptional()
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({ description: 'Último día incluido (YYYY-MM-DD). Por defecto, hoy.' })
  @IsOptional()
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  to?: string;

  @ApiPropertyOptional({ enum: LODGING_CHANNELS, description: 'Canal de la reserva.' })
  @IsOptional()
  @IsIn(LODGING_CHANNELS)
  channel?: LodgingChannel;

  @ApiPropertyOptional({ enum: LOSS_TYPES, description: 'Cancelación o no-show.' })
  @IsOptional()
  @IsIn(LOSS_TYPES)
  type?: LodgingLossType;
}
