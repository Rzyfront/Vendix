import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  MaxLength,
  Min,
  IsUrl,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';

// Enums
export enum BrandStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export class CreateBrandDto {
  @ApiProperty({ example: 'Nike', description: 'Nombre de la marca' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    example: 'Marca deportiva internacional',
    description: 'Descripción de la marca (opcional)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    example: 'nike',
    description: 'Slug único de la marca (opcional)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  slug?: string;

  @ApiProperty({ example: 1, description: 'ID de la tienda asociada' })
  @IsInt()
  @Min(1)
  store_id: number;

  @ApiPropertyOptional({
    example: 'https://logo.com/nike.png',
    description: 'URL del logo de la marca (opcional)',
  })
  @IsString()
  @IsOptional()
  @IsUrl()
  logo_url?: string;

  @ApiPropertyOptional({
    example: 'https://nike.com',
    description: 'Sitio web de la marca (opcional)',
  })
  @IsString()
  @IsOptional()
  @IsUrl()
  website_url?: string;

  @ApiPropertyOptional({
    example: 'Nike - Ropa y calzado',
    description: 'Meta título SEO (opcional)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  meta_title?: string;

  @ApiPropertyOptional({
    example: 'Marca líder en ropa deportiva',
    description: 'Meta descripción SEO (opcional)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  meta_description?: string;

  @ApiPropertyOptional({
    example: 0,
    description: 'Orden de aparición (opcional)',
  })
  @IsInt()
  @IsOptional()
  @Min(0)
  sort_order?: number;

  @ApiPropertyOptional({
    example: true,
    description: '¿Es marca destacada? (opcional)',
  })
  @IsBoolean()
  @IsOptional()
  is_featured?: boolean;

  @ApiPropertyOptional({
    example: 'active',
    description: 'Estado de la marca (opcional)',
  })
  @IsEnum(BrandStatus)
  @IsOptional()
  status?: BrandStatus;
}

// Update Brand DTO
export class UpdateBrandDto extends PartialType(CreateBrandDto) {
  @IsInt()
  @IsOptional()
  @Min(1)
  store_id?: number;
}

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
    description: 'Búsqueda por nombre o slug (opcional)',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'Filtrar por ID de tienda (opcional)',
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  store_id?: number;

  @ApiPropertyOptional({
    example: 'active',
    description: 'Filtrar por estado de la marca (opcional)',
  })
  @IsOptional()
  @IsEnum(BrandStatus)
  status?: BrandStatus;

  @ApiPropertyOptional({
    example: true,
    description: 'Filtrar solo marcas destacadas (opcional)',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  is_featured?: boolean;

  @ApiPropertyOptional({
    example: 'name',
    description: 'Campo para ordenar (opcional)',
  })
  @IsOptional()
  @IsString()
  sort_by?: string = 'name';

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'asc';

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  include_inactive?: boolean = false;
}
