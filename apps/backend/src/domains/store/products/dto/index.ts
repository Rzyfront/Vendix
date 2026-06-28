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
  Max,
  ValidateNested,
  IsNotEmpty,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum ProductState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ARCHIVED = 'archived',
}

export enum PricingType {
  UNIT = 'unit',
  WEIGHT = 'weight',
}

export enum ProductType {
  PHYSICAL = 'physical',
  SERVICE = 'service',
  // Plato/preparación producida in-house (suite restaurante). Ya existe en el
  // enum Prisma product_type_enum; el DTO debe aceptarlo para crear/editar platos.
  PREPARED = 'prepared',
}

export enum ServiceModality {
  IN_PERSON = 'in_person',
  VIRTUAL = 'virtual',
  HYBRID = 'hybrid',
}

export enum ServicePricingType {
  PER_HOUR = 'per_hour',
  PER_SESSION = 'per_session',
  PACKAGE = 'package',
  SUBSCRIPTION = 'subscription',
}

export enum BookingMode {
  PROVIDER_REQUIRED = 'provider_required',
  FREE_BOOKING = 'free_booking',
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

export class CreateVariantWithStockDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  id?: number;

  @IsString()
  @MaxLength(100)
  sku: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

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
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de costo no puede ser negativo' })
  cost_price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El margen de ganancia no puede ser negativo' })
  profit_margin?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_on_sale?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de oferta no puede ser negativo' })
  sale_price?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'La cantidad en stock no puede ser negativa' })
  stock_quantity?: number = 0;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockByLocationDto)
  stock_by_location?: StockByLocationDto[];

  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;

  @IsOptional()
  @IsInt()
  image_id?: number;

  @IsOptional()
  @IsString()
  variant_image_url?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  track_inventory_override?: boolean | null;
}

export class ProductImageDto {
  @IsString()
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

export class CreateProductDto {
  @IsOptional()
  @IsInt()
  store_id?: number;

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
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'La cantidad en stock no puede ser negativa' })
  stock_quantity?: number = 0;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio no puede ser negativo' })
  price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de costo no puede ser negativo' })
  cost_price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El margen de ganancia no puede ser negativo' })
  profit_margin?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_on_sale?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  available_for_ecommerce?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_featured?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  allow_pos_price_override?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  has_multiple_price_tiers?: boolean;

  // ===== Restaurant Suite toggles (Fase A additive, exposed in Fase B) =====
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_sellable?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_ingredient?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_combo?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_batch_produced?: boolean;

  // ===== Control exacto de UoM (Fase UoM) =====
  // FKs al catálogo global units_of_measure. El factor de conversión
  // purchase→stock NO se confía del cliente: el backend lo deriva de
  // factor_to_base del catálogo (ver products.service.ts).
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  stock_uom_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  purchase_uom_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  purchase_to_stock_factor?: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  enabled_price_tier_ids?: number[];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de oferta no puede ser negativo' })
  sale_price?: number;

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
  state?: ProductState = ProductState.ACTIVE;

  @IsOptional()
  @IsEnum(PricingType)
  pricing_type?: PricingType = PricingType.UNIT;

  @IsOptional()
  @IsEnum(ProductType)
  product_type?: ProductType = ProductType.PHYSICAL;

  // Service-specific fields
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1, { message: 'La duración del servicio debe ser al menos 1 minuto' })
  service_duration_minutes?: number;

  @IsOptional()
  @IsEnum(ServiceModality)
  service_modality?: ServiceModality;

  @IsOptional()
  @IsEnum(ServicePricingType)
  service_pricing_type?: ServicePricingType;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requires_booking?: boolean;

  @IsOptional()
  @IsEnum(BookingMode)
  booking_mode?: BookingMode;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_recurring?: boolean;

  @IsOptional()
  @IsString()
  service_instructions?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10080)
  @Type(() => Number)
  preparation_time_minutes?: number;

  // Consultation-specific fields
  @IsOptional()
  @IsBoolean()
  is_consultation?: boolean;

  @IsOptional()
  @IsBoolean()
  send_preconsultation?: boolean;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  consultation_template_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  preconsultation_template_id?: number;

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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVariantWithStockDto)
  variants?: CreateVariantWithStockDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];
}

