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

// Enums
export enum CategoryStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

// Create Category DTO
export class CreateCategoryDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  slug?: string;

  @IsInt()
  @Min(1)
  store_id: number;

  @IsInt()
  @IsOptional()
  @Min(1)
  parent_id?: number;

  @IsString()
  @IsOptional()
  @IsUrl()
  image_url?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  meta_title?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  meta_description?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  meta_keywords?: string[];

  @IsInt()
  @IsOptional()
  @Min(0)
  sort_order?: number;

  @IsBoolean()
  @IsOptional()
  is_featured?: boolean = false;

  @IsEnum(CategoryStatus)
  @IsOptional()
  status?: CategoryStatus = CategoryStatus.ACTIVE;
}

// Update Category DTO
export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {
  @IsInt()
  @IsOptional()
  @Min(1)
  store_id?: number;
}

// Category Query DTO
export class CategoryQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  store_id?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  parent_id?: number;

  @IsOptional()
  @IsEnum(CategoryStatus)
  status?: CategoryStatus;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  is_featured?: boolean;

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

// Assign Product to Category DTO
export class AssignProductToCategoryDto {
  @IsInt()
  @Min(1)
  product_id: number;

  @IsInt()
  @IsOptional()
  @Min(0)
  sort_order?: number = 0;
}

// Category Tree Response DTO
export class CategoryTreeDto {
  id: number;
  name: string;
  slug: string;
  description?: string;
  image_url?: string;
  is_featured: boolean;
  sort_order: number;
  status: CategoryStatus;
  children?: CategoryTreeDto[];
  product_count?: number;
}
