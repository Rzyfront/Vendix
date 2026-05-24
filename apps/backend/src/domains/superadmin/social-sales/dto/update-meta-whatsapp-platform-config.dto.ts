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
}
