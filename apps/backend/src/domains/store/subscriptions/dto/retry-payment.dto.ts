import { IsOptional, IsString, IsUrl } from 'class-validator';

/**
 * Bug 3 — Retry payment endpoint body. Stays minimal: the endpoint resolves
 * the store + the latest pending invoice from request context. The caller
 * may pass `returnUrl` to override the post-payment redirect (otherwise the
 * default subscription panel URL is used).
 */
export class RetryPaymentDto {
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  returnUrl?: string;
}
