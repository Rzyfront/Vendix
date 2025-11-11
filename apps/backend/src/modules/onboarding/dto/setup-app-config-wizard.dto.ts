import {
  IsString,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsHexColor,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum AppType {
  ORG_ADMIN = 'ORG_ADMIN',
  STORE_ADMIN = 'STORE_ADMIN',
}

export class SetupAppConfigWizardDto {
  @ApiProperty({
    example: 'ORG_ADMIN',
    enum: AppType,
    description: 'Type of application',
  })
  @IsEnum(AppType)
  app_type: AppType;

  @ApiProperty({
    example: '#3B82F6',
    description: 'Primary brand color (hex)',
  })
  @IsHexColor()
  primary_color: string;

  @ApiProperty({
    example: '#10B981',
    description: 'Secondary brand color (hex)',
  })
  @IsHexColor()
  secondary_color: string;

  @ApiProperty({
    example: false,
    description: 'Whether to use custom domain',
  })
  @IsBoolean()
  use_custom_domain: boolean;

  @ApiPropertyOptional({
    example: 'tienda.micomercio.com',
    description: 'Custom domain (if use_custom_domain is true)',
  })
  @ValidateIf((o) => o.use_custom_domain === true)
  @IsString()
  @MaxLength(255)
  custom_domain?: string;

  @ApiPropertyOptional({
    example: 'mi-empresa-123.vendix.com',
    description: 'Auto-generated subdomain',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subdomain?: string;
}
