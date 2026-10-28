import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, Matches } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** H3.9 — period of the "Servicios exentos" report (store civil dates, inclusive). */
export class VatExemptServicesQueryDto {
  @ApiPropertyOptional({ description: 'Primer día (YYYY-MM-DD). Por defecto, el 1 del mes en curso.' })
  @IsOptional()
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({ description: 'Último día incluido (YYYY-MM-DD). Por defecto, hoy.' })
  @IsOptional()
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  to?: string;
}
