import { IsBoolean, IsDateString, IsOptional } from 'class-validator';

/** Settings of the active public link (`null` clears the expiry). */
export class UpdatePublicLinkSettingsDto {
  @IsOptional()
  @IsBoolean()
  captcha_required?: boolean;

  @IsOptional()
  @IsDateString()
  expires_at?: string | null;
}
