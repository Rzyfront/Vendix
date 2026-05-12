import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { inventory_transaction_type_enum } from '@prisma/client';

/**
 * Query DTO for `/organization/inventory/transactions` (read-only).
 *
 * Mirrors the filter shape from {@link OrgMovementQueryDto} so the org-level
 * transactions endpoint stays consistent with movements:
 *   - `store_id` is the optional breakdown filter when operating_scope=ORGANIZATION
 *     and is required (and forced) when operating_scope=STORE.
 *   - `start_date`/`end_date` filter `created_at` (DESC ordering by default).
 *   - `location_id` is intentionally omitted: `inventory_transactions` has no
 *     direct `location_id` column. Use `/organization/inventory/movements` for
 *     location breakdowns.
 */
export class QueryOrgTransactionsDto {
  /** Optional breakdown filter when operating_scope=ORGANIZATION; forced when STORE. */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  store_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  product_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  product_variant_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  user_id?: number;

  @IsOptional()
  @IsEnum(inventory_transaction_type_enum)
  type?: inventory_transaction_type_enum;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number;
}
