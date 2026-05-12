import { IsOptional, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query DTO for org-wide stock level reads.
 *
 * - `store_id` is OPTIONAL when operating_scope=ORGANIZATION (acts as a
 *   breakdown filter). It is REQUIRED when operating_scope=STORE — the service
 *   asks `OrganizationPrismaService.getScopedWhere` to enforce that contract.
 * - `product_id`, `product_variant_id`, `location_id` are pure filters.
 */
export class OrgStockLevelQueryDto {
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
  location_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  limit?: number;
}
