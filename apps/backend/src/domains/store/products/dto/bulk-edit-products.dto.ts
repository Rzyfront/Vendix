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

  /**
   * Escala del precio: unidades de stock que cubre `base_price`. Editarla en
   * masa es lo que permite pasar un catálogo entero de "por unidad" a "por
   * metro" sin abrir producto por producto.
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1, { message: 'El precio debe cubrir al menos una unidad de stock' })
  price_unit_quantity?: number;

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

// ===========================================================================
// Archivado masivo (soft-delete) — QUI-567
// ===========================================================================

/**
 * Cuerpo de `POST /store/products/bulk-edit/archive` y de su `/preview`.
 *
 * ACCIÓN DEDICADA, no un campo más de `BulkEditableChangesDto`. `state` sigue
 * siendo editable en masa (y `ARCHIVED` sigue entre sus valores válidos), pero
 * archivar por esa vía es un efecto colateral no anunciado: comparte el permiso
 * `store:products:bulk_update` con `is_featured`, no tiene preview de bloqueos y
 * no exige confirmación reforzada. Esta superficie separada existe para que
 * eliminar N productos tenga permiso propio (`store:products:admin_delete`, el
 * mismo que el borrado individual), preview propio y confirmación propia.
 *
 * Mismos decoradores y mismo tope de 100 ids que `BulkEditProductsDto`: el
 * `ValidationPipe` global es quien los aplica, el controller no re-valida.
 *
 * NO HAY RESTAURACIÓN, ni masiva ni individual: la API no expone ninguna ruta que
 * saque un producto de `archived` (`update()` y `deactivate()` lo excluyen por
 * `where`, y no existe `activate`/`restore`). Revertir exige acceso directo a la
 * base. Decisión asumida en QUI-567: el preview de bloqueos y la confirmación
 * reforzada son la única red antes de una operación irreversible.
 */
export class BulkArchiveProductsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BULK_EDIT_IDS)
  @IsInt({ each: true })
  @Type(() => Number)
  ids: number[];

  /**
   * CP-PURCHASE-TRANSPARENCY D.6 — la confirmación del castigo de inventario,
   * propagada a `ProductsService.remove(id, opts)`.
   *
   * EXISTE PARA QUE LA COMPUERTA INDIVIDUAL NO SE PUEDA BURLAR MANDANDO UN
   * LOTE. El archivado masivo llama a `remove()` producto por producto: sin
   * este campo, en cuanto D.4 aterrizó, o bien un lote de 40 identificadores
   * castigaba el inventario de 40 productos sin que nadie confirmara nada, o
   * bien todos devolvían 409 dentro del bucle y el archivado masivo quedaba
   * roto al 100 %. Con él, un lote de UN solo identificador se comporta
   * exactamente igual que la ruta individual.
   *
   * Ausente ⇒ `false`. La confirmación se declara, nunca se asume.
   */
  @IsOptional()
  @IsBoolean()
  confirm_stock_write_off?: boolean;
}

/**
 * Resultado read-only por producto del preview de archivado.
 *
 * No lleva array de diffs (a diferencia de `BulkEditPreviewItemDto`): no hay
 * campos que el usuario elija cambiar — se archiva y punto. Lo que el usuario
 * necesita ver es el MOTIVO, así que la fila lleva `code` + `message`.
 *
 * Semántica del `status` (decisión de producto, no derivable del código):
 * - `error`: el archivado se BLOQUEA. Reservas de stock activas, o el producto
 *   está en un pedido abierto (no finalizado/cancelado/reembolsado).
 * - `warning`: el archivado SÍ ocurre, pero con consecuencia que el usuario debe
 *   conocer. El producto es insumo de una receta activa, o está en una promoción
 *   vigente.
 * - `ok`: sin observaciones.
 *
 * `code` solo viaja en las filas `error`, igual que en el preview de edición:
 * los warnings no son errores y el contrato prohíbe inventar códigos nuevos
 * para reutilizarlos con otra semántica.
 */
export class BulkArchivePreviewItemDto {
  id: number;
  name: string;
  sku: string | null;
  status: BulkEditItemStatus;
  code?: string;
  message?: string;
  /**
   * D.6 / FB-10 — lo que este producto va a perder si el lote se confirma.
   * Aditivo: las filas `error` los traen igual (en 0 cuando no hay existencias),
   * para que la interfaz no tenga que distinguir formas.
   */
  on_hand_units: number;
  value_to_write_off: number;
  /** Unidades sin costo conocido: se destruyen, pero no generan asiento. */
  zero_cost_units: number;
  /**
   * Unidades en ubicaciones que esta tienda no puede tocar (bodega central de
   * la organización). Bloquean el archivado: se transfieren o ajustan primero.
   */
  out_of_scope_units: number;
}

export class BulkArchivePreviewResultDto {
  total: number;
  ok: number;
  warnings: number;
  errors: number;
  /** D.6 — el total que el operador está a punto de aprobar, en una cifra. */
  total_units_to_write_off: number;
  total_value_to_write_off: number;
  /** `true` si alguna fila tiene existencias: sin confirmar, el lote no castiga. */
  requires_confirmation: boolean;
  items: BulkArchivePreviewItemDto[];
}

/** Resultado por producto tras el archivado real (no hay `warning` aquí). */
export class BulkArchiveResultItemDto {
  id: number;
  name: string;
  status: Exclude<BulkEditItemStatus, 'warning'>;
  code?: string;
  message?: string;
  /** D.6 — lo que ESTA fila destruyó de verdad. 0 en las filas fallidas. */
  written_off_units?: number;
  written_off_value?: number;
  zero_cost_units?: number;
  adjustment_ids?: number[];
}

export class BulkArchiveResultDto {
  total: number;
  successful: number;
  failed: number;
  /** D.6 — el desglose agregado de lo que el lote destruyó. */
  written_off_units: number;
  written_off_value: number;
  results: BulkArchiveResultItemDto[];
}
