import { IsDateString, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query params para el resumen diario de comisiones dueño/mecánico.
 * Usado por el reporte al cierre del día. La fecha se interpreta en la
 * timezone de la tienda (vía RequestContextService en el controller).
 */
export class DailyCommissionSummaryQueryDto {
  @ApiPropertyOptional({ description: 'Fecha del reporte (YYYY-MM-DD). Default: hoy.' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ description: 'Filtrar por mecánico (service_providers.id).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  provider_id?: number;

  @ApiPropertyOptional({ description: 'Filtrar por servicio (products.id).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  product_id?: number;
}