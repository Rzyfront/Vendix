import {
  IsString,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsArray,
  IsNumber,
  Min,
  Max,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import {
  shipping_method_type_enum,
  shipping_rate_type_enum,
} from '@prisma/client';

// --- Methods ---
export class CreateShippingMethodDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(shipping_method_type_enum)
  @IsOptional()
  type?: shipping_method_type_enum;

  @IsString()
  @IsOptional()
  provider_name?: string;

  @IsInt()
  @IsOptional()
  min_days?: number;

  @IsInt()
  @IsOptional()
  max_days?: number;

  @IsInt()
  @Min(0)
  @Max(10080)
  @IsOptional()
  @Type(() => Number)
  transit_time_minutes?: number;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class UpdateShippingMethodDto extends CreateShippingMethodDto {}

// --- Zones ---
export class CreateShippingZoneDto {
  @IsString()
  name: string;

  @IsArray()
  @IsString({ each: true })
  countries: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  regions?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  cities?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  zip_codes?: string[];

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class UpdateShippingZoneDto extends CreateShippingZoneDto {}

// --- Rates ---
export class CreateShippingRateDto {
  @IsInt()
  shipping_zone_id: number;

  @IsInt()
  shipping_method_id: number;

  @IsString()
  @IsOptional()
  name?: string;

  @IsEnum(shipping_rate_type_enum)
  type: shipping_rate_type_enum;

  @IsNumber()
  @Min(0)
  base_cost: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    return Number(value);
  })
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(0)
  per_unit_cost?: number | null;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    return Number(value);
  })
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(0)
  min_val?: number | null;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    return Number(value);
  })
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(0)
  max_val?: number | null;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (value === null || value === '' || Number(value) <= 0) return null;
    return Number(value);
  })
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(0)
  free_shipping_threshold?: number | null;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class UpdateShippingRateDto extends CreateShippingRateDto {}
