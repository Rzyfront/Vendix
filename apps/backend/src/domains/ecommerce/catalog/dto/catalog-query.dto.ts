import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  MaxLength,
  IsEnum,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export enum ProductSortBy {
  NAME = 'name',
  PRICE_ASC = 'price_asc',
  PRICE_DESC = 'price_desc',
  NEWEST = 'newest',
  OLDEST = 'oldest',
  BEST_SELLING = 'best_selling',
}

export class CatalogQueryDto {
  // D.3 (ADR-09, ERR-16, F-024): mismo hardening que B.1 en ProductQueryDto.
  // Overlong → 400 SYS_VALIDATION_001; el storefront clampa a 200 (nunca 400
  // por tipeo) y min-length en service evita scans de 1 char.
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  category_id?: number;

  @IsOptional()
  @IsString()
  category_ids?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  brand_id?: number;

  @IsOptional()
  @IsString()
  brand_ids?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0)
  min_price?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0)
  max_price?: number;

  @IsOptional()
  @IsEnum(ProductSortBy)
  sort_by?: ProductSortBy = ProductSortBy.NEWEST;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  ids?: string;

  @IsOptional()
  @IsString()
  has_discount?: string;

  @IsOptional()
  @IsString()
  is_featured?: string;

  @IsOptional()
  @IsString()
  fill?: string;
}
