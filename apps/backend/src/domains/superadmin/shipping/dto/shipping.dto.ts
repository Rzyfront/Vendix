import {
  IsString,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsArray,
  IsNumber,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { shipping_method_type_enum, shipping_rate_type_enum } from '@prisma/client';

// --- System Methods ---
export class CreateSystemShippingMethodDto {
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

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class UpdateSystemShippingMethodDto extends CreateSystemShippingMethodDto {}

// --- System Zones ---
export class CreateSystemShippingZoneDto {
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

export class UpdateSystemShippingZoneDto extends CreateSystemShippingZoneDto {}

// --- System Rates ---
export class CreateSystemShippingRateDto {
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

  @IsNumber()
  @Min(0)
  @IsOptional()
  per_unit_cost?: number;

  @IsNumber()
  @IsOptional()
  min_val?: number;

  @IsNumber()
  @IsOptional()
  max_val?: number;

  @IsNumber()
  @IsOptional()
  free_shipping_threshold?: number;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class UpdateSystemShippingRateDto extends CreateSystemShippingRateDto {}
