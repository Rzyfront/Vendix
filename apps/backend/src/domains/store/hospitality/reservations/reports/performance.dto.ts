import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, Matches } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** H7.2 — period of the occupancy, ADR and RevPAR report (business days, inclusive). */
export class LodgingPerformanceQueryDto {
  @ApiPropertyOptional({ description: 'Primer día de negocio (YYYY-MM-DD). Por defecto, el 1 del mes en curso.' })
  @IsOptional()
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({ description: 'Último día incluido (YYYY-MM-DD). Por defecto y como máximo, hoy.' })
  @IsOptional()
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  to?: string;
}
