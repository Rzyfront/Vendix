import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Org-level checkout preview DTO. ORG_ADMIN must declare which store the
 * checkout targets via `storeId` — the store_id can no longer be derived
 * from `RequestContext` because ORG tokens carry no store binding.
 */
export class OrgCheckoutPreviewDto {
  @Type(() => Number)
  @IsNumber()
  storeId: number;

  @Type(() => Number)
  @IsNumber()
  planId: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  coupon_code?: string;
}
