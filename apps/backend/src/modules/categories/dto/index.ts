import {
  IsString,
  IsOptional,
  IsInt,
  IsNotEmpty,
  MinLength,
  MaxLength,
  Min,
  IsUrl,
  IsEnum,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Enums - matching the Prisma schema
export enum CategoryState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

// Create Category DTO - matching Prisma schema fields
export class CreateCategoryDto {
  @ApiProperty({ example: 'Ropa', description: 'Nombre de la categoría' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre no puede estar vacío' })
  @MinLength(4, { message: 'El nombre debe tener al menos 4 caracter' })
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    example: 'ropa',
    description: 'Slug de la categoría (opcional)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  slug?: string;

  @ApiPropertyOptional({
    example: 'Categoría de ropa para adultos',
    description: 'Descripción de la categoría (opcional)',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    example: 'https://ejemplo.com/categoria.jpg',
    description: 'URL de la imagen (opcional)',
  })
  @IsString()
  @IsOptional()
  @IsUrl()
  image_url?: string;

  // store_id se infiere automáticamente del contexto del token
  // @IsInt()
  // @IsOptional()
  // @Min(1)
  // store_id?: number;

  @ApiPropertyOptional({
    example: CategoryState.ACTIVE,
    enum: CategoryState,
    description: 'Estado de la categoría (opcional)',
  })
  @IsEnum(CategoryState)
  @IsOptional()
  state?: CategoryState = CategoryState.ACTIVE;
}

// Update Category DTO
export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}

// Category Query DTO - simplified to match schema
export class CategoryQueryDto {
  @ApiPropertyOptional({ example: 1, description: 'Página (opcional)' })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    example: 10,
    description: 'Límite de resultados por página (opcional)',
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @ApiPropertyOptional({
    example: 'camisa',
    description: 'Búsqueda por nombre (opcional)',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'ID de la tienda (opcional)',
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  store_id?: number;

  @ApiPropertyOptional({
    example: CategoryState.ACTIVE,
    enum: CategoryState,
    description: 'Estado de la categoría (opcional)',
  })
  @IsOptional()
  @IsEnum(CategoryState)
  state?: CategoryState;

  @ApiPropertyOptional({
    example: 'name',
    description: 'Campo de ordenamiento (opcional)',
  })
  @IsOptional()
  @IsString()
  sort_by?: string = 'name';

  @ApiPropertyOptional({
    example: 'asc',
    description: 'Orden (asc o desc) (opcional)',
  })
  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'asc';
}

// Assign Product to Category DTO
export class AssignProductToCategoryDto {
  @ApiProperty({ example: 10, description: 'ID del producto' })
  @IsInt()
  @Min(1)
  product_id: number;
}

// Category Response DTO - matching schema fields
export class CategoryResponseDto {
  @ApiProperty({ example: 1, description: 'ID de la categoría' })
  id: number;

  @ApiProperty({ example: 'Ropa', description: 'Nombre de la categoría' })
  name: string;

  @ApiProperty({ example: 'ropa', description: 'Slug de la categoría' })
  slug: string;

  @ApiPropertyOptional({
    example: 'Categoría de ropa',
    description: 'Descripción de la categoría (opcional)',
  })
  description?: string;

  @ApiPropertyOptional({
    example: 'https://ejemplo.com/categoria.jpg',
    description: 'URL de la imagen (opcional)',
  })
  image_url?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'ID de la tienda (opcional)',
  })
  store_id?: number;

  @ApiProperty({
    example: CategoryState.ACTIVE,
    enum: CategoryState,
    description: 'Estado de la categoría',
  })
  state: CategoryState;
}
