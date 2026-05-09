import {
  IsBoolean,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Org-level checkout commit DTO. Mirrors `CheckoutCommitDto` but requires
 * `storeId` because ORG_ADMIN tokens have no implicit store binding.
 */
export class OrgCheckoutCommitDto {
  @Type(() => Number)
  @IsNumber()
  storeId: number;

  @Type(() => Number)
  @IsNumber()
  planId: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  paymentMethodId?: number;

  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  returnUrl?: string;

  @IsBoolean()
  no_refund_acknowledged: boolean;

  @IsOptional()
  @IsISO8601()
  no_refund_acknowledged_at?: string;

  @IsOptional()
  @IsString()
  coupon_code?: string;
}
