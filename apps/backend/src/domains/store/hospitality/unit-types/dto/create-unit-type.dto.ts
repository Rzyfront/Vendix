import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsSafeS3Key } from '@common/decorators/is-safe-s3-key.decorator';
import {
  LODGING_AMENITY_CODES,
  MAX_UNIT_TYPE_IMAGES,
} from '../lodging-media';

/** H1.6 — upper bound of a type's overbooking allowance. */
export const MAX_OVERBOOKING_ALLOWANCE = 99;

export const MAX_CAPACITY_MESSAGE =
  'La capacidad máxima debe ser mayor que cero';

/**
 * Room type of a hotel store. `base_price` and `tax_category_ids` belong to
 * the owned service product ("Noche – {name}"), the single source of the
 * nightly price and its tax.
 */
export class CreateUnitTypeDto {
  @ApiProperty({ description: 'Nombre del tipo: "Doble estándar", "Suite".' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ required: false, description: 'Código corto interno.' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  code?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false, description: 'Personas incluidas en el precio base.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  base_occupancy?: number;

  @ApiProperty({ description: 'Máximo de adultos (mayor que cero).' })
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: MAX_CAPACITY_MESSAGE })
  max_adults!: number;

  @ApiProperty({ required: false, description: 'Máximo de niños.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  max_children?: number;

  @ApiProperty({
    required: false,
    description: 'Máximo de personas. Por defecto adultos + niños.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: MAX_CAPACITY_MESSAGE })
  max_occupancy?: number;

  @ApiProperty({ required: false, description: 'Camas: "1 doble + 1 sencilla".' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  bed_config?: string;

  @ApiProperty({ description: 'Precio base por noche, antes de impuestos.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  base_price!: number;

  @ApiProperty({ required: false, description: 'Categorías de impuesto del producto noche.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @Type(() => Number)
  @IsInt({ each: true })
  tax_category_ids?: number[];

  @ApiProperty({
    required: false,
    description: 'Claves S3 de las fotos, en el orden en que se muestran.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_UNIT_TYPE_IMAGES)
  @IsString({ each: true })
  @IsSafeS3Key({ each: true })
  images?: string[];

  @ApiProperty({
    required: false,
    description: 'Códigos de amenidades del catálogo (wifi, air_conditioning...).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(LODGING_AMENITY_CODES.length)
  @IsIn(LODGING_AMENITY_CODES, { each: true })
  amenities?: string[];

  @ApiProperty({
    required: false,
    description:
      'Reservas que se pueden vender por encima de las habitaciones activas del tipo (sobreventa). Cambiarla requiere store:lodging:rates:write; por defecto toma hospitality.default_overbooking_allowance.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_OVERBOOKING_ALLOWANCE)
  overbooking_allowance?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort_order?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
