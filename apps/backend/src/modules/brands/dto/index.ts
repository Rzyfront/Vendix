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
import { Transform } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';

// Enums
export enum BrandStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

// Create Brand DTO
export class CreateBrandDto {
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

  @IsString()
  @IsOptional()
  @IsUrl()
  logo_url?: string;

  @IsString()
  @IsOptional()
  @IsUrl()
  website_url?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  meta_title?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  meta_description?: string;

  @IsInt()
  @IsOptional()
  @Min(0)
  sort_order?: number;

  @IsBoolean()
  @IsOptional()
  is_featured?: boolean = false;

  @IsEnum(BrandStatus)
  @IsOptional()
  status?: BrandStatus = BrandStatus.ACTIVE;
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
  @IsEnum(BrandStatus)
  status?: BrandStatus;

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
