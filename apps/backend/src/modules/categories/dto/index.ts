import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsArray,
  MaxLength,
  Min,
  IsUrl,
  IsEnum,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Enums
export enum CategoryStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

// Create Category DTO
export class CreateCategoryDto {
  @ApiProperty({ example: 'Ropa', description: 'Nombre de la categoría' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ example: 'Categoría de ropa para adultos', description: 'Descripción de la categoría (opcional)' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 'ropa', description: 'Slug de la categoría (opcional)' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  slug?: string;

  @ApiProperty({ example: 1, description: 'ID de la tienda' })
  @IsInt()
  @Min(1)
  store_id: number;

  @ApiPropertyOptional({ example: 2, description: 'ID de la categoría padre (opcional)' })
  @IsInt()
  @IsOptional()
  @Min(1)
  parent_id?: number;

  @ApiPropertyOptional({ example: 'https://ejemplo.com/categoria.jpg', description: 'URL de la imagen (opcional)' })
  @IsString()
  @IsOptional()
  @IsUrl()
  image_url?: string;

  @ApiPropertyOptional({ example: 'Ropa - Tienda', description: 'Meta título SEO (opcional)' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  meta_title?: string;

  @ApiPropertyOptional({ example: 'Encuentra la mejor ropa', description: 'Meta descripción SEO (opcional)' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  meta_description?: string;

  @ApiPropertyOptional({ example: ['ropa', 'moda'], description: 'Meta keywords SEO (opcional)' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  meta_keywords?: string[];

  @ApiPropertyOptional({ example: 0, description: 'Orden de la categoría (opcional)' })
  @IsInt()
  @IsOptional()
  @Min(0)
  sort_order?: number;

  @ApiPropertyOptional({ example: false, description: '¿Es destacada? (opcional)' })
  @IsBoolean()
  @IsOptional()
  is_featured?: boolean = false;

  @ApiPropertyOptional({ example: CategoryStatus.ACTIVE, enum: CategoryStatus, description: 'Estado de la categoría (opcional)' })
  @IsEnum(CategoryStatus)
  @IsOptional()
  status?: CategoryStatus = CategoryStatus.ACTIVE;
}

// Update Category DTO
export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {
  @ApiPropertyOptional({ example: 1, description: 'ID de la tienda (opcional)' })
  @IsInt()
  @IsOptional()
  @Min(1)
  store_id?: number;
}

// Category Query DTO
export class CategoryQueryDto {
  @ApiPropertyOptional({ example: 1, description: 'Página (opcional)' })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 10, description: 'Límite de resultados por página (opcional)' })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @ApiPropertyOptional({ example: 'camisa', description: 'Búsqueda por nombre (opcional)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 1, description: 'ID de la tienda (opcional)' })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  store_id?: number;

  @ApiPropertyOptional({ example: 2, description: 'ID de la categoría padre (opcional)' })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  parent_id?: number;

  @ApiPropertyOptional({ example: CategoryStatus.ACTIVE, enum: CategoryStatus, description: 'Estado de la categoría (opcional)' })
  @IsOptional()
  @IsEnum(CategoryStatus)
  status?: CategoryStatus;

  @ApiPropertyOptional({ example: false, description: '¿Es destacada? (opcional)' })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  is_featured?: boolean;

  @ApiPropertyOptional({ example: 'name', description: 'Campo de ordenamiento (opcional)' })
  @IsOptional()
  @IsString()
  sort_by?: string = 'name';

  @ApiPropertyOptional({ example: 'asc', description: 'Orden (asc o desc) (opcional)' })
  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'asc';

  @ApiPropertyOptional({ example: false, description: '¿Incluir inactivas? (opcional)' })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  include_inactive?: boolean = false;
}

// Assign Product to Category DTO
export class AssignProductToCategoryDto {
  @ApiProperty({ example: 10, description: 'ID del producto' })
  @IsInt()
  @Min(1)
  product_id: number;

  @ApiPropertyOptional({ example: 0, description: 'Orden del producto en la categoría (opcional)' })
  @IsInt()
  @IsOptional()
  @Min(0)
  sort_order?: number = 0;
}

// Category Tree Response DTO
export class CategoryTreeDto {
  @ApiProperty({ example: 1, description: 'ID de la categoría' })
  id: number;
  @ApiProperty({ example: 'Ropa', description: 'Nombre de la categoría' })
  name: string;
  @ApiProperty({ example: 'ropa', description: 'Slug de la categoría' })
  slug: string;
  @ApiPropertyOptional({ example: 'Categoría de ropa', description: 'Descripción de la categoría (opcional)' })
  description?: string;
  @ApiPropertyOptional({ example: 'https://ejemplo.com/categoria.jpg', description: 'URL de la imagen (opcional)' })
  image_url?: string;
  @ApiProperty({ example: false, description: '¿Es destacada?' })
  is_featured: boolean;
  @ApiProperty({ example: 0, description: 'Orden de la categoría' })
  sort_order: number;
  @ApiProperty({ example: CategoryStatus.ACTIVE, enum: CategoryStatus, description: 'Estado de la categoría' })
  status: CategoryStatus;
  @ApiPropertyOptional({ type: () => [CategoryTreeDto], description: 'Subcategorías (opcional)' })
  children?: CategoryTreeDto[];
  @ApiPropertyOptional({ example: 10, description: 'Cantidad de productos (opcional)' })
  product_count?: number;
}
