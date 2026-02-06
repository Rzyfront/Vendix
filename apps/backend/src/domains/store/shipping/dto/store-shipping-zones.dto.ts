import {
  IsString,
  IsArray,
  IsBoolean,
  IsOptional,
  IsNumber,
  IsEnum,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
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

  @ApiPropertyOptional({ description: 'Whether the zone is active', default: true })
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
  @IsString()
  name?: string;

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
    description: 'Cost per unit (kg for weight_based, currency for price_based)',
    example: 10.0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  per_unit_cost?: number;

  @ApiPropertyOptional({
    description: 'Minimum value (weight in kg or order price)',
    example: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  min_val?: number;

  @ApiPropertyOptional({
    description: 'Maximum value (weight in kg or order price)',
    example: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  max_val?: number;

  @ApiPropertyOptional({
    description: 'Order amount threshold for free shipping',
    example: 2000.0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  free_shipping_threshold?: number;

  @ApiPropertyOptional({ description: 'Whether the rate is active', default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateRateDto extends PartialType(CreateRateDto) {}
