import { IsOptional } from 'class-validator';

/**
 * Every field is optional: absent = unchanged, `null` = remove it from the
 * panel (back to the environment fallback). Values are validated in the
 * service so the user gets a Spanish message for each rule.
 */
export class UpdateMessagingPricesDto {
  @IsOptional()
  sms_price_table?: Record<string, number> | null;

  @IsOptional()
  sms_max_price_usd?: number | null;

  @IsOptional()
  sms_max_price_margin?: number | null;

  @IsOptional()
  whatsapp_price_table?: Record<string, number> | null;

  @IsOptional()
  email_price_usd?: number | null;
}
