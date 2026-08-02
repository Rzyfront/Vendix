import {
  IsBoolean,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BillingProfileDto } from './billing-profile.dto';

export class CheckoutCommitDto {
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

  // G8 — política de no-reembolso. El frontend marca este flag al confirmar
  // explícitamente el checkbox de aceptación. El backend valida y persiste
  // en subscription_invoices.metadata para auditoría.
  @IsBoolean()
  no_refund_acknowledged: boolean;

  @IsOptional()
  @IsISO8601()
  no_refund_acknowledged_at?: string;

  /**
   * S2.1 — Optional redemption code. When present the commit re-validates the
   * coupon server-side and applies the overlay (creates `promotional_applied`
   * event + invalidates the resolved-features cache) inside the same flow.
   */
  @IsOptional()
  @IsString()
  coupon_code?: string;

  /**
   * Fiscal identity of the paying organization. Vendix invoices subscriptions
   * electronically, so this is the DIAN *adquiriente*. Optional in the contract
   * because a renewal by an organization that already has a complete profile
   * does not need to resend it; the commit handler requires it when the profile
   * is incomplete and the plan actually charges.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => BillingProfileDto)
  billing_profile?: BillingProfileDto;
}
