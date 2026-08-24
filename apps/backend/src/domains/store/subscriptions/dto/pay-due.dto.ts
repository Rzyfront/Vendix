import { IsInt, IsOptional, IsPositive, IsString, IsUrl } from 'class-validator';

/**
 * Body DTO for `POST store/subscriptions/checkout/pay-due`.
 * Allows optionally specifying a specific invoiceId (must belong to the store's
 * subscription) and a returnUrl for Wompi redirect.
 */
export class PayDueDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  invoiceId?: number;

  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  returnUrl?: string;
}
