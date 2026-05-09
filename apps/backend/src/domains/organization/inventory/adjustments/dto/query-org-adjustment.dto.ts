import {
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';

export const ORG_ADJUSTMENT_TYPES = [
  'damage',
  'loss',
  'theft',
  'expiration',
  'count_variance',
  'manual_correction',
] as const;
export type OrgAdjustmentType = (typeof ORG_ADJUSTMENT_TYPES)[number];

export const ORG_ADJUSTMENT_STATUS = ['pending', 'approved'] as const;
export type OrgAdjustmentStatus = (typeof ORG_ADJUSTMENT_STATUS)[number];

/**
 * Query DTO for `/api/organization/inventory/adjustments` list endpoints.
 *
 * Reads are auto-scoped to `organization_id` by `OrganizationPrismaService`.
 * Optional `store_id` performs the per-store breakdown filter via
 * `inventory_locations.store_id` (adjustments themselves don't carry store_id).
 */
export class QueryOrgAdjustmentDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  limit?: number;

  /**
   * Pagination offset alias (when consumer prefers offset/limit over
   * page/limit). If both are passed, `offset` wins.
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  offset?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  store_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  location_id?: number;

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
  batch_id?: number;

  @IsOptional()
  @IsEnum(ORG_ADJUSTMENT_TYPES)
  type?: OrgAdjustmentType;

  /**
   * `pending` → no approver yet (approved_by_user_id IS NULL).
   * `approved` → approved_by_user_id IS NOT NULL.
   * The schema has no explicit status column, so this is mapped at query time.
   */
  @IsOptional()
  @IsEnum(ORG_ADJUSTMENT_STATUS)
  status?: OrgAdjustmentStatus;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  created_by_user_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  approved_by_user_id?: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  start_date?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  end_date?: Date;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(['created_at', 'approved_at', 'quantity_change'])
  sort_by?: 'created_at' | 'approved_at' | 'quantity_change';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sort_order?: 'asc' | 'desc';
}
