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
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export enum ProductState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ARCHIVED = 'archived',
}

export class CreateProductDto {
  // store_id se infiere automáticamente del contexto del token, pero se permite en body para testing
  @IsOptional()
  @IsInt()
  store_id?: number;

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
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de costo no puede ser negativo' })
  cost_price?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0, { message: 'El peso no puede ser negativo' })
  weight?: number;

  @IsOptional()
  @IsObject()
  dimensions?: {
    length: number;
    width: number;
    height: number;
  };

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  track_inventory?: boolean;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'El stock mínimo no puede ser negativo' })
  min_stock_level?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'El stock máximo no puede ser negativo' })
  max_stock_level?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'El punto de reorden no puede ser negativo' })
  reorder_point?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'La cantidad de reorden no puede ser negativa' })
  reorder_quantity?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requires_serial_numbers?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requires_batch_tracking?: boolean;

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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockByLocationDto)
  stock_by_location?: StockByLocationDto[];
}

// DTO para especificar stock por ubicación
export class StockByLocationDto {
  @IsInt()
  @Min(1)
  location_id: number;

  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'La cantidad en stock no puede ser negativa' })
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockByLocationDto)
  stock_by_location?: StockByLocationDto[];
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

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  pos_optimized?: boolean = false;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  include_stock?: boolean = true;
}

// Product Variants DTOs
export class CreateProductVariantDto {
  // product_id se infiere automáticamente del contexto
  // @IsOptional()
  // @IsInt()
  // product_id?: number;

  @IsString()
  @MaxLength(100)
  sku: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio no puede ser negativo' })
  price_override?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio no puede ser negativo' })
  price?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'La cantidad en stock no puede ser negativa' })
  stock_quantity?: number = 0;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;

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

  @IsOptional()
  @IsString()
  @MaxLength(255)
  alt_text?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0)
  sort_order?: number;
}
