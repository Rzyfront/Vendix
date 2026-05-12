import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * S2.1 — Coupon redemption code validation request.
 *
 * Code is normalized server-side (trim) and looked up against
 * subscription_plans.redemption_code (UNIQUE, case-sensitive).
 */
export class ValidateCouponDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;
}
