import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNotEmpty,
  MinLength,
  MaxLength,
} from 'class-validator';

/**
 * Wompi Phase 5 — payload sent by the frontend after the widget tokenizes a
 * card. Replaces the legacy `provider_token` shape: the frontend now collects
 * the short-lived `card_token` (tok_*) plus the acceptance tokens, and the
 * backend exchanges them for a long-lived `payment_source_id` via the Wompi
 * `/payment_sources` endpoint.
 */
export class TokenizePaymentMethodDto {
  /** Wompi widget short-lived card token (`tok_*`). */
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(512)
  card_token: string;

  /** Acceptance token shown to the user during widget tokenization. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  acceptance_token: string;

  /** Personal-data auth token shown to the user during widget tokenization. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  personal_auth_token: string;

  @IsString()
  @IsOptional()
  type?: string = 'card';

  @IsString()
  @IsOptional()
  last4?: string;

  @IsString()
  @IsOptional()
  brand?: string;

  @IsString()
  @IsOptional()
  expiry_month?: string;

  @IsString()
  @IsOptional()
  expiry_year?: string;

  @IsString()
  @IsOptional()
  card_holder?: string;

  @IsBoolean()
  @IsOptional()
  is_default?: boolean = false;
}
