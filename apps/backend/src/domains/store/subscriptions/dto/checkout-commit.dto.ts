import {
  IsBoolean,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';
import { Type } from 'class-transformer';

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
}