export class UpdateProductDto {
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
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'La cantidad en stock no puede ser negativa' })
  stock_quantity?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  track_inventory?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requires_serial_numbers?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio no puede ser negativo' })
  price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de costo no puede ser negativo' })
  cost_price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El margen de ganancia no puede ser negativo' })
  profit_margin?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_on_sale?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  available_for_ecommerce?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_featured?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  allow_pos_price_override?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  has_multiple_price_tiers?: boolean;

  // ===== Restaurant Suite toggles (Fase A additive, exposed in Fase B) =====
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_sellable?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_ingredient?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_combo?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_batch_produced?: boolean;

  // ===== Control exacto de UoM (Fase UoM) =====
  // FKs al catálogo global units_of_measure. El factor de conversión
  // purchase→stock NO se confía del cliente: el backend lo deriva de
  // factor_to_base del catálogo (ver products.service.ts).
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  stock_uom_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  purchase_uom_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  purchase_to_stock_factor?: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  enabled_price_tier_ids?: number[];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de oferta no puede ser negativo' })
  sale_price?: number;

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
  @IsEnum(ProductState)
  state?: ProductState;

  @IsOptional()
  @IsEnum(PricingType)
  pricing_type?: PricingType;

  @IsOptional()
  @IsEnum(ProductType)
  product_type?: ProductType;

  // Service-specific fields
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1, { message: 'La duración del servicio debe ser al menos 1 minuto' })
  service_duration_minutes?: number;

  @IsOptional()
  @IsEnum(ServiceModality)
  service_modality?: ServiceModality;

  @IsOptional()
  @IsEnum(ServicePricingType)
  service_pricing_type?: ServicePricingType;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requires_booking?: boolean;

  @IsOptional()
  @IsEnum(BookingMode)
  booking_mode?: BookingMode;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_recurring?: boolean;

  @IsOptional()
  @IsString()
  service_instructions?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10080)
  @Type(() => Number)
  preparation_time_minutes?: number;

  // Consultation-specific fields
  @IsOptional()
  @IsBoolean()
  is_consultation?: boolean;

  @IsOptional()
  @IsBoolean()
  send_preconsultation?: boolean;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  consultation_template_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  preconsultation_template_id?: number;

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

  @IsOptional()
  @IsString()
  @IsIn(['first', 'distribute', 'reset'])
  stock_transfer_mode?: 'first' | 'distribute' | 'reset';

  @IsOptional()
  @IsString()
  @IsIn(['first', 'distribute', 'reset'])
  variant_removal_stock_mode?: 'first' | 'distribute' | 'reset';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVariantWithStockDto)
  variants?: CreateVariantWithStockDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];
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

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  include_variants?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  track_inventory?: boolean;

  @IsOptional()
  @IsEnum(ProductType)
  product_type?: ProductType;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requires_booking?: boolean;

  /**
   * Restaurant Suite (Fase H) — when supplied, the listing is filtered to
   * products whose `is_sellable` flag matches this value. The POS always
   * sends `is_sellable=true` to hide pure ingredients (Phase A). Defaults
   * to undefined to keep retail catalog reads byte-identical to today
   * (existing products all have `is_sellable=true` by default anyway).
   */
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_sellable?: boolean;

  /**
   * Restaurant Suite — filtra el listado a productos producibles por lote
   * (insumos con stock propio). El form de Producción envía `is_batch_produced=true`.
   * Por defecto undefined para no alterar las lecturas del catálogo.
   */
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_batch_produced?: boolean;
}

