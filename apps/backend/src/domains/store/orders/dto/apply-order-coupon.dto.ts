import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * Payload for `PATCH /api/store/orders/:id/coupon`.
 *
 * - Non-empty `coupon_code`: validates and applies/replaces a coupon (or promotion code)
 *   on an editable unpaid order, recalculating line discounts, taxes, and grand total.
 * - `null` or empty string: removes the currently applied coupon and restores original totals.
 */
export class ApplyOrderCouponDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim().toUpperCase();
    return trimmed.length > 0 ? trimmed : null;
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(50)
  coupon_code?: string | null;
}
