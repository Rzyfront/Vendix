import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  BookingMode,
  PricingType,
  ProductState,
  ProductType,
  ServiceModality,
  ServicePricingType,
} from './product-enums';

/**
 * Tope duro de productos por lote. El `ValidationPipe` global lo aplica vía
 * `@ArrayMaxSize`, y el endpoint de ids por filtro lo reutiliza para marcar
 * `capped` en vez de truncar la selección en silencio.
 */
export const MAX_BULK_EDIT_IDS = 100;

/** Estado de una fila dentro de un preview o de una aplicación de lote. */
export type BulkEditItemStatus = 'ok' | 'warning' | 'error';

/**
 * Subconjunto ESCALAR de `UpdateProductDto` habilitado para edición masiva.
 * Cada campo replica exactamente los decoradores que tiene en
 * `UpdateProductDto`, porque el servicio de bulk delega en
 * `ProductsService.update()` y no debe aceptar valores que ese `update()`
 * rechazaría fila por fila.
 *
 * El `ValidationPipe` global corre con `whitelist: true` y
 * `forbidNonWhitelisted: true` (`apps/backend/src/main.ts:57-65`), así que este
 * contrato es cerrado: cualquier propiedad no declarada aquí devuelve 400.
 *
 * EXCLUIDOS DELIBERADAMENTE (no añadir sin revisar el motivo):
 * - `sku`, `slug`, `barcode`: tienen `@@unique([store_id, …])`
 *   (`apps/backend/prisma/schema.prisma:1607-1609`); aplicar el mismo valor a N
 *   productos colisiona.
 * - `stock_quantity`, `stock_by_location`, `stock_transfer_mode`,
 *   `variant_removal_stock_mode`: disparan `StockLevelManager.updateStock()`,
 *   que escribe `inventory_movements`.
 * - `image_urls`, `images`: el update borra objetos de S3 de forma irreversible.
 * - `variants`: reescribe la matriz de variantes del producto.
 * - `name`, `description`: no tiene sentido darle el mismo nombre o la misma
 *   descripción a N productos.
 * - `category_ids`, `tax_category_ids`, `brand_id`, `enabled_price_tier_ids`:
 *   son relacionales y requieren semántica de añadir / quitar / reemplazar;
 *   fuera del alcance de esta iteración.
 */
export class BulkEditableChangesDto {
  // ===== Tipo y estado =====
  @IsOptional()
  @IsEnum(ProductType)
  product_type?: ProductType;

  @IsOptional()
  @IsEnum(ProductState)
  state?: ProductState;

  @IsOptional()
  @IsEnum(PricingType)
  pricing_type?: PricingType;

  // ===== Flags de la suite restaurante =====
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

  // ===== Inventario (solo flags: las cantidades quedan fuera) =====
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  track_inventory?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requires_serial_numbers?: boolean;

  // ===== Precios =====
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0, { message: 'El precio base no puede ser negativo' })
  base_price?: number;

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
  @IsBoolean()
  @Type(() => Boolean)
  allow_pos_price_override?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  has_multiple_price_tiers?: boolean;

  // ===== Ecommerce =====
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  available_for_ecommerce?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_featured?: boolean;

  // ===== Físico =====
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

  // ===== UoM (FKs al catálogo global units_of_measure) =====
  // El factor purchase→stock NO se acepta del cliente: el backend lo deriva de
  // `factor_to_base` del catálogo, así que `purchase_to_stock_factor` no entra.
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  stock_uom_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  purchase_uom_id?: number;

  // ===== Servicio =====
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

  // ===== Consulta =====
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
}

/** Cuerpo de `POST /store/products/bulk-edit` y de su `/preview`. */
export class BulkEditProductsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BULK_EDIT_IDS)
  @IsInt({ each: true })
  @Type(() => Number)
  ids: number[];

  @IsObject()
  @ValidateNested()
  @Type(() => BulkEditableChangesDto)
  changes: BulkEditableChangesDto;
}

/** Un campo que cambiaría de valor en una fila del preview. */
export class BulkEditFieldDiffDto {
  field: string;
  current: unknown;
  next: unknown;
}

/**
 * Resultado read-only por producto. `warning` significa que el cambio se
 * aplicará pero con una neutralización silenciosa (p. ej. un flag que la
 * industria de la tienda no soporta, o precios que el sanitizer de insumo
 * puro anulará).
 */
export class BulkEditPreviewItemDto {
  id: number;
  name: string;
  sku: string | null;
  status: BulkEditItemStatus;
  changes: BulkEditFieldDiffDto[];
  code?: string;
  message?: string;
}

export class BulkEditPreviewResultDto {
  total: number;
  ok: number;
  warnings: number;
  errors: number;
  items: BulkEditPreviewItemDto[];
}

/** Resultado por producto tras la aplicación real (no hay `warning` aquí). */
export class BulkEditResultItemDto {
  id: number;
  name: string;
  status: Exclude<BulkEditItemStatus, 'warning'>;
  code?: string;
  message?: string;
}

export class BulkEditResultDto {
  total: number;
  successful: number;
  failed: number;
  results: BulkEditResultItemDto[];
}
