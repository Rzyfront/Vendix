import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsIn,
  MaxLength,
  MinLength,
  IsInt,
  IsBoolean,
  IsObject,
  IsArray,
  IsNumber,
  Min,
  Max,
  Length,
  Matches,
  IsDate,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  organization_mode_enum,
  organization_account_type_enum,
  organization_operating_scope_enum,
  fiscal_scope_enum,
} from '@prisma/client';

/**
 * Address-related fields that flow into `addresses` (one row per organization)
 * rather than into `organizations` or `organization_settings.settings`. They
 * are declared at the top level of the DTO so the super-admin modal can speak
 * a flat contract; the service merges them into the primary `addresses` row.
 */
export const ORG_ADDRESS_DTO_KEYS = [
  'address_line1',
  'address_line2',
  'city',
  'state_province',
  'country_code',
  'department_code',
  'municipality_code',
  'postal_code',
  'latitude',
  'longitude',
] as const;

/**
 * Top-level branding fields that physically live in
 * `organization_settings.settings` JSONB. They are declared at the top level
 * so the contract stays flat; the service merges them into the JSONB blob
 * with the top-level values preferred over `dto.settings.*` for the same key.
 */
export const ORG_JSONB_DTO_KEYS = [
  'color_primary',
  'color_secondary',
  'color_accent',
] as const;

/**
 * Every editable key in the super-admin organization DTO. Use this tuple to
 * derive contract typings or to drive generated forms without drifting from
 * the DTO.
 */
export const ORG_EDITABLE_DTO_KEYS = [
  'name',
  'slug',
  'legal_name',
  'tax_id',
  'document_type',
  'verification_digit',
  'person_type',
  'tax_regime',
  'fiscal_responsibilities',
  'ciiu_code',
  'email',
  'phone',
  'website',
  'logo_url',
  'description',
  'state',
  'mode',
  'account_type',
  'operating_scope',
  'fiscal_scope',
  'is_partner',
  'partner_settings',
  'partner_since',
  'fraud_blocked',
  'fraud_blocked_reason',
  'onboarding',
  'has_consumed_trial',
  ...ORG_ADDRESS_DTO_KEYS,
  ...ORG_JSONB_DTO_KEYS,
] as const;

export enum OrganizationState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
  ARCHIVED = 'archived',
  DRAFT = 'draft',
}

export enum OrganizationMode {
  PRODUCTION = 'production',
  DEMO = 'demo',
  TEST = 'test',
}

export { organization_account_type_enum, organization_operating_scope_enum, fiscal_scope_enum };

// Re-exports of the enums declared by Prisma so the contract file can re-export
// them with a friendlier name. The runtime values are the same string literals.
export type OrganizationAccountType = organization_account_type_enum;
export type OrganizationOperatingScope = organization_operating_scope_enum;
export type OrganizationFiscalScope = fiscal_scope_enum;

