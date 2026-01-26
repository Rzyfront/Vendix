import { IsOptional, IsString, IsInt, Min, Max, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export enum ProductSortBy {
  NAME = 'name',
  PRICE_ASC = 'price_asc',
  PRICE_DESC = 'price_desc',
  NEWEST = 'newest',
  OLDEST = 'oldest',
  BEST_SELLING = 'best_selling',
}

export class CatalogQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  category_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  brand_id?: number;

  @IsOptional()
  @Type(() => Number)
  min_price?: number;

  @IsOptional()
  @Type(() => Number)
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
}
