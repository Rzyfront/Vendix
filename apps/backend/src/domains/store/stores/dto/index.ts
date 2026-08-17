import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsUrl,
  MaxLength,
  MinLength,
  IsInt,
  IsBoolean,
  IsObject,
  IsIn,
  IsDecimal,
  IsArray,
  IsJSON,
  IsNumber,
  Min,
  Max,
  Length,
  Matches,
  ArrayMinSize,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Address-related fields that flow into `addresses` (one row per store) rather
 * than into `stores` or `store_settings.settings`. They are declared at the top
 * level of the DTO so the super-admin modal can speak a flat contract; the
 * service merges them into the primary `addresses` row.
 */
export const STORE_ADDRESS_DTO_KEYS = [
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
 * Top-level descriptive / contact fields that physically live on
 * `store_settings.settings` JSONB. They are declared at the top level so the
 * contract stays flat; the service merges them into the JSONB blob with the
 * top-level values preferred over `dto.settings.*` for the same key.
 */
export const STORE_JSONB_DTO_KEYS = [
  'description',
  'email',
  'phone',
  'website',
  'domain',
  'currency_code',
  'color_primary',
  'color_secondary',
  'color_accent',
] as const;

/**
 * Every editable key in the super-admin store DTO. Use this tuple to derive
 * contract typings or to drive generated forms without drifting from the DTO.
 */
export const STORE_EDITABLE_DTO_KEYS = [
  'name',
  'slug',
  'store_code',
  'logo_url',
  'domain',
  'timezone',
  'operating_hours',
  'store_type',
  'industries',
  'is_active',
  'manager_user_id',
  'organization_id',
  'settings',
  ...STORE_ADDRESS_DTO_KEYS,
  ...STORE_JSONB_DTO_KEYS,
] as const;

export enum StoreType {
  PHYSICAL = 'physical',
  ONLINE = 'online',
  HYBRID = 'hybrid',
  POPUP = 'popup',
  KIOSKO = 'kiosko',
}

export enum StoreState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
  ARCHIVED = 'archived',
}

export enum StoreIndustry {
  RETAIL = 'retail',
  RESTAURANT = 'restaurant',
  MANUFACTURING = 'manufacturing',
  SERVICE = 'service',
  GYM = 'gym',
}

export class CreateStoreDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  organization_id?: number;

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
  @MaxLength(20)
  store_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  logo_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  domain?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  timezone?: string;

  @IsOptional()
  @IsJSON()
  operating_hours?: any;

  @IsOptional()
  @IsEnum(StoreType)
  store_type?: StoreType = StoreType.PHYSICAL;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(StoreIndustry, { each: true })
  industries?: StoreIndustry[];

  @IsOptional()
  @IsBoolean()
  is_active?: boolean = true;

  @IsOptional()
  @IsInt()
  manager_user_id?: number;

  // ---- descriptive / contact fields (live in store_settings.settings JSONB) ----

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  website?: string;

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

  // ---- branding / currency aliases for the JSONB blob ----

  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  currency_code?: string;

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

  @IsOptional()
  @IsObject()
  settings?: {
    currency_code?: string;
    color_primary?: string;
    color_secondary?: string;
    color_accent?: string;
    [key: string]: any;
  };
}

export class UpdateStoreDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  organization_id?: number;

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
  @MaxLength(20)
  store_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  logo_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  domain?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  timezone?: string;

  @IsOptional()
  @IsJSON()
  operating_hours?: any;

  @IsOptional()
  @IsEnum(StoreType)
  store_type?: StoreType;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(StoreIndustry, { each: true })
  industries?: StoreIndustry[];

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsInt()
  manager_user_id?: number;

  // ---- descriptive / contact fields (live in store_settings.settings JSONB) ----

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  website?: string;

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

  // ---- branding / currency aliases for the JSONB blob ----

  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  currency_code?: string;

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

  @IsOptional()
  @IsObject()
  settings?: {
    currency_code?: string;
    color_primary?: string;
    color_secondary?: string;
    color_accent?: string;
    [key: string]: any;
  };
}

export class StoreQueryDto {
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
  @IsEnum(StoreType)
  store_type?: StoreType;

  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(StoreIndustry, { each: true })
  industries?: StoreIndustry[];

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_active?: boolean;
}

export class AddStaffToStoreDto {
  @IsInt()
  user_id: number;

  @IsInt()
  role_id: number;

  @IsOptional()
  @IsObject()
  permissions?: any;

  @IsOptional()
  @IsString()
  hire_date?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean = true;
}

export class UpdateStoreSettingsDto {
  @IsObject()
  settings: any;
}

export class StoreDashboardDto {
  @IsOptional()
  @Type(() => Date)
  start_date?: Date;

  @IsOptional()
  @Type(() => Date)
  end_date?: Date;
}

export class AdminStoreQueryDto {
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
  @IsEnum(StoreType)
  store_type?: StoreType;

  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(StoreIndustry, { each: true })
  industries?: StoreIndustry[];

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  organization_id?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  include_non_production?: boolean;
}
