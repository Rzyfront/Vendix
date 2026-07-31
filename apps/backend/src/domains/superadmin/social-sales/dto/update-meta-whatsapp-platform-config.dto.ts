import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateMetaWhatsappPlatformConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  app_id?: string;

  @IsOptional()
  @IsString()
  app_secret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  whatsapp_config_id?: string;

  @IsOptional()
  @IsString()
  verify_token?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  graph_version?: string;

  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  app_review_status?: 'pending' | 'approved' | 'rejected';

  @IsOptional()
  @IsBoolean()
  allow_dev_signup?: boolean;

  /**
   * Status of Vendix as a Meta Tech Partner (Access Verification).
   * - not_started: enrollment never initiated
   * - in_review: Access Verification form submitted, awaiting Meta
   * - approved: Vendix is officially a Tech Partner
   * - rejected: Meta rejected the enrollment
   */
  @IsOptional()
  @IsIn(['not_started', 'in_review', 'approved', 'rejected'])
  meta_tech_provider_status?:
    | 'not_started'
    | 'in_review'
    | 'approved'
    | 'rejected';

  /**
   * Status of Vendix business verification with Meta.
   * Mirrors what is shown in business.facebook.com/settings/security.
   */
  @IsOptional()
  @IsIn(['not_started', 'in_review', 'verified', 'rejected'])
  meta_business_verification_status?:
    | 'not_started'
    | 'in_review'
    | 'verified'
    | 'rejected';

  /**
   * Webhook URL Vendix exposes for the production Meta App.
   * Stored so the superadmin UI can show / copy it without
   * relying on env vars at request time.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  production_webhook_url?: string;
}
