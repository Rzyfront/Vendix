import {
  IsString,
  IsArray,
  IsBoolean,
  IsOptional,
  IsNumber,
  IsEnum,
  IsInt,
  Min,
  ValidateIf,
  ValidateNested,
  ValidationOptions,
  registerDecorator,
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

export class DistanceTierDto {
  @ApiProperty({ description: 'Km inicial del tramo (inclusivo)', example: 0 })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  from_km: number;

  @ApiPropertyOptional({
    description: 'Km final del tramo (exclusivo). null = tramo abierto.',
    example: 5,
    nullable: true,
  })
  @IsOptional()
  @Transform(({ obj, key }) => {
    const raw = obj?.[key];
    if (raw === undefined) return undefined;
    if (raw === null || raw === '') return null;
    return Number(raw);
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsNumber()
  @Min(0)
  to_km?: number | null;

  @ApiProperty({ description: 'Precio del tramo', example: 8000 })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  price: number;
}

/**
 * La escala debe llegar ordenada por `from_km` y ser contigua (cada
 * `from_km` iguala el `to_km` anterior: sin huecos ni traslapes), con
 * `to_km > from_km` en cada tramo y tramo abierto (`null`) solo al final.
 * `undefined`/`null`/vacío = sin escala (rige el precio plano).
 */
export function IsValidDistanceTiers(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidDistanceTiers',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (value === undefined || value === null) return true;
          if (!Array.isArray(value) || value.length === 0) return true;
          for (const item of value) {
            const tier = item as Partial<DistanceTierDto> | null;
            if (
              tier == null ||
              typeof tier.from_km !== 'number' ||
              !Number.isFinite(tier.from_km) ||
              tier.from_km < 0 ||
              typeof tier.price !== 'number' ||
              !Number.isFinite(tier.price) ||
              tier.price < 0
            ) {
              return false;
            }
            const to = tier.to_km;
            if (
              to !== null &&
              to !== undefined &&
              (typeof to !== 'number' ||
                !Number.isFinite(to) ||
                to <= tier.from_km)
            ) {
              return false;
            }
          }
          for (let i = 0; i < value.length; i++) {
            const tier = value[i] as DistanceTierDto;
            if (i > 0) {
              const prev = value[i - 1] as DistanceTierDto;
              if (prev.to_km == null) return false;
              if (tier.from_km < prev.from_km) return false;
              if (tier.from_km !== prev.to_km) return false;
            }
            const to = tier.to_km ?? null;
            if (to == null && i !== value.length - 1) return false;
          }
          return true;
        },
        defaultMessage(): string {
          return 'distance_tiers debe ser una escala ordenada y contigua [{from_km,to_km|null,price}] sin huecos ni traslapes, con to_km abierto solo en el último tramo';
        },
      },
    });
  };
}

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

  @ApiPropertyOptional({
    description:
      'Optional tax category (IVA/INC, exactly one rate > 0) always INCLUDED in the rate price. null = no tax.',
    nullable: true,
    example: 12,
  })
  @IsOptional()
  // Lee el crudo (`obj[key]`): con `enableImplicitConversion` el `value` ya
  // llega coaccionado y `null` (= quitar el impuesto) no debe volverse 0.
  @Transform(({ obj, key }) => {
    const raw = obj?.[key];
    if (raw === undefined) return undefined;
    if (raw === null || raw === '') return null;
    return Number(raw);
  })
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  tax_category_id?: number | null;

  @ApiPropertyOptional({
    description:
      'Escala de km para cobro por distancia [{from_km,to_km|null,price}]. null/vacía = rige el precio plano.',
    example: [
      { from_km: 0, to_km: 5, price: 8000 },
      { from_km: 5, to_km: null, price: 12000 },
    ],
    nullable: true,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DistanceTierDto)
  @IsValidDistanceTiers()
  distance_tiers?: DistanceTierDto[] | null;
}

export class UpdateRateDto extends PartialType(CreateRateDto) {}