export class CreateOrganizationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  legal_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tax_id?: string;

  // ---- DIAN fiscal identity ----

  @IsOptional()
  @IsString()
  @MaxLength(10)
  document_type?: string;

  @IsOptional()
  @IsString()
  @Length(1, 1)
  verification_digit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  person_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tax_regime?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(10, { each: true })
  fiscal_responsibilities?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(10)
  ciiu_code?: string;

  // ---- scopes (enums Prisma) ----

  @IsOptional()
  @IsEnum(organization_account_type_enum)
  account_type?: organization_account_type_enum;

  @IsOptional()
  @IsEnum(organization_operating_scope_enum)
  operating_scope?: organization_operating_scope_enum;

  @IsOptional()
  @IsEnum(fiscal_scope_enum)
  fiscal_scope?: fiscal_scope_enum;

  // ---- partner (optional) ----

  @IsOptional()
  @IsBoolean()
  is_partner?: boolean;

  @IsOptional()
  @IsObject()
  partner_settings?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  partner_since?: Date;

  // ---- fraud (super-admin only) ----

  @IsOptional()
  @IsBoolean()
  fraud_blocked?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  fraud_blocked_reason?: string;

  // ---- onboarding ----

  @IsOptional()
  @IsBoolean()
  onboarding?: boolean;

  @IsOptional()
  @IsBoolean()
  has_consumed_trial?: boolean;

  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string;

  // The DTO used to require `@IsUrl()` here, but the field is the
  // S3 key after upload; treat it as an opaque string bounded by length.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  logo_url?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(OrganizationState)
  state?: OrganizationState = OrganizationState.ACTIVE;

  @IsOptional()
  @IsEnum(organization_mode_enum)
  mode?: organization_mode_enum;

  // ---- primary address fields (flow into addresses[]; service merges them) ----

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address_line1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address_line2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  state_province?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  country_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  department_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  municipality_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postal_code?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') return undefined;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : value;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : undefined;
    }
    return value;
  })
  @IsNumber({}, { message: 'latitude must be a valid number' })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') return undefined;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : value;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : undefined;
    }
    return value;
  })
  @IsNumber({}, { message: 'longitude must be a valid number' })
  @Min(-180)
  @Max(180)
  longitude?: number;

  // ---- branding aliases for the JSONB blob (organization_settings.settings) ----

  @IsOptional()
  @Matches(/^#[0-9A-F]{6}$/i, {
    message: 'color_primary must be a 6-digit hex color (e.g. #1A2B3C)',
  })
  color_primary?: string;

  @IsOptional()
  @Matches(/^#[0-9A-F]{6}$/i, {
    message: 'color_secondary must be a 6-digit hex color (e.g. #1A2B3C)',
  })
  color_secondary?: string;

  @IsOptional()
  @Matches(/^#[0-9A-F]{6}$/i, {
    message: 'color_accent must be a 6-digit hex color (e.g. #1A2B3C)',
  })
  color_accent?: string;
}

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  legal_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tax_id?: string;

  // ---- DIAN fiscal identity ----

  @IsOptional()
  @IsString()
  @MaxLength(10)
  document_type?: string;

  @IsOptional()
  @IsString()
  @Length(1, 1)
  verification_digit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  person_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tax_regime?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(10, { each: true })
  fiscal_responsibilities?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(10)
  ciiu_code?: string;

  // ---- scopes (enums Prisma) ----

  @IsOptional()
  @IsEnum(organization_account_type_enum)
  account_type?: organization_account_type_enum;

  @IsOptional()
  @IsEnum(organization_operating_scope_enum)
  operating_scope?: organization_operating_scope_enum;

  @IsOptional()
  @IsEnum(fiscal_scope_enum)
  fiscal_scope?: fiscal_scope_enum;

  // ---- partner (optional) ----

  @IsOptional()
  @IsBoolean()
  is_partner?: boolean;

  @IsOptional()
  @IsObject()
  partner_settings?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  partner_since?: Date;

  // ---- fraud (super-admin only) ----

  @IsOptional()
  @IsBoolean()
  fraud_blocked?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  fraud_blocked_reason?: string;

  // ---- onboarding ----

  @IsOptional()
  @IsBoolean()
  onboarding?: boolean;

  @IsOptional()
  @IsBoolean()
  has_consumed_trial?: boolean;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  logo_url?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(OrganizationState)
  state?: OrganizationState;

  @IsOptional()
  @IsEnum(organization_mode_enum)
  mode?: organization_mode_enum;

  // ---- primary address fields (flow into addresses[]; service merges them) ----

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address_line1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address_line2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  state_province?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  country_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  department_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  municipality_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postal_code?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') return undefined;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : value;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : undefined;
    }
    return value;
  })
  @IsNumber({}, { message: 'latitude must be a valid number' })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') return undefined;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : value;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : undefined;
    }
    return value;
  })
  @IsNumber({}, { message: 'longitude must be a valid number' })
  @Min(-180)
  @Max(180)
  longitude?: number;

  // ---- branding aliases for the JSONB blob (organization_settings.settings) ----

  @IsOptional()
  @Matches(/^#[0-9A-F]{6}$/i, {
    message: 'color_primary must be a 6-digit hex color (e.g. #1A2B3C)',
  })
  color_primary?: string;

  @IsOptional()
  @Matches(/^#[0-9A-F]{6}$/i, {
    message: 'color_secondary must be a 6-digit hex color (e.g. #1A2B3C)',
  })
  color_secondary?: string;

  @IsOptional()
  @Matches(/^#[0-9A-F]{6}$/i, {
    message: 'color_accent must be a 6-digit hex color (e.g. #1A2B3C)',
  })
  color_accent?: string;
}

export class AdminOrganizationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(OrganizationState)
  status?: OrganizationState;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  sort_by?: string = 'created_at';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_order?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @IsEnum(organization_mode_enum)
  mode?: organization_mode_enum;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  include_non_production?: boolean;
}

export class OrganizationsDashboardStatsDto {
  @ApiProperty({ type: Number })
  total_organizations: number;

  @ApiProperty({ type: Number })
  active: number;

  @ApiProperty({ type: Number })
  inactive: number;

  @ApiProperty({ type: Number })
  suspended: number;

  @ApiProperty({ type: Number })
  demo: number;

  @ApiProperty({ type: Number })
  test: number;
}

export class OrganizationDashboardDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  store_id?: number;

  @IsOptional()
  @Type(() => Date)
  start_date?: Date;

  @IsOptional()
  @Type(() => Date)
  end_date?: Date;

  @IsOptional()
  @IsString()
  period?: string = '6m';
}
