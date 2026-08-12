import { IsInt, IsOptional, IsString, IsArray, IsDateString, Min, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const COMMISSION_STATUSES = ['pending', 'accrued', 'paid', 'declined', 'reversed'] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

/**
 * Query params para listar las comisiones de un mecánico.
 * Usado por GET /store/users/:id/commissions
 */
export class ListEmployeeCommissionsDto {
  @ApiPropertyOptional({ description: 'Estados a filtrar (CSV). Default: todos.' })
  @IsOptional()
  @Type(() => String)
  @IsString()
  status?: string;  // CSV: "accrued,paid"

  @ApiPropertyOptional({ description: 'Fecha desde (inclusive). ISO 8601.' })
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @ApiPropertyOptional({ description: 'Fecha hasta (inclusive). ISO 8601.' })
  @IsOptional()
  @IsDateString()
  date_to?: string;

  @ApiPropertyOptional({ description: 'Página (1-based).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Resultados por página. Max 100.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

/**
 * Body para declinar una comisión.
 * Usado por POST /store/commissions/:id/decline
 */
export class DeclineCommissionDto {
  @ApiProperty({ description: 'Motivo de la declinación. Mínimo 3 chars. Obligatorio.' })
  @IsString()
  reason!: string;
}

/**
 * Body para marcar una comisión como pagada.
 * Usado por POST /store/commissions/:id/mark-paid
 */
export class MarkCommissionPaidDto {
  @ApiPropertyOptional({ description: 'Referencia del pago (transfer, cheque, etc.).' })
  @IsOptional()
  @IsString()
  payment_reference?: string;

  @ApiPropertyOptional({ description: 'Notas del pago.' })
  @IsOptional()
  @IsString()
  notes?: string;
}

/**
 * Query params para el resumen diario de comisiones.
 * Usado por GET /store/reservations/commissions/daily-summary
 */
export class DailyCommissionSummaryQueryDto {
  @ApiPropertyOptional({ description: 'Fecha del reporte (YYYY-MM-DD). Default: hoy.' })
  @IsOptional()
  @IsDateString()
  date?: string;
}