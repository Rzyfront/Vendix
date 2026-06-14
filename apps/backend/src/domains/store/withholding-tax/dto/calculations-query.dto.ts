import { IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query params for the withholding calculations audit list
 * (`GET /store/withholding-tax/calculations`).
 *
 * Tenant context (organization_id / store_id) is derived from the request
 * context by the scoped Prisma service — never from the client.
 */
export class CalculationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  /** Fiscal year of the calculation (withholding_calculations.year). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(2000)
  year?: number;

  /** Calendar month 1-12; filtered via created_at range of the month/year. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  supplier_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  concept_id?: number;

  /**
   * Legal role of the withholding:
   *  - 'practiced' → tenant withheld a supplier (purchases).
   *  - 'suffered'  → a customer withheld the tenant (sales).
   */
  @IsOptional()
  @IsIn(['practiced', 'suffered'])
  role?: 'practiced' | 'suffered';
}
