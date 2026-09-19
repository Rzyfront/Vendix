import { IsDateString, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { BaseReportQueryDto } from '@common/reports/base-report-query.dto';

/**
 * Filter DTO for the "Inventario por Proveedor" report (QUI-550).
 *
 * Extends {@link BaseReportQueryDto} inheriting `date_from`, `date_to`, `page`, `limit`.
 */
export class InventoryBySupplierQueryDto extends BaseReportQueryDto {
  /** Optional snapshot date (YYYY-MM-DD), defaults to date_to or today in store TZ. */
  @IsOptional()
  @IsDateString()
  as_of?: string;

  /** Optional filter by supplier ID. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  supplier_id?: number;

  /** Optional text search across supplier name, document, or code. */
  @IsOptional()
  @IsString()
  search?: string;
}
