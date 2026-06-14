import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';

export type SubscriptionFiscalEnvironment = 'test' | 'production';

export const PLATFORM_RESOLUTION_DOCUMENT_TYPES = [
  'sales_invoice',
  'support_document',
] as const;

export type PlatformResolutionDocumentType =
  (typeof PLATFORM_RESOLUTION_DOCUMENT_TYPES)[number];

export class UpsertSubscriptionFiscalConfigDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  platform_organization_id!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  accounting_entity_id!: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  invoice_resolution_id?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  dian_configuration_id?: number;

  @IsString()
  name!: string;

  @IsString()
  nit!: string;

  @IsOptional()
  @IsString()
  nit_dv?: string;

  @IsString()
  software_id!: string;

  @IsOptional()
  @IsString()
  software_pin?: string;

  @IsOptional()
  @IsString()
  test_set_id?: string;

  @IsIn(['test', 'production'])
  environment!: SubscriptionFiscalEnvironment;

  @IsBoolean()
  is_enabled!: boolean;

  @IsBoolean()
  auto_issue!: boolean;

  @IsOptional()
  @IsBoolean()
  confirm_production?: boolean;
}

export class SubscriptionFiscalQueryDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsIn(['test', 'production'])
  environment?: SubscriptionFiscalEnvironment;

  @IsOptional()
  @IsString()
  search?: string;
}

export class RetrySubscriptionFiscalDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class CreatePlatformResolutionDto {
  @IsString()
  @Length(1, 4)
  prefix!: string;

  @IsIn(PLATFORM_RESOLUTION_DOCUMENT_TYPES as unknown as string[])
  document_type!: PlatformResolutionDocumentType;

  @IsIn(['test', 'production'])
  environment!: SubscriptionFiscalEnvironment;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  rango_inicial!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  rango_final!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  technical_key?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  resolution_number?: string;

  @IsOptional()
  @IsISO8601()
  resolution_date?: string;

  @IsOptional()
  @IsISO8601()
  valid_from?: string;

  @IsOptional()
  @IsISO8601()
  valid_to?: string;
}

export class ListPlatformResolutionsQueryDto {
  @IsOptional()
  @IsIn(PLATFORM_RESOLUTION_DOCUMENT_TYPES as unknown as string[])
  document_type?: PlatformResolutionDocumentType;

  @IsOptional()
  @IsIn(['test', 'production'])
  environment?: SubscriptionFiscalEnvironment;

  @Type(() => Boolean)
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
