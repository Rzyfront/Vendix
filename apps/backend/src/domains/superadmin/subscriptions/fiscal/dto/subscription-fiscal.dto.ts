import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  TrimString,
  TrimTaxId,
} from '../../../../../common/decorators/trim-string.decorator';

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

  @TrimString()
  @IsString()
  @MaxLength(100)
  name!: string;

  // Dots and spaces are stripped; hyphens are NOT, so `900123456-8` fails the
  // digits-only guard instead of silently becoming a corrupt NIT.
  @TrimTaxId()
  @IsString()
  @Matches(/^\d+$/, { message: 'nit must contain only digits' })
  nit!: string;

  @IsOptional()
  @TrimString()
  @IsString()
  @Matches(/^\d$/, { message: 'nit_dv must be a single digit' })
  nit_dv?: string;

  // DIAN issues software_id and test_set_id as UUIDs. A pasted value with a
  // trailing space or a stray character is accepted by the DIAN endpoint and
  // then never classified, which is indistinguishable from a queue backlog.
  @TrimString()
  @IsUUID(undefined, { message: 'software_id must be the UUID issued by DIAN' })
  software_id!: string;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(100)
  software_pin?: string;

  @IsOptional()
  @TrimString()
  @IsUUID(undefined, { message: 'test_set_id must be the UUID issued by DIAN' })
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

/**
 * Partial update of a platform DIAN resolution.
 *
 * Every field is optional so the caller can send only what changed. What is
 * *legal* to change depends on whether DIAN numbers have already been consumed
 * — that rule lives in the service, not here, because it needs the stored row.
 */
export class UpdatePlatformResolutionDto {
  @IsOptional()
  @IsString()
  @Length(1, 4)
  prefix?: string;

  @IsOptional()
  @IsIn(PLATFORM_RESOLUTION_DOCUMENT_TYPES as unknown as string[])
  document_type?: PlatformResolutionDocumentType;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  rango_inicial?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  rango_final?: number;

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

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
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
