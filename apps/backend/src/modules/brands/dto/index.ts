import {
  IsString,
  IsOptional,
  IsInt,
  MaxLength,
  Min,
  IsUrl,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';

export class CreateBrandDto {
  @ApiProperty({ example: 'Nike', description: 'Nombre de la marca' })
  @IsString()
  @MaxLength(100)
  name: string;

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
  @IsUrl()
  logo_url?: string;
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
    example: 'name',
    description: 'Campo para ordenar (opcional)',
  })
  @IsOptional()
  @IsString()
  sort_by?: string = 'name';

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'asc';
}
