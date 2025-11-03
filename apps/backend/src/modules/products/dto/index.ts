import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsUrl,
  MaxLength,
  MinLength,
  IsInt,
  IsBoolean,
  IsObject,
  IsIn,
  IsDecimal,
  IsArray,
  IsJSON,
  IsNumber,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export enum ProductState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ARCHIVED = 'archived',
}

export class CreateProductDto {
  @IsInt()
  store_id: number;

  @IsOptional()
  @IsInt()
  category_id?: number;

  @IsOptional()
  @IsInt()
  brand_id?: number;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio base no puede ser negativo' })
  base_price: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'La cantidad en stock no puede ser negativa' })
  stock_quantity?: number = 0;

  @IsOptional()
  @IsEnum(ProductState)
  state?: ProductState = ProductState.INACTIVE;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  category_ids?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  tax_category_ids?: number[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  image_urls?: string[];
}

export class UpdateProductDto {
  @IsOptional()
  @IsInt()
  category_id?: number;

  @IsOptional()
  @IsInt()
  brand_id?: number;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio base no puede ser negativo' })
  base_price?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'La cantidad en stock no puede ser negativa' })
  stock_quantity?: number;

  @IsOptional()
  @IsEnum(ProductState)
  state?: ProductState;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  category_ids?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  tax_category_ids?: number[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  image_urls?: string[];
}

export class ProductQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(ProductState)
  state?: ProductState;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  store_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  category_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  brand_id?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  include_inactive?: boolean = false;
}

// Product Variants DTOs
export class CreateProductVariantDto {
  @IsInt()
  product_id: number;

  @IsString()
  @MaxLength(100)
  sku: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio no puede ser negativo' })
  price_override?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'La cantidad en stock no puede ser negativa' })
  stock_quantity?: number = 0;

  @IsOptional()
  @IsInt()
  image_id?: number;
}

export class UpdateProductVariantDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio no puede ser negativo' })
  price_override?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'La cantidad en stock no puede ser negativa' })
  stock_quantity?: number;

  @IsOptional()
  @IsInt()
  image_id?: number;
}

export class ProductImageDto {
  @IsString()
  @IsUrl()
  image_url: string;

  @IsOptional()
  @IsBoolean()
  is_main?: boolean = false;
}
