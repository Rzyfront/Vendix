import {
  IsString,
  IsArray,
  IsBoolean,
  IsOptional,
  IsNumber,
  IsEnum,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { PartialType, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { shipping_rate_type_enum } from '@prisma/client';

// ===== ZONAS =====

export class CreateZoneDto {
  @ApiProperty({ description: 'Internal zone name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Display name for customers' })
  @IsOptional()
  @IsString()
  display_name?: string;

  @ApiProperty({
    description: 'Array of ISO country codes',
    example: ['DO', 'US'],
  })
  @IsArray()
  @IsString({ each: true })
  countries: string[];

  @ApiPropertyOptional({
    description: 'Array of region/state codes',
    example: ['Santiago', 'Santo Domingo'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  regions?: string[];

  @ApiPropertyOptional({
    description: 'Array of specific cities',
    example: ['Santiago de los Caballeros'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cities?: string[];

  @ApiPropertyOptional({
    description: 'Array of zip code patterns',
    example: ['51000', '10100-10199'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  zip_codes?: string[];

  @ApiPropertyOptional({
    description: 'Whether the zone is active',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateZoneDto extends PartialType(CreateZoneDto) {}

// ===== TARIFAS =====

export class CreateRateDto {
  @ApiProperty({ description: 'ID of the shipping zone this rate belongs to' })
  @IsNumber()
  @Type(() => Number)
  shipping_zone_id: number;

  @ApiProperty({ description: 'ID of the shipping method to use' })
  @IsNumber()
  @Type(() => Number)
  shipping_method_id: number;

  @ApiPropertyOptional({ description: 'Display name for the rate' })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (value === null || (typeof value === 'string' && value.trim() === '')) return null;
    return typeof value === 'string' ? value.trim() : value;
  })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  name?: string | null;

  @ApiProperty({
    description: 'Rate calculation type',
    enum: shipping_rate_type_enum,
    example: 'flat',
  })
  @IsEnum(shipping_rate_type_enum)
  type: shipping_rate_type_enum;

  @ApiProperty({ description: 'Base cost of shipping', example: 150.0 })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  base_cost: number;

  @ApiPropertyOptional({
    description:
      'Cost per unit (kg for weight_based, currency for price_based)',
    example: 10.0,
  })
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

  @ApiPropertyOptional({
    description: 'Minimum value (weight in kg or order price)',
    example: 0,
  })
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

  @ApiPropertyOptional({
    description: 'Maximum value (weight in kg or order price)',
    example: 100,
  })
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

  @ApiPropertyOptional({
    description: 'Order amount threshold for free shipping',
    example: 2000.0,
  })
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

  @ApiPropertyOptional({
    description: 'Whether the rate is active',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateRateDto extends PartialType(CreateRateDto) {}