// Product Variants DTOs
export class CreateProductVariantDto {
  @IsString()
  @MaxLength(100)
  sku: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

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
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de costo no puede ser negativo' })
  cost_price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El margen de ganancia no puede ser negativo' })
  profit_margin?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_on_sale?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de oferta no puede ser negativo' })
  sale_price?: number;

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
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  track_inventory_override?: boolean | null;
  @ApiPropertyOptional({
    description: 'Override of service duration in minutes',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  service_duration_minutes?: number;

  @ApiPropertyOptional({ enum: ['per_session', 'package', 'subscription'] })
  @IsOptional()
  @IsEnum(['per_session', 'package', 'subscription'])
  service_pricing_type?: 'per_session' | 'package' | 'subscription';

  @ApiPropertyOptional({
    description: 'Override of buffer minutes between bookings',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  buffer_minutes?: number;

  @ApiPropertyOptional({
    description: 'Override of preparation time before service',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  preparation_time_minutes?: number;
}

export class UpdateProductVariantDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;

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
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de costo no puede ser negativo' })
  cost_price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El margen de ganancia no puede ser negativo' })
  profit_margin?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_on_sale?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de oferta no puede ser negativo' })
  sale_price?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'La cantidad en stock no puede ser negativa' })
  stock_quantity?: number;

  @IsOptional()
  @IsInt()
  image_id?: number;
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  track_inventory_override?: boolean | null;
  @ApiPropertyOptional({
    description: 'Override of service duration in minutes',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  service_duration_minutes?: number;

  @ApiPropertyOptional({ enum: ['per_session', 'package', 'subscription'] })
  @IsOptional()
  @IsEnum(['per_session', 'package', 'subscription'])
  service_pricing_type?: 'per_session' | 'package' | 'subscription';

  @ApiPropertyOptional({
    description: 'Override of buffer minutes between bookings',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  buffer_minutes?: number;

  @ApiPropertyOptional({
    description: 'Override of preparation time before service',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  preparation_time_minutes?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  available_for_ecommerce?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_featured?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['first', 'distribute', 'reset'])
  variant_removal_stock_mode?: 'first' | 'distribute' | 'reset';
}

export class UpdateProductWithVariantsDto {
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
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio no puede ser negativo' })
  price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de costo no puede ser negativo' })
  cost_price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El margen de ganancia no puede ser negativo' })
  profit_margin?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_on_sale?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  available_for_ecommerce?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_featured?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de oferta no puede ser negativo' })
  sale_price?: number;

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
  state?: ProductState;

  @IsOptional()
  @IsEnum(PricingType)
  pricing_type?: PricingType;

  @IsOptional()
  @IsEnum(ProductType)
  product_type?: ProductType;

  // Service-specific fields
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1, { message: 'La duración del servicio debe ser al menos 1 minuto' })
  service_duration_minutes?: number;

  @IsOptional()
  @IsEnum(ServiceModality)
  service_modality?: ServiceModality;

  @IsOptional()
  @IsEnum(ServicePricingType)
  service_pricing_type?: ServicePricingType;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requires_booking?: boolean;

  @IsOptional()
  @IsEnum(BookingMode)
  booking_mode?: BookingMode;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_recurring?: boolean;

  @IsOptional()
  @IsString()
  service_instructions?: string;

  // Consultation-specific fields
  @IsOptional()
  @IsBoolean()
  is_consultation?: boolean;

  @IsOptional()
  @IsBoolean()
  send_preconsultation?: boolean;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  consultation_template_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  preconsultation_template_id?: number;

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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateVariantWithStockDto)
  variants_to_update?: UpdateVariantWithStockDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVariantWithStockDto)
  variants_to_add?: CreateVariantWithStockDto[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  variant_ids_to_remove?: number[];
}

export class UpdateVariantWithStockDto {
  @IsInt()
  id: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;

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
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de costo no puede ser negativo' })
  cost_price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El margen de ganancia no puede ser negativo' })
  profit_margin?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_on_sale?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  available_for_ecommerce?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_featured?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio de oferta no puede ser negativo' })
  sale_price?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'La cantidad en stock no puede ser negativa' })
  stock_quantity?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockByLocationDto)
  stock_by_location?: StockByLocationDto[];

  @IsOptional()
  @IsInt()
  image_id?: number | null;

  @IsOptional()
  @IsString()
  variant_image_url?: string | null;
}

// Bulk Upload DTOs
export class BulkProductItemDto {
  @IsNotEmpty({ message: 'Product name is required' })
  @IsString()
  name: string;

  @IsNotEmpty({ message: 'Base price is required' })
  @IsNumber({}, { message: 'Base price must be a number' })
  @Min(0, { message: 'Base price must be positive' })
  base_price: number;

  @IsNotEmpty({ message: 'SKU is required' })
  @IsString()
  sku: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  brand_id?: number | string;

  @IsOptional()
  category_ids?: (number | string)[] | string;

  @IsOptional()
  tax_category_ids?: (number | string)[] | string;

  @IsOptional()
  @IsNumber({}, { message: 'Stock quantity must be a number' })
  @Min(0, { message: 'Stock quantity must be positive' })
  stock_quantity?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Cost price must be a number' })
  @Min(0, { message: 'Cost price must be positive' })
  cost_price?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Weight must be a number' })
  @Min(0, { message: 'Weight must be positive' })
  weight?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Profit margin must be a number' })
  @Min(0, { message: 'Profit margin must be positive' })
  profit_margin?: number;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsBoolean()
  available_for_ecommerce?: boolean;

  @IsOptional()
  @IsBoolean()
  is_featured?: boolean;

  @IsOptional()
  @IsBoolean()
  allow_pos_price_override?: boolean;

  @IsOptional()
  @IsBoolean()
  has_multiple_price_tiers?: boolean;

  // ===== Restaurant Suite toggles (Fase A additive, exposed in Fase B) =====
  @IsOptional()
  @IsBoolean()
  is_sellable?: boolean;

  @IsOptional()
  @IsBoolean()
  is_ingredient?: boolean;

  @IsOptional()
  @IsBoolean()
  is_combo?: boolean;

  @IsOptional()
  @IsBoolean()
  is_batch_produced?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductVariantDto)
  variants?: CreateProductVariantDto[];

  @IsOptional()
  @IsString()
  warehouse_code?: string;

  @IsOptional()
  @IsString()
  warehouse_name?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockByLocationDto)
  stock_by_location?: StockByLocationDto[];

  @IsOptional()
  @IsString()
  product_type?: string;

  @IsOptional()
  @IsBoolean()
  track_inventory?: boolean;

  @IsOptional()
  @IsNumber()
  service_duration_minutes?: number;

  @IsOptional()
  @IsString()
  service_modality?: string;

  @IsOptional()
  @IsString()
  service_pricing_type?: string;

  @IsOptional()
  @IsBoolean()
  requires_booking?: boolean;

  @IsOptional()
  @IsString()
  booking_mode?: string;

  @IsOptional()
  @IsNumber()
  buffer_minutes?: number;

  @IsOptional()
  @IsBoolean()
  is_recurring?: boolean;

  @IsOptional()
  @IsString()
  service_instructions?: string;

  @IsOptional()
  @IsBoolean()
  is_consultation?: boolean;

  @IsOptional()
  @IsBoolean()
  send_preconsultation?: boolean;

  @IsOptional()
  @IsNumber()
  consultation_template_id?: number;

  @IsOptional()
  @IsNumber()
  preconsultation_template_id?: number;

  @IsOptional()
  @IsNumber()
  preparation_time_minutes?: number;

  @IsOptional()
  @IsNumber()
  min_stock_level?: number;

  @IsOptional()
  @IsNumber()
  max_stock_level?: number;

  @IsOptional()
  @IsNumber()
  reorder_point?: number;

  @IsOptional()
  @IsNumber()
  reorder_quantity?: number;

  @IsOptional()
  @IsBoolean()
  requires_serial_numbers?: boolean;

  @IsOptional()
  @IsBoolean()
  requires_batch_tracking?: boolean;

  @IsOptional()
  @IsString()
  pricing_type?: string;
}

export class BulkProductUploadDto {
  @IsNotEmpty({ message: 'Products array is required' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkProductItemDto)
  products: BulkProductItemDto[];
}

export class BulkUploadItemResultDto {
  row_number?: number;
  product_name?: string;
  sku?: string;
  action?: 'create' | 'update';
  product: any;
  status: 'success' | 'error' | 'skipped';
  message: string;
  error?: string;
  error_code?: string;
}

export class BulkUploadResultDto {
  success: boolean;
  total_processed: number;
  successful: number;
  failed: number;
  skipped: number;
  results: BulkUploadItemResultDto[];
}

export class BulkValidationResultDto {
  isValid: boolean;
  errors: string[];
  validProducts: BulkProductItemDto[];
}

export class BulkUploadTemplateDto {
  headers: string[];
  sample_data: any[];
  instructions: string;
}

export class GenerateProductDescriptionDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  base_price?: number;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsObject()
  extra_context?: Record<string, any>;
}

export class GenerateProductImageEnhancementDto {
  @IsString()
  @IsNotEmpty()
  image_url: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1200)
  prompt: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  product_name?: string;

  @IsOptional()
  @IsString()
  @IsIn(['physical', 'service'])
  product_type?: 'physical' | 'service';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsObject()
  extra_context?: Record<string, any>;
}

export * from './bulk-image-upload.dto';
export * from './bulk-image-analysis.dto';
export * from './update-product-promotions.dto';
export * from './bulk-product-analysis.dto';
