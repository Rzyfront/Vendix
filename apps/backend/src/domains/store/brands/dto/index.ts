import {
  IsString,
  IsOptional,
  IsInt,
  IsNotEmpty,
  MinLength,
  MaxLength,
  Min,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';

// Enums - matching the Prisma schema (brand_state_enum)
export enum BrandState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export class CreateBrandDto {
  @ApiProperty({ example: 'Nike', description: 'Nombre de la marca' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre no puede estar vacío' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({
    example: 'nike',
    description: 'Slug de la marca (opcional, se genera automáticamente)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  slug?: string;

  @ApiPropertyOptional({
    example: 'Marca deportiva internacional',
    description: 'Descripción de la marca (opcional)',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    example: 'https://logo.com/nike.png',
    description: 'URL del logo de la marca (opcional)',
  })
  @IsString()
  @IsOptional()
  logo_url?: string;

  @ApiPropertyOptional({
    example: BrandState.ACTIVE,
    enum: BrandState,
    description: 'Estado de la marca (opcional)',
  })
  @IsEnum(BrandState)
  @IsOptional()
  state?: BrandState = BrandState.ACTIVE;

  @ApiPropertyOptional({
    example: false,
    description: 'Indica si la marca se destaca en la tienda online',
  })
  @IsBoolean()
  @IsOptional()
  is_featured?: boolean = false;
}

// Update Brand DTO
export class UpdateBrandDto extends PartialType(CreateBrandDto) {}

// Brand Query DTO
export class BrandQueryDto {
  @ApiPropertyOptional({
    example: 1,
    description: 'Página de resultados (opcional)',
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    example: 10,
    description: 'Cantidad de resultados por página (opcional)',
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @ApiPropertyOptional({
    example: 'nike',
    description: 'Búsqueda por nombre (opcional)',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: BrandState.ACTIVE,
    enum: BrandState,
    description: 'Estado de la marca (opcional)',
  })
  @IsOptional()
  @IsEnum(BrandState)
  state?: BrandState;

  @ApiPropertyOptional({
    example: true,
    description: 'Filtra marcas destacadas o no destacadas',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  is_featured?: boolean;

  @ApiPropertyOptional({
    example: 'created_at',
    description: 'Campo para ordenar (opcional)',
  })
  @IsOptional()
  @IsString()
  sort_by?: string = 'created_at';

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'desc';
}
