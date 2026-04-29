import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class UpdatePartnerBrandingDto {
  @IsOptional()
  @IsString()
  company_name?: string;

  @IsOptional()
  @IsEmail()
  support_email?: string;

  @IsOptional()
  @IsString()
  custom_domain?: string | null;

  @IsOptional()
  @Matches(/^#([0-9A-Fa-f]{3}){1,2}$/, {
    message: 'primary_color must be a valid hex color',
  })
  primary_color?: string;

  @IsOptional()
  @Matches(/^#([0-9A-Fa-f]{3}){1,2}$/, {
    message: 'secondary_color must be a valid hex color',
  })
  secondary_color?: string;

  @IsOptional()
  @IsString()
  logo_url?: string | null;

  @IsOptional()
  @IsBoolean()
  show_vendix_branding?: boolean;
}

export interface BrandingConfig {
  company_name: string;
  support_email: string;
  custom_domain: string | null;
  primary_color: string;
  secondary_color: string;
  logo_url: string | null;
  show_vendix_branding: boolean;
}

export const DEFAULT_BRANDING: BrandingConfig = {
  company_name: '',
  support_email: '',
  custom_domain: null,
  primary_color: '#3B82F6',
  secondary_color: '#10B981',
  logo_url: null,
  show_vendix_branding: true,
};
