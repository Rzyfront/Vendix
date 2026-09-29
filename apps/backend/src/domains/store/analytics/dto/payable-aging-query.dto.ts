import { IsDateString, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { BaseReportQueryDto } from '@common/reports/base-report-query.dto';

/**
 * Filter DTO for the "Cuentas por Pagar a Proveedores por Edades (Aging)" report (QUI-542).
 *
 * Extends {@link BaseReportQueryDto} inheriting `date_from`, `date_to`, `page`, `limit`.
 */
export class PayableAgingQueryDto extends BaseReportQueryDto {
  /**
   * Optional reference date for aging calculation (YYYY-MM-DD in store TZ).
   * Defaults to `date_to` (if provided) or current date in store TZ.
   */
  @IsOptional()
  @IsDateString()
  as_of?: string;

  /** Optional filter by supplier ID. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  supplier_id?: number;

  /** Optional text search across supplier name, document or code. */
  @IsOptional()
  @IsString()
  search?: string;
}
